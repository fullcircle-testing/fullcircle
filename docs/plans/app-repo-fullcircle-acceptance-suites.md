<!-- markdownlint-disable MD013 -->

# App-repo FullCircle acceptance suites for SaaS flows

Status: coordination spec. This branch adds reusable FullCircle providers and the acceptance-suite contract; actual app-repo test implementation should happen in each app repository once the corresponding seams are present.

This document turns the SaaS E2E roadmap into concrete acceptance suites for app repos. Each suite should run normal app/service code with external provider base URLs pointed at FullCircle, then assert four things together:

1. user-visible or operator-visible state;
2. external request sequence and payloads;
3. local DB snapshots/diffs;
4. logs, audit rows, or job state that prove failure recovery is safe.

## Shared suite harness

Each app repo should expose one helper that starts FullCircle with every provider target needed by the suite:

```ts
type FullCircleSaasAcceptanceHarness = {
  fullcircleUrl: string;
  providers: {
    hetzner?: ReturnType<typeof import('@fullcircle/harness').hetznerProvider>;
    cloudflare?: ReturnType<typeof import('@fullcircle/harness').cloudflareProvider>;
    openrouter?: ReturnType<typeof import('@fullcircle/harness').openRouterProvider>;
    autumn?: ReturnType<typeof import('@fullcircle/harness').autumnProvider>;
    aiUsage?: ReturnType<typeof import('@fullcircle/harness').aiUsageScenario>;
  };
  db: {
    snapshot(name: string): Promise<void>;
    diff(from: string, to: string): Promise<unknown>;
  };
  close(): Promise<void>;
};
```

The app repo owns framework-specific setup, database adapters, and app URLs. FullCircle owns deterministic provider fixtures and request assertions.

## CI contract

- Run acceptance suites on push to any branch once the app-repo seams exist.
- Keep real-provider smoke tests out of required CI; they belong behind explicit secrets/env gates.
- Upload FullCircle request logs, DB diffs, and browser traces as artifacts on failure.
- Fail fast on unexpected outbound provider requests.
- Keep retry behavior deterministic by using provider fixtures for 429/5xx/error envelopes.

## Hetzner SaaS control-plane suite

Target app repo: active Hetzner SaaS control-plane worktree described in [`coding-agent-saas-e2e-roadmap.md`](./coding-agent-saas-e2e-roadmap.md).

Provider dependencies:

- `hetznerProvider` for servers, volumes, actions, attach/detach/delete.
- `cloudflareProvider` for D1 query/control-plane checks and tunnel cleanup.
- Optional generic HTTP sink for remote executor callbacks if the app does not expose a typed gateway yet.

### HZ-1 happy path provision

Purpose: prove a lifecycle job can provision a customer runtime and persist all provider ids.

Fixtures:

- Hetzner server create returns `server.id=1001`, public IPv4, and action `3001`.
- Hetzner volume create returns `volume.id=2001` and action `3002`.
- Hetzner volume attach returns success action `3003`.
- Cloudflare D1 query/update returns success envelopes for runtime state persistence.
- Executor callback returns accepted/completed status.

Assertions:

- Requests happen in order: server create -> volume create -> volume attach -> D1/runtime state update -> executor callback.
- DB diff has one lifecycle job transitioned to succeeded/active.
- Runtime row contains server id, volume id, hostname/tunnel metadata, and no plaintext secrets.
- Operator-visible state shows active/provisioned runtime.

### HZ-2 allocation failure

Purpose: prove provider allocation failure is user-actionable and leaves no active runtime.

Fixtures:

- Hetzner server create returns `resource_unavailable` or 429.

Assertions:

- No volume create or Cloudflare runtime activation request occurs after the failed server create.
- Lifecycle job transitions to failed with provider error details safe for display/logging.
- Customer/runtime state remains non-active.

### HZ-3 attach failure preserves cleanup metadata

Purpose: prove partial provider success can be resumed or cleaned up.

Fixtures:

- Hetzner server create succeeds.
- Hetzner volume create succeeds.
- Hetzner volume attach fails with 5xx or failed action.

Assertions:

- DB diff preserves server id and volume id on the failed job.
- Runtime is not active.
- Error/audit row includes enough metadata for cleanup/resume.
- Optional cleanup path calls detach/delete against the persisted ids.

### HZ-4 delete/suspend is idempotent

Purpose: prove teardown can be retried safely.

