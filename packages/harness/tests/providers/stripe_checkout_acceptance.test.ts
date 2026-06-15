(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import crypto from 'node:crypto';
import http from 'node:http';
import Database from 'better-sqlite3';
import express from 'express';
import fetch from 'node-fetch';
import request from 'supertest';

import {diffDatabaseSnapshots, sqliteDatabase} from '../../src/database';
import {fullcircle} from '../../src/fullcircle';
import {stripeProvider} from '../../src/providers/stripe';

const STRIPE_WEBHOOK_SECRET = 'whsec_fullcircle_test_secret';

const readRawBody = (req: express.Request): Promise<Buffer> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
});

const verifyStripeSignature = (payload: Buffer, signatureHeader: string | undefined) => {
    if (!signatureHeader) {
        return false;
    }

    const parts = Object.fromEntries(signatureHeader.split(',').map(part => part.split('=')));
    if (!parts.t || !parts.v1) {
        return false;
    }

    const expected = crypto
        .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
        .update(`${parts.t}.${payload.toString('utf8')}`)
        .digest('hex');

    return expected === parts.v1;
};

const createDatabase = () => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL
        );
        CREATE TABLE subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            provider_customer_id TEXT NOT NULL,
            provider_subscription_id TEXT NOT NULL,
            status TEXT NOT NULL
        );
        CREATE TABLE processed_webhook_events (
            event_id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            type TEXT NOT NULL
        );
    `);

    return db;
};

const initBillingApp = (input: {db: Database.Database; stripeBaseUrl: string}) => {
    const app = express();

    app.post('/stripe/webhook', async (req, res) => {
        const rawBody = await readRawBody(req);
        if (!verifyStripeSignature(rawBody, req.header('stripe-signature'))) {
            res.status(400).json({error: 'invalid stripe signature'});
            return;
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        const session = event.data.object;
        const userId = session.metadata?.userId || session.client_reference_id;

        const insertEvent = input.db.prepare('INSERT OR IGNORE INTO processed_webhook_events (event_id, provider, type) VALUES (?, ?, ?)');
        const eventResult = insertEvent.run(event.id, 'stripe', event.type);
        if (eventResult.changes === 0) {
            res.status(204).end();
            return;
        }

        if (event.type === 'checkout.session.completed') {
            input.db.prepare(`
                INSERT INTO subscriptions (user_id, provider, provider_customer_id, provider_subscription_id, status)
                VALUES (?, ?, ?, ?, ?)
            `).run(userId, 'stripe', session.customer, session.subscription, 'active');
        }

        res.status(204).end();
    });

    app.use(express.json());

    app.post('/api/test/login', (req, res) => {
        input.db.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)')
            .run('user_test_123', 'customer@example.com');
        res.json({id: 'user_test_123', email: 'customer@example.com'});
    });

    app.get('/billing', (req, res) => {
        const subscription = input.db.prepare('SELECT * FROM subscriptions WHERE user_id = ? AND status = ?')
            .get('user_test_123', 'active');
        const plan = subscription ? 'Pro' : 'Free';
        res.type('html').send(`<h1>Billing</h1><p>Current plan: ${plan}</p><button>Upgrade to Pro</button>`);
    });

    app.post('/api/billing/checkout', async (req, res) => {
        const stripeResponse = await fetch(`${input.stripeBaseUrl}/v1/checkout/sessions`, {
            method: 'POST',
            headers: {
                authorization: 'Bearer sk_test_fullcircle',
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                mode: 'subscription',
                success_url: 'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'http://localhost:3000/billing/cancel',
                client_reference_id: 'user_test_123',
                'line_items[0][price]': 'price_pro_monthly',
                'line_items[0][quantity]': '1',
                'metadata[userId]': 'user_test_123',
                'subscription_data[metadata][userId]': 'user_test_123',
            }).toString(),
        });

        res.status(stripeResponse.status).json(await stripeResponse.json());
    });

    return app;
};

describe('Stripe Checkout subscription dogfood acceptance', () => {
    it('upgrades a user from Free to Pro through FullCircle-controlled Stripe API and signed webhook with SQLite diffs', async () => {
        await using fc = await fullcircle({listenAddress: 0, defaultDestination: 'api.stripe.com'});
        await using th = fc.harness('api.stripe.com');

        const stripe = stripeProvider(th, {
            webhookSigningSecret: STRIPE_WEBHOOK_SECRET,
        });
        stripe.checkout.sessions.create({
            match: {
                mode: 'subscription',
                priceId: 'price_pro_monthly',
                quantity: 1,
                clientReferenceId: 'user_test_123',
                metadata: {userId: 'user_test_123'},
                subscriptionMetadata: {userId: 'user_test_123'},
            },
            reply: {
                id: 'cs_test_fullcircle_123',
                customer: 'cus_fullcircle_123',
                url: 'http://localhost:7331/stripe/checkout/cs_test_fullcircle_123',
            },
        });

        const db = createDatabase();
        const app = initBillingApp({
            db,
            stripeBaseUrl: fc.url,
        });
        const appServer = await new Promise<http.Server>(resolve => {
            const listener = app.listen(0, () => resolve(listener));
        });
        const testDb = sqliteDatabase(db);

        try {
            const address = appServer.address();
            if (!address || typeof address === 'string') {
                throw new Error('Expected app server TCP address');
            }
            const webhookUrl = `http://127.0.0.1:${address.port}/stripe/webhook`;

            await request(app).post('/api/test/login').expect(200);
            const before = await testDb.snapshot('before checkout');

            await request(app)
                .get('/billing')
                .expect(200)
                .expect(response => expect(response.text).toContain('Current plan: Free'));

            const checkoutResponse = await request(app)
                .post('/api/billing/checkout')
                .expect(200);

            expect(checkoutResponse.body).toMatchObject({
                id: 'cs_test_fullcircle_123',
                object: 'checkout.session',
                mode: 'subscription',
                customer: 'cus_fullcircle_123',
                url: 'http://localhost:7331/stripe/checkout/cs_test_fullcircle_123',
            });

            const webhookResult = await stripe.webhooks.send('checkout.session.completed', {
                id: 'evt_fullcircle_checkout_completed_123',
                data: {
                    object: {
                        id: 'cs_test_fullcircle_123',
                        object: 'checkout.session',
                        mode: 'subscription',
                        status: 'complete',
                        payment_status: 'paid',
                        customer: 'cus_fullcircle_123',
                        subscription: 'sub_fullcircle_123',
                        client_reference_id: 'user_test_123',
                        metadata: {userId: 'user_test_123'},
                    },
                },
            }, {to: webhookUrl, timestamp: 1760000000});

            expect(webhookResult).toMatchObject({ok: true, status: 204});

            await request(app)
                .get('/billing')
                .expect(200)
                .expect(response => expect(response.text).toContain('Current plan: Pro'));

            const after = await testDb.snapshot('after checkout');
            const diff = diffDatabaseSnapshots(before, after, 'checkout subscription upgrade');

            expect(diff.tables.subscriptions.inserted).toMatchObject([{
                user_id: 'user_test_123',
                provider: 'stripe',
                provider_customer_id: 'cus_fullcircle_123',
                provider_subscription_id: 'sub_fullcircle_123',
                status: 'active',
            }]);
            expect(diff.tables.processed_webhook_events.inserted).toEqual([{
                event_id: 'evt_fullcircle_checkout_completed_123',
                provider: 'stripe',
                type: 'checkout.session.completed',
            }]);
        } finally {
            await new Promise<void>((resolve, reject) => appServer.close(err => err ? reject(err) : resolve()));
            db.close();
        }
    });
});
