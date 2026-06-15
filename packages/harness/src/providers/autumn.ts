import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type AutumnScalar = string | number | boolean;
type MaybeMatcher<T extends AutumnScalar> = T | RegExp | ((actual: AutumnScalar | undefined) => boolean);
type AutumnBody = Record<string, unknown>;
type AutumnReply = Record<string, unknown>;

export type AutumnErrorFixture = {
    code: string;
    message: string;
    [key: string]: unknown;
};

export type AutumnCommonOptions<TMatch extends Record<string, MaybeMatcher<AutumnScalar> | undefined>> = {
    match?: TMatch;
    reply?: AutumnReply;
    status?: number;
    error?: AutumnErrorFixture;
};

export type AutumnCustomerMatch = {
    customerId?: MaybeMatcher<string>;
    email?: MaybeMatcher<string>;
};

export type AutumnProductMatch = AutumnCustomerMatch & {
    productId?: MaybeMatcher<string>;
};

export type AutumnBalanceMatch = AutumnCustomerMatch & {
    featureId?: MaybeMatcher<string>;
    requiredBalance?: MaybeMatcher<number>;
    sendEvent?: MaybeMatcher<boolean>;
};

export type AutumnTrackTokenUsageMatch = AutumnCustomerMatch & {
    featureId?: MaybeMatcher<string>;
    model?: MaybeMatcher<string>;
    inputTokens?: MaybeMatcher<number>;
    outputTokens?: MaybeMatcher<number>;
};

export type AutumnFinalizeLockExpectation = {
    lockId: string;
    action?: MaybeMatcher<string>;
    reply?: AutumnReply;
    status?: number;
    error?: AutumnErrorFixture;
};

export type AutumnProviderHarness = {
    customers: {
        getOrCreate: (expectation: AutumnCommonOptions<AutumnCustomerMatch>) => void;
        list: (expectation: Omit<AutumnCommonOptions<AutumnCustomerMatch>, 'reply'> & {reply?: AutumnReply[]}) => void;
    };
    billing: {
        attach: (expectation: AutumnCommonOptions<AutumnProductMatch>) => void;
        update: (expectation: AutumnCommonOptions<AutumnProductMatch>) => void;
    };
    balances: {
        check: (expectation: AutumnCommonOptions<AutumnBalanceMatch>) => void;
        track: (expectation: AutumnCommonOptions<AutumnBalanceMatch>) => void;
        trackTokenUsage: (expectation: AutumnCommonOptions<AutumnTrackTokenUsageMatch>) => void;
        batchTrackUsage: (expectation: AutumnCommonOptions<AutumnCustomerMatch>) => void;
        finalize: (expectation: AutumnFinalizeLockExpectation) => void;
    };
};

export const autumnProvider = (harness: TestHarness): AutumnProviderHarness => ({
    customers: {
        getOrCreate: expectation => mockAutumnRpc(harness, '/v1/customers.get_or_create', 'customer get/create', {
            match: normalizeCustomerMatch(expectation.match),
            reply: expectation.reply || {id: 'cust_fullcircle_123'},
            status: expectation.status,
            error: expectation.error,
        }),
        list: expectation => mockAutumnRpc(harness, '/v1/customers.list', 'customer list', {
            match: normalizeCustomerMatch(expectation.match),
            reply: {customers: expectation.reply || []},
            status: expectation.status,
            error: expectation.error,
        }),
    },
    billing: {
        attach: expectation => mockAutumnRpc(harness, '/v1/billing.attach', 'billing attach', {
            match: normalizeProductMatch(expectation.match),
            reply: expectation.reply || {success: true},
            status: expectation.status,
            error: expectation.error,
        }),
        update: expectation => mockAutumnRpc(harness, '/v1/billing.update', 'billing update', {
            match: normalizeProductMatch(expectation.match),
            reply: expectation.reply || {success: true},
            status: expectation.status,
            error: expectation.error,
        }),
    },
    balances: {
        check: expectation => mockAutumnRpc(harness, '/v1/balances.check', 'balance check', {
            match: normalizeBalanceMatch(expectation.match),
            reply: expectation.reply || {allowed: true},
            status: expectation.status,
            error: expectation.error,
        }),
        track: expectation => mockAutumnRpc(harness, '/v1/balances.track', 'balance track', {
            match: normalizeBalanceMatch(expectation.match),
            reply: expectation.reply || {success: true},
            status: expectation.status,
            error: expectation.error,
        }),
        trackTokenUsage: expectation => mockAutumnRpc(harness, '/v1/balances.track_token_usage', 'token usage track', {
            match: normalizeTokenUsageMatch(expectation.match),
            reply: expectation.reply || {success: true},
            status: expectation.status,
            error: expectation.error,
        }),
        batchTrackUsage: expectation => mockAutumnRpc(harness, '/v1/balances.batch_track_usage', 'batch usage track', {
            match: normalizeCustomerMatch(expectation.match),
            reply: expectation.reply || {success: true},
            status: expectation.status,
            error: expectation.error,
        }),
        finalize: expectation => mockAutumnRpc(harness, '/v1/balances.finalize_lock', 'lock finalize', {
            match: {
                lock_id: expectation.lockId,
                action: expectation.action,
            },
            reply: expectation.reply || {success: true, lock_id: expectation.lockId},
            status: expectation.status,
            error: expectation.error,
        }),
    },
});

