# Telemetry and widget sink provider contract

FullCircle's telemetry sink provider keeps e2e tests deterministic by replacing low-priority analytics, error reporting, and browser widget services with local sinks. The sinks return successful stub responses by default, keep a small in-memory record of what the app attempted to send, and can fail the test when a flow starts depending on unexpected telemetry behavior.

## Scope

- PostHog capture, batch, event, and decide calls.
- Rollbar item ingestion calls.
- Intercom browser widget script and browser API calls.
- Generic third-party browser scripts that should load without reaching the network.

These helpers are not intended to model provider analytics behavior completely. They exist so product e2e tests can assert that the critical user journey works even when analytics, error reporting, or support widgets are unavailable or synthetic.

## API

```ts
import {fullcircle, telemetrySinksProvider} from '@fullcircle/harness';

await using fc = await fullcircle({listenAddress: null, defaultDestination: 'app.posthog.com'});
await using harness = fc.harness('app.posthog.com');

const telemetry = telemetrySinksProvider(harness);

const posthog = telemetry.sink.posthog({assertNoUnexpectedIdentify: false});
const rollbar = telemetry.sink.rollbar({failOnServerErrorReport: true});
const intercom = telemetry.sink.intercom();
const widget = telemetry.sink.browserScript({
  path: '/third-party/widget.js',
  globalName: 'ThirdPartyWidget',
});
```

Each sink registers `times: 'any'` because analytics clients often retry, batch, or fire multiple calls during the same user journey.

## PostHog sink

Routes:

- `POST /capture/`
- `POST /batch/`
- `POST /e/`
- `POST /decide/`

Behavior:

- Capture-like routes return `{ status: 1 }`.
- Decide returns `{ featureFlags: {} }`.
- Captured events are recorded as `{ event, distinctId }` in the returned handle.
- By default, `$identify` is treated as unexpected and returns `422`. Set `assertNoUnexpectedIdentify: false` when a test intentionally exercises identity setup.

## Rollbar sink

Route:

- `POST /api/1/item/`

Behavior:

- Returns `{ err: 0, result: { id: 'fullcircle-rollbar-item' } }` for accepted items.
- Records each item as `{ level, body }`.
- When `failOnServerErrorReport: true`, reports at `error` or `critical` level return `422`. This lets e2e tests fail when the app silently reports server-side errors during a happy path.

## Intercom sink

Routes:

- `GET /widget/*`
- `POST /messenger/*`, `/events*`, `/visitor*`, and `/trackers*`

Behavior:

- Widget script returns a deterministic `window.Intercom` stub.
- Browser API routes return `{ ok: true }` and store request bodies in the returned handle.

## Generic browser script sink

`browserScript({ path, globalName, body, status })` stubs browser-only scripts that do not need a dedicated provider. It returns JavaScript that creates `window[globalName]` unless an explicit `body` is supplied.

## E2E guidance

1. Register telemetry sinks for each host an app reaches during a test run.
2. Prefer disabling analytics in app config when possible; use sinks when a client or widget still reaches the network.
3. Keep `$identify` and Rollbar `error` reports strict by default so CI catches accidental PII emission or hidden app failures.
4. Do not write product assertions against analytics provider internals. Assert critical app state and only inspect sink handles when telemetry behavior is the test subject.
