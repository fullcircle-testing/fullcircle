import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type JsonObject = Record<string, unknown>;

export type RecordedPostHogEvent = {
    event: string;
    distinctId?: string;
};

export type RecordedRollbarItem = {
    level?: string;
    body: unknown;
};

export type PostHogSinkOptions = {
    assertNoUnexpectedIdentify?: boolean;
};

export type RollbarSinkOptions = {
    failOnServerErrorReport?: boolean;
};

export type BrowserScriptSinkOptions = {
    path: string | RegExp;
    globalName?: string;
    body?: string;
    status?: number;
};

export type PostHogSinkHandle = {
    events: RecordedPostHogEvent[];
};

export type RollbarSinkHandle = {
    items: RecordedRollbarItem[];
};

export type IntercomSinkHandle = {
    messages: unknown[];
};

export type BrowserScriptSinkHandle = {
    requests: string[];
};

export type TelemetrySinksProviderHarness = {
    sink: {
        posthog: (options?: PostHogSinkOptions) => PostHogSinkHandle;
        rollbar: (options?: RollbarSinkOptions) => RollbarSinkHandle;
        intercom: () => IntercomSinkHandle;
        browserScript: (options: BrowserScriptSinkOptions) => BrowserScriptSinkHandle;
    };
};

export const telemetrySinksProvider = (harness: TestHarness): TelemetrySinksProviderHarness => ({
    sink: {
        posthog: (options = {}) => registerPostHogSink(harness, options),
        rollbar: (options = {}) => registerRollbarSink(harness, options),
        intercom: () => registerIntercomSink(harness),
        browserScript: options => registerBrowserScriptSink(harness, options),
    },
});

const registerPostHogSink = (harness: TestHarness, options: PostHogSinkOptions): PostHogSinkHandle => {
    const handle: PostHogSinkHandle = {events: []};
    const handler: FullCircleHandler = request => {
        const events = postHogEvents(request.body);
        handle.events.push(...events);

        const identifyEvents = events.filter(event => event.event === '$identify');
        if (options.assertNoUnexpectedIdentify !== false && identifyEvents.length) {
            return response.json({
                error: 'PostHog sink received unexpected identify event',
                events: identifyEvents.map(event => event.event),
            }, {status: 422});
        }

        return response.json({status: 1});
    };

    harness.mockRoute({method: 'POST', path: /^\/(capture|batch|e)\/?$/}, handler, {
        name: 'PostHog telemetry sink',
        times: 'any',
    });
    harness.mockRoute({method: 'POST', path: /^\/decide\/?$/}, () => response.json({featureFlags: {}}), {
        name: 'PostHog decide sink',
        times: 'any',
    });

    return handle;
};

const registerRollbarSink = (harness: TestHarness, options: RollbarSinkOptions): RollbarSinkHandle => {
    const handle: RollbarSinkHandle = {items: []};

    harness.mockRoute({method: 'POST', path: /^\/api\/1\/item\/?$/}, request => {
        const body = bodyValue(request.body);
        const level = rollbarLevel(body);
        handle.items.push({level, body});

        if (options.failOnServerErrorReport && (level === 'error' || level === 'critical')) {
            return response.json({error: 'Rollbar sink received a server error report', level}, {status: 422});
        }

        return response.json({err: 0, result: {id: 'fullcircle-rollbar-item'}});
    }, {
        name: 'Rollbar telemetry sink',
        times: 'any',
    });

    return handle;
};

const registerIntercomSink = (harness: TestHarness): IntercomSinkHandle => {
    const handle: IntercomSinkHandle = {messages: []};

    harness.mockRoute({method: 'GET', path: /^\/widget\/.*$/}, () => response.text(
        'window.Intercom=window.Intercom||function(){(window.Intercom.q=window.Intercom.q||[]).push(arguments);};',
        {headers: {'content-type': 'application/javascript; charset=utf-8'}},
    ), {
        name: 'Intercom widget script sink',
        times: 'any',
    });
    harness.mockRoute({method: 'POST', path: /^\/(messenger|events|visitor|trackers)\b.*$/}, request => {
        handle.messages.push(bodyValue(request.body));
        return response.json({ok: true});
    }, {
        name: 'Intercom browser API sink',
        times: 'any',
    });

    return handle;
};

const registerBrowserScriptSink = (harness: TestHarness, options: BrowserScriptSinkOptions): BrowserScriptSinkHandle => {
    const handle: BrowserScriptSinkHandle = {requests: []};
    const globalName = options.globalName || 'FullCircleThirdPartyWidget';

    harness.mockRoute({method: 'GET', path: options.path}, request => {
        handle.requests.push(request.url);
        return response.text(options.body || stubGlobalScript(globalName), {
            status: options.status || 200,
            headers: {'content-type': 'application/javascript; charset=utf-8'},
        });
    }, {
        name: 'Browser widget script sink',
        times: 'any',
    });

    return handle;
};

const postHogEvents = (body: FullCircleBody): RecordedPostHogEvent[] => {
    const value = bodyValue(body);
    if (!isRecord(value)) {
        return [];
    }

    if (Array.isArray(value.batch)) {
        return value.batch.filter(isRecord).map(postHogEventFromRecord);
    }

    return [postHogEventFromRecord(value)];
};

const postHogEventFromRecord = (record: JsonObject): RecordedPostHogEvent => ({
    event: typeof record.event === 'string' ? record.event : 'unknown',
    distinctId: typeof record.distinct_id === 'string' ? record.distinct_id : undefined,
});

const rollbarLevel = (body: unknown): string | undefined => {
    if (!isRecord(body)) {
        return undefined;
    }

    const data = isRecord(body.data) ? body.data : body;
    return typeof data.level === 'string' ? data.level : undefined;
};

const bodyValue = (body: FullCircleBody): unknown => {
    if (body.kind === 'json' || body.kind === 'form' || body.kind === 'text' || body.kind === 'bytes') {
        return body.value;
    }
    return undefined;
};

const isRecord = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stubGlobalScript = (globalName: string): string => {
    const property = JSON.stringify(globalName);
    return `window[${property}]=window[${property}]||function(){};`;
};
