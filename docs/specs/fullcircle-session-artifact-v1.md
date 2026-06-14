# FullCircle Session Artifact v1

Status: implementation schema seed  
Bead: `fullcircle-64o.3 — Define canonical FullCircle session artifact schema`

## Goal

A FullCircle session artifact is the stable interchange format between:

- the recorder CLI/API,
- future session management web UI,
- future Vite/browser interaction capture plugin,
- provider-specific typed helpers,
- generic capture/replay,
- database snapshot/diff assertions,
- agent skills that generate e2e tests from captured usage.

The canonical schema version is:

```txt
fullcircle.session.v1
```

The TypeScript source of truth lives in `packages/recorder/src/session_artifact.ts`.

## Top-level shape

```ts
type FullCircleSessionArtifact = {
  schemaVersion: 'fullcircle.session.v1';
  name: string;
  startedAt: string;
  endedAt: string;
  timeline: FullCircleTimelineEvent[];
  providerFixtures: FullCircleProviderFixture[];
  webhookDeliveries: FullCircleWebhookDelivery[];
  browserEvents: FullCircleBrowserEvent[];
  resources: FullCircleResourceSeed[];
  database: FullCircleDatabaseArtifacts;
  redactions: FullCircleRedactionRule[];
  metadata: Record<string, unknown>;
};
```

### Why both `timeline` and typed collections?

The `timeline` preserves chronology across browser actions, outbound provider calls, webhook deliveries, and DB diffs. The typed collections make it easy for agents and tools to find all provider fixtures, webhook events, browser steps, or DB artifacts without re-scanning timeline events.

For v1, tools may write the timeline first and leave typed collections empty when the data is not available yet. Future capture/replay work should keep both in sync.

## Timeline events

Supported v1 event kinds:

- `http.exchange`: recorded request/response to an external destination.
- `browser.event`: browser-side action such as click, input, submit, or navigation.
- `webhook.delivery`: provider webhook sent to the app.
- `database.diff`: DB state changes observed between snapshots.

Each event has:

```ts
{
  id: string;
  at: string;
  correlationId?: string;
}
```

`correlationId` is reserved for the Vite/browser capture plugin and recorder to connect a user action to app-originating network requests.

## HTTP exchange events

```ts
type FullCircleHttpExchangeEvent = {
  kind: 'http.exchange';
  destination: string;
  request: {
    method: string;
    path: string;
    headers: Record<string, string | string[]> | null;
    body: FullCircleBodyArtifact;
  };
  response: {
    status: number;
    headers: Record<string, string | string[]> | null;
    body: FullCircleBodyArtifact;
  };
};
```

Body variants:

```ts
type FullCircleBodyArtifact =
  | {kind: 'empty'}
  | {kind: 'json'; value: unknown}
  | {kind: 'text'; value: string}
  | {kind: 'bytes'; base64: string};
```

## Provider fixtures

Provider fixtures are semantic expectations generated from captured HTTP exchanges or authored directly in tests.

Example:

```json
{
  "provider": "stripe",
  "name": "create hosted Checkout Session",
  "request": {
    "method": "POST",
    "destination": "https://api.stripe.com",
    "path": "/v1/checkout/sessions",
    "bodyEncoding": "form-urlencoded",
    "match": {
      "mode": "subscription",
      "priceId": "price_pro_monthly"
    }
  },
  "response": {
    "status": 200,
    "body": {
      "id": "cs_test_fullcircle_123",
      "object": "checkout.session"
    }
  }
}
```

## Browser events

Browser events are intentionally small so they can be captured by Playwright, a future Vite plugin, or a lightweight injected script.

```ts
type FullCircleBrowserEvent = {
  type: 'click' | 'input' | 'submit' | 'navigation' | 'custom';
  url: string;
  selector?: string;
  label?: string;
  value?: string;
  metadata?: Record<string, unknown>;
};
```

Sensitive form values should be redacted before persistence unless a test explicitly marks them safe.

## Webhook deliveries

```ts
type FullCircleWebhookDelivery = {
  provider: string;
  type: string;
  eventId: string;
  endpoint: string;
  signatureMode: 'valid' | 'invalid' | 'missing';
  payload: unknown;
};
```

## Resources

Resources are high-level domain seeds that providers can translate into HTTP fixtures and DB seeds. They prevent drift between provider responses and local test data.

Examples:

- Stripe subscription plan resources.
- Acuity booked-hours resources.
- Auth user resources.
- OpenRouter/Autumn AI usage resources.

## Database artifacts

Database artifacts support snapshots and diffs for SQLite first, with adapter names kept open for Postgres/Supabase and other stores.

```ts
type FullCircleDatabaseSnapshot = {
  name: string;
  at: string;
  adapter: 'sqlite' | 'postgres' | string;
  tables: Record<string, Array<Record<string, unknown>>>;
};

type FullCircleDatabaseDiff = {
  name: string;
  from: string;
  to: string;
  adapter: 'sqlite' | 'postgres' | string;
  tables: Record<string, {
    inserted: Array<Record<string, unknown>>;
    updated: Array<{before: Record<string, unknown>; after: Record<string, unknown>}>;
    deleted: Array<Record<string, unknown>>;
  }>;
};
```

## Redaction rules

```ts
type FullCircleRedactionRule = {
  field: string;
  strategy: 'omit' | 'replace' | 'hash';
  replacement?: string;
};
```

Default recorder behavior should continue to omit headers unless explicitly enabled. When headers are enabled, agents should add redaction rules for authorization, cookies, API keys, tokens, and PII.

## Migration from current recorder output

The current recorder still writes per-call JSON files and `summary.json`. `packages/recorder/src/session_artifact.ts` now includes conversion helpers that map `RecordedCall[]` into a v1 `timeline` of `http.exchange` events.

A follow-up capture/replay milestone should:

1. write `session.fullcircle.json` alongside `summary.json`,
2. include browser events and webhook deliveries when available,
3. derive `providerFixtures` from provider-aware recordings,
4. keep legacy output until downstream examples migrate.
