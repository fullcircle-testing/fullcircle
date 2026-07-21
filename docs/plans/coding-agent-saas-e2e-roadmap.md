# Coding agent SaaS E2E + FullCircle provider roadmap

Status: discussion plan based on local repo inspection on 2026-06-14.

Relevant repos:

- `fullcircle`: current harness/recorder plus first Stripe provider.
- `~/repos/vibe-kanban-vscode-web`: app shell for a coding-agent dashboard. Current code is mostly VK/code-server workflow UI and GitHub workflow automation; OpenRouter/Autumn integrations are not present yet.
- `/var/tmp/vibe-kanban/worktrees/5438-hetzner-saas-sys/hetzner-saas`: active Hetzner SaaS control-plane worktree. `~/repos/hetzner-saas` main is currently empty except bead metadata.

## Current state

### FullCircle

- Core harness can run in-process (`listenAddress: null`) or on a dynamic TCP port (`listenAddress: 0`).
- Mock routing is keyed by destination host plus exact path or path-without-query.
- Mock expectations are single-use and verified on harness disposal.
- Existing provider: Stripe Checkout Sessions plus signed webhook delivery.
- Recorder can proxy one or more destinations from `fullcircle.recorder.json` and record request/response JSON.
- Current test baseline: `npm test -- --runInBand` passed on 2026-06-14: 29 tests across root and example app.

Main gaps before using this as the foundation for long-lived SaaS E2E:

1. Express leaks through provider API.
2. Route matching lacks methods, headers, query matchers, body matchers, and cardinality.
3. Failed/throwing async handlers can be hard to diagnose.
4. No generic capture/replay fixture provider yet.
5. No first-class Web Fetch/Undici interception story for code that hardcodes `https://...`.

### Hetzner SaaS

The active branch already has good ports and seams:

- `LifecycleInfraRunner` is the high-level provisioning seam.
- `PulumiCliRunner` is the concrete runner for Pulumi plus direct Hetzner/Cloudflare REST operations.
- `RemoteLifecycleJobExecutor` and executor app model the worker-to-executor boundary.
- Tests currently use fakes, MSW, and global fetch stubs.
- Direct external HTTP calls exist for:
  - Hetzner Cloud API: `https://api.hetzner.cloud/v1/...`
  - Cloudflare API: `https://api.cloudflare.com/client/v4/...`
  - Remote lifecycle executor URL
  - customer origin proxying

This is a good FullCircle candidate because it has a small number of external APIs and clear happy/failure workflows: server create, volume create/attach/detach, delete, tunnel deletion, and executor callback.

### Vibe Kanban VSCode Web

Current repo is the app shell/dashboard. The OpenRouter and Autumn work appears unimplemented; there are no code paths for those names in source. Current server integration points include VK backend API, GitHub workflow webhooks, and workspace/voyage UI.

For future billing/AI limits, this app should introduce small gateway modules before UI code grows around raw SDK calls:

- `OpenRouterGateway`: base URL, API key, completion/generation stats calls.
- `AutumnGateway`: base URL, secret key, customer get/create, check, track/token-usage, billing attach/update/portal.
- `AiUsageService`: single business seam that checks/reserves Autumn balance, calls OpenRouter/OpenCode, records/refunds usage, and persists audit rows.
- `IssueTrackerGateway` plugin host: routes Jira, GitHub, Linear, and Trello integrations through common ticket/project primitives without hiding provider-specific IDs, webhook signatures, or rate-limit behavior.

## External API facts to model

