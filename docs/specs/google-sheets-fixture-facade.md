# FullCircle Google Sheets Fixture Facade

Bead: `fullcircle-64o.16 — Add Google Sheets fixture facade`

## Scope

This facade defines a typed fixture/resource model for app code that already uses an injectable Google Sheets mock. It does **not** add a Google Sheets HTTP API mock yet. Soundspace-style legacy booking calculations need deterministic Acuity modifier rows, and app tests can consume the emitted JSON/CSV files from their existing `MockGoogleSheetsClient`.

Add an HTTP provider later only if production app code stops using an injectable sheets client and starts calling Google APIs directly.

## API

```ts
const googleSheets = googleSheetsFixtureFacade();

const fixture = googleSheets.resources.acuityModifiers([
  { CalendarId: '7034881', TenderModifier: '1', CreditModifier: '1' },
  { CalendarId: '3287474', TenderModifier: '2', CreditModifier: '0.5' },
]);

await googleSheets.writeFixtureFiles(fixture, {
  directory: 'test-fixtures/google-sheets',
  basename: 'acuity-modifiers.default',
});
```

The fixture shape is:

```ts
{
  kind: 'google-sheets.acuity-modifiers.v1',
  rows: GoogleSheetsAcuityModifierRow[],
  csv: string,
  diagnostics?: string[],
}
```

`resources.acuityModifiers()` validates rows before emitting them so app mocks do not accidentally consume malformed booking modifiers.

## Built-in variants

- `fixtures.acuityModifiersDefault()` — one normal calendar modifier row.
- `fixtures.acuityModifiersEmpty()` — header-only CSV for no configured modifiers.
- `fixtures.acuityModifiersMultiCalendar()` — multiple calendars with different tender/credit modifiers.
- `fixtures.acuityModifiersMalformed()` — intentionally invalid fixture with diagnostics for negative tests.

## Validation rules

For normal resource fixtures:

- `CalendarId` is required.
- `TenderModifier` is required and numeric.
- `CreditModifier` is required and numeric.

Malformed fixtures bypass throwing and include diagnostics, which lets app-level tests exercise defensive parsing paths.

## Acceptance tests

`packages/harness/tests/providers/google_sheets.test.ts` verifies typed fixture generation, deterministic CSV output, validation errors, malformed diagnostics, built-in variants, and writing JSON/CSV files for app mocks.
