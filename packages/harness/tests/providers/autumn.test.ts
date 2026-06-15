(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {autumnProvider} from '../../src/providers/autumn';

describe('Autumn billing provider harness', () => {
    it('fixtures customer get/create and billing attach/update RPC calls', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.useautumn.com'});
        await using th = fc.harness('api.useautumn.com');

        const autumn = autumnProvider(th);
        autumn.customers.getOrCreate({
            match: {customerId: 'cust_acme', email: 'billing@example.test'},
            reply: {id: 'cust_acme', products: [{id: 'pro'}]},
        });
        autumn.customers.list({
            match: {email: 'billing@example.test'},
            reply: [{id: 'cust_acme', email: 'billing@example.test'}],
        });
        autumn.billing.attach({
            match: {customerId: 'cust_acme', productId: 'pro'},
            reply: {checkout_url: 'https://checkout.useautumn.test/acme'},
        });
        autumn.billing.update({
            match: {customerId: 'cust_acme', productId: 'team'},
            reply: {success: true},
        });

        expect((await request(fc.expressApp)
            .post('/v1/customers.get_or_create')
            .send({customer_id: 'cust_acme', email: 'billing@example.test'})
            .expect(200)).body)
            .toEqual({id: 'cust_acme', products: [{id: 'pro'}]});
        expect((await request(fc.expressApp)
            .post('/v1/customers.list')
            .send({email: 'billing@example.test'})
            .expect(200)).body)
            .toEqual({customers: [{id: 'cust_acme', email: 'billing@example.test'}]});
        expect((await request(fc.expressApp)
            .post('/v1/billing.attach')
            .send({customer_id: 'cust_acme', product_id: 'pro'})
            .expect(200)).body)
            .toEqual({checkout_url: 'https://checkout.useautumn.test/acme'});
        expect((await request(fc.expressApp)
            .post('/v1/billing.update')
            .send({customer_id: 'cust_acme', product_id: 'team'})
            .expect(200)).body)
            .toEqual({success: true});
    });

    it('fixtures balance check, token tracking, batch tracking, and lock finalization', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.useautumn.com'});
        await using th = fc.harness('api.useautumn.com');

        const autumn = autumnProvider(th);
        autumn.balances.check({
            match: {customerId: 'cust_acme', featureId: 'ai_tokens', requiredBalance: 1200, sendEvent: true},
            reply: {allowed: true, balance: {remaining: 8800}, lockId: 'lock_1'},
        });
        autumn.balances.trackTokenUsage({
            match: {customerId: 'cust_acme', featureId: 'ai_tokens', model: 'anthropic/claude-sonnet-4.6', inputTokens: 1000, outputTokens: 200},
            reply: {success: true},
        });
        autumn.balances.batchTrackUsage({
            match: {customerId: 'cust_acme'},
            reply: {success: true, events: 2},
        });
        autumn.balances.finalize({lockId: 'lock_1', action: 'confirm', reply: {success: true, lock_id: 'lock_1'}});

        expect((await request(fc.expressApp)
            .post('/v1/balances.check')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens', required_balance: 1200, send_event: true})
            .expect(200)).body)
            .toEqual({allowed: true, balance: {remaining: 8800}, lockId: 'lock_1'});
        expect((await request(fc.expressApp)
            .post('/v1/balances.track_token_usage')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens', model: 'anthropic/claude-sonnet-4.6', input_tokens: 1000, output_tokens: 200})
            .expect(200)).body)
            .toEqual({success: true});
        expect((await request(fc.expressApp)
            .post('/v1/balances.batch_track_usage')
            .send({customer_id: 'cust_acme', events: [{feature_id: 'ai_tokens'}, {feature_id: 'ai_messages'}]})
            .expect(200)).body)
            .toEqual({success: true, events: 2});
        expect((await request(fc.expressApp)
            .post('/v1/balances.finalize_lock')
            .send({lock_id: 'lock_1', action: 'confirm'})
            .expect(200)).body)
            .toEqual({success: true, lock_id: 'lock_1'});
    });

    it('models denied balance checks and Autumn unavailable failures', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.useautumn.com'});
        await using th = fc.harness('api.useautumn.com');

        const autumn = autumnProvider(th);
        autumn.balances.check({
            match: {customerId: 'cust_blocked', featureId: 'ai_tokens'},
            reply: {allowed: false, upgradeUrl: 'https://billing.example.test/upgrade'},
        });
        autumn.balances.trackTokenUsage({
            match: {customerId: 'cust_acme', featureId: 'ai_tokens'},
            status: 503,
            error: {code: 'service_unavailable', message: 'Autumn unavailable'},
        });

        expect((await request(fc.expressApp)
            .post('/v1/balances.check')
            .send({customer_id: 'cust_blocked', feature_id: 'ai_tokens'})
            .expect(200)).body)
            .toEqual({allowed: false, upgradeUrl: 'https://billing.example.test/upgrade'});
        expect((await request(fc.expressApp)
            .post('/v1/balances.track_token_usage')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens'})
            .expect(503)).body)
            .toEqual({error: {code: 'service_unavailable', message: 'Autumn unavailable'}});
    });

    it('returns actionable diagnostics for mismatched Autumn requests', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.useautumn.com'});
        await using th = fc.harness('api.useautumn.com');

        autumnProvider(th).balances.check({
            match: {customerId: 'cust_acme', featureId: 'ai_tokens', requiredBalance: 1200},
            reply: {allowed: true},
        });

        const response = await request(fc.expressApp)
            .post('/v1/balances.check')
            .send({customer_id: 'cust_other', feature_id: 'ai_messages', required_balance: 42})
            .expect(422);

        expect(response.body).toEqual({
            error: 'Autumn balance check request did not match expectations',
            mismatches: [
                'Expected customer_id to match cust_acme but received cust_other',
                'Expected feature_id to match ai_tokens but received ai_messages',
                'Expected required_balance to match 1200 but received 42',
            ],
        });
    });
});
