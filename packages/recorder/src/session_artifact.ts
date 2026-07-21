import {RecordedCall} from './types';

export const FULLCIRCLE_SESSION_SCHEMA_VERSION = 'fullcircle.session.v1' as const;

export type FullCircleSessionArtifact = {
    schemaVersion: typeof FULLCIRCLE_SESSION_SCHEMA_VERSION;
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

export type FullCircleTimelineEvent =
    | FullCircleHttpExchangeEvent
    | FullCircleBrowserTimelineEvent
    | FullCircleWebhookTimelineEvent
    | FullCircleDatabaseTimelineEvent;

export type FullCircleTimelineEventBase = {
    id: string;
    at: string;
    correlationId?: string;
};

export type FullCircleHttpExchangeEvent = FullCircleTimelineEventBase & {
    kind: 'http.exchange';
    destination: string;
    request: FullCircleHttpRequestArtifact;
    response: FullCircleHttpResponseArtifact;
};

export type FullCircleBrowserTimelineEvent = FullCircleTimelineEventBase & {
    kind: 'browser.event';
    event: FullCircleBrowserEvent;
};

export type FullCircleWebhookTimelineEvent = FullCircleTimelineEventBase & {
    kind: 'webhook.delivery';
    delivery: FullCircleWebhookDelivery;
};

export type FullCircleDatabaseTimelineEvent = FullCircleTimelineEventBase & {
    kind: 'database.diff';
    diff: FullCircleDatabaseDiff;
};

export type FullCircleHttpRequestArtifact = {
    method: string;
    path: string;
    headers: Record<string, string | string[]> | null;
    body: FullCircleBodyArtifact;
};

export type FullCircleHttpResponseArtifact = {
    status: number;
    headers: Record<string, string | string[]> | null;
    body: FullCircleBodyArtifact;
};

export type FullCircleBodyArtifact =
    | {kind: 'empty'}
    | {kind: 'json'; value: unknown}
    | {kind: 'text'; value: string}
    | {kind: 'bytes'; base64: string};

export type FullCircleProviderFixture = {
    provider: string;
    name: string;
    request: {
        method: string;
        destination: string;
        path: string;
        bodyEncoding?: 'json' | 'form-urlencoded' | 'text' | 'bytes';
        match?: Record<string, unknown>;
    };
    response: {
        status: number;
        headers?: Record<string, string>;
        body?: unknown;
    };
    assertions?: Record<string, unknown>;
};

export type FullCircleWebhookDelivery = {
    provider: string;
    type: string;
    eventId: string;
    endpoint: string;
    signatureMode: 'valid' | 'invalid' | 'missing';
    payload: unknown;
};

export type FullCircleBrowserEvent = {
    type: 'click' | 'input' | 'submit' | 'navigation' | 'custom';
    url: string;
    selector?: string;
    label?: string;
    value?: string;
    metadata?: Record<string, unknown>;
};

export type FullCircleResourceSeed = {
    provider: string;
    type: string;
    name: string;
    value: unknown;
};

export type FullCircleDatabaseArtifacts = {
    snapshots: FullCircleDatabaseSnapshot[];
    diffs: FullCircleDatabaseDiff[];
};

export type FullCircleDatabaseSnapshot = {
    name: string;
    at: string;
    adapter: 'sqlite' | 'postgres' | string;
    tables: Record<string, Array<Record<string, unknown>>>;
};

export type FullCircleDatabaseDiff = {
    name: string;
    from: string;
    to: string;
    adapter: 'sqlite' | 'postgres' | string;
    tables: Record<string, FullCircleTableDiff>;
};

export type FullCircleTableDiff = {
    inserted: Array<Record<string, unknown>>;
    updated: Array<{before: Record<string, unknown>; after: Record<string, unknown>}>;
    deleted: Array<Record<string, unknown>>;
};

export type FullCircleRedactionRule = {
    field: string;
    strategy: 'omit' | 'replace' | 'hash';
    replacement?: string;
};

export const createEmptySessionArtifact = (input: {
    name: string;
    startedAt: string;
    endedAt?: string;
    metadata?: Record<string, unknown>;
}): FullCircleSessionArtifact => ({
    schemaVersion: FULLCIRCLE_SESSION_SCHEMA_VERSION,
    name: input.name,
    startedAt: input.startedAt,
    endedAt: input.endedAt || input.startedAt,
    timeline: [],
    providerFixtures: [],
    webhookDeliveries: [],
    browserEvents: [],
    resources: [],
    database: {
        snapshots: [],
        diffs: [],
    },
    redactions: [],
    metadata: input.metadata || {},
});

export const recordedCallToHttpExchangeEvent = (
    call: RecordedCall,
    index: number,
): FullCircleHttpExchangeEvent => ({
    id: `http-${index + 1}`,
    at: call.time,
    kind: 'http.exchange',
    destination: call.host,
    request: {
        method: call.requestMethod,
        path: call.requestPath,
        headers: normalizeHeaders(call.requestHeaders),
        body: normalizeBody(call.requestBody),
    },
    response: {
        status: call.status,
        headers: normalizeHeaders(call.responseHeaders),
        body: normalizeBody(call.responseBody),
    },
});

export const browserEventToTimelineEvent = (
    input: {
        id?: string;
        at: string;
        correlationId?: string;
        event: FullCircleBrowserEvent;
    },
    index: number,
): FullCircleBrowserTimelineEvent => ({
    id: input.id || `browser-${index + 1}`,
    at: input.at,
    correlationId: input.correlationId,
    kind: 'browser.event',
    event: input.event,
});

export const recordedCallsToSessionArtifact = (input: {
    name: string;
    startedAt: string;
    endedAt: string;
    calls: RecordedCall[];
    browserEvents?: Array<{
        id?: string;
        at: string;
        correlationId?: string;
        event: FullCircleBrowserEvent;
    }>;
    metadata?: Record<string, unknown>;
}): FullCircleSessionArtifact => {
    const httpEvents = input.calls.map(recordedCallToHttpExchangeEvent);
    const browserEvents = (input.browserEvents || []).map(browserEventToTimelineEvent);

    return {
        ...createEmptySessionArtifact(input),
        timeline: [...httpEvents, ...browserEvents].sort((left, right) => left.at.localeCompare(right.at)),
        browserEvents: browserEvents.map(event => event.event),
    };
};

const normalizeHeaders = (
    headers: RecordedCall['requestHeaders'] | RecordedCall['responseHeaders'],
): Record<string, string | string[]> | null => {
    if (!headers) {
        return null;
    }

    return Object.fromEntries(
        Object.entries(headers)
            .filter((entry): entry is [string, string | string[]] => {
                const value = entry[1];
                return typeof value === 'string' || Array.isArray(value);
            }),
    );
};

const normalizeBody = (body: unknown): FullCircleBodyArtifact => {
    if (body === undefined || body === null) {
        return {kind: 'empty'};
    }

    if (typeof body === 'string') {
        return {kind: 'text', value: body};
    }

    return {kind: 'json', value: body};
};
