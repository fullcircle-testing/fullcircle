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


    it('matches hosted subscription Checkout Sessions with multiple line items and trial settings', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        stripeProvider(th).checkout.sessions.create({
            match: {
                mode: 'subscription',
                customer: 'cus_soundspace_user',
                successUrl: 'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}',
                cancelUrl: 'http://localhost:3000/billing/cancel',
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
                id: 'cs_test_hosted_multi_123',
                customer: 'cus_soundspace_user',
            },
        });

        const response = await request(fc.expressApp)
            .post('/v1/checkout/sessions')
            .type('form')
            .send({
                mode: 'subscription',
                customer: 'cus_soundspace_user',
                success_url: 'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'http://localhost:3000/billing/cancel',
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
            id: 'cs_test_hosted_multi_123',
            object: 'checkout.session',
            mode: 'subscription',
            customer: 'cus_soundspace_user',
            success_url: 'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'http://localhost:3000/billing/cancel',
            allow_promotion_codes: true,
            client_reference_id: 'user_test_123',
            metadata: {
                user_id: 'user_test_123',
                plan_id: 'plan_pro',
            },
        });
    });

    it('models embedded subscription Checkout Sessions as a separate provider contract', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        stripeProvider(th).checkout.embedded.sessions.createSubscription({
            match: {
                customer: 'cus_soundspace_user',
                returnUrl: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
                redirectOnCompletion: 'if_required',
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
                ui_mode: 'embedded_page',
                customer: 'cus_soundspace_user',
                return_url: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
                redirect_on_completion: 'if_required',
                allow_promotion_codes: 'true',
                client_reference_id: 'user_test_123',
                'line_items[0][price]': 'price_room_hours_monthly',
                'line_items[0][quantity]': '2',
                'line_items[1][price]': 'price_storage_monthly',
                'line_items[1][quantity]': '1',
                'metadata[user_id]': 'user_test_123',
                'metadata[plan_id]': 'plan_pro',
                'subscription_data[metadata][user_id]': 'user_test_123',
            })
            .expect(200);

        expect(response.body).toMatchObject({
            id: 'cs_test_embedded_123',
            object: 'checkout.session',
            mode: 'subscription',
            ui_mode: 'embedded_page',
            return_url: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
            redirect_on_completion: 'if_required',
            client_secret: 'cs_test_embedded_123_secret_fullcircle',
            customer: 'cus_soundspace_user',
            url: null,
            success_url: null,
            cancel_url: null,
        });
    });

    it('rejects hosted-style Checkout payloads for the embedded Checkout contract', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        stripeProvider(th).checkout.embedded.sessions.createSubscription({
            match: {
                returnUrl: 'http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID}',
                lineItems: [{priceId: 'price_room_hours_monthly', quantity: 1}],
            },
        });

        const response = await request(fc.expressApp)
            .post('/v1/checkout/sessions')
            .type('form')
            .send({
                mode: 'subscription',
                success_url: 'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'http://localhost:3000/billing/cancel',
                'line_items[0][price]': 'price_room_hours_monthly',
                'line_items[0][quantity]': '1',
            })
            .expect(422);

        expect(response.body).toEqual({
            error: 'Stripe Checkout Session create request did not match expectations',
            mismatches: [
                'Expected ui_mode to match embedded_page but received undefined',
                'Expected return_url to match http://localhost:3000/checkout/return?session_id={CHECKOUT_SESSION_ID} but received undefined',
                'Expected embedded Checkout request to omit success_url',
                'Expected embedded Checkout request to omit cancel_url',
            ],
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

    it('supports customer list-by-email and create fixtures', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        const stripe = stripeProvider(th);
        stripe.customers.list({
            match: {email: 'customer@example.test'},
            reply: [{id: 'cus_fullcircle_123', object: 'customer', email: 'customer@example.test'}],
        });
        stripe.customers.create({
            match: {email: 'new@example.test', name: 'New Customer'},
            reply: {id: 'cus_fullcircle_new', object: 'customer'},
        });

        const listResponse = await request(fc.expressApp)
            .get('/v1/customers?email=customer%40example.test')
            .expect(200);
        expect(listResponse.body).toEqual({
            object: 'list',
            data: [{id: 'cus_fullcircle_123', object: 'customer', email: 'customer@example.test'}],
            has_more: false,
            url: '/v1/customers',
        });

        const createResponse = await request(fc.expressApp)
            .post('/v1/customers')
            .type('form')
            .send({email: 'new@example.test', name: 'New Customer'})
            .expect(200);
        expect(createResponse.body).toMatchObject({
            id: 'cus_fullcircle_new',
            object: 'customer',
            email: 'new@example.test',
            name: 'New Customer',
        });
    });

    it('supports product and price admin-sync fixtures', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        const stripe = stripeProvider(th);
        stripe.products.list({reply: [{id: 'prod_booking', object: 'product', name: 'Booking'}]});
        stripe.products.search({
            match: {query: 'metadata["soundspace_product_type"]:"pause"'},
            reply: [{id: 'prod_pause', object: 'product', metadata: {soundspace_product_type: 'pause'}}],
        });
        stripe.products.create({
            match: {name: /Piano Room/},
            reply: {id: 'prod_room', object: 'product'},
        });
        stripe.prices.create({
            match: {product: 'prod_room', 'recurring[interval]': 'month'},
            reply: {id: 'price_room_monthly', object: 'price'},
        });
        stripe.prices.list({
            match: {product: 'prod_pause'},
            reply: [{id: 'price_pause', object: 'price', product: 'prod_pause'}],
        });

        expect((await request(fc.expressApp).get('/v1/products').expect(200)).body.data)
            .toEqual([{id: 'prod_booking', object: 'product', name: 'Booking'}]);
        expect((await request(fc.expressApp)
            .get('/v1/products/search?query=metadata%5B%22soundspace_product_type%22%5D%3A%22pause%22')
            .expect(200)).body.data)
            .toEqual([{id: 'prod_pause', object: 'product', metadata: {soundspace_product_type: 'pause'}}]);
        expect((await request(fc.expressApp)
            .post('/v1/products')
            .type('form')
            .send({name: 'Piano Room Subscription'})
            .expect(200)).body)
            .toMatchObject({id: 'prod_room', object: 'product', name: 'Piano Room Subscription'});
        expect((await request(fc.expressApp)
            .post('/v1/prices')
            .type('form')
            .send({product: 'prod_room', 'recurring[interval]': 'month'})
            .expect(200)).body)
            .toMatchObject({id: 'price_room_monthly', object: 'price', product: 'prod_room'});
        expect((await request(fc.expressApp)
            .get('/v1/prices?product=prod_pause')
            .expect(200)).body.data)
            .toEqual([{id: 'price_pause', object: 'price', product: 'prod_pause'}]);
    });

    it('supports subscription, invoice, and billing portal fixtures', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await using th = fc.harness('api.stripe.com');
        const stripe = stripeProvider(th);
        stripe.subscriptions.retrieve({id: 'sub_fullcircle_123', reply: {status: 'active'}});
        stripe.subscriptions.list({
            match: {customer: 'cus_fullcircle_123'},
            reply: [{id: 'sub_fullcircle_123', object: 'subscription', customer: 'cus_fullcircle_123'}],
        });
        stripe.subscriptions.update({
            id: 'sub_fullcircle_123',
            match: {cancel_at_period_end: 'true'},
            reply: {cancel_at_period_end: true},
        });
        stripe.invoices.retrieve({id: 'in_fullcircle_123', reply: {status: 'draft'}});
        stripe.invoices.finalize({id: 'in_fullcircle_123', reply: {status: 'open'}});
        stripe.invoices.list({
            match: {subscription: 'sub_fullcircle_123'},
            reply: [{id: 'in_fullcircle_123', object: 'invoice', subscription: 'sub_fullcircle_123'}],
        });
        stripe.billingPortal.sessions.create({
            match: {customer: 'cus_fullcircle_123'},
            reply: {id: 'bps_fullcircle_123', object: 'billing_portal.session', url: 'http://localhost:7331/portal'},
        });

        expect((await request(fc.expressApp).get('/v1/subscriptions/sub_fullcircle_123').expect(200)).body)
            .toMatchObject({id: 'sub_fullcircle_123', object: 'subscription', status: 'active'});
        expect((await request(fc.expressApp).get('/v1/subscriptions?customer=cus_fullcircle_123').expect(200)).body.data)
            .toEqual([{id: 'sub_fullcircle_123', object: 'subscription', customer: 'cus_fullcircle_123'}]);
        expect((await request(fc.expressApp)
            .post('/v1/subscriptions/sub_fullcircle_123')
            .type('form')
            .send({cancel_at_period_end: 'true'})
            .expect(200)).body)
            .toMatchObject({id: 'sub_fullcircle_123', object: 'subscription', cancel_at_period_end: true});
        expect((await request(fc.expressApp).get('/v1/invoices/in_fullcircle_123').expect(200)).body)
            .toMatchObject({id: 'in_fullcircle_123', object: 'invoice', status: 'draft'});
        expect((await request(fc.expressApp).post('/v1/invoices/in_fullcircle_123/finalize').expect(200)).body)
            .toMatchObject({id: 'in_fullcircle_123', object: 'invoice', status: 'open'});
        expect((await request(fc.expressApp).get('/v1/invoices?subscription=sub_fullcircle_123').expect(200)).body.data)
            .toEqual([{id: 'in_fullcircle_123', object: 'invoice', subscription: 'sub_fullcircle_123'}]);
        expect((await request(fc.expressApp)
            .post('/v1/billing_portal/sessions')
            .type('form')
            .send({customer: 'cus_fullcircle_123'})
            .expect(200)).body)
            .toMatchObject({id: 'bps_fullcircle_123', object: 'billing_portal.session', url: 'http://localhost:7331/portal'});
    });

});
