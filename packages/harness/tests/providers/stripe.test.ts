(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {stripeProvider} from '../../src/providers/stripe';

describe('Stripe provider harness', () => {
    it('matches subscription Checkout Session create requests and returns deterministic session fixtures', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        stripeProvider(th).checkout.sessions.create({
            match: {
                mode: 'subscription',
                priceId: 'price_pro_monthly',
                quantity: 1,
                clientReferenceId: 'user_test_123',
                metadata: {
                    userId: 'user_test_123',
                },
                subscriptionMetadata: {
                    userId: 'user_test_123',
                },
            },
            reply: {
                id: 'cs_test_fullcircle_123',
                customer: 'cus_fullcircle_123',
                url: 'http://localhost:7331/stripe/checkout/cs_test_fullcircle_123',
            },
        });

        const response = await request(fc.expressApp)
            .post('/v1/checkout/sessions')
            .type('form')
            .send({
                mode: 'subscription',
                success_url: 'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'http://localhost:3000/billing/cancel',
                client_reference_id: 'user_test_123',
                'line_items[0][price]': 'price_pro_monthly',
                'line_items[0][quantity]': '1',
                'metadata[userId]': 'user_test_123',
                'subscription_data[metadata][userId]': 'user_test_123',
            })
            .expect(200);

        expect(response.body).toMatchObject({
            id: 'cs_test_fullcircle_123',
            object: 'checkout.session',
            mode: 'subscription',
            status: 'open',
            payment_status: 'unpaid',
            customer: 'cus_fullcircle_123',
            subscription: null,
            client_reference_id: 'user_test_123',
            metadata: {
                userId: 'user_test_123',
            },
            success_url: 'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'http://localhost:3000/billing/cancel',
            url: 'http://localhost:7331/stripe/checkout/cs_test_fullcircle_123',
        });
    });


    it('matches embedded subscription Checkout Sessions with multiple line items and trial settings', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        stripeProvider(th).checkout.sessions.create({
            match: {
                mode: 'subscription',
                customer: 'cus_soundspace_user',
                uiMode: 'embedded',
                returnUrl: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
                allowPromotionCodes: true,
                clientReferenceId: 'user_test_123',
                lineItems: [
                    {priceId: 'price_room_hours_monthly', quantity: 2},
                    {priceId: 'price_storage_monthly', quantity: 1},
                ],
                metadata: {
                    user_id: 'user_test_123',
                    plan_id: 'plan_pro',
                },
                subscriptionMetadata: {
                    user_id: 'user_test_123',
                },
                trial: {
                    end: 1765000000,
                    missingPaymentMethod: 'cancel',
                },
            },
            reply: {
                id: 'cs_test_embedded_123',
                customer: 'cus_soundspace_user',
                client_secret: 'cs_test_embedded_123_secret_fullcircle',
            },
        });

        const response = await request(fc.expressApp)
            .post('/v1/checkout/sessions')
            .type('form')
            .send({
                mode: 'subscription',
                customer: 'cus_soundspace_user',
                ui_mode: 'embedded',
                return_url: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
                allow_promotion_codes: 'true',
                client_reference_id: 'user_test_123',
                'line_items[0][price]': 'price_room_hours_monthly',
                'line_items[0][quantity]': '2',
                'line_items[1][price]': 'price_storage_monthly',
                'line_items[1][quantity]': '1',
                'metadata[user_id]': 'user_test_123',
                'metadata[plan_id]': 'plan_pro',
                'subscription_data[metadata][user_id]': 'user_test_123',
                'subscription_data[trial_end]': '1765000000',
                'subscription_data[trial_settings][end_behavior][missing_payment_method]': 'cancel',
            })
            .expect(200);

        expect(response.body).toMatchObject({
            id: 'cs_test_embedded_123',
            object: 'checkout.session',
            mode: 'subscription',
            customer: 'cus_soundspace_user',
            client_secret: 'cs_test_embedded_123_secret_fullcircle',
            ui_mode: 'embedded',
            return_url: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
            allow_promotion_codes: true,
            client_reference_id: 'user_test_123',
            metadata: {
                user_id: 'user_test_123',
                plan_id: 'plan_pro',
            },
        });
    });

    it('rejects Checkout Session create requests that do not match expected Stripe parameters', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        stripeProvider(th).checkout.sessions.create({
            match: {
                mode: 'subscription',
                priceId: 'price_pro_monthly',
                quantity: 1,
            },
        });

        const response = await request(fc.expressApp)
            .post('/v1/checkout/sessions')
            .type('form')
            .send({
                mode: 'subscription',
                'line_items[0][price]': 'price_wrong',
                'line_items[0][quantity]': '1',
            })
            .expect(422);

        expect(response.body).toEqual({
            error: 'Stripe Checkout Session create request did not match expectations',
            mismatches: ['Expected line_items[0][price] to match price_pro_monthly but received price_wrong'],
        });
    });

    it('returns deterministic retrieve and line item fixtures for recorded Checkout Sessions', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        const stripe = stripeProvider(th);
        stripe.checkout.sessions.retrieve({
            id: 'cs_test_fullcircle_123',
            reply: {
                id: 'cs_test_fullcircle_123',
                status: 'complete',
                payment_status: 'paid',
                subscription: 'sub_fullcircle_123',
            },
        });
        stripe.checkout.sessions.lineItems({
            sessionId: 'cs_test_fullcircle_123',
            reply: {
                data: [{
                    id: 'li_fullcircle_123',
                    object: 'item',
                    price: {
                        id: 'price_pro_monthly',
                    },
                    quantity: 1,
                }],
            },
        });

        const sessionResponse = await request(fc.expressApp)
            .get('/v1/checkout/sessions/cs_test_fullcircle_123?expand[]=line_items')
            .expect(200);

        expect(sessionResponse.body).toMatchObject({
            id: 'cs_test_fullcircle_123',
            object: 'checkout.session',
            status: 'complete',
            payment_status: 'paid',
            subscription: 'sub_fullcircle_123',
        });

        const lineItemsResponse = await request(fc.expressApp)
            .get('/v1/checkout/sessions/cs_test_fullcircle_123/line_items')
            .expect(200);

        expect(lineItemsResponse.body).toEqual({
            object: 'list',
            data: [{
                id: 'li_fullcircle_123',
                object: 'item',
                price: {
                    id: 'price_pro_monthly',
                },
                quantity: 1,
            }],
            has_more: false,
            url: '/v1/checkout/sessions/cs_test_fullcircle_123/line_items',
        });
    });

    it('uses the requested Checkout Session id as the default retrieve fixture id', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        stripeProvider(th).checkout.sessions.retrieve({
            id: 'cs_test_custom_session',
        });

        const sessionResponse = await request(fc.expressApp)
            .get('/v1/checkout/sessions/cs_test_custom_session')
            .expect(200);

        expect(sessionResponse.body).toMatchObject({
            id: 'cs_test_custom_session',
            object: 'checkout.session',
        });
    });

});