- OpenRouter chat completions are OpenAI-style at `POST /api/v1/chat/completions`; responses include `usage` token counts for non-streaming calls. OpenRouter docs now state detailed usage is returned automatically, including in the last SSE message for streaming, with token counts/cost/caching details.
- OpenRouter generation stats can be queried by generation ID at `GET /api/v1/generation?id=...`, which is useful for delayed cost/audit reconciliation.
- OpenCode supports OpenRouter as a provider and allows custom provider `baseURL` in `opencode.json`, which gives tests a clean way to point OpenCode at FullCircle.
- Autumn is a billing/entitlements system of record on top of Stripe. Its docs emphasize `check` for access, `track` for usage, and atomic check+track/reservation patterns for concurrent events. Current API reference uses v2-style RPC endpoints such as `POST /v1/billing.attach`, `POST /v1/billing.update`, `POST /v1/customers.list`, and balance endpoints including Check Permissions, Track Usage, Track Token Usage, Batch Track Usage, and Finalize Lock.
- Hetzner Cloud API is REST under `https://api.hetzner.cloud/v1`; the control-plane code needs servers, volumes, and actions failure simulation.
- GitHub issue/PR integrations should model both REST issue endpoints and pull request endpoints because GitHub's REST API treats pull requests as issues for some operations while separate PR endpoints are needed for PR-specific data.
- Jira Cloud integrations should model REST API v3 issue/project/search endpoints plus dynamic/webhook registration and delivery behavior.
- Linear integrations should model GraphQL queries/mutations at `https://api.linear.app/graphql` and webhook delivery for entity create/update events.
- Trello integrations should model REST cards/lists/boards plus webhook creation/delivery; Trello webhook setup validates callback URLs, so tests need to handle registration-time verification behavior.

## Proposed test pyramid

### Layer 1: deterministic unit/contract tests in app repos

Keep these fast and fake-based:

- provisioning plan derivation;
- lifecycle job state transitions;
- Autumn/OpenRouter accounting service edge cases;
- retry/idempotency logic;
- DB adapters and row-level invariants.

### Layer 2: FullCircle provider contract tests in this repo

Implement provider APIs here first, with TDD around request matching and fixture shape. These tests prove provider ergonomics and wire compatibility before app code depends on them.

### Layer 3: app-repo acceptance tests with FullCircle

Concrete suite definitions live in [`app-repo-fullcircle-acceptance-suites.md`](./app-repo-fullcircle-acceptance-suites.md).

Run real app/service code with dependency base URLs pointed to FullCircle. Assert:

- external request sequence;
- DB diffs/snapshots;
- user-visible state;
- logs/audit events;
- failure recovery behavior.

### Layer 4: optional provider-backed smoke tests

Keep real Hetzner/OpenRouter/Autumn tests gated behind env vars and never required for normal CI.

## FullCircle provider plan

### 1. Core harness hardening first

Implement before additional providers so provider tests do not encode known limitations:

```ts
harness.mock({
  name: 'create Hetzner server',
  method: 'POST',
  destination: 'https://api.hetzner.cloud',
  path: '/v1/servers',
  headers: { authorization: /^Bearer / },
  body: body => jsonField(body, 'server_type') === 'cpx21',
}, () => response.json(serverFixture), { times: 1 });
```

Required capabilities:

- framework-neutral request/response types;
- method/path/query/header/body matchers;
- cardinality: exact, min/max, any;
- named expectations and actual request log in failures;
- async handler correctness: await handlers, do not mark satisfied before success;
- explicit `verify()` / `close()` lifecycle in addition to `await using`;
- optional fallback capture/replay for low-value endpoints.

### 2. Hetzner provider

Initial API:

```ts
const hcloud = hetznerProvider(fc.harness('https://api.hetzner.cloud'));

hcloud.servers.create({
  match: { name: 'acme-app', serverType: 'cpx21', image: 'snapshot-*', location: 'nbg1' },
  reply: { id: 1001, name: 'acme-app', ipv4: '203.0.113.10' },
});
hcloud.volumes.create({ match: { name: 'acme-data', size: 50, location: 'nbg1' }, reply: { id: 2001 } });
hcloud.volumes.attach({ volumeId: 2001, match: { server: 1001 }, replyAction: { id: 3001, status: 'success' } });
hcloud.servers.delete({ serverId: 1001, replyAction: { id: 3002 } });
```

Failure fixtures:

- `resource_unavailable` on server create;
- rate limit / 429;
- volume create succeeds but attach fails;
- server create succeeds but response lacks ID;
- delete server succeeds while volume delete fails;
- action status remains running/failed when code starts polling.

E2E journeys in `hetzner-saas`:

1. happy path provision creates lifecycle job, executor runs it, D1 receives server/volume/hostname outputs;
2. allocation failure marks job failed and customer state non-active without partial persisted runtime;
3. volume attach failure preserves enough provider IDs for cleanup/resume;
4. suspend/delete calls detach/delete/tunnel cleanup and updates D1 idempotently;
5. remote executor unavailable returns actionable admin error and no stuck running job.

### 3. Cloudflare provider

Cover only APIs used by `PulumiCliRunner`/D1 adapter first:

- D1 query endpoint for control-plane deploy/check workflows;
- tunnel delete endpoint;
- future route/DNS endpoints if hostname routing moves out of Pulumi.

Failure fixtures:

- invalid token;
- D1 query error envelope;
- tunnel already deleted;
- transient 5xx.

### 4. OpenRouter provider

Initial API:

```ts
const openrouter = openRouterProvider(fc.harness('https://openrouter.ai'));

openrouter.chat.completions.create({
  match: {
    model: 'anthropic/claude-sonnet-4.6',
    messages: [{ role: 'user', contentIncludes: 'fix the failing test' }],
    stream: false,
    metadata: { customerId: 'cust_acme' },
  },
  reply: openrouter.fixtures.chatCompletion({
    id: 'gen_acme_1',
    content: 'Done.',
    usage: { promptTokens: 1000, completionTokens: 200, cost: 0.014 },
  }),
});

openrouter.generation.get({ id: 'gen_acme_1', reply: { totalCost: 0.014, nativeTokens: 1200 } });
```

Streaming support should be first-class, not an afterthought:

- SSE chunks with deltas;
- final usage chunk;
- abrupt stream termination;
- provider error chunk / normalized `finish_reason: error`;
- delayed generation stats reconciliation.

OpenCode integration pattern:

- create a temp `opencode.json` with OpenRouter provider `baseURL` set to FullCircle;
- create isolated `XDG_DATA_HOME` / auth file with fake key;
- run OpenCode against a tiny fixture repo;
- assert OpenRouter request(s), token/cost usage, and produced file changes.

### 5. Autumn provider

Initial API:

```ts
const autumn = autumnProvider(fc.harness('https://api.useautumn.com'));

autumn.customers.getOrCreate({ match: { customerId: 'cust_acme' }, reply: customerWithPlan });
autumn.balances.check({
  match: { customerId: 'cust_acme', featureId: 'ai_tokens', requiredBalance: 1200, sendEvent: true },
  reply: { allowed: true, balance: { remaining: 8800 }, lockId: 'lock_1' },
});
autumn.balances.trackTokenUsage({
  match: { customerId: 'cust_acme', featureId: 'ai_tokens', model: 'anthropic/claude-sonnet-4.6' },
  reply: { success: true },
});
autumn.balances.finalize({ lockId: 'lock_1', action: 'confirm' });
```

Key scenarios:

- allowed with enough balance;
- denied with paywall/upgrade URL;
- Autumn unavailable: app policy should be explicit (likely fail-closed for paid OpenRouter call initiation, fail-open only for read-only UI);
- OpenRouter succeeds but Autumn track fails: queue reconciliation;
- OpenRouter stream aborts after reservation: refund/release reserved balance;
- concurrent requests with atomic check+track or lock/finalize.

### 6. Composite AI usage provider/helper

After OpenRouter and Autumn provider primitives exist, add a test helper that models the business invariant directly:

```ts
aiUsageScenario({
  customerId: 'cust_acme',
  featureId: 'ai_tokens',
  model: 'anthropic/claude-sonnet-4.6',
  requiredTokens: 1200,
  completion: { promptTokens: 1000, completionTokens: 200, cost: 0.014 },
});
```

This should register both Autumn and OpenRouter mocks and expose expected ledger diffs so tests cannot drift between usage and billing fixtures.

### 7. Issue tracker and source-host plugin providers

The app plugin roadmap should treat Jira, GitHub, Linear, and Trello as first-class external systems, not as one-off workflow mocks. FullCircle should provide provider primitives plus a small cross-provider fixture vocabulary.

Common plugin contract:

```ts
const trackers = issueTrackerScenario({
  customerId: 'cust_acme',
  repo: 'acme/web',
  task: { title: 'Fix CI failure', externalId: 'ENG-123' },
});

trackers.github.issues.get({ owner: 'acme', repo: 'web', issueNumber: 123, reply: githubIssue });
trackers.linear.issues.create({ match: { teamKey: 'ENG', titleIncludes: 'Fix CI failure' }, reply: linearIssue });
trackers.jira.issues.transition({ issueKey: 'ENG-123', match: { status: 'In Progress' }, reply: jiraTransition });
trackers.trello.cards.move({ cardId: 'card_123', match: { listId: 'doing' }, reply: trelloCard });
```

