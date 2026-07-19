<!-- markdownlint-disable MD013 -->

# FullCircle SaaS E2E implementation plan

Status: review draft  
Bead: `fullcircle-qwx — Draft implementation plan for SaaS E2E roadmap`  
Date: 2026-07-19

This plan turns the roadmap in [`coding-agent-saas-e2e-roadmap.md`](./coding-agent-saas-e2e-roadmap.md) and acceptance-suite contract in [`app-repo-fullcircle-acceptance-suites.md`](./app-repo-fullcircle-acceptance-suites.md) into an execution sequence. The goal is to get FullCircle into a mergeable foundation state first, then add provider coverage only when it is backed by contract tests and at least one app-repo acceptance target.

## Guiding principles

1. **TDD first**: add failing provider/core contract tests before implementation.
2. **Core before breadth**: do not add more providers on top of the current single-use path-only matcher limitations.
3. **Provider APIs model business intent**: tests should say “create Hetzner server”, “reserve Autumn tokens”, or “transition Jira issue”, not hand-roll raw HTTP in every suite.
4. **App repos own app bootstrapping**: FullCircle owns deterministic external provider behavior, request assertions, and reusable fixtures.
5. **No required real-provider CI**: real Hetzner/OpenRouter/Autumn/Jira/GitHub/Linear/Trello calls stay gated behind explicit env vars.

## Phase 0 — baseline and review alignment

Deliverables:

- Confirm package install/build/test baseline.
- Review and accept this sequencing with app owners.
- Create beads for Phase 1 slices before implementation starts.

Acceptance criteria:

- `npm test -- --runInBand` passes.
- `npm run check-types` passes.
- Roadmap and acceptance-suite docs have no known contradictions with this plan.

## Phase 1 — core harness hardening

This phase unblocks every provider that follows.

### 1.1 Framework-neutral mock API

Add FullCircle-owned request/response primitives alongside existing Express compatibility.

Proposed files:

- `packages/harness/src/core/types.ts`
- `packages/harness/src/core/response.ts`
- `packages/harness/src/core/express-adapter.ts`

Key API:

```ts
harness.mockRoute(
  {
    name: 'create Hetzner server',
    method: 'POST',
    path: '/v1/servers',
    headers: { authorization: /^Bearer / },
    body: body => body.kind === 'json' && body.value.server_type === 'cpx21',
  },
  () => response.json({ server: { id: 1001 } }),
  { times: 1 },
);
```

Tests first:

- JSON body is available as structured data.
- Form body stays compatible with Stripe provider.
- Async handlers are awaited.
- Throwing handlers return a diagnostic 500 and do not satisfy expectations.

### 1.2 Structured matching and cardinality

Add route matcher support for:

- method;
- path string/regex;
- query values, including repeated query params;
- headers;
- JSON/form/text body predicates;
- `times: number | 'any' | { min?: number; max?: number }`.

Tests first:

- query-agnostic default still supports current Stripe retrieve behavior;
- strict query matching catches missing `expand[]` where requested;
- repeated allowed calls support SDK retries;
- missing and over-called mocks produce named failures.

### 1.3 Diagnostics and lifecycle

Add:

- `harness.verify()`;
- `harness.close()`;
- actual request log with destination/method/path/status/body summary;
- failure messages optimized for agent debugging.

Compatibility:

- Keep current `mock(path, express.Handler)` and `await using` tests working during migration.
- New providers should use only the framework-neutral API.

Phase 1 exit criteria:

- Existing Stripe tests pass unchanged or with minimal compatibility updates.
- New core tests cover matcher/cardinality/lifecycle behavior.
- Public provider code can avoid importing Express types.

## Phase 2 — Hetzner + Cloudflare provider slice

This phase validates FullCircle against the active provisioning-control-plane repo.

### 2.1 Hetzner provider contract

Proposed files:

- `packages/harness/src/providers/hetzner.ts`
- `packages/harness/tests/providers/hetzner.test.ts`

Initial endpoints:

- `POST /v1/servers`
- `GET /v1/servers/:id`
- `DELETE /v1/servers/:id`
- `POST /v1/servers/:id/actions/poweroff`
- `POST /v1/volumes`
- `GET /v1/volumes/:id`
- `DELETE /v1/volumes/:id`
- `POST /v1/volumes/:id/actions/attach`
- `POST /v1/volumes/:id/actions/detach`

Provider features:

