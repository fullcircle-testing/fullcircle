<!-- markdownlint-disable MD013 -->

# Soundspace FullCircle provider and fixture plan

Status: case-study plan for `~/repos/soundspace` based on source inspection on 2026-06-11.

Soundspace is a good stress case for FullCircle because it already routes some SDK traffic through FullCircle in legacy Playwright tests, while newer app code mixes injectable SDK clients, direct `fetch()` calls, local Supabase, and browser-only third-party scripts.

## Current integration map

| Service | Source locations | Current seam | Test priority |
| --- | --- | --- | --- |
| Stripe API | `src/utils/stripe/*`, `src/app/(header-footer-layout)/checkout/createCheckoutSession.ts`, `src/utils/checkout/handleCheckoutSessionComplete.ts`, `src/app/stripe-webhook/*`, subscription management pages | `StripeClient` accepts a mock base URL via `src/utils/stripe/StripeMock.ts`; `APP_ENV=test` points to `http://localhost:3005` | Critical |
| Acuity API | `src/utils/acuity/AcuityClient.ts`, `src/external/acuity/*.ts`, `src/app/(header-footer-layout)/book/**`, legacy booking utilities | Legacy `deps.acuity()` uses injectable base URL, but newer `src/external/acuity/Acuity.ts` hardcodes `https://acuityscheduling.com/api/v1` | Critical |
| Acuity iframe | `src/app/(header-footer-layout)/legacy-book/iframe-proxy/route.ts`, `src/app/(header-footer-layout)/legacy-book/components/BookingMain.tsx` | `deps.data.acuityProxyUrl` points to `http://localhost:3002` in test, but `BookingMain.tsx` still contains a hardcoded iframe URL | Critical for legacy flow |
| Google Sheets | `src/utils/google-sheets/*`, legacy booking pages | Already replaced by `MockGoogleSheetsClient` in `APP_ENV=test`; no HTTP harness today | Medium |
| Supabase auth/storage | `src/utils/supabase/*`, auth routes/pages, image upload URL route | Local Supabase URLs in `tests-e2e/testdata/env_vars.ts`; service-role client for storage signed upload URLs | Critical for accounts, medium for storage |
| Prisma/Postgres | `src/utils/prisma/prisma.ts`, `prisma/schema/schema.prisma`, Docker Supabase Postgres | Real local DB in e2e; reset scripts exist | Critical |
| HubSpot | `src/utils/hubspot/createHubspotServerClient.ts`, `auth/complete-login/setUpAccount.ts`, HubSpot form components | Server SDK has no injectable base URL; browser forms load external script | Medium |
| Attio | `auth/complete-login/setUpAccount.ts` | Direct `fetch()` to `https://api.attio.com/v2/...`; no seam | Medium |
| Google Places/Maps | `my-listings/locations/create/googlePlacesSearch.ts`, location details map component | Direct `fetch()` to Places API; browser Maps API key prop | Medium |
| PostHog | `src/app/providers/PostHogProvider.tsx` | Can be disabled via `NEXT_PUBLIC_POSTHOG_OPT_OUT=true` | Low |
| Rollbar | `src/utils/rollbar/*`, `src/instrumentation.ts`, error pages | Frontend endpoint points back to app; server Rollbar direct SDK | Low |
| Intercom | `src/app/(header-footer-layout)/components/IntercomWrapper.tsx` | Browser SDK only; no server dependency | Low |

Existing legacy FullCircle usage lives in `tests-e2e/run_full_circle.ts` and `tests-e2e/tests/acuity_form.spec.ts`. The lockfile dependency is `fullcircle` from `fullcircle-testing/fullcircle.git#7f03209704305a9f7b25513e89b77a84f1237db8` (`tests-e2e/package.json`, `tests-e2e/pnpm-lock.yaml`). It currently starts three FullCircle servers: Acuity API on port 3001, Acuity iframe on 3002, and Stripe API on 3005.

The old Stripe mock hook is still present: `src/utils/stripe/StripeMock.ts` defines `newMockStripeHttpClient(url)`, and `src/utils/stripe/StripeClient.ts` passes it into Stripe's SDK `httpClient` option. `git grep --all` shows the same artifact on `main`, `staging`, and `debug/tender-network-auth`; no older separate mock client appears necessary.

## Recommended app harness shape

Soundspace should keep one app-local dependency module, but the seam should cover every network boundary, including direct `fetch()` code:

