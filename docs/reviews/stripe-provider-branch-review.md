<!-- markdownlint-disable MD013 MD024 -->

# Stripe provider branch review

Review target: `vk/8f1c-fullcircle-harde` through commit `a3dd73f`.

Validation run on 2026-06-11:

- `npm test` passed.
- `npm run build` passed.

This branch is a strong first slice: it adds a Stripe Checkout provider, signed webhook delivery, a dogfood acceptance test with SQLite diffs, and specs/case-study docs. The core direction is sound, but I would not call the provider product-ready for the intended Soundspace/agent workflow until the concerns below are resolved or explicitly scoped as follow-up work.

## Concern 1: Checkout Session fixtures do not model Soundspace's actual embedded Checkout contract

Soundspace's real `createCheckoutSession()` sends `customer`, `line_items`, `mode: 'subscription'`, `allow_promotion_codes`, optional `subscription_data`, `return_url`, `ui_mode: 'embedded'`, and metadata. It then requires `session.client_secret`; if the returned session lacks `client_secret`, Soundspace redirects to `/error`.

The current `StripeCheckoutSessionFixture` does not include `client_secret`, `ui_mode`, or `return_url`, and `StripeCheckoutSessionCreateExpectation.match` cannot assert `customer`, `uiMode`, `returnUrl`, `allowPromotionCodes`, trial settings, or multiple line items. The dogfood acceptance test uses a simplified sample app with `success_url`/`cancel_url`, so it does not catch this gap.

### Fix strategy A: Extend the generic Stripe provider now

Add fields and matchers for `client_secret`, `customer`, `ui_mode`, `return_url`, `allow_promotion_codes`, `subscription_data.trial_*`, and an array of line-item matchers. Update tests to exercise Soundspace-like embedded Checkout payloads.

Pros:

- Makes the provider immediately useful for the intended Soundspace checkout flow.
- Keeps the API provider-general rather than Soundspace-specific.
- Prevents false confidence from the current simplified acceptance test.

Cons:

- Broadens the first Stripe provider API surface.
- Requires careful type design for nested Stripe form fields.

### Fix strategy B: Add Soundspace-specific helpers on top of the current provider

Keep the generic provider small, but add `stripe.checkout.sessions.createEmbeddedSubscription()` or a Soundspace fixture builder that fills in `client_secret`, `ui_mode`, `return_url`, and line-item expectations.

Pros:

- Faster and narrower than a generic nested-form matcher.
- Produces readable agent-facing APIs for the known first app.

Cons:

- Risks encoding Soundspace assumptions into the provider package.
- May duplicate logic once generic Stripe resource builders arrive.

### Recommendation

Use strategy A for the request/response contract and add a small helper as sugar only after the generic matcher supports Soundspace's real payload.

## Concern 2: Stripe webhook type coverage is narrower than the documented Soundspace flow

The provider supports `checkout.session.*`, `customer.subscription.*`, `invoice.paid`, and `invoice.payment_failed`. The branch spec and Soundspace code also need `invoice.created`, `invoice.finalization_failed`, and `invoice.payment_action_required`. Soundspace's `processStripeEvent()` explicitly handles those event types, including an `invoice.created` path that retrieves and finalizes draft invoices.

### Fix strategy A: Expand `StripeWebhookType` and add fixture tests

Add the missing invoice event types to the union and test sending each event with a valid signature.

Pros:

- Low-risk API expansion.
- Aligns provider types with the spec and Soundspace implementation.
- Prevents agents from dropping to untyped escape hatches for common events.

Cons:

- Still leaves resource-specific invoice helpers for later.

### Fix strategy B: Replace the strict union with `string` plus known helper builders

Let `webhooks.send(type: string, ...)` accept any Stripe event type, while separately exporting typed builders for known flows.

Pros:

- Avoids churn as Stripe adds event types.
- Lets advanced tests cover rare events immediately.

Cons:

- Loses compile-time typo protection on raw `send()` calls.
- Makes provider docs and generated skill guidance less precise.

### Recommendation

Use strategy A now and consider a separate `sendRaw()` escape hatch later if strict typing becomes burdensome.

## Concern 3: The provider only covers Checkout Session endpoints, not the Stripe APIs Soundspace already uses

