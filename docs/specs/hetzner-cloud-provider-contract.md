# FullCircle Hetzner Cloud Provider Contract

Bead: `fullcircle-64o.25 — Add Hetzner Cloud provider`

## Scope

This provider models the Hetzner Cloud lifecycle calls needed by SaaS control-plane e2e tests: server create/delete, volume create/attach/detach/delete, and action polling. It targets app code that points its Hetzner Cloud API base URL at FullCircle instead of making real calls to `https://api.hetzner.cloud/v1`.

The provider focuses on deterministic provisioning workflows and failure recovery. Real Hetzner smoke tests should remain opt-in and env-gated.

## Provider API

```ts
const hcloud = hetznerProvider(harness);

hcloud.servers.create({
  match: {
    name: 'acme-app',
    serverType: 'cpx21',
    image: /snapshot-.+/,
    location: 'nbg1',
  },
  reply: { id: 1001, name: 'acme-app', ipv4: '203.0.113.10' },
  replyAction: { id: 3001, status: 'success' },
});

hcloud.volumes.create({
  match: { name: 'acme-data', size: 50, location: 'nbg1' },
  reply: { id: 2001, name: 'acme-data' },
  replyAction: { id: 3002, status: 'success' },
});

hcloud.volumes.attach({
  volumeId: 2001,
  match: { server: 1001, automount: true },
  replyAction: { id: 3003, status: 'running' },
});

hcloud.actions.get({
  actionId: 3003,
  reply: { id: 3003, status: 'success' },
});

hcloud.servers.delete({ serverId: 1001, replyAction: { id: 3004 } });
hcloud.volumes.delete({ volumeId: 2001, status: 204 });
```

## Endpoints modeled

| Provider helper | Method/path | Match fields |
| --- | --- | --- |
| `servers.create()` | `POST /v1/servers` | `name`, `server_type`, `image`, `location`, `start_after_create` |
| `servers.delete()` | `DELETE /v1/servers/:id` | id in path |
| `volumes.create()` | `POST /v1/volumes` | `name`, `size`, `location`, `server`, `automount`, `format` |
| `volumes.attach()` | `POST /v1/volumes/:id/actions/attach` | `server`, `automount` |
| `volumes.detach()` | `POST /v1/volumes/:id/actions/detach` | `server`, `automount` when supplied |
| `volumes.delete()` | `DELETE /v1/volumes/:id` | id in path |
| `actions.get()` | `GET /v1/actions/:id` | id in path |

Request mismatches return `422` with field-level diagnostics before any configured failure fixture is returned. This keeps tests honest: a fixture only satisfies the app when the app sends the expected lifecycle payload.

## Failure fixtures

All mutation helpers accept `status` plus `error` to model provider failures:

```ts
hcloud.servers.create({
  match: { name: 'acme-app', serverType: 'cpx21' },
  status: 503,
  error: { code: 'resource_unavailable', message: 'No capacity in location' },
});

hcloud.volumes.attach({
  volumeId: 2001,
  match: { server: 1001 },
  status: 422,
  error: { code: 'invalid_input', message: 'server cannot attach volume' },
});

hcloud.actions.get({
  actionId: 3003,
  reply: { id: 3003, status: 'error', error: { code: 'action_failed', message: 'attach failed' } },
});
```

High-value acceptance scenarios:

1. happy path: create server, create volume, attach volume, poll success, persist runtime outputs;
2. server allocation failure: job fails without active runtime state;
3. volume attach failure: provider ids remain available for cleanup/resume;
4. action remains running/then errors: app timeout/retry path is exercised;
5. teardown: server deletion succeeds while volume deletion fails.

## Acceptance tests

`packages/harness/tests/providers/hetzner.test.ts` verifies:

1. server create/delete fixture shape and request matching;
2. volume create/attach/detach/delete plus action polling;
3. configured Hetzner errors and mismatch diagnostics.

## References

- Hetzner Cloud API reference: https://docs.hetzner.cloud/reference/cloud
- Hetzner API authentication basics: https://docs.hetzner.com/cloud/api/getting-started/using-api/
