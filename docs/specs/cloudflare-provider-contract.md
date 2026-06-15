# FullCircle Cloudflare Provider Contract

Bead: `fullcircle-64o.26 — Add Cloudflare provider`

## Scope

This provider models the Cloudflare API calls needed by SaaS control-plane e2e tests before app repos use real Cloudflare services:

- D1 query/control-plane workflows;
- Cloudflare Tunnel deletion and already-deleted failures;
- future DNS record create/update/delete workflows when hostname routing moves out of Pulumi.

It targets app code configured with Cloudflare's API base URL pointed at FullCircle instead of `https://api.cloudflare.com/client/v4`.

## Provider API

```ts
const cloudflare = cloudflareProvider(harness);

cloudflare.d1.query({
  accountId: 'acct_123',
  databaseId: 'db_123',
  match: {
    sql: /select \* from lifecycle_jobs/i,
    params: ['job_1'],
  },
  reply: {
    results: [{ id: 'job_1', status: 'active' }],
    meta: { served_by: 'fullcircle' },
  },
});

cloudflare.tunnels.delete({
  accountId: 'acct_123',
  tunnelId: 'tun_123',
  reply: { id: 'tun_123', deleted: true },
});

cloudflare.dns.records.create({
  zoneId: 'zone_123',
  match: { type: 'CNAME', name: 'app.example.test', content: 'tunnel.example.test' },
  reply: { id: 'dns_123', type: 'CNAME', name: 'app.example.test' },
});
```

## Endpoints modeled

| Provider helper | Method/path | Match fields |
| --- | --- | --- |
| `d1.query()` | `POST /client/v4/accounts/:accountId/d1/database/:databaseId/query` | `sql`, `params` |
| `tunnels.delete()` | `DELETE /client/v4/accounts/:accountId/cfd_tunnel/:tunnelId` | id in path |
| `dns.records.create()` | `POST /client/v4/zones/:zoneId/dns_records` | `type`, `name`, `content`, `proxied`, `ttl` |
| `dns.records.update()` | `PUT /client/v4/zones/:zoneId/dns_records/:recordId` | `type`, `name`, `content`, `proxied`, `ttl` |
| `dns.records.delete()` | `DELETE /client/v4/zones/:zoneId/dns_records/:recordId` | id in path |

All successful responses use Cloudflare's envelope shape:

```json
{
  "success": true,
  "errors": [],
  "messages": [],
  "result": {}
}
```

D1 query responses wrap the query result as `result: [{ results, meta, success }]`, which matches the D1 query API's result-list style.

## Failure fixtures

Helpers accept `status`, `errors`, and `messages` for Cloudflare-style failures:

```ts
cloudflare.d1.query({
  accountId: 'acct_123',
  databaseId: 'db_123',
  match: { sql: 'UPDATE lifecycle_jobs SET status = ? WHERE id = ?' },
  status: 400,
  errors: [{ code: 7500, message: 'D1_ERROR: no such table' }],
});

cloudflare.tunnels.delete({
  accountId: 'acct_123',
  tunnelId: 'tun_missing',
  status: 404,
  errors: [{ code: 1003, message: 'tunnel not found' }],
});
```

Request mismatches return `422` with FullCircle diagnostics before configured provider failures. That makes fixture failures about Cloudflare behavior, not about accidental app payload drift.

## Acceptance tests

`packages/harness/tests/providers/cloudflare.test.ts` verifies:

1. D1 query matching and response envelopes;
2. D1 error envelopes and SQL mismatch diagnostics;
3. tunnel deletion and already-deleted/not-found responses;
4. DNS record create/update/delete fixtures for future routing work.

## References

- Cloudflare D1 query API: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
- Cloudflare D1 remote API guidance: https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/
- Cloudflare API reference root: https://developers.cloudflare.com/api/