Soundspace also calls Stripe customers, products, prices, subscriptions, invoices, customer portal, search/list endpoints, and product/price admin-sync flows. The new `docs/case-studies/soundspace-provider-plan.md` correctly inventories those, but the actual provider only implements:

- `POST /v1/checkout/sessions`
- `GET /v1/checkout/sessions/:id`
- `GET /v1/checkout/sessions/:id/line_items`
- outbound webhook delivery

### Fix strategy A: Incrementally implement provider methods by acceptance journey

Implement the next endpoints only when a real acceptance journey needs them: account setup (`customers.list/create`, HubSpot/Attio), checkout completion (`checkout.retrieve`, `line_items`, webhooks), then subscription management (`subscriptions.*`, `invoices.*`).

Pros:

- Keeps the code TDD-driven and avoids speculative mocks.
- Produces real-world confidence per milestone.

Cons:

- Full provider completeness will take multiple iterations.
- Agents may hit unsupported endpoints during early dogfooding.

### Fix strategy B: Generate broad raw Stripe endpoint responders from captured sessions

Before writing typed helpers, make FullCircle capture/replay arbitrary Stripe routes from session files, then layer typed helpers over high-value endpoints.

Pros:

- Faster coverage for many APIs.
- Good fit for real sandbox-capture workflows.

Cons:

- Less readable and less intentional than resource builders.
- Harder to assert semantic correctness from e2e tests.

### Recommendation

Use both in order: add typed helpers for the checkout/account journeys first, and add capture/replay fallback for lower-value or rarely touched Stripe endpoints.

## Concern 4: Request matching is too permissive in some places and too narrow in others

The harness path match now ignores query strings, which lets `retrieve()` work with `expand[]=subscription` or `expand[]=line_items`. That is useful, but it also means the provider cannot assert required expand parameters. Checkout create matching is narrow in a different way: it only checks the first line item and selected metadata fields.

### Fix strategy A: Add structured request expectations to provider methods

Let provider methods accept `match.query`, `match.headers`, and richer `match.body`, including arrays and optional unordered matching for repeated Stripe fields.

Pros:

- Provider tests become more diagnostic.
- Agents can assert exact API contracts where it matters.

Cons:

- More matcher API design work.
- Overly strict tests could become brittle if users assert everything.

### Fix strategy B: Keep default matching permissive but add `strict: true`

Use today’s permissive defaults, but allow strict mode per fixture.

Pros:

- Good beginner ergonomics.
- Lets productized provider evolve without breaking easy tests.

Cons:

- Important assertions may be skipped unless agents know to opt in.

### Recommendation

Use strategy B at the public API level, implemented by strategy A internally. Default to helpful minimal assertions, but make strict matching easy and well-documented.

## Concern 5: Harness mocks are single-use and ordered only by registration

`TestHarness` marks a mock as called and will not match it again. That catches missing expected calls, but Stripe SDKs and app code may retry idempotent requests, retrieve the same object more than once, or call a list endpoint after a create endpoint in a flow not known up front.

### Fix strategy A: Add invocation cardinality

Allow `{times: 1}`, `{times: 2}`, `{times: 'any'}`, and `{min/max}` on `harness.mock()` and provider methods.

Pros:

- Maintains strong assertions while supporting retries/repeats.
- Clear failure messages can report actual call counts.

Cons:

- Requires changes to core harness bookkeeping.

### Fix strategy B: Add explicit repeat helpers only in providers

Keep core `harness.mock()` as single-use but let providers register repeated handlers internally.

Pros:

- Smaller core change.
- Provider APIs can stay business-oriented.

Cons:

- Repetition behavior becomes inconsistent between raw and provider mocks.

### Recommendation

Use strategy A. Cardinality belongs in the core harness because every provider will need it.

## Concern 6: Native `better-sqlite3` is now a root dev dependency for one acceptance test

The SQLite acceptance test is valuable because it dogfoods DB snapshots/diffs. However, `better-sqlite3` is a native module and increases install/CI risk, especially for a CLI/library that may otherwise be mostly TypeScript and HTTP tooling.

### Fix strategy A: Keep `better-sqlite3` and commit to SQLite as a core dev/test dependency

Pros:

