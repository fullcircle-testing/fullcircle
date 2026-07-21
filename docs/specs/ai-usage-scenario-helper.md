# FullCircle Composite AI Usage Scenario Helper

Bead: `fullcircle-64o.29 — Add composite AI usage provider helper`

## Scope

`aiUsageScenario()` composes Autumn and OpenRouter provider fixtures into one business-level helper. It keeps entitlement checks, model calls, usage tracking, lock finalization, generation-cost reconciliation, and expected ledger rows aligned so e2e tests do not drift between billing and AI fixtures.

Use primitive providers directly for low-level contract tests. Use this helper when the app behavior under test is the end-to-end invariant: **reserve/check balance, call OpenRouter, record usage, finalize or release the Autumn lock, and assert app ledger rows.**

## API

```ts
const scenario = aiUsageScenario({
  autumn: autumnProvider(autumnHarness),
  openrouter: openRouterProvider(openRouterHarness),
  customerId: 'cust_acme',
  featureId: 'ai_tokens',
  model: 'anthropic/claude-sonnet-4.6',
  requiredTokens: 1200,
  promptIncludes: 'fix the failing test',
  completion: {
    promptTokens: 1000,
    completionTokens: 200,
    cost: 0.014,
    content: 'Done.',
  },
  generationId: 'gen_acme_1',
  lockId: 'lock_1',
});
```

The helper registers:

1. `Autumn balances.check` with `send_event=true` and a lock id;
2. OpenRouter chat completion or stream fixture;
3. OpenRouter generation stats fixture for delayed cost reconciliation;
4. `Autumn balances.track_token_usage` for successful completions;
5. `Autumn balances.finalize_lock` with `confirm` for success or `release` for aborted streams.

It returns `expectedLedgerDiff` in the same shape app acceptance tests can compare with database diffs:

```ts
expect(scenario.expectedLedgerDiff).toEqual({
  inserted: {
    ai_usage_events: [{
      customer_id: 'cust_acme',
      feature_id: 'ai_tokens',
      model: 'anthropic/claude-sonnet-4.6',
      generation_id: 'gen_acme_1',
      autumn_lock_id: 'lock_1',
      input_tokens: 1000,
      output_tokens: 200,
      total_tokens: 1200,
      cost: 0.014,
      status: 'confirmed',
    }],
  },
});
```

## Outcomes

| Outcome | Registered behavior | Ledger status |
| --- | --- | --- |
| `success` | Autumn check -> OpenRouter completion/stream -> generation stats -> token track -> finalize `confirm` | `confirmed` |
| `denied` | Autumn check returns `allowed: false`; no OpenRouter or usage tracking mocks are registered | no rows |
| `track_failure` | OpenRouter succeeds, Autumn token tracking returns `503`; app should queue reconciliation | `reconciliation_queued` |
| `stream_aborted` | Autumn check reserves, OpenRouter SSE omits final usage and `[DONE]`, lock finalizes with `release` | `released` |

## Acceptance tests

`packages/harness/tests/providers/ai_usage.test.ts` verifies:

1. success path wires Autumn reservation, OpenRouter completion, token tracking, finalization, generation stats, and expected ledger rows;
2. denied checks do not register OpenRouter or usage tracking expectations;
3. stream aborts after reservation produce release finalization expectations and released ledger rows.

## Design notes

- The helper accepts already-created `autumnProvider()` and `openRouterProvider()` harnesses so tests can choose separate FullCircle hosts and base URLs.
- Default metadata is `{ customerId, featureId }`, matching the OpenRouter provider contract used by agent/gateway tests.
- The helper intentionally does not write database rows. It returns expected ledger rows so app-specific database adapters can compare their real DB diffs without coupling FullCircle to one schema.
