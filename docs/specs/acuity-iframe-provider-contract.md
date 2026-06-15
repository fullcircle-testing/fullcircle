# FullCircle Acuity Iframe Provider Contract

Bead: `fullcircle-64o.15 — Add Acuity iframe HTML capture provider`

## Scope

This provider supports legacy Acuity iframe booking flows where an app embeds `https://app.acuityscheduling.com/schedule.php?...`. It is intentionally separate from the Acuity API provider: the API provider fixtures JSON endpoints, while this provider serves a captured schedule-page HTML document with small, high-signal edits for deterministic browser tests.

The provider is useful when an e2e test needs the app to render an iframe-like booking surface without contacting Acuity. It does not attempt to recreate Acuity's whole frontend; it patches captured HTML enough for app-level tests to click, fill, or assert key states.

## Provider API

```ts
const iframe = acuityIframeProvider(harness);

iframe.schedulePage({
  owner: '18362646',
  calendarId: '7034881',
  capturedHtml: await fs.readFile('fixtures/acuity/schedule.php.html', 'utf8'),
  user: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    phone: '+15551234567',
  },
  appointmentTypes: [
    { id: '111', name: 'Two hour session', durationMinutes: 120 },
    { id: '222', name: 'Three hour session', durationMinutes: 180 },
  ],
  hiddenSelectors: ['#phone', '#email'],
});
```

This registers `GET /schedule.php` and, when provided, matches `owner` and `calendarID` query parameters. The response content type is `text/html; charset=utf-8`.

## HTML patching model

The provider starts from `capturedHtml` or a minimal built-in baseline, then applies deterministic edits:

- patch `firstName`, `lastName`, `email`, and `phone` input values by matching `name` or `id` attributes
- replace the `appointmentType` select options with deterministic options that include `data-fullcircle-appointment-type`
- inject a `<style data-fullcircle-hidden-selectors>` block for selectors that should be hidden in tests
- inject a `<script type="application/json" data-fullcircle-acuity-iframe>` metadata block with owner, calendar, variant, and appointment types

The strategy keeps the captured Acuity page as the source of truth while making test-specific data visible and repeatable.

## Variants

`variant` supports common booking states without requiring separate static HTML files for every case:

| Variant | Status | Injected text |
| --- | --- | --- |
| `default` | `200` | none |
| `insufficient_credits` | `200` | `Not enough booking credit` |
| `max_hours_reached` | `200` | `Maximum bookable hours reached` |
| `multi_calendar_chooser` | `200` | `Choose a calendar` |
| `acuity_unavailable` | `503` | `Acuity is unavailable` |

Each helper also accepts an explicit `status` override for app-specific failure handling.

## Acceptance tests

`packages/harness/tests/providers/acuity_iframe.test.ts` verifies:

1. captured schedule HTML is patched with user values, appointment types, hidden selectors, and metadata;
2. insufficient-credit, max-hours, calendar-chooser, and unavailable variants render deterministic state text/status;
3. owner/calendar query matching prevents a captured page from accidentally satisfying the wrong iframe URL.

## Non-goals

- Do not model Acuity's complete client-side booking app.
- Do not use this provider for JSON endpoints; use `acuityProvider()` instead.
- Do not create one full static fixture per business case when a captured baseline plus patch metadata is enough.