```ts
export type SoundspaceHarnessUrls = {
  stripeApi: string;
  stripeJs?: string;
  acuityApi: string;
  acuityIframe: string;
  hubspotApi: string;
  hubspotFormsJs?: string;
  attioApi: string;
  googlePlacesApi: string;
  googleSheetsApi?: string;
  rollbarApi?: string;
  posthogApi?: string;
  intercomJs?: string;
};

export type SoundspaceExternalClients = {
  stripe: () => StripeClient;
  acuity: () => AcuityGateway;
  googleSheets: () => IGoogleSheetsClient;
  hubspot: () => HubspotGateway;
  attio: () => AttioGateway;
  places: () => GooglePlacesGateway;
  telemetry: () => TelemetryGateway;
  urls: SoundspaceHarnessUrls;
};
```

Actionable app changes before FullCircle can own the whole suite:

1. Change `src/external/acuity/Acuity.ts` from a hardcoded `ACUITY_BASE_URL` to the same configured `acuityApi` URL used by `deps.acuity()`.
2. Route `BookingMain.tsx` iframe URL through `deps.data.acuityProxyUrl` instead of hardcoding `https://app.acuityscheduling.com/schedule.php?...`.
3. Wrap HubSpot SDK construction behind a `HubspotGateway` whose transport/base URL can be injected. If the official SDK cannot reliably accept a base URL, keep the SDK for production and use an app-local gateway interface in tests.
4. Wrap Attio and Google Places direct `fetch()` calls behind small gateways that accept `baseUrl`.
5. Treat analytics/error-reporting/browser widgets as sinks by default in e2e; only capture them in tests that explicitly assert observability.

## FullCircle provider set

These provider APIs are deliberately higher-level than raw route registration. The intent is for an agent to write readable tests that model business resources, and for the provider to translate those resources into HTTP fixtures plus request assertions.

### 1. Stripe Soundspace provider

Build on the existing FullCircle Stripe provider, but add Soundspace-specific resources around products, prices, subscriptions, invoices, customer portal, and checkout.

```ts
const stripe = stripeProvider(harness, {
  webhookEndpoint: `${appUrl}/stripe-webhook`,
  webhookSigningSecret: env.STRIPE_WEBHOOK_SECRET,
});

stripe.customers.listByEmail({ email, reply: [customer] });
stripe.customers.create({ match: { email }, reply: customer });

stripe.products.list({ reply: [bookingProduct, legacyBookingProduct, nonBookingProduct] });
stripe.products.retrieve({ id: 'prod_booking_1', reply: bookingProduct });
stripe.products.create({ match: { name: /Piano Room/ }, reply: bookingProduct });
stripe.products.update({ id: 'prod_booking_1', match: { metadata: {} }, reply: bookingProduct });
stripe.products.search({ query: 'metadata["soundspace_product_type"]:"pause"', reply: [pauseProduct] });

stripe.prices.retrieve({ id: 'price_monthly_1', reply: monthlyPrice });
stripe.prices.create({ match: { product: 'prod_booking_1', recurringInterval: 'month' }, reply: monthlyPrice });
stripe.prices.update({ id: 'price_monthly_1', match: { active: false }, reply: inactivePrice });
stripe.prices.list({ match: { product: 'prod_pause' }, reply: [pausePrice] });

// Future embedded-Checkout provider contract, not implemented in the hosted
// Checkout v1 provider.
stripe.checkout.sessions.createEmbeddedSubscription({
  match: {
    customer: 'cus_soundspace_user',
    uiMode: 'embedded',
    returnUrlContains: '/checkout/return',
    metadata: { user_id: userId, plan_id: planId },
    lineItems: [{ price: 'price_booking_month', quantity: 2 }],
  },
  reply: checkoutSession,
});
stripe.checkout.sessions.retrieveCompleted({ id: 'cs_soundspace_1', subscription });
stripe.checkout.sessions.lineItems({ sessionId: 'cs_soundspace_1', reply: checkoutLineItems });

stripe.subscriptions.retrieve({ id: 'sub_soundspace_1', reply: subscription });
stripe.subscriptions.list({ customer: 'cus_soundspace_user', reply: [subscription] });
stripe.subscriptions.update({ id: 'sub_soundspace_1', match: { cancel_at_period_end: true }, reply: canceledAtPeriodEndSubscription });

stripe.invoices.retrieve({ id: 'in_soundspace_1', reply: draftInvoice });
stripe.invoices.finalize({ id: 'in_soundspace_1', reply: openInvoice });
stripe.invoices.list({ subscription: 'sub_soundspace_1', reply: [priorInvoice, currentInvoice] });

await stripe.webhooks.sendSequence(stripe.sequences.checkoutSubscriptionPaid({
  checkoutSession,
  subscription,
  invoice,
}));
```

