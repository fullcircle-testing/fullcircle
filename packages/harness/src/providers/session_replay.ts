import fs from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

import {TestHarness} from '../harness';
import type {
    FullCircleBody,
    FullCircleExpectationOptions,
    FullCircleResponse,
    FullCircleRouteMatcher,
} from '../primitives';
import {response} from '../primitives';

export type FullCircleReplayBodyArtifact =
    | {kind: 'empty'}
    | {kind: 'json'; value: unknown}
    | {kind: 'text'; value: string}
    | {kind: 'bytes'; base64: string};

export type FullCircleReplayHttpExchangeEvent = {
    id: string;
    at: string;
    correlationId?: string;
    kind: 'http.exchange';
    destination: string;
    request: {
        method: string;
        path: string;
        headers: Record<string, string | string[]> | null;
        body: FullCircleReplayBodyArtifact;
    };
    response: {
        status: number;
        headers: Record<string, string | string[]> | null;
        body: FullCircleReplayBodyArtifact;
    };
};

export type FullCircleReplayTimelineEvent =
    | FullCircleReplayHttpExchangeEvent
    | {
        id: string;
        at: string;
        correlationId?: string;
        kind: string;
        [key: string]: unknown;
    };

export type FullCircleReplaySessionArtifact = {
    schemaVersion: 'fullcircle.session.v1';
    name: string;
    startedAt: string;
    endedAt: string;
    timeline: FullCircleReplayTimelineEvent[];
    providerFixtures?: unknown[];
    webhookDeliveries?: unknown[];
    browserEvents?: unknown[];
    resources?: unknown[];
    database?: unknown;
    redactions?: unknown[];
    metadata?: Record<string, unknown>;
};

export type FullCircleReplayOptions = {
    destination?: string;
    namePrefix?: string;
    strict?: boolean;
    expectations?: FullCircleExpectationOptions;
};

export const replaySessionArtifactFile = async (
    harness: TestHarness,
    artifactPath: string,
    options: FullCircleReplayOptions = {},
): Promise<void> => {
    const content = await fs.readFile(artifactPath, 'utf8');
    replaySessionArtifact(harness, JSON.parse(content) as FullCircleReplaySessionArtifact, options);
};

export const replaySessionArtifact = (
    harness: TestHarness,
    artifact: FullCircleReplaySessionArtifact,
    options: FullCircleReplayOptions = {},
): void => {
    validateArtifact(artifact);

    for (const exchange of artifact.timeline) {
        if (!isHttpExchange(exchange)) {
            continue;
        }

        if (options.destination && normalizeDestination(exchange.destination) !== normalizeDestination(options.destination)) {
            continue;
        }

        const matcher: FullCircleRouteMatcher = {
            destination: destinationMatcher(exchange.destination),
            method: exchange.request.method,
            path: pathWithoutQuery(exchange.request.path),
            query: queryMatchers(exchange.request.path),
            body: actualBody => bodyMatches(exchange.request.body, actualBody),
            strict: options.strict ?? true,
        };

        const name = [
            options.namePrefix,
            `${exchange.request.method.toUpperCase()} ${exchange.request.path}`,
            `from ${artifact.name}`,
        ].filter(Boolean).join(' ');

        harness.mockRoute(matcher, () => artifactResponse(exchange.response), {
            ...options.expectations,
            name: options.expectations?.name || name,
        });
    }
};

const isHttpExchange = (
    event: FullCircleReplayTimelineEvent,
): event is FullCircleReplayHttpExchangeEvent => event.kind === 'http.exchange';

const validateArtifact = (artifact: FullCircleReplaySessionArtifact): void => {
    if (artifact.schemaVersion !== 'fullcircle.session.v1') {
        throw new Error(`Unsupported FullCircle session artifact schema: ${artifact.schemaVersion}`);
    }
};

const artifactResponse = (
    artifact: FullCircleReplayHttpExchangeEvent['response'],
): FullCircleResponse => {
    const headers = singleValueHeaders(artifact.headers);
    const init = {status: artifact.status, headers};

    if (artifact.body.kind === 'json') {
        return response.json(artifact.body.value, init);
    }

    if (artifact.body.kind === 'text') {
        return response.text(artifact.body.value, init);
    }

    if (artifact.body.kind === 'bytes') {
        return response.status(artifact.status, Uint8Array.from(Buffer.from(artifact.body.base64, 'base64')), headers);
    }

    return response.status(artifact.status, undefined, headers);
};

const bodyMatches = (
    expected: FullCircleReplayBodyArtifact,
    actual: FullCircleBody,
): boolean => {
    if (expected.kind === 'empty') {
        return actual.kind === 'empty';
    }

    if (expected.kind === 'json') {
        if (actual.kind !== 'json' && actual.kind !== 'form') {
            return false;
        }

        return isDeepStrictEqual(actual.value, expected.value);
    }

    if (expected.kind === 'text') {
        return actual.kind === 'text' && actual.value === expected.value;
    }

    if (actual.kind !== 'bytes') {
        return false;
    }

    return Buffer.from(actual.value).equals(Buffer.from(expected.base64, 'base64'));
};

const singleValueHeaders = (
    headers: Record<string, string | string[]> | null,
): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers || {})) {
        result[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    return result;
};

const normalizeDestination = (destination: string): string => destination
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

const destinationMatcher = (destination: string): RegExp => {
    const normalized = escapeRegExp(normalizeDestination(destination));
    return new RegExp(`^(https?://)?${normalized}/?$`);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pathWithoutQuery = (path: string): string => {
    const parsed = new URL(path, 'http://fullcircle.local');
    return parsed.pathname;
};

const queryMatchers = (path: string): Record<string, string> | undefined => {
    const parsed = new URL(path, 'http://fullcircle.local');
    if (!parsed.search) {
        return undefined;
    }

    return Object.fromEntries(parsed.searchParams.entries());
};
