import type express from 'express';

import type {TestHarness} from '../harness';

type MaybeMatcher<T> = T | ((actual: T | undefined) => boolean);

type StripeFormBody = Record<string, unknown>;

export type StripeCheckoutSessionFixture = {
    id: string;
    object: 'checkout.session';
    mode: 'subscription';
    status: 'open' | 'complete' | 'expired';
    payment_status: 'paid' | 'unpaid' | 'no_payment_required';
    customer: string | null;
    subscription: string | null;
    client_reference_id: string | null;
    metadata: Record<string, string>;
    success_url: string | null;
    cancel_url: string | null;
    url: string | null;
    livemode: boolean;
};

export type StripeCheckoutSessionCreateExpectation = {
    match?: {
        mode?: MaybeMatcher<string>;
        successUrl?: MaybeMatcher<string>;
        cancelUrl?: MaybeMatcher<string>;
        priceId?: MaybeMatcher<string>;
        quantity?: MaybeMatcher<number>;
        clientReferenceId?: MaybeMatcher<string>;
        metadata?: Record<string, MaybeMatcher<string>>;
        subscriptionMetadata?: Record<string, MaybeMatcher<string>>;
    };
    reply?: Partial<StripeCheckoutSessionFixture>;
};

export type StripeCheckoutSessionRetrieveExpectation = {
    id: string;
    reply?: Partial<StripeCheckoutSessionFixture>;
};

export type StripeCheckoutSessionLineItemsExpectation = {
    sessionId: string;
    reply?: {
        data: object[];
    };
};

export type StripeProviderHarness = {
    checkout: {
        sessions: {
            create: (expectation: StripeCheckoutSessionCreateExpectation) => void;
            retrieve: (expectation: StripeCheckoutSessionRetrieveExpectation) => void;
            lineItems: (expectation: StripeCheckoutSessionLineItemsExpectation) => void;
        };
    };
};

const CHECKOUT_SESSIONS_PATH = '/v1/checkout/sessions';

export const stripeProvider = (harness: TestHarness): StripeProviderHarness => ({
    checkout: {
        sessions: {
            create: (expectation) => {
                harness.mock(CHECKOUT_SESSIONS_PATH, makeCheckoutSessionCreateHandler(expectation));
            },
            retrieve: (expectation) => {
                harness.mock(`${CHECKOUT_SESSIONS_PATH}/${expectation.id}`, (req, res) => {
                    if (req.method !== 'GET') {
                        res.status(405).json({error: 'Expected GET for Stripe Checkout Session retrieve'});
                        return;
                    }

                    res.json(buildCheckoutSessionFixture({}, {id: expectation.id, ...expectation.reply}));
                });
            },
            lineItems: (expectation) => {
                harness.mock(`${CHECKOUT_SESSIONS_PATH}/${expectation.sessionId}/line_items`, (req, res) => {
                    if (req.method !== 'GET') {
                        res.status(405).json({error: 'Expected GET for Stripe Checkout Session line_items'});
                        return;
                    }

                    res.json({
                        object: 'list',
                        data: expectation.reply?.data || [],
                        has_more: false,
                        url: `${CHECKOUT_SESSIONS_PATH}/${expectation.sessionId}/line_items`,
                    });
                });
            },
        },
    },
});

const makeCheckoutSessionCreateHandler = (expectation: StripeCheckoutSessionCreateExpectation): express.Handler => {
    return (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({error: 'Expected POST for Stripe Checkout Session create'});
            return;
        }

        const body = normalizeStripeFormBody(req.body);
        const mismatches = collectCheckoutSessionCreateMismatches(body, expectation);

        if (mismatches.length) {
            res.status(422).json({
                error: 'Stripe Checkout Session create request did not match expectations',
                mismatches,
            });
            return;
        }

        res.json(buildCheckoutSessionFixture(body, expectation.reply));
    };
};

const collectCheckoutSessionCreateMismatches = (
    body: StripeFormBody,
    expectation: StripeCheckoutSessionCreateExpectation,
): string[] => {
    const match = expectation.match;
    if (!match) {
        return [];
    }

    const mismatches: string[] = [];

    assertMatch(mismatches, 'mode', getString(body, 'mode'), match.mode);
    assertMatch(mismatches, 'success_url', getString(body, 'success_url'), match.successUrl);
    assertMatch(mismatches, 'cancel_url', getString(body, 'cancel_url'), match.cancelUrl);
    assertMatch(mismatches, 'line_items[0][price]', getString(body, 'line_items[0][price]'), match.priceId);
    assertMatch(mismatches, 'line_items[0][quantity]', getNumber(body, 'line_items[0][quantity]'), match.quantity);
    assertMatch(mismatches, 'client_reference_id', getString(body, 'client_reference_id'), match.clientReferenceId);

    for (const [key, matcher] of Object.entries(match.metadata || {})) {
        assertMatch(mismatches, `metadata[${key}]`, getString(body, `metadata[${key}]`), matcher);
    }

    for (const [key, matcher] of Object.entries(match.subscriptionMetadata || {})) {
        assertMatch(mismatches, `subscription_data[metadata][${key}]`, getString(body, `subscription_data[metadata][${key}]`), matcher);
    }

    return mismatches;
};

const assertMatch = <T extends string | number>(
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
        : actual === matcher;

    if (!matched) {
        mismatches.push(`Expected ${field} to match ${String(matcher)} but received ${String(actual)}`);
    }
};

const buildCheckoutSessionFixture = (
    body: StripeFormBody,
    reply: Partial<StripeCheckoutSessionFixture> = {},
): StripeCheckoutSessionFixture => {
    const metadata = collectMetadata(body, 'metadata');

    return {
        id: 'cs_test_fullcircle_123',
        object: 'checkout.session',
        mode: 'subscription',
        status: 'open',
        payment_status: 'unpaid',
        customer: 'cus_fullcircle_123',
        subscription: null,
        client_reference_id: getString(body, 'client_reference_id') || null,
        metadata,
        success_url: getString(body, 'success_url') || null,
        cancel_url: getString(body, 'cancel_url') || null,
        url: 'http://localhost:7331/stripe/checkout/cs_test_fullcircle_123',
        livemode: false,
        ...reply,
    };
};

const normalizeStripeFormBody = (body: unknown): StripeFormBody => {
    if (!body || typeof body !== 'object') {
        return {};
    }

    return body as StripeFormBody;
};

const getString = (body: StripeFormBody, key: string): string | undefined => {
    const value = body[key];
    if (Array.isArray(value)) {
        return typeof value[0] === 'string' ? value[0] : undefined;
    }

    return typeof value === 'string' ? value : undefined;
};

const getNumber = (body: StripeFormBody, key: string): number | undefined => {
    const value = getString(body, key);
    if (value === undefined) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const collectMetadata = (body: StripeFormBody, prefix: string): Record<string, string> => {
    const metadata: Record<string, string> = {};
    const startsWith = `${prefix}[`;

    for (const [key, value] of Object.entries(body)) {
        if (!key.startsWith(startsWith) || !key.endsWith(']')) {
            continue;
        }

        if (typeof value !== 'string') {
            continue;
        }

        const metadataKey = key.slice(startsWith.length, -1);
        metadata[metadataKey] = value;
    }

    return metadata;
};