Fixtures:

- Hetzner server delete returns success or already-deleted style response.
- Hetzner volume detach/delete returns success.
- Cloudflare tunnel delete returns success or already-deleted response.

Assertions:

- Re-running teardown does not create duplicate destructive requests beyond configured idempotent retries.
- DB state ends inactive/deleted.
- Audit log records teardown completion once.

### HZ-5 remote executor unavailable

Purpose: prove executor outages do not leave stuck running jobs.

Fixtures:

- Hetzner and Cloudflare setup may be skipped or mocked as not started.
- Executor endpoint returns connection failure/503 equivalent.

Assertions:

- Job transitions to retryable failed or queued retry state according to app policy.
- Admin-visible error is actionable.
- No runtime is marked active before executor acknowledgment.

## Vibe Kanban VSCode Web AI/billing suite

Target app repo: `~/repos/vibe-kanban-vscode-web` once OpenRouter/Autumn feature code exists.

Provider dependencies:

- `openRouterProvider` for non-streaming and streaming completions plus generation stats.
- `autumnProvider` for customer, check/reserve, track/finalize, and billing portal flows.
- `aiUsageScenario` composite helper for invariant-heavy tests.

Required app seams before implementation:

- `OpenRouterGateway` with configurable base URL and fake API key support.
- `AutumnGateway` with configurable base URL and explicit outage policy.
- `AiUsageService` that owns reserve/call/finalize/refund semantics.
- DB/audit adapter with stable snapshot/diff hooks.

### AI-1 customer bootstrap

Purpose: prove login/customer setup creates or loads the billing customer before paid AI work.

Fixtures:

- Autumn customer get/list returns missing.
- Autumn customer create or billing attach returns `cust_acme`.

Assertions:

- DB diff stores Autumn customer id.
- UI shows billing/usage state loaded.
- No OpenRouter request occurs during bootstrap.

### AI-2 successful agent task with accounting

Purpose: prove the app checks entitlement, calls OpenRouter, and finalizes actual usage.

Fixtures:

- Autumn check/reserve allows `requiredTokens=1200`, returns `lock_1`.
- OpenRouter chat completion returns generation id and usage.
- Autumn track/finalize confirms actual token usage.
- Optional OpenRouter generation stats reconciles delayed cost.

Assertions:

- Request order: Autumn reserve -> OpenRouter completion -> Autumn track/finalize.
- DB diff contains agent task output, usage ledger row, provider generation id, and cost/tokens.
- UI shows generated result and updated remaining balance.
- Audit row links customer, task id, Autumn lock id, and OpenRouter generation id.

### AI-3 insufficient balance denies generation

Purpose: prove paywall/upgrade state prevents paid provider usage.

Fixtures:

- Autumn check returns denied with upgrade/paywall metadata.

Assertions:

- No OpenRouter request is made.
- UI shows upgrade or insufficient-balance state.
- DB records denied attempt if product policy requires an audit trail, but no usage ledger debit.

### AI-4 OpenRouter transient failure releases reservation

Purpose: prove paid reservation is released/refunded when generation fails before usable output.

Fixtures:

- Autumn reserve succeeds.
- OpenRouter returns 429/5xx or stream aborts.
- Autumn finalize/release records cancellation/refund.

Assertions:

- Request order includes release/refund after OpenRouter failure.
- UI shows retryable error.
- DB has no successful task output and no confirmed debit.
- Audit row records failure class and refund/release action.

### AI-5 Autumn track failure queues reconciliation

Purpose: prove post-generation billing failure is explicit and recoverable.

Fixtures:

- Autumn reserve succeeds.
- OpenRouter succeeds with usage.
- Autumn track/finalize returns 5xx.

Assertions:

- Generated output is not lost.
- DB marks usage reconciliation pending with idempotency key.
- Background retry can replay Autumn finalize/track without another OpenRouter call.
- Operator logs are actionable.

## Migration strategy

1. Start with service-level acceptance tests that call app gateways directly; do not require full browser automation until provider seams are stable.
2. Add one browser happy path per product surface after DB/request assertions are reliable.
3. Promote suites to required push CI only after they are deterministic on two consecutive branches.
4. Keep provider fixtures in app repos close to the journey tests; keep reusable provider helpers in FullCircle.
5. When a new provider behavior is needed, add/extend the FullCircle provider contract test before changing the app acceptance suite.
