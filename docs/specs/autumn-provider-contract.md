# FullCircle Autumn Billing Provider Contract

Bead: `fullcircle-64o.28 — Add Autumn billing provider`

## Scope

This provider models Autumn billing and entitlement calls needed by AI usage and SaaS billing e2e tests. Autumn is treated as the billing/entitlements system of record between app code and Stripe: app tests can check permission, reserve/track usage, attach or update billing, and exercise failure policy without real Autumn or Stripe calls.

The initial contract covers:

- customer get-or-create and list flows;
- billing attach/update RPC flows;
- balance/permission checks;
- usage tracking and token usage tracking;
- batch usage tracking;
- reservation/lock finalization;
- denied/paywall responses and Autumn unavailable failures.

## Provider API

```ts
const autumn = autumnProvider(harness);

autumn.customers.getOrCreate({
  match: { customerId: 'cust_acme', email: 'billing@example.test' },
  reply: { id: 'cust_acme', products: [{ id: 'pro' }] },
});

autumn.balances.check({
  match: { customerId: 'cust_acme', featureId: 'ai_tokens', requiredBalance: 1200, sendEvent: true },
  reply: { allowed: true, balance: { remaining: 8800 }, lockId: 'lock_1' },
});

autumn.balances.trackTokenUsage({
  match: {
    customerId: 'cust_acme',
    featureId: 'ai_tokens',
    model: 'anthropic/claude-sonnet-4.6',
    inputTokens: 1000,
    outputTokens: 200,
  },
  reply: { success: true },
});

autumn.balances.finalize({ lockId: 'lock_1', action: 'confirm' });
```

## Endpoints modeled

The provider uses RPC-style paths so gateway code can point its Autumn base URL to FullCircle:

| Provider helper | Method/path | Match fields |
| --- | --- | --- |
| `customers.getOrCreate()` | `POST /v1/customers.get_or_create` | `customer_id`, `email` |
| `customers.list()` | `POST /v1/customers.list` | `customer_id`, `email` |
| `billing.attach()` | `POST /v1/billing.attach` | `customer_id`, `email`, `product_id` |
| `billing.update()` | `POST /v1/billing.update` | `customer_id`, `email`, `product_id` |
| `balances.check()` | `POST /v1/balances.check` | `customer_id`, `email`, `feature_id`, `required_balance`, `send_event` |
| `balances.track()` | `POST /v1/balances.track` | same fields as check |
| `balances.trackTokenUsage()` | `POST /v1/balances.track_token_usage` | `customer_id`, `email`, `feature_id`, `model`, `input_tokens`, `output_tokens` |
| `balances.batchTrackUsage()` | `POST /v1/balances.batch_track_usage` | `customer_id`, `email` |
| `balances.finalize()` | `POST /v1/balances.finalize_lock` | `lock_id`, `action` |

Request mismatches return `422` with field-level diagnostics before a fixture response is used.

## Failure and policy scenarios

Denied/paywall response:

```ts
autumn.balances.check({
  match: { customerId: 'cust_blocked', featureId: 'ai_tokens' },
  reply: { allowed: false, upgradeUrl: 'https://billing.example.test/upgrade' },
});
```

Provider unavailable:

```ts
autumn.balances.trackTokenUsage({
  match: { customerId: 'cust_acme', featureId: 'ai_tokens' },
  status: 503,
  error: { code: 'service_unavailable', message: 'Autumn unavailable' },
});
```

High-value app acceptance scenarios:

1. allowed check reserves enough balance, OpenRouter succeeds, token usage is tracked, and lock is confirmed;
2. denied check returns an upgrade URL and the app does not call OpenRouter;
3. Autumn unavailable before a paid OpenRouter call fails closed;
4. OpenRouter succeeds but usage tracking fails, so the app queues reconciliation;
5. stream aborts after reservation, so the app finalizes the lock as refund/release;
6. concurrent requests use atomic check+track or lock/finalize paths.

## Acceptance tests

`packages/harness/tests/providers/autumn.test.ts` verifies:

1. customer get/create, customers list, billing attach, and billing update fixtures;
2. balance checks, token usage tracking, batch tracking, and lock finalization;
3. denied checks and Autumn unavailable error fixtures;
4. mismatch diagnostics for customer/feature/required-balance drift.

## References

- Autumn overview: https://docs.useautumn.com/welcome
- Autumn tracking usage guide: https://docs.useautumn.com/documentation/customers/tracking-usage
- Better Auth Autumn plugin context: https://better-auth.com/docs/plugins/autumn
