<!-- markdownlint-disable MD013 -->

# Soundspace acceptance journey fixture plan

Status: case-study fixture design only. Soundspace remains a data point for FullCircle provider coverage; this document does not require app-repo seam backports on this branch.

The goal is to show what a mature FullCircle acceptance session should contain for a SaaS app with payments, bookings, CRM enrichment, location search, auth, and deterministic database assertions.

## Shared fixture envelope

Every Soundspace acceptance fixture should be stored as a FullCircle session artifact with these sections:

```ts
type SoundspaceAcceptanceFixture = {
  name: string;
  app: {
    baseUrl: string;
    env: Record<string, string>;
    seed: {
      users?: unknown[];
      listings?: unknown[];
      products?: unknown[];
      balances?: unknown[];
      subscriptions?: unknown[];
    };
  };
  providers: {
    stripe?: unknown;
    acuity?: unknown;
    acuityIframe?: unknown;
    googleSheets?: unknown;
    supabase?: unknown;
    hubspot?: unknown;
    attio?: unknown;
    places?: unknown;
    telemetry?: unknown;
  };
  browser: {
    path: string;
    steps: string[];
    expectedVisibleText?: string[];
  };
  assertions: {
    requests: string[];
    dbDiff: string[];
    auditLog?: string[];
  };
};
```

The fixture should keep business resources readable and let provider helpers derive raw HTTP responses. For example, tests should say “owner has a monthly studio plan” instead of hand-authoring every Stripe `price` field unless the test specifically cares about that field.

## Journey A: new user completes checkout subscription

Purpose: prove a brand-new user can finish account setup, enter checkout, receive a signed Stripe webhook, and end with local subscription rows.

### Inputs

- Supabase/better-auth user seed:
  - Confirmed user email: `student@example.test`.
  - No existing Soundspace `users` profile row.
- App DB seed:
  - Listing/tender with one checkout subscription plan.
  - Product entitlement grants booking balance, e.g. `120` minutes monthly.
- Provider fixtures:
  - Stripe customer list by email returns empty.
  - Stripe customer create returns `cus_fullcircle_student`.
  - HubSpot contact search returns empty.
  - HubSpot contact create returns `hubspot_contact_student`.
  - Attio people query returns empty.
  - Attio people upsert returns `attio_person_student`.
  - Stripe embedded Checkout create returns `cs_test_soundspace_subscription` and client secret.
  - Stripe Checkout retrieve returns a completed subscription-mode session.
  - Stripe line items returns the subscribed price/product.
  - Stripe webhook sequence emits signed `checkout.session.completed`.
  - Telemetry sinks accept page views but fail on Rollbar server errors.

### Expected browser steps

1. Visit complete-login route as the confirmed user.
2. Assert account setup finishes and user can reach checkout.
3. Start embedded Checkout for the plan.
4. Simulate return URL with `session_id=cs_test_soundspace_subscription`.
5. Deliver the signed webhook through the app webhook endpoint.
6. Assert the UI shows the active plan or successful checkout state.

### Expected DB diff

- `users`: one row inserted with Stripe, HubSpot, and Attio ids.
- `subscriptions`: one active subscription row inserted or updated.
- `subscription_items`: row inserted for the Stripe price.
- `balances`: monthly booking balance created from product metadata.
- `stripe_webhook_events`: event id recorded exactly once for idempotency.

## Journey B: legacy Acuity booking respects subscription usage

Purpose: prove the legacy iframe booking page renders deterministic availability based on local subscription balance and Acuity fixture data.

### Inputs

- User seed with an active subscription and remaining booking balance.
- Listing seed with `acuity_calendar_id` and legacy booking URL metadata.
- Stripe resource seed for the product/price metadata that determines balance.
- Google Sheets facade fixture for Acuity modifiers.
- Acuity API resource fixture for existing calendar usage.
- Acuity iframe fixture for captured scheduling HTML patched to local endpoints.

### Expected browser steps

1. Visit the legacy booking page.
2. Load the FullCircle-backed Acuity iframe instead of the live scheduler.
3. Select a valid appointment type and date.
4. Assert appointments that exceed remaining balance are hidden or blocked.
5. Optionally submit a booking when enough balance remains.

### Expected DB diff

- Read-only availability path: no booking/balance rows should be mutated.
- Optional booking path:
  - `bookings`: row inserted with `acuity_appointment_id`.
  - `balances` or balance ledger: consumed minutes decremented/recorded.
  - Audit/event row records booking creation if the app has that table.

## Journey C: new booking page creates and cancels Acuity appointments

Purpose: prove the modern booking flow can create an Acuity appointment, persist local booking state, then cancel and restore balance.

### Inputs

- User seed with available balance.
- Listing/space seed with `acuity_calendar_id`.
- Acuity API fixtures:
  - Calendars list/retrieve.
  - Appointment types.
  - Available dates and times.
  - Forms and form fields.
  - Check-times validation.
  - Appointment create returns `acuity_appointment_1`.
  - Appointment cancel returns a cancelled appointment payload.
- Telemetry sinks strict for Rollbar errors.

### Expected browser steps

1. Visit `/book` for the seeded listing.
2. Choose a date, time, and appointment type.
3. Submit required form fields.
4. Assert confirmation page shows the booked appointment.
5. Cancel the booking.
6. Assert UI shows cancellation/restored availability state.

### Expected DB diff

- `bookings`: inserted with `acuity_appointment_id=acuity_appointment_1`, then marked cancelled.
- Balance ledger: consumed minutes added on creation and reversed on cancellation.
- Request assertions: create happens before cancel, and cancel uses the created appointment id.

## Journey D: listing owner manages Stripe-backed plans

Purpose: prove listing owners can create, modify, and archive plans while local DB state and Stripe product/price operations stay consistent.

### Inputs

- Owner account seed.
- Managed listing/tender seed.
- Stripe fixtures:
  - Product create for a new booking plan.
  - Price create for the first monthly amount.
  - Product update for plan metadata/name changes.
  - Price deactivate for old amount.
  - Price create for revised amount.
  - Product update/archive for deletion.
- Telemetry/widget sinks for non-critical scripts.

### Expected browser steps

1. Visit listing plan management.
2. Create a monthly subscription plan.
3. Edit the plan amount or entitlements.
4. Archive/delete the plan.
5. Assert owner-visible state tracks each mutation.

### Expected DB diff

- `products` or app plan table: inserted, updated, then archived.
- Stripe ids stored exactly once and reused across later mutations.
- Price history keeps old Stripe price inactive and new Stripe price active.
- Request assertions confirm product/price mutation order.

## Fixture naming

Recommended fixture names if these become checked-in artifacts:

- `soundspace.checkout.new-user-subscription.session.json`
- `soundspace.legacy-booking.usage-limited.session.json`
- `soundspace.booking.create-cancel-acuity.session.json`
- `soundspace.owner.stripe-backed-plan-management.session.json`

## Implementation notes for future app-repo work

- Keep Soundspace-specific code out of `@fullcircle/harness` unless a reusable provider or resource builder emerges.
- Use existing generic providers for Stripe, Acuity, Google Sheets, Supabase, HubSpot, Attio, Google Places, and telemetry sinks.
- Add app-local gateway seams before writing browser assertions so every external request can be routed to FullCircle.
- Use DB snapshot/diff helpers for acceptance assertions; avoid relying only on visible UI text for billing/booking side effects.
- Keep optional live-provider smoke tests separate from CI-required acceptance fixtures.
