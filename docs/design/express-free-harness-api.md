# Express-free FullCircle Harness API Direction

Status: design direction  
Bead: `fullcircle-8vn — Plan express-free harness API direction`

## Decision

FullCircle's public harness API should become framework-neutral. Express can remain an internal transport implementation while the agent-facing and test-facing API uses FullCircle-owned request/response types and plain async handlers.

This keeps the current Express-like ergonomics without leaking Express concepts (`req`, `res`, `next`, `express.Handler`) into provider authorship, agent skills, fixtures, or long-term docs.

## Why

The current `TestHarness` API accepts `express.Handler` directly:

```ts
th.mock('/v1/checkout/sessions', (req, res) => {
  res.json({ id: 'cs_test_123' });
});
```

That is convenient, but it couples provider code to Express response mutation and makes scaling harder:

- async handler errors are not naturally represented as return values,
- mocks are marked called before an async handler succeeds,
- provider authors need to know Express response APIs,
- future transports, browser capture, service-worker capture, Vite plugins, or non-Node runtimes would need compatibility shims,
- agents learn framework-specific patterns instead of a FullCircle provider contract.

## Target public API shape

### Core request/response primitives

```ts
export type FullCircleRequest = {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: FullCircleBody;
  destination: string;
};

export type FullCircleBody =
  | { kind: 'empty' }
  | { kind: 'json'; value: unknown }
  | { kind: 'form'; value: Record<string, string | string[]> }
  | { kind: 'text'; value: string }
  | { kind: 'bytes'; value: Uint8Array };

export type FullCircleResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export type FullCircleHandler = (
  request: FullCircleRequest,
) => FullCircleResponse | Promise<FullCircleResponse>;
```

Handlers return data instead of mutating `res`:

```ts
harness.mock('/v1/checkout/sessions', async request => ({
  status: 200,
  body: {
    id: 'cs_test_fullcircle_123',
    object: 'checkout.session',
  },
}));
```

### Convenience response helpers

For Express-like ergonomics without Express coupling:

```ts
export const response = {
  json: (body: unknown, init?: ResponseInit): FullCircleResponse => ({
    status: init?.status ?? 200,
    headers: {'content-type': 'application/json', ...init?.headers},
    body,
  }),
  text: (body: string, init?: ResponseInit): FullCircleResponse => ({
    status: init?.status ?? 200,
    headers: {'content-type': 'text/plain', ...init?.headers},
    body,
  }),
  status: (status: number, body?: unknown): FullCircleResponse => ({status, body}),
};
```

Example:

```ts
harness.mock('/todos', () => response.json([{title: 'my todo'}]));
```

### Matching API

String paths are fine for simple cases, but the product API should graduate to explicit matchers:

```ts
export type FullCircleRouteMatcher =
  | string
  | {
      method?: string;
      path: string | RegExp;
      query?: Record<string, string | RegExp>;
      headers?: Record<string, string | RegExp>;
      body?: Record<string, unknown> | ((body: FullCircleBody) => boolean);
    };
```

Example:

```ts
harness.mock({
  method: 'POST',
  path: '/v1/checkout/sessions',
  body: body => formValue(body, 'mode') === 'subscription',
}, request => response.json(sessionFixture));
```

### Cardinality and assertions

Mocks should track expected usage explicitly:

```ts
harness.mock(route, handler, {
  times: 1,
  name: 'create hosted Stripe Checkout Session',
});
```

Proposed options:

```ts
export type MockOptions = {
  name?: string;
  times?: number | {min?: number; max?: number};
  allowUnexpected?: boolean;
};
```

Assertions should report names, matchers, and actual request summaries. This is especially important for agents because failures become instructions for what fixture/session is missing.

### Lifecycle without `await using` as the primary docs pattern

Keep `Symbol.asyncDispose` as a convenience for internal tests, but public docs and generated skills should prefer explicit cleanup:

```ts
const fc = await fullcircle({listenAddress: 0});
const harness = fc.harness('api.stripe.com');
try {
  // test body
  await harness.verify();
} finally {
  await harness.close();
  await fc.close();
}
```

`await using` can appear as an optional advanced note, not the main path.

## Provider API direction

Provider authors should only see FullCircle primitives:

```ts
export type ProviderContext = {
  mock: (
    matcher: FullCircleRouteMatcher,
    handler: FullCircleHandler,
    options?: MockOptions,
  ) => void;
  sendWebhook: (request: FullCircleOutgoingRequest) => Promise<FullCircleWebhookResult>;
};

export function stripeProvider(context: ProviderContext): StripeProviderHarness;
```

Stripe v1 should stay hosted Checkout-first:

```ts
stripe.checkout.sessions.create({
  match: {
    mode: 'subscription',
    priceId: 'price_pro_monthly',
  },
  reply: {
    id: 'cs_test_fullcircle_123',
    url: 'http://localhost:7331/stripe/checkout/cs_test_fullcircle_123',
  },
});
```

Elements and embedded Checkout should be separate future contracts, not optional fields mixed into the hosted Checkout provider.

## Migration plan

1. **Introduce framework-neutral types alongside current Express internals.**
   - Add `FullCircleRequest`, `FullCircleResponse`, `FullCircleHandler`, and response helpers.
   - Add an adapter from Express requests/responses to those types.

2. **Add `mockRoute()` / `mock()` overloads that accept FullCircle handlers.**
   - Keep existing Express handler support temporarily, but mark it internal/compatibility.
   - New docs and providers use the FullCircle handler only.

3. **Update first-party providers.**
   - Convert Stripe provider to return `FullCircleResponse` objects.
   - Add tests proving async handler errors fail the request and do not incorrectly satisfy assertions.

4. **Add explicit `verify()` / `close()` lifecycle.**
   - `close()` unsubscribes and verifies by default.
   - `verify()` can be called before close for clearer failure timing.

5. **Hide Express from public exports.**
   - Keep Express as an implementation dependency until the transport is replaced.
   - Do not expose `expressApp` as the main integration API in product docs.

## Compatibility policy

- Current Express-based tests can keep working during migration.
- New examples, docs, agent skills, and provider code should use FullCircle-owned primitives only.
- Once all first-party providers are migrated, Express handler overloads should be deprecated and removed before a stable public package release.

## Acceptance criteria for implementation follow-up

- Public provider code imports no Express types.
- Public docs do not teach `req`, `res`, or `next` handlers.
- Async mock handlers are awaited.
- A mock that throws does not count as successfully satisfied.
- Failed assertions include named mock expectations and actual requests seen.
- The hosted Stripe Checkout provider continues to pass its current contract and dogfood acceptance tests.