- deterministic server/volume/action fixtures;
- error envelope helpers for 400/401/404/409/429/5xx;
- request assertions for names, labels, region/location, image, user_data presence, and auth header.

### 2.2 Cloudflare provider contract

Proposed files:

- `packages/harness/src/providers/cloudflare.ts`
- `packages/harness/tests/providers/cloudflare.test.ts`

Initial endpoints:

- D1 query endpoint used by `CloudflareD1Client`;
- tunnel delete endpoint used by `PulumiCliRunner` cleanup.

Provider features:

- success/error envelopes;
- token/header assertions;
- already-deleted tunnel behavior.

### 2.3 Hetzner SaaS spike branch

In the active `hetzner-saas` worktree, add one acceptance spike after providers pass locally:

- direct `PulumiCliRunner.runResume()` or cleanup-path test with base URL/global fetch seam pointed at FullCircle;
- DB snapshot/diff around lifecycle job result where practical.

If app code currently hardcodes provider origins, prefer adding base URL options/envs to the app over relying only on global fetch interception.

Phase 2 exit criteria:

- FullCircle provider contract tests pass.
- One Hetzner SaaS acceptance spike demonstrates real app/service code can use the providers.
- Failure fixtures exist for allocation failure and attach failure.

## Phase 3 — OpenRouter + Autumn AI accounting slice

This phase builds the foundation for paid AI token usage and OpenCode tests.

### 3.1 OpenRouter provider

Proposed files:

- `packages/harness/src/providers/openrouter.ts`
- `packages/harness/tests/providers/openrouter.test.ts`

Initial endpoints:

- `POST /api/v1/chat/completions`
- `GET /api/v1/generation?id=...`

Provider features:

- OpenAI-compatible non-streaming response fixture;
- SSE streaming fixture with final usage chunk;
- usage/cost fixture builders;
- 401, 402/credit, 429, 5xx, and malformed-stream helpers;
- request matchers for model, messages, tools, metadata, and stream mode.

### 3.2 Autumn provider

Proposed files:

- `packages/harness/src/providers/autumn.ts`
- `packages/harness/tests/providers/autumn.test.ts`

Initial endpoint groups:

- customer lookup/create/list;
- billing attach/update/portal;
- balance check;
- track usage / track token usage;
- finalize lock or release/refund equivalent used by app policy.

Provider features:

- allowed/denied fixtures;
- reservation/lock fixture;
- track/finalize success and failure;
- idempotency key assertions;
- entitlement-disabled fixtures for plugin gating.

### 3.3 Composite AI usage helper

Proposed file:

- `packages/harness/src/providers/ai-usage-scenario.ts`

Purpose:

- register Autumn reserve/check, OpenRouter completion, and Autumn finalization together;
- return expected ledger fields for app DB assertions;
- prevent drift between token/cost usage and billing fixtures.

### 3.4 Vibe app gateway spike

In `vibe-kanban-vscode-web`, before UI-heavy work:

- add `OpenRouterGateway`, `AutumnGateway`, and `AiUsageService` seams;
- fake-gateway unit tests for reserve/call/finalize/refund;
- one FullCircle service-level acceptance test for “successful agent task with accounting”.

Phase 3 exit criteria:

- OpenRouter and Autumn provider tests pass, including failure cases.
- One app-level test proves no OpenRouter request occurs when Autumn denies access.
- One app-level test proves successful usage is auditable and reconciled.

## Phase 4 — plugin provider and conformance slice

This phase adds Jira/GitHub/Linear/Trello plugin test foundations.

### 4.1 Shared plugin conformance contract

Proposed files:

- `packages/harness/src/providers/issue-tracker/types.ts`
- `packages/harness/src/providers/issue-tracker/conformance.ts`
- `packages/harness/tests/providers/issue-tracker-conformance.test.ts`

Common app-level concepts:

- `ExternalWorkItem`;
- provider installation/auth record;
- create/link/comment/transition operations;
- webhook event ingestion;
- idempotency keys and provider IDs;
- entitlement gate through Autumn.

The conformance suite should be provider-agnostic and run against each provider adapter.

### 4.2 GitHub provider first

Proposed files:

- `packages/harness/src/providers/github.ts`
- `packages/harness/tests/providers/github.test.ts`

Initial coverage:

- app installation token exchange;
- issues get/create/comment/update;
- pull request get/list/comment/review-comment basics;
- commit statuses/check runs;
- repository dispatch;
- signed webhook delivery.

Why first:

- `vibe-kanban-vscode-web` already has GitHub webhook/workflow code, so this gives the fastest real acceptance target.