const mockAutumnRpc = (
    harness: TestHarness,
    path: string,
    label: string,
    expectation: {
        match?: Record<string, MaybeMatcher<AutumnScalar> | undefined>;
        reply: AutumnReply;
        status?: number;
        error?: AutumnErrorFixture;
    },
): void => {
    harness.mockRoute({method: 'POST', path}, makeAutumnHandler(label, expectation), {name: `Autumn ${label}`});
};

const makeAutumnHandler = (
    label: string,
    expectation: {
        match?: Record<string, MaybeMatcher<AutumnScalar> | undefined>;
        reply: AutumnReply;
        status?: number;
        error?: AutumnErrorFixture;
    },
): FullCircleHandler => request => {
    const body = valuesFromBody(request.body);
    const mismatches = collectMismatches(body, expectation.match);

    if (mismatches.length) {
        return response.json({
            error: `Autumn ${label} request did not match expectations`,
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json({error: expectation.error}, {status: expectation.status || 500});
    }

    return response.json(expectation.reply, {status: expectation.status || 200});
};

const normalizeCustomerMatch = (
    match: AutumnCustomerMatch | undefined,
): Record<string, MaybeMatcher<AutumnScalar> | undefined> | undefined => match && ({
    customer_id: match.customerId,
    email: match.email,
});

const normalizeProductMatch = (
    match: AutumnProductMatch | undefined,
): Record<string, MaybeMatcher<AutumnScalar> | undefined> | undefined => match && ({
    ...normalizeCustomerMatch(match),
    product_id: match.productId,
});

const normalizeBalanceMatch = (
    match: AutumnBalanceMatch | undefined,
): Record<string, MaybeMatcher<AutumnScalar> | undefined> | undefined => match && ({
    ...normalizeCustomerMatch(match),
    feature_id: match.featureId,
    required_balance: match.requiredBalance,
    send_event: match.sendEvent,
});

const normalizeTokenUsageMatch = (
    match: AutumnTrackTokenUsageMatch | undefined,
): Record<string, MaybeMatcher<AutumnScalar> | undefined> | undefined => match && ({
    ...normalizeCustomerMatch(match),
    feature_id: match.featureId,
    model: match.model,
    input_tokens: match.inputTokens,
    output_tokens: match.outputTokens,
});

const valuesFromBody = (body: FullCircleBody): AutumnBody => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        return body.value as AutumnBody;
    }

    if (body.kind === 'form') {
        return body.value;
    }

    return {};
};

const collectMismatches = (
    values: AutumnBody,
    match: Record<string, MaybeMatcher<AutumnScalar> | undefined> | undefined,
): string[] => {
    const mismatches: string[] = [];
    for (const [field, matcher] of Object.entries(match || {})) {
        assertMatch(mismatches, field, scalar(values[field]), matcher);
    }
    return mismatches;
};

const assertMatch = <T extends AutumnScalar>(
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

const scalar = (value: unknown): AutumnScalar | undefined => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return undefined;
};
