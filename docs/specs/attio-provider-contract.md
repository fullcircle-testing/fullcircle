# FullCircle Attio Provider Contract

Bead: `fullcircle-64o.19 — Add Attio provider`

## Scope

This provider covers the Attio seams needed by Soundspace-style account setup tests: direct fetch calls that query people by email and assert/upsert a person record by email. It also includes the generic records search endpoint as a low-cost fixture for apps that use Attio's search flow before switching to strongly consistent record queries.

## API

```ts
const attio = attioProvider(harness);

attio.people.queryByEmail({
  email: 'new@example.test',
  reply: [],
});

attio.people.upsertByEmail({
  email: 'new@example.test',
  reply: { id: { record_id: 'attio_person_1' } },
});

attio.records.search({
  match: { query: 'new@example.test' },
  reply: [{ object: 'people', id: { record_id: 'attio_person_1' } }],
});
```

## Endpoints modeled

| Helper | Method/path | Match fields |
| --- | --- | --- |
| `people.queryByEmail()` | `POST /v2/objects/people/records/query` | email found anywhere in the filter tree |
| `people.upsertByEmail()` | `PUT /v2/objects/people/records?matching_attribute=email_addresses` | email found anywhere under `data` |
| `records.search()` | `POST /v2/objects/records/search` | `query` |

Successful Attio responses are wrapped as `{ data: ... }`, matching Attio's REST response style.

## Failure fixtures

```ts
attio.people.upsertByEmail({
  email: 'fail@example.test',
  status: 409,
  error: { type: 'invalid_request_error', code: 'conflict', message: 'Multiple records matched' },
});
```

High-value cases:

- no person found, then upsert succeeds;
- existing person found, account setup reuses the Attio record id;
- upsert conflict/failure causes the app's account-completion policy to run;
- generic search returns eventual-consistency results only when the app explicitly depends on search.

## Acceptance tests

`packages/harness/tests/providers/attio.test.ts` verifies people query by email, upsert by email, generic records search, failure fixtures, and mismatch diagnostics.

## References

- Attio list person records: https://docs.attio.com/rest-api/endpoint-reference/people/list-person-records
- Attio upsert record: https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record
- Attio records search: https://docs.attio.com/rest-api/endpoint-reference/records/search-records
