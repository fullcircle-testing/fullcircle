import crypto from 'node:crypto';

import type express from 'express';

import type {TestHarness} from '../harness';

type MaybeMatcher<T> = T | ((actual: T | undefined) => boolean);

type StripeFormBody = Record<string, unknown>;

export type StripeCheckoutLineItemExpectation = {
    priceId?: MaybeMatcher<string>;
    quantity?: MaybeMatcher<number>;
};

export type StripeCheckoutTrialExpectation = {
    end?: MaybeMatcher<number>;
    periodDays?: MaybeMatcher<number>;
    missingPaymentMethod?: MaybeMatcher<string>;
};

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
    allow_promotion_codes: boolean | null;
    url: string | null;
    livemode: boolean;
};

export type StripeCheckoutSessionCreateExpectation = {
    match?: {
        mode?: MaybeMatcher<string>;
        successUrl?: MaybeMatcher<string>;
        cancelUrl?: MaybeMatcher<string>;
        customer?: MaybeMatcher<string>;
        allowPromotionCodes?: MaybeMatcher<boolean>;
        priceId?: MaybeMatcher<string>;
        quantity?: MaybeMatcher<number>;
        lineItems?: StripeCheckoutLineItemExpectation[];
        clientReferenceId?: MaybeMatcher<string>;
        metadata?: Record<string, MaybeMatcher<string>>;
        subscriptionMetadata?: Record<string, MaybeMatcher<string>>;
        trial?: StripeCheckoutTrialExpectation;
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

export type StripeWebhookType =
    | 'checkout.session.completed'
    | 'checkout.session.async_payment_succeeded'
    | 'checkout.session.async_payment_failed'
    | 'checkout.session.expired'
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted'
    | 'invoice.created'
    | 'invoice.finalization_failed'
    | 'invoice.paid'
    | 'invoice.payment_action_required'
    | 'invoice.payment_failed';

export type StripeWebhookFixture<TType extends StripeWebhookType = StripeWebhookType> = Partial<{
    id: string;
    object: 'event';
    api_version: string;
    created: number;
    livemode: boolean;
    type: TType;
    data: {
        object: Record<string, unknown>;
    };
}> & {
    data: {
        object: Record<string, unknown>;
    };
};

export type StripeWebhookSendOptions = {
    to?: string;
    signingSecret?: string;
    timestamp?: number;
    signatureMode?: 'valid' | 'invalid' | 'missing';
};

export type StripeWebhookSequenceItem = {
    type: StripeWebhookType;
    event: StripeWebhookFixture;
    options?: StripeWebhookSendOptions;
};

export type WebhookDeliveryResult = {
    ok: boolean;
    status: number;
    body: string;
};

export type StripeProviderOptions = {
    webhookEndpoint?: string;
    webhookSigningSecret?: string;
    apiVersion?: string;
};

export type StripeProviderHarness = {
    checkout: {
        sessions: {
            create: (expectation: StripeCheckoutSessionCreateExpectation) => void;
            retrieve: (expectation: StripeCheckoutSessionRetrieveExpectation) => void;
            lineItems: (expectation: StripeCheckoutSessionLineItemsExpectation) => void;
        };
    };
    webhooks: {
        send: <TType extends StripeWebhookType>(
            type: TType,
            event: StripeWebhookFixture<TType>,
            options?: StripeWebhookSendOptions,
        ) => Promise<WebhookDeliveryResult>;
        sendSequence: (
            events: StripeWebhookSequenceItem[],
            options?: StripeWebhookSendOptions,
        ) => Promise<WebhookDeliveryResult[]>;
    };
};

const CHECKOUT_SESSIONS_PATH = '/v1/checkout/sessions';

export const stripeProvider = (harness: TestHarness, options: StripeProviderOptions = {}): StripeProviderHarness => ({
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
    webhooks: {
        send: (type, event, sendOptions) => sendStripeWebhook(type, event, options, sendOptions),
        sendSequence: async (events, sendOptions) => {
            const results: WebhookDeliveryResult[] = [];
            for (const item of events) {
                results.push(await sendStripeWebhook(
                    item.type,
                    item.event,
                    options,
                    {...sendOptions, ...item.options},
                ));
            }
            return results;
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
    assertMatch(mismatches, 'customer', getString(body, 'customer'), match.customer);
    assertMatch(mismatches, 'allow_promotion_codes', getBoolean(body, 'allow_promotion_codes'), match.allowPromotionCodes);
    assertMatch(mismatches, 'line_items[0][price]', getString(body, 'line_items[0][price]'), match.priceId);
    assertMatch(mismatches, 'line_items[0][quantity]', getNumber(body, 'line_items[0][quantity]'), match.quantity);
    assertMatch(mismatches, 'client_reference_id', getString(body, 'client_reference_id'), match.clientReferenceId);

    match.lineItems?.forEach((lineItem, index) => {
        assertMatch(mismatches, `line_items[${index}][price]`, getString(body, `line_items[${index}][price]`), lineItem.priceId);
        assertMatch(mismatches, `line_items[${index}][quantity]`, getNumber(body, `line_items[${index}][quantity]`), lineItem.quantity);
    });

    if (match.trial) {
        assertMatch(mismatches, 'subscription_data[trial_end]', getNumber(body, 'subscription_data[trial_end]'), match.trial.end);
        assertMatch(mismatches, 'subscription_data[trial_period_days]', getNumber(body, 'subscription_data[trial_period_days]'), match.trial.periodDays);
        assertMatch(
            mismatches,
            'subscription_data[trial_settings][end_behavior][missing_payment_method]',
            getString(body, 'subscription_data[trial_settings][end_behavior][missing_payment_method]'),
            match.trial.missingPaymentMethod,
        );
    }

    for (const [key, matcher] of Object.entries(match.metadata || {})) {
        assertMatch(mismatches, `metadata[${key}]`, getString(body, `metadata[${key}]`), matcher);
    }

    for (const [key, matcher] of Object.entries(match.subscriptionMetadata || {})) {
        assertMatch(mismatches, `subscription_data[metadata][${key}]`, getString(body, `subscription_data[metadata][${key}]`), matcher);
    }

    return mismatches;
};

const assertMatch = <T extends string | number | boolean>(
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
    const id = reply.id || 'cs_test_fullcircle_123';

    return {
        id,
        object: 'checkout.session',
        mode: 'subscription',
        status: 'open',
        payment_status: 'unpaid',
        customer: getString(body, 'customer') || 'cus_fullcircle_123',
        subscription: null,
        client_reference_id: getString(body, 'client_reference_id') || null,
        metadata,
        success_url: getString(body, 'success_url') || null,
        cancel_url: getString(body, 'cancel_url') || null,
        allow_promotion_codes: getBoolean(body, 'allow_promotion_codes') ?? null,
        url: `http://localhost:7331/stripe/checkout/${id}`,
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

const getBoolean = (body: StripeFormBody, key: string): boolean | undefined => {
    const value = getString(body, key);
    if (value === undefined) {
        return undefined;
    }

    if (value === 'true') {
        return true;
    }

    if (value === 'false') {
        return false;
    }

    return undefined;
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


const sendStripeWebhook = async <TType extends StripeWebhookType>(
    type: TType,
    event: StripeWebhookFixture<TType>,
    providerOptions: StripeProviderOptions,
    sendOptions: StripeWebhookSendOptions = {},
): Promise<WebhookDeliveryResult> => {
    const endpoint = sendOptions.to || providerOptions.webhookEndpoint;
    if (!endpoint) {
        throw new Error('Stripe webhook endpoint is required. Pass webhookEndpoint to stripeProvider or to webhooks.send().');
    }

    const signingSecret = sendOptions.signingSecret || providerOptions.webhookSigningSecret || 'whsec_fullcircle_test_secret';
    const timestamp = sendOptions.timestamp || Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(buildStripeWebhookEvent(type, event, providerOptions));
    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };

    const signatureMode = sendOptions.signatureMode || 'valid';
    if (signatureMode !== 'missing') {
        headers['stripe-signature'] = makeStripeSignatureHeader(
            payload,
            signingSecret,
            timestamp,
            signatureMode,
        );
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: payload,
    });

    return {
        ok: response.ok,
        status: response.status,
        body: await response.text(),
    };
};

const buildStripeWebhookEvent = <TType extends StripeWebhookType>(
    type: TType,
    event: StripeWebhookFixture<TType>,
    providerOptions: StripeProviderOptions,
) => {
    const apiVersion = event.api_version || providerOptions.apiVersion;

    return {
        id: event.id || `evt_fullcircle_${type.replaceAll('.', '_')}`,
        object: 'event' as const,
        ...(apiVersion ? {api_version: apiVersion} : {}),
        created: event.created || Math.floor(Date.now() / 1000),
        livemode: event.livemode ?? false,
        type,
        data: event.data,
    };
};

const makeStripeSignatureHeader = (
    payload: string,
    signingSecret: string,
    timestamp: number,
    signatureMode: 'valid' | 'invalid',
): string => {
    const secret = signatureMode === 'valid' ? signingSecret : `${signingSecret}_invalid`;
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

    return `t=${timestamp},v1=${signature}`;
};