- Fast and reliable locally in this workspace.
- Aligns with the product direction of first-class SQLite support.
- Lets us build real snapshot/diff APIs without toy abstractions.

Cons:

- Native install friction on some platforms.
- Adds a large lockfile change for a single test before DB APIs are productized.

### Fix strategy B: Move the SQLite dogfood app into a separate optional package/example

Pros:

- Keeps the root package lighter.
- Lets the DB harness have its own dependency lifecycle.

Cons:

- Makes the acceptance test less central.
- More workspace/package plumbing now.

### Fix strategy C: Replace `better-sqlite3` in this test with an in-memory JS object until DB harness work starts

Pros:

- Lowest dependency risk.
- Still tests Stripe API/webhook flow.

Cons:

- Loses the strongest part of the acceptance test: real SQL row diffs.
- Defers database correctness concerns.

### Recommendation

Keep `better-sqlite3` for now, but make the next DB milestone extract snapshot/diff behind an adapter so the dependency is justified by product code, not just one test.

## Concern 7: Explicit resource management (`await using`) is good in tests but should not be the only documented consumer pattern

The `await using` tests are clean and passed under this repo’s TypeScript/Jest setup. They are a good fit for harness lifetime management. The risk is consumer friction: agents and downstream projects may not have TypeScript 5.2+ explicit resource management configured, and JavaScript consumers may prefer `try/finally`.

### Fix strategy A: Keep `await using` as the preferred modern pattern and document prerequisites

Pros:

- Very readable lifecycle semantics.
- Prevents forgotten `close()`/assertion cleanup.

Cons:

- Requires modern TS/toolchain support.
- May confuse agents in older projects.

### Fix strategy B: Provide `withFullCircle()` / `withHarness()` helpers

Example:

```ts
await withFullCircle(options, async (fc) => {
  await withHarness(fc, 'api.stripe.com', async (harness) => {
    // test body
  });
});
```

Pros:

- Works in older JS/TS projects.
- Still guarantees cleanup and assertion execution.

Cons:

- Slightly more nested than `await using`.
- Another API to document and support.

### Recommendation

Support both. Keep `await using` internally and in modern examples, but ship `withFullCircle()`/`withHarness()` as the agent-safe default.

## Concern 8: Minor polish items should be cleaned before broad reuse

Small issues observed during review:

- `buildCheckoutSessionFixture()` has a duplicate `customer: 'cus_fullcircle_123'` property. It is harmless at runtime but noisy.
- The default webhook `api_version` is `2025-xx-xx.basil`, which is intentionally fake-looking. Tests should either omit it, require the caller to set it, or default to a real captured/configured API version.
- Some helper error messages stringify function matchers as source code or generic function text, which may be noisy for agents.

### Fix strategy A: Fix polish immediately

Pros:

- Cheap cleanup.
- Reduces distraction in future reviews.

Cons:

- Does not materially change product readiness.

### Fix strategy B: Fold into the next implementation milestone

Pros:

- Avoids a tiny standalone change.
- Lets changes happen alongside matcher/API improvements.

Cons:

- Easy to forget.

### Recommendation

Fix the duplicate `customer` immediately; handle `api_version` and matcher messages with the next provider API expansion.

## Conclusion and succinct recommendations

1. Extend Checkout Session create/retrieve fixtures to match Soundspace’s real embedded Checkout contract: `client_secret`, `ui_mode`, `return_url`, `customer`, promotion codes, trial data, and multiple line items.
2. Add missing Soundspace webhook event types now: `invoice.created`, `invoice.finalization_failed`, and `invoice.payment_action_required`.
3. Implement additional Stripe endpoints by acceptance journey, starting with customers, checkout completion, subscriptions, and invoices; add capture/replay fallback later.
4. Add structured request matching with permissive defaults and an easy strict mode for query/body/header assertions.
5. Add core harness cardinality (`times`, `min`, `max`, `any`) so providers can model retries and repeated retrieves.
6. Keep `better-sqlite3` for now, but extract real DB snapshot/diff product APIs next so the native dependency is justified.
7. Keep `await using`, but add `withFullCircle()`/`withHarness()` helpers for older projects and agent-generated tests.
8. Clean up minor polish: duplicate `customer`, fake default webhook `api_version`, and noisy matcher error text.
