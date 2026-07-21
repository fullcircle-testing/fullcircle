# FullCircle HubSpot Provider and Browser Form Sink

Bead: `fullcircle-64o.18 — Add HubSpot provider and browser form sink`

## Scope

This provider covers the HubSpot seams needed by Soundspace-style account completion and browser-page tests:

- server-side CRM contact search by email;
- contact create/update fixtures;
- explicit failure fixtures for account setup paths;
- browser HubSpot form embeds as script sinks unless a test deliberately asserts form loading.

Production app code should wrap the official HubSpot SDK behind an app-owned gateway with an injectable base URL. If the SDK cannot reliably point at FullCircle, keep the SDK in production and make the test gateway call FullCircle-shaped endpoints.

## API

```ts
const hubspot = hubspotProvider(harness);

hubspot.contacts.searchByEmail({
  email: 'new@example.test',
  reply: [],
});

hubspot.contacts.create({
  match: { email: 'new@example.test', firstname: 'New', lastname: 'User' },
  reply: { id: 'hs_contact_1', properties: { email: 'new@example.test' } },
});

hubspot.contacts.update({
  contactId: 'hs_contact_1',
  match: { lifecyclestage: 'customer' },
  reply: { id: 'hs_contact_1', properties: { lifecyclestage: 'customer' } },
});
```

## Endpoints modeled

| Helper | Method/path | Match fields |
| --- | --- | --- |
| `contacts.searchByEmail()` | `POST /crm/v3/objects/contacts/search` | first email filter value in `filterGroups[].filters[]` |
| `contacts.create()` | `POST /crm/v3/objects/contacts` | `properties.*` |
| `contacts.update()` | `PATCH /crm/v3/objects/contacts/:contactId` | `properties.*` |

Successful search responses are shaped as `{ total, results }`. Create/update replies are caller-provided HubSpot-like contact objects.

Mismatch responses return `422` with field-level diagnostics, so app account setup tests fail on payload drift before a fixture is consumed.

## Failure fixtures

```ts
hubspot.contacts.create({
  match: { email: 'fail@example.test' },
  status: 409,
  error: { status: 'error', message: 'Contact already exists', category: 'CONFLICT' },
});
```

High-value cases:

- search returns no contact, then create succeeds;
- search returns existing contact, then update succeeds;
- create conflict is handled idempotently;
- HubSpot unavailable causes the app's account-completion policy to run.

## Browser form sink

HubSpot browser forms load third-party scripts such as `/forms/embed/v2.js`. Default e2e tests should not load real HubSpot scripts. Use the form sink to explicitly block/replace the script with a deterministic stub:

```ts
hubspotFormsSink(harness).formsEmbedScript({
  portalId: '12345',
  formId: 'form_abc',
});
```

The sink installs a minimal `window.hbspt.forms.create()` stub, records calls in `window.__fullcircleHubSpotForms`, and appends a marker element with `data-fullcircle-hubspot-form="true"`. This is enough for app-level tests to verify that the embed point was reached without executing external HubSpot code.

If a future test needs real form behavior, it should model that as a separate explicit fixture rather than silently allowing live script execution.

## Acceptance tests

`packages/harness/tests/providers/hubspot.test.ts` verifies contact search/create, existing search/update, failure responses, mismatch diagnostics, and the browser forms script sink.
