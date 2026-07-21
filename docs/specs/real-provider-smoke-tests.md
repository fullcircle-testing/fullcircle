# Optional real-provider smoke tests

FullCircle keeps normal CI deterministic by testing provider contracts against local fixtures. Real-provider smoke tests are intentionally separate and opt-in so they never spend money, mutate provider state, or depend on external availability during required CI.

## Run command

```bash
FULLCIRCLE_REAL_PROVIDER_SMOKE=1 \
HCLOUD_TOKEN=... \
OPENROUTER_API_KEY=... \
AUTUMN_SECRET_KEY=... \
npm run test:smoke:real-providers
```

Each provider test is read-only and is skipped when its provider-specific credential is absent. The suite is also skipped unless `FULLCIRCLE_REAL_PROVIDER_SMOKE=1` is set.

## Providers

- Hetzner Cloud: `GET https://api.hetzner.cloud/v1/locations` with `HCLOUD_TOKEN`.
- OpenRouter: `GET https://openrouter.ai/api/v1/models` with `OPENROUTER_API_KEY`.
- Autumn: `POST https://api.useautumn.com/v1/customers.list` with `AUTUMN_SECRET_KEY` or `AUTUMN_API_KEY` and `limit: 1`.

The endpoints are deliberately low-impact catalog/list calls. Destructive or billable operations belong in sandbox-specific manual tests, not this smoke suite.

References:

- Hetzner Cloud API docs: https://docs.hetzner.cloud/reference/cloud
- OpenRouter models API: https://openrouter.ai/docs/api/api-reference/models/get-models
- Autumn customers list API: https://docs.useautumn.com/api-reference/customers/listCustomers

## CI policy

- Do not add this command to required push/PR checks.
- It may run in a scheduled/manual workflow only when secrets are configured.
- Failures should be treated as provider availability/credential signals, not as a blocker for fixture-backed contract tests unless the provider API has intentionally changed and the local provider contract must be updated.
