import {isDeepStrictEqual} from 'node:util';

import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type CloudflareScalar = string | number | boolean;
type MaybeMatcher<T extends CloudflareScalar> = T | RegExp | ((actual: CloudflareScalar | undefined) => boolean);
type CloudflareValues = Record<string, unknown>;

export type CloudflareApiError = {
    code: number | string;
    message: string;
    [key: string]: unknown;
};

export type CloudflareD1QueryExpectation = {
    accountId: string;
    databaseId: string;
    match?: {
        sql?: MaybeMatcher<string>;
        params?: unknown[];
    };
    reply?: {
        results?: Array<Record<string, unknown>>;
        meta?: Record<string, unknown>;
        success?: boolean;
        [key: string]: unknown;
    };
    status?: number;
    errors?: CloudflareApiError[];
    messages?: unknown[];
};

export type CloudflareTunnelDeleteExpectation = {
    accountId: string;
    tunnelId: string;
    reply?: Record<string, unknown>;
    status?: number;
    errors?: CloudflareApiError[];
    messages?: unknown[];
};

export type CloudflareDnsRecordMatch = {
    type?: MaybeMatcher<string>;
    name?: MaybeMatcher<string>;
    content?: MaybeMatcher<string>;
    proxied?: MaybeMatcher<boolean>;
    ttl?: MaybeMatcher<number>;
};

export type CloudflareDnsRecordMutationExpectation = {
    zoneId: string;
    recordId?: string;
    match?: CloudflareDnsRecordMatch;
    reply?: Record<string, unknown>;
    status?: number;
    errors?: CloudflareApiError[];
    messages?: unknown[];
};

export type CloudflareDnsRecordDeleteExpectation = {
    zoneId: string;
    recordId: string;
    reply?: Record<string, unknown>;
    status?: number;
    errors?: CloudflareApiError[];
    messages?: unknown[];
};

export type CloudflareProviderHarness = {
    d1: {
        query: (expectation: CloudflareD1QueryExpectation) => void;
    };
    tunnels: {
        delete: (expectation: CloudflareTunnelDeleteExpectation) => void;
    };
    dns: {
        records: {
            create: (expectation: CloudflareDnsRecordMutationExpectation) => void;
            update: (expectation: CloudflareDnsRecordMutationExpectation & {recordId: string}) => void;
            delete: (expectation: CloudflareDnsRecordDeleteExpectation) => void;
        };
    };
};

export const cloudflareProvider = (harness: TestHarness): CloudflareProviderHarness => ({
    d1: {
        query: expectation => {
            harness.mockRoute({
                method: 'POST',
                path: `/client/v4/accounts/${expectation.accountId}/d1/database/${expectation.databaseId}/query`,
            }, makeCloudflareHandler({
                label: 'D1 query',
                match: values => collectD1QueryMismatches(values, expectation.match),
                status: expectation.status ?? (expectation.errors?.length ? 400 : 200),
                errors: expectation.errors,
                messages: expectation.messages,
                result: () => [
                    {
                        results: [],
                        meta: {},
                        success: true,
                        ...expectation.reply,
                    },
                ],
            }), {name: `Cloudflare D1 query ${expectation.accountId}/${expectation.databaseId}`});
        },
    },
    tunnels: {
        delete: expectation => {
            harness.mockRoute({
                method: 'DELETE',
                path: `/client/v4/accounts/${expectation.accountId}/cfd_tunnel/${expectation.tunnelId}`,
            }, makeCloudflareHandler({
                label: 'delete tunnel',
                status: expectation.status ?? (expectation.errors?.length ? 404 : 200),
                errors: expectation.errors,
                messages: expectation.messages,
                result: () => expectation.reply ?? {id: expectation.tunnelId},
            }), {name: `Cloudflare delete tunnel ${expectation.accountId}/${expectation.tunnelId}`});
        },
    },
    dns: {
        records: {
            create: expectation => {
                harness.mockRoute({
                    method: 'POST',
                    path: `/client/v4/zones/${expectation.zoneId}/dns_records`,
                }, makeCloudflareHandler({
                    label: 'create DNS record',
                    match: values => collectFieldMismatches(values, normalizeDnsRecordMatch(expectation.match)),
                    status: expectation.status ?? (expectation.errors?.length ? 400 : 200),
                    errors: expectation.errors,
                    messages: expectation.messages,
                    result: values => ({
                        id: expectation.reply?.id ?? 'dns_fullcircle_123',
                        ...values,
                        ...expectation.reply,
                    }),
                }), {name: `Cloudflare create DNS record ${expectation.zoneId}`});
            },
            update: expectation => {
                harness.mockRoute({
                    method: 'PUT',
                    path: `/client/v4/zones/${expectation.zoneId}/dns_records/${expectation.recordId}`,
                }, makeCloudflareHandler({
                    label: 'update DNS record',
                    match: values => collectFieldMismatches(values, normalizeDnsRecordMatch(expectation.match)),
                    status: expectation.status ?? (expectation.errors?.length ? 400 : 200),
                    errors: expectation.errors,
                    messages: expectation.messages,
                    result: values => ({
                        id: expectation.recordId,
                        ...values,
                        ...expectation.reply,
                    }),
                }), {name: `Cloudflare update DNS record ${expectation.zoneId}/${expectation.recordId}`});
            },
            delete: expectation => {
                harness.mockRoute({
                    method: 'DELETE',
                    path: `/client/v4/zones/${expectation.zoneId}/dns_records/${expectation.recordId}`,
                }, makeCloudflareHandler({
                    label: 'delete DNS record',
                    status: expectation.status ?? (expectation.errors?.length ? 404 : 200),
                    errors: expectation.errors,
                    messages: expectation.messages,
                    result: () => expectation.reply ?? {id: expectation.recordId},
                }), {name: `Cloudflare delete DNS record ${expectation.zoneId}/${expectation.recordId}`});
            },
        },
    },
});