### 4.3 Linear provider

Initial coverage:

- GraphQL operation matching by `operationName` and variables;
- issue create/update/comment;
- team/project lookup;
- workflow-state transition;
- webhook delivery.

### 4.4 Jira provider

Initial coverage:

- project lookup;
- JQL issue search;
- issue create/update/comment/transition;
- dynamic webhook registration;
- webhook delivery.

### 4.5 Trello provider

Initial coverage:

- boards/lists/cards get/create/update;
- comments/actions;
- move card between lists;
- webhook create/list/delete;
- webhook callback verification behavior.

### 4.6 Vibe app plugin spike

In `vibe-kanban-vscode-web`:

- implement common plugin install/auth state;
- implement GitHub provider through common `ExternalWorkItem` contract;
- add FullCircle acceptance for link ticket -> agent starts -> PR opens -> provider comment/status update;
- add entitlement-denied test that proves no provider call occurs.

Phase 4 exit criteria:

- GitHub provider passes conformance and app spike.
- Linear/Jira/Trello provider contracts pass in FullCircle.
- App plugin architecture can add another provider without changing workflow business logic.

## Phase 5 — capture/replay and CI productization

### 5.1 Capture/replay fallback

Add sanitized fixture replay for endpoints not yet worth typed providers:

- load recorded `summary.json` sessions;
- match requests semantically enough to avoid brittle timestamps;
- sanitize secrets by default;
- provide “promote captured route to typed provider test” guidance.

### 5.2 CI integration

For FullCircle:

- provider contract tests required on PR/push;
- build and typecheck required;
- fixture lint for accidental secrets.

For app repos:

- service-level FullCircle acceptance tests required once stable;
- browser E2E added only for key happy paths;
- real-provider smoke tests gated and non-required;
- upload request logs, DB diffs, and traces on failure.

Phase 5 exit criteria:

- New provider behavior can be developed by recording once, sanitizing, then turning into typed fixtures.
- CI failures produce enough artifacts for agents to fix missing/incorrect mocks without rerunning real providers.

## Recommended immediate next PRs

1. **PR 1: Core route matcher and response primitives**
   - Add framework-neutral types and response helpers.
   - Add `mockRoute()` behind current API.
   - Keep Stripe green.

2. **PR 2: Cardinality, verify/close, diagnostics**
   - Add named expectations, actual request log, and repeat semantics.
   - Update docs/examples to use explicit lifecycle.

3. **PR 3: Hetzner provider MVP**
   - Servers, volumes, attach/detach/delete, error helpers.
   - Contract tests only.

4. **PR 4: Hetzner SaaS acceptance spike**
   - Add app-repo seam/base URL if needed.
   - Prove one happy path or cleanup failure path with FullCircle.

5. **PR 5: OpenRouter provider MVP**
   - Non-streaming and streaming chat completions plus generation stats.

6. **PR 6: Autumn provider MVP + AI usage scenario**
   - Reserve/check, token track, finalize/release.
   - Composite helper.

7. **PR 7: GitHub provider + plugin conformance skeleton**
   - Reuse existing GitHub workflow code for app acceptance.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Provider APIs become too broad before app usage exists | Only implement endpoints needed by the next contract or app acceptance test. |
| App code hardcodes third-party origins | Prefer base URL env/options as app PR prerequisites; use fetch interception only as fallback. |
| Tests assert raw payload details too tightly | Default providers to semantic matching with opt-in strict assertions. |
| Streaming OpenRouter tests become flaky | Drive SSE from deterministic in-memory fixtures and avoid real timing dependence. |
| Billing reconciliation is ambiguous | Make app policy explicit: fail closed before paid calls, queue reconciliation only after successful model output. |
| Plugin models erase provider-specific details | Normalize workflow primitives but persist raw provider IDs/payload snapshots. |
| Real-provider smoke tests leak into required CI | Separate scripts/env gates and document that required CI uses only FullCircle. |

## Review questions

1. Do we agree that Phase 1 core harness hardening blocks all new providers?
2. Should Hetzner be the first provider MVP, or should GitHub go first because app code already exists?
3. Which app repo should receive the first FullCircle acceptance spike: `hetzner-saas` provisioning or `vibe-kanban-vscode-web` GitHub workflow/plugin?
4. For Autumn, do we want lock/reservation semantics in v1, or start with simple check + track and add locks once app code needs concurrency?
5. Do we want capture/replay before or after the first two typed providers?
