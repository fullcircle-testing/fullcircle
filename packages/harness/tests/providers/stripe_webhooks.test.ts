(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import crypto from 'node:crypto';
import http from 'node:http';

import express from 'express';

import {fullcircle} from '../../src/fullcircle';
import {stripeProvider} from '../../src/providers/stripe';

const readRawBody = (req: express.Request): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
};

const verifyStripeSignature = (payload: Buffer, signatureHeader: string | undefined, secret: string) => {
    if (!signatureHeader) {
        return false;
    }

    const parts = Object.fromEntries(signatureHeader.split(',').map(part => part.split('=')));
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) {
        return false;
    }

    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${payload.toString('utf8')}`)
        .digest('hex');

    return expected === signature;
};

describe('Stripe provider webhooks', () => {
    let server: http.Server | undefined;
    let webhookUrl: string;
    let receivedEvents: Array<{body: any; signature?: string; signatureValid: boolean}>;

    beforeEach(async () => {
        receivedEvents = [];
        const app = express();
        app.post('/stripe/webhook', async (req, res) => {
            const rawBody = await readRawBody(req);
            const signature = req.header('stripe-signature');
            receivedEvents.push({
                body: JSON.parse(rawBody.toString('utf8')),
                signature,
                signatureValid: verifyStripeSignature(rawBody, signature, 'whsec_fullcircle_test_secret'),
            });
            res.status(204).end();
        });

        server = await new Promise<http.Server>(resolve => {
            const listener = app.listen(0, () => resolve(listener));
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Expected test webhook server to listen on a TCP address');
        }
        webhookUrl = `http://127.0.0.1:${address.port}/stripe/webhook`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve, reject) => {
            server?.close(err => err ? reject(err) : resolve());
        });
    });

    it('sends checkout.session.completed with a valid Stripe-Signature header', async () => {
        await using fc = await fullcircle({listenAddress: null});
        await using th = fc.harness('api.stripe.com');
        const stripe = stripeProvider(th, {
            webhookEndpoint: webhookUrl,
            webhookSigningSecret: 'whsec_fullcircle_test_secret',
        });

        const result = await stripe.webhooks.send('checkout.session.completed', {
            id: 'evt_fullcircle_checkout_completed_123',
            data: {
                object: {
                    id: 'cs_test_fullcircle_123',
                    customer: 'cus_fullcircle_123',
                    subscription: 'sub_fullcircle_123',
                },
            },
        }, {timestamp: 1760000000});

        expect(result).toMatchObject({status: 204, ok: true});
        expect(receivedEvents).toHaveLength(1);
        expect(receivedEvents[0]).toMatchObject({
            signatureValid: true,
            body: {
                id: 'evt_fullcircle_checkout_completed_123',
                object: 'event',
                type: 'checkout.session.completed',
                livemode: false,
                data: {
                    object: {
                        id: 'cs_test_fullcircle_123',
                        customer: 'cus_fullcircle_123',
                        subscription: 'sub_fullcircle_123',
                    },
                },
            },
        });
        expect(receivedEvents[0]?.signature).toMatch(/^t=1760000000,v1=[a-f0-9]{64}$/);
    });

    it('supports invalid and missing webhook signature modes for negative tests', async () => {
        await using fc = await fullcircle({listenAddress: null});
        await using th = fc.harness('api.stripe.com');
        const stripe = stripeProvider(th, {
            webhookEndpoint: webhookUrl,
            webhookSigningSecret: 'whsec_fullcircle_test_secret',
        });

        await stripe.webhooks.send('invoice.paid', {data: {object: {id: 'in_fullcircle_123'}}}, {signatureMode: 'invalid'});
        await stripe.webhooks.send('customer.subscription.created', {data: {object: {id: 'sub_fullcircle_123'}}}, {signatureMode: 'missing'});

        expect(receivedEvents).toHaveLength(2);
        expect(receivedEvents[0]?.signature).toBeTruthy();
        expect(receivedEvents[0]?.signatureValid).toBe(false);
        expect(receivedEvents[1]?.signature).toBeUndefined();
        expect(receivedEvents[1]?.signatureValid).toBe(false);
    });

    it('delivers webhook sequences in caller-defined order', async () => {
        await using fc = await fullcircle({listenAddress: null});
        await using th = fc.harness('api.stripe.com');
        const stripe = stripeProvider(th, {
            webhookEndpoint: webhookUrl,
            webhookSigningSecret: 'whsec_fullcircle_test_secret',
        });

        const results = await stripe.webhooks.sendSequence([
            {type: 'invoice.paid', event: {id: 'evt_invoice', data: {object: {id: 'in_123'}}}},
            {type: 'checkout.session.completed', event: {id: 'evt_checkout', data: {object: {id: 'cs_123'}}}},
        ]);

        expect(results.map(result => result.status)).toEqual([204, 204]);
        expect(receivedEvents.map(event => event.body.type)).toEqual([
            'invoice.paid',
            'checkout.session.completed',
        ]);
    });
});