Estimated fixtures:

- `customer.none.json`: list-by-email returns `data: []`.
- `customer.existing.json`: list-by-email returns existing `cus_*`.
- `checkout.embedded.subscription.create.json`: future embedded Checkout fixture; `POST /v1/checkout/sessions` response with `client_secret`, `ui_mode=embedded`, `mode=subscription`, and Soundspace metadata.
- `checkout.completed.retrieve.json`: `GET /v1/checkout/sessions/:id?expand[]=subscription` with expanded subscription.
- `checkout.line_items.booking-products.json`: line items with expanded `price.product` IDs matching Prisma plan products.
- `webhook.checkout.session.completed.json`: event that triggers `handleCheckoutSessionComplete()`.
- `webhook.invoice.created.json`: draft invoice path plus `invoices.finalizeInvoice` follow-up.
- `webhook.invoice.paid.json`: period rollover and balance renewal.
- `webhook.customer.subscription.updated.json`: pause/resume/cancel-at-period-end updates.
- `webhook.customer.subscription.deleted.json`: cancellation and balance removal.
- `products.admin-sync.json`: product/price create, update, deactivate, and search responses for my-listings tender plan admin flows.

Resource usage injection:

```ts
stripe.resources.subscriptionPlan({
  planId,
  customerId,
  products: [
    { productId: 'prod_room_hours', priceId: 'price_room_hours_month', quantity: 2, usage: { kind: 'minutes', perUnit: 60 } },
    { productId: 'prod_credits', priceId: 'price_credits_month', quantity: 1, usage: { kind: 'credits', perUnit: 10 } },
  ],
});
```

The provider should expose the same resource object to DB seed helpers so the Stripe line items, Prisma plan rows, and expected balance rows cannot drift.

### 2. Acuity API provider

Soundspace needs both legacy credit-booking endpoints and newer booking-page endpoints.

```ts
const acuity = acuityProvider(harness);

acuity.appointmentTypes.list({ calendarId: 7034881, reply: [halfHour, twoHour, threeHour] });
acuity.appointments.listByEmail({ email, minDate: today, reply: bookedAppointments });
acuity.calendars.list({ reply: [calendarHq, calendarBrooklyn] });
acuity.availability.dates({ calendarId, appointmentTypeId, month: '2026-06', reply: ['2026-06-12'] });
acuity.availability.times({ calendarId, appointmentTypeId, date: '2026-06-12', reply: [{ time: '2026-06-12T10:00:00-0400' }] });
acuity.availability.checkTimes({ match: { calendarId, appointmentTypeId, datetime }, reply: { valid: true } });
acuity.forms.list({ appointmentTypeId, reply: [bookingForm] });
acuity.appointments.create({ match: { calendarId, appointmentTypeId, email, datetime }, reply: createdAppointment });
acuity.appointments.cancel({ appointmentId: 'apt_1', reply: { ok: true } });
```

Estimated fixtures:

- Existing legacy fixtures already cover `GET /api/v1/appointment-types` and `GET /api/v1/appointments?email&minDate`.
- Add `calendars.list.json`, `availability.dates.available.json`, `availability.times.available.json`, `availability.check-times.valid.json`, `forms.booking.json`, `appointments.create.success.json`, `appointments.cancel.success.json`.
- Failure fixtures: no availability, invalid selected time, create conflict, cancel failure.

Resource usage injection:

```ts
acuity.resources.calendarUsage({
  email,
  calendars: [
    { calendarId: 7034881, minutesBooked: 90, appointments: [{ durationMinutes: 60 }, { durationMinutes: 30 }] },
  ],
});
```

The provider can derive `GET /appointments` responses from `calendarUsage()` and let tests assert Soundspace's computed booked minutes without hand-editing raw Acuity JSON.

### 3. Acuity iframe provider

The existing legacy iframe fixture is a large captured HTML page. Keep that as a captured session, but layer a small editor on top for high-signal test inputs.