Provider-specific starting surface:

- **GitHub provider**: issues, pull requests, review comments, commit statuses/check runs, repository dispatch, app installation token exchange, and signed webhook delivery. Reuse the existing GitHub workflow tests in `vibe-kanban-vscode-web` as the first acceptance target.
- **Jira provider**: project lookup, issue search by JQL, issue create/update/comment/transition, user/account lookup, dynamic webhook registration, and signed or shared-secret webhook delivery depending on app mode.
- **Linear provider**: GraphQL operation matching by `operationName` plus semantic variables, issue/team/project mutations, comments, workflow-state changes, OAuth/API-key auth variants, and webhook delivery.
- **Trello provider**: board/list/card CRUD, comments/actions, member lookup, card movement, webhook create/list/delete, and registration callback verification.

Cross-provider test scenarios:

1. link a coding-agent task to an external ticket and persist provider IDs;
2. create/update external ticket when an agent starts, blocks, opens a PR, or completes;
3. ingest webhook updates from the tracker and update app task state idempotently;
4. post an agent summary/comment back to the provider;
5. handle OAuth expiration, 401/403 permission errors, 404 deleted tickets, 409/conflict races, and 429 rate limits;
6. verify per-customer plugin enablement and billing limits: disabled plugin means no outbound provider call; insufficient Autumn entitlement blocks new sync work before provider calls.

Implementation notes:

- Keep a common `ExternalWorkItem` shape in app code, but retain raw provider payload snapshots for debugging and migrations.
- Match GraphQL providers by operation name and variables, not raw query string formatting.
- Use FullCircle outbound webhook delivery helpers for provider-to-app events, just like the Stripe provider.
- Add a small plugin conformance suite so every provider proves create/link/comment/transition/webhook/idempotency semantics.
- Build GitHub first because `vibe-kanban-vscode-web` already has GitHub webhook/workflow code, then Linear, Jira, and Trello.

## App-repo implementation sequence

1. Add gateways/seams in `vibe-kanban-vscode-web` before feature code:
   - `OpenRouterGateway` with base URL env;
   - `AutumnGateway` with base URL env;
   - `AiUsageService` with explicit policy for check/track/refund failures.
2. Add local unit tests using fake gateways.
3. Add FullCircle-backed acceptance tests for:
   - customer creation/login -> Autumn customer get/create;
   - start agent task -> Autumn check/reserve -> OpenCode/OpenRouter -> Autumn confirm/track -> DB audit;
   - insufficient balance -> no OpenRouter request;
   - OpenRouter 429/5xx -> release/refund usage and show retryable state.
4. Add plugin gateway seams and conformance tests in `vibe-kanban-vscode-web`:
   - common plugin installation/auth storage model;
   - GitHub provider first using existing webhook/workflow code;
   - Linear/Jira/Trello providers behind the same `ExternalWorkItem` contract;
   - plugin entitlement checks through Autumn before starting paid or rate-limited sync jobs.
5. In `hetzner-saas`, add FullCircle-backed acceptance tests around the active control plane branch:
   - first with direct `PulumiCliRunner` methods that already call fetch;
   - then full worker/executor HTTP flow with D1 shim snapshots;
   - keep real Hetzner smoke tests gated.
6. Add CI jobs that run FullCircle provider contract tests and app acceptance tests, but not real provider tests.

## Discussion questions

1. Should FullCircle intercept hardcoded global `fetch` origins directly, or should app code always expose base URL env vars? Recommendation: both, but require base URL injection for product code and keep global interception as a legacy/safety net.
2. For Autumn outages, should AI generation fail closed or allow temporary use? Recommendation: fail closed before starting paid OpenRouter work; queue reconciliation only after OpenRouter has already succeeded.
3. Should token limits be enforced by required balance estimate before generation or by final actual usage? Recommendation: reserve a conservative estimate, then finalize/refund using actual OpenRouter usage/generation stats.
4. Should OpenCode tests be true E2E or provider-level only at first? Recommendation: one tiny true OpenCode fixture test early to validate config/baseURL/auth isolation, then keep most cases at the gateway/service layer.
5. Should issue tracker plugins share one normalized app model or expose provider-native concepts directly? Recommendation: normalized `ExternalWorkItem` for app workflows, provider-native IDs/payloads retained for debugging, migrations, and advanced plugin behavior.
