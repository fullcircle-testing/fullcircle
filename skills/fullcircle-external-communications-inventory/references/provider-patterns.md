# Provider classification patterns

## Typed FullCircle provider

Use for high-value providers whose resources matter to business assertions: Stripe subscriptions/webhooks, auth, storage, email, AI gateways, provisioning APIs. Prefer resource builders over raw route mocks so provider responses and DB seeds cannot drift.

## Generic session replay

Use for low-value or broad API surface endpoints. Replay captured `http.exchange` events with `replaySessionArtifact()` and promote endpoints to typed providers only when tests need semantic assertions.

## Injectable local fake/seam

Use when the app already has a client boundary or can cheaply add one. Examples: Google Sheets calculators, feature flags, analytics wrappers, email senders. Keep the seam app-owned; FullCircle can still document it as a session/resource.

## Sink or disable

Use for observability widgets and analytics that should not affect critical e2e flows. Assert they do not block the UI. Only capture their traffic in tests that explicitly verify observability.

## Optional real-provider smoke

Use sparingly for provider contract drift detection. These tests must be isolated from normal CI, require explicit credentials, and never be the only coverage for a user journey.

## OAuth guidance

For routine user auth, prefer first-class app auth helpers or better-auth test utilities over a mock OAuth server. For provider OAuth flows under test, capture the authorize/token/userinfo sequence, add app-owned issuer/base-URL configuration, and replay through FullCircle with state/PKCE assertions.

## Seam examples

- SDK base URL/config: `STRIPE_BASE_URL`, `OPENROUTER_BASE_URL`, `CLOUDFLARE_API_BASE_URL`.
- Webhook target: app server URL passed to provider helper.
- Browser widgets: env flags such as `NEXT_PUBLIC_ANALYTICS_DISABLED=true`.
- Storage: app-owned storage client factory that can point to FullCircle or a local fake.