```ts
const iframe = acuityIframeProvider(harness);

iframe.schedulePage({
  owner: '18362646',
  calendarId: '7034881',
  user: { firstName, lastName, email, phone },
  appointmentTypes: [twoHour, threeHour],
  hiddenSelectors: ['#phone', '#email'],
});
```

Estimated fixtures:

- Existing `schedule.php/GET.json` as baseline.
- Variants for “too little credit”, “max hours reached”, “multi-calendar chooser”, and “Acuity unavailable”.

The long-term provider should support DOM/HTML patching against a captured page rather than creating entire static copies for every variant.

### 4. Google Sheets provider / fixture facade

Today this is already a mock object in `APP_ENV=test`. FullCircle should still define the resource model because the Acuity provider and legacy booking calculations depend on it.

```ts
googleSheets.resources.acuityModifiers([
  { CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1' },
  { CalendarId: '3287474', TenderModifier: '2', CreditModifier: '0.5' },
]);
```

Estimated fixtures:

- `acuity-modifiers.default.csv`.
- `acuity-modifiers.empty.csv`.
- `acuity-modifiers.multi-calendar.csv`.
- `acuity-modifiers.malformed.csv`.

Implementation options:

- Short term: keep using `MockGoogleSheetsClient` and have FullCircle emit a typed fixture file consumed by that mock.
- Later: add a Google Sheets HTTP provider only if the production code stops using an injectable client.

### 5. Supabase auth/storage plus database provider

For routine user authentication, do not mock Google OAuth. Prefer local Supabase plus direct account/session helpers. Soundspace already has local Supabase URLs in `tests-e2e/testdata/env_vars.ts`.

```ts
const db = databaseProvider({ url: process.env.DIRECT_URL });
const auth = supabaseAuthProvider({ supabaseUrl, serviceRoleKey });

const snap = await db.snapshot('before checkout');
const user = await auth.users.createPasswordUser({ email, password, confirmed: true });
await auth.sessions.loginInBrowser(page, user);

// Run flow...
await expect(db.diff(snap)).toContainRows({ table: 'subscriptions', where: { users_id: user.soundspaceUserId } });
```

Estimated fixtures/seeds:

- `auth.confirmed-basic-user`: Supabase auth user plus Soundspace `users` row.
- `auth.new-user-complete-login`: Supabase user only; e2e hits `/auth/complete-login` and fixtures Stripe/HubSpot/Attio customer creation.
- `auth.google-oauth-callback`: only for testing OAuth callback wiring; otherwise skip real OAuth.
- `storage.upload-url.success`: Supabase storage signed upload URL flow for listing images.

Database resource usage and diffs should be first-class:

```ts
await db.seed.soundspacePlan(stripe.resources.subscriptionPlan(...));
const before = await db.snapshot();
// exercise browser flow
expect(await db.diff(before)).toMatchObject({
  inserted: {
    subscriptions: [{ stripe_subscription_id: 'sub_soundspace_1' }],
    balances: expect.arrayContaining([{ balance: 120 }]),
  },
});
```

Even though the product direction prefers SQLite, Soundspace itself currently uses Prisma/Postgres through local Supabase. The generic FullCircle DB API should support SQLite first and Postgres through an adapter so this case study can still dogfood snapshot/diff behavior.

### 6. HubSpot provider

Server setup calls `crm.contacts.searchApi.doSearch()` and `crm.contacts.basicApi.create()` during account completion.

```ts
const hubspot = hubspotProvider(harness);
hubspot.contacts.searchByEmail({ email, reply: [] });
hubspot.contacts.create({ match: { email }, reply: { id: 'hs_contact_1', properties: { email } } });
```

Estimated fixtures:

- `contacts.search.none.json`.
- `contacts.search.existing.json`.
- `contacts.create.success.json`.
- `contacts.create.failure.json`.

Browser HubSpot form embeds should be treated as a script sink unless a test explicitly verifies form loading.

### 7. Attio provider

Account setup uses direct fetch calls to query or upsert people records.

```ts
const attio = attioProvider(harness);
attio.people.queryByEmail({ email, reply: [] });
attio.people.upsertByEmail({ email, reply: { id: { record_id: 'attio_person_1' } } });
```

Estimated fixtures:

- `people.query.none.json`.
- `people.query.existing.json`.
- `people.upsert.success.json`.
- `people.query.failure.json`.

### 8. Google Places provider

Location creation calls `POST https://places.googleapis.com/v1/places:searchText`.