const makeCloudflareHandler = (input: {
    label: string;
    match?: (values: CloudflareValues) => string[];
    status: number;
    errors?: CloudflareApiError[];
    messages?: unknown[];
    result: (values: CloudflareValues) => unknown;
}): FullCircleHandler => request => {
    const values = valuesFromBody(request.body);
    const mismatches = input.match?.(values) ?? [];

    if (mismatches.length) {
        return response.json({
            error: `Cloudflare ${input.label} request did not match expectations`,
            mismatches,
        }, {status: 422});
    }

    if (input.errors?.length) {
        return response.json(cloudflareEnvelope({
            success: false,
            errors: input.errors,
            messages: input.messages,
            result: null,
        }), {status: input.status});
    }

    return response.json(cloudflareEnvelope({
        success: true,
        errors: [],
        messages: input.messages,
        result: input.result(values),
    }), {status: input.status});
};

const cloudflareEnvelope = (input: {
    success: boolean;
    errors: CloudflareApiError[];
    messages?: unknown[];
    result: unknown;
}) => ({
    success: input.success,
    errors: input.errors,
    messages: input.messages ?? [],
    result: input.result,
});

const collectD1QueryMismatches = (
    values: CloudflareValues,
    match: CloudflareD1QueryExpectation['match'],
): string[] => {
    const mismatches = collectFieldMismatches(values, {sql: match?.sql});
    if (match?.params !== undefined && !isDeepStrictEqual(values.params, match.params)) {
        mismatches.push(`Expected params to equal ${JSON.stringify(match.params)} but received ${JSON.stringify(values.params)}`);
    }
    return mismatches;
};

const normalizeDnsRecordMatch = (
    match: CloudflareDnsRecordMatch | undefined,
): Record<string, MaybeMatcher<CloudflareScalar> | undefined> | undefined => match && ({
    type: match.type,
    name: match.name,
    content: match.content,
    proxied: match.proxied,
    ttl: match.ttl,
});

const collectFieldMismatches = (
    values: CloudflareValues,
    match: Record<string, MaybeMatcher<CloudflareScalar> | undefined> | undefined,
): string[] => {
    const mismatches: string[] = [];
    for (const [field, matcher] of Object.entries(match || {})) {
        assertMatch(mismatches, field, scalar(values[field]), matcher);
    }
    return mismatches;
};

const assertMatch = <T extends CloudflareScalar>(
    mismatches: string[],
    field: string,
    actual: T | undefined,
    matcher: MaybeMatcher<T> | undefined,
) => {
    if (matcher === undefined) {
        return;
    }

    const matched = typeof matcher === 'function'
        ? matcher(actual)
        : matcher instanceof RegExp
            ? typeof actual === 'string' && matcher.test(actual)
        : actual === matcher;

    if (!matched) {
        mismatches.push(`Expected ${field} to match ${String(matcher)} but received ${String(actual)}`);
    }
};

const valuesFromBody = (body: FullCircleBody): CloudflareValues => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        return body.value as CloudflareValues;
    }

    if (body.kind === 'form') {
        return body.value;
    }

    return {};
};

const scalar = (value: unknown): CloudflareScalar | undefined => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return undefined;
};