```ts
const places = googlePlacesProvider(harness);
places.searchText({
  match: { textQuery: /Soundspace/i },
  reply: [{ id: 'places/soundspace-hq', displayName: { text: 'Soundspace HQ' } }],
});
```

Estimated fixtures:

- `places.searchText.single.json`.
- `places.searchText.empty.json`.
- `places.searchText.error.json`.

### 9. Telemetry/widget sinks

PostHog, Rollbar, Intercom, and third-party browser scripts should default to “blocked but recorded” sinks for deterministic e2e.

```ts
telemetry.sink.posthog({ assertNoUnexpectedIdentify: false });
telemetry.sink.rollbar({ failOnServerErrorReport: true });
telemetry.sink.intercom();
```

Estimated fixtures:

- Usually none. These providers primarily assert that no critical flow requires analytics to be reachable.
- Optional `rollbar.error-report.json` when testing error instrumentation.

## Suggested Soundspace acceptance journeys

### A. New user completes checkout subscription

1. Seed local DB with a Soundspace plan and products generated from `stripe.resources.subscriptionPlan()`.
2. Create a confirmed Supabase user with no Soundspace profile.
3. Fixture Stripe customer list/create, HubSpot contact search/create, Attio person query/upsert.
4. Visit complete-login; assert `users` row created with Stripe/HubSpot/Attio IDs.
5. Visit checkout, create embedded Stripe Checkout session, return with `session_id`.
6. Fixture Checkout retrieve and line items; send signed `checkout.session.completed` webhook.
7. Assert DB diff: `subscriptions`, `subscription_items`, `balances`, and `stripe_webhook_events` rows inserted/updated.

### B. Legacy Acuity booking respects subscription usage

1. Seed user, subscription, balances, and Stripe product metadata.
2. Inject Google Sheets acuity modifiers.
3. Inject Acuity appointments via `acuity.resources.calendarUsage()`.
4. Visit legacy booking page through Playwright.
5. Assert the iframe/provider output hides or allows appointments based on remaining credits/hours.
6. Optionally create an appointment and assert DB balance consumption rows.

### C. New booking page creates and cancels Acuity appointments

1. Seed a user with available balance and a space with `acuity_calendar_id`.
2. Fixture Acuity calendars, appointment types, dates, times, forms, check-times, and create appointment.
3. Click through `/book` and submit booking.
4. Assert DB diff includes booking row with `acuity_appointment_id` and consumed balance.
5. Fixture cancel endpoint; cancel booking and assert balance restored / cancellation state.

### D. Listing owner manages Stripe-backed plans

1. Seed an owner account and managed listing/tender.
2. Fixture Stripe product/price create for a new managed plan.
3. Modify the plan; fixture product update, price deactivation, and price create.
4. Delete/archive the plan; fixture product/price inactive updates.
5. Assert DB diffs and request assertions agree on Stripe object IDs.

## What this implies for FullCircle

1. Providers should expose resource builders, not only raw HTTP route helpers. Tests should say “this user has 2 hours booked” or “this plan grants 120 minutes”, and providers should derive raw service fixtures.
2. A session file should contain: app resource seeds, provider fixtures, webhook sequence, browser capture metadata, request assertions, redaction rules, and DB snapshots/diffs.
3. FullCircle should support multiple targets per session (`stripe`, `acuity-api`, `acuity-iframe`, `hubspot`, `attio`, `places`) and make target URL injection explicit.
4. DB snapshot/diff should be a core harness capability. SQLite can ship first, but the API should not assume SQLite-only because Soundspace dogfoods Postgres/Supabase today.
5. Agents need an “external communications inventory” skill: scan imports and direct URLs, add seams for unowned network calls, then record each provider session before writing browser assertions.

## Immediate implementation order

1. Add Soundspace-specific fixture/resource builders to the existing Stripe provider: customers, products, prices, subscriptions, invoices, and checkout sequence helpers.
2. Add a generic DB snapshot/diff API with SQLite first and an adapter boundary for Postgres.
3. Add Acuity API provider for the endpoints listed above.
4. Add an Acuity iframe HTML-capture provider that can patch captured pages.
5. Add small JSON providers for HubSpot, Attio, and Google Places.
6. Add telemetry sinks.
7. Backport app seams in Soundspace: hardcoded Acuity API/iframe URLs, HubSpot gateway, Attio gateway, Places gateway.
