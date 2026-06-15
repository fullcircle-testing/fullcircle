(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {aiUsageScenario} from '../../src/providers/ai_usage';
import {autumnProvider} from '../../src/providers/autumn';
import {openRouterProvider} from '../../src/providers/openrouter';

describe('composite AI usage provider helper', () => {
    it('registers Autumn reservation, OpenRouter completion, token tracking, finalization, and ledger expectations', async () => {
        await using fc = await fullcircle({listenAddress: null});
        await using autumnHarness = fc.harness('api.useautumn.com');
        await using openRouterHarness = fc.harness('openrouter.ai');

        const scenario = aiUsageScenario({
            autumn: autumnProvider(autumnHarness),
            openrouter: openRouterProvider(openRouterHarness),
            customerId: 'cust_acme',
            featureId: 'ai_tokens',
            model: 'anthropic/claude-sonnet-4.6',
            requiredTokens: 1200,
            promptIncludes: 'fix the failing test',
            completion: {promptTokens: 1000, completionTokens: 200, cost: 0.014, content: 'Done.'},
            generationId: 'gen_acme_1',
            lockId: 'lock_1',
        });

        expect(scenario.expectedLedgerDiff).toEqual({
            inserted: {
                ai_usage_events: [{
                    customer_id: 'cust_acme',
                    feature_id: 'ai_tokens',
                    model: 'anthropic/claude-sonnet-4.6',
                    generation_id: 'gen_acme_1',
                    autumn_lock_id: 'lock_1',
                    input_tokens: 1000,
                    output_tokens: 200,
                    total_tokens: 1200,
                    cost: 0.014,
                    status: 'confirmed',
                }],
            },
        });

        expect((await request(fc.expressApp)
            .post('/v1/balances.check')
            .set('original_host', 'api.useautumn.com')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens', required_balance: 1200, send_event: true})
            .expect(200)).body)
            .toMatchObject({allowed: true, balance: {remaining: 8800}, lockId: 'lock_1'});

        expect((await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .set('original_host', 'openrouter.ai')
            .send({
                model: 'anthropic/claude-sonnet-4.6',
                messages: [{role: 'user', content: 'please fix the failing test'}],
                stream: false,
                metadata: {customerId: 'cust_acme', featureId: 'ai_tokens'},
            })
            .expect(200)).body)
            .toMatchObject({id: 'gen_acme_1', usage: {prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.014}});

        expect((await request(fc.expressApp)
            .post('/v1/balances.track_token_usage')
            .set('original_host', 'api.useautumn.com')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens', model: 'anthropic/claude-sonnet-4.6', input_tokens: 1000, output_tokens: 200})
            .expect(200)).body)
            .toEqual({success: true});

        expect((await request(fc.expressApp)
            .get('/api/v1/generation?id=gen_acme_1')
            .set('original_host', 'openrouter.ai')
            .expect(200)).body.data)
            .toMatchObject({id: 'gen_acme_1', total_cost: 0.014, native_tokens_prompt: 1000, native_tokens_completion: 200});

        expect((await request(fc.expressApp)
            .post('/v1/balances.finalize_lock')
            .set('original_host', 'api.useautumn.com')
            .send({lock_id: 'lock_1', action: 'confirm'})
            .expect(200)).body)
            .toEqual({success: true, lock_id: 'lock_1'});
    });

    it('models denied checks without registering OpenRouter or usage tracking mocks', async () => {
        await using fc = await fullcircle({listenAddress: null});
        await using autumnHarness = fc.harness('api.useautumn.com');

        const scenario = aiUsageScenario({
            autumn: autumnProvider(autumnHarness),
            customerId: 'cust_blocked',
            featureId: 'ai_tokens',
            model: 'openai/gpt-4o-mini',
            requiredTokens: 500,
            outcome: 'denied',
            upgradeUrl: 'https://billing.example.test/upgrade',
        });

        expect(scenario.expectedLedgerDiff).toEqual({inserted: {ai_usage_events: []}});
        expect((await request(fc.expressApp)
            .post('/v1/balances.check')
            .set('original_host', 'api.useautumn.com')
            .send({customer_id: 'cust_blocked', feature_id: 'ai_tokens', required_balance: 500, send_event: true})
            .expect(200)).body)
            .toEqual({allowed: false, upgradeUrl: 'https://billing.example.test/upgrade'});
    });

    it('models OpenRouter stream abort after reservation with release finalization expectations', async () => {
        await using fc = await fullcircle({listenAddress: null});
        await using autumnHarness = fc.harness('api.useautumn.com');
        await using openRouterHarness = fc.harness('openrouter.ai');

        const scenario = aiUsageScenario({
            autumn: autumnProvider(autumnHarness),
            openrouter: openRouterProvider(openRouterHarness),
            customerId: 'cust_acme',
            featureId: 'ai_tokens',
            model: 'openai/gpt-4o-mini',
            requiredTokens: 100,
            stream: true,
            outcome: 'stream_aborted',
            completion: {promptTokens: 100, completionTokens: 0, cost: 0, chunks: ['partial']},
            generationId: 'gen_abort_1',
            lockId: 'lock_abort_1',
        });

        expect(scenario.expectedLedgerDiff.inserted.ai_usage_events).toEqual([expect.objectContaining({status: 'released', autumn_lock_id: 'lock_abort_1'})]);

        await request(fc.expressApp)
            .post('/v1/balances.check')
            .set('original_host', 'api.useautumn.com')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens', required_balance: 100, send_event: true})
            .expect(200);
        const stream = await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .set('original_host', 'openrouter.ai')
            .send({model: 'openai/gpt-4o-mini', messages: [], stream: true, metadata: {customerId: 'cust_acme', featureId: 'ai_tokens'}})
            .expect(200);
        expect(stream.text).toContain('partial');
        expect(stream.text).not.toContain('[DONE]');
        expect((await request(fc.expressApp)
            .get('/api/v1/generation?id=gen_abort_1')
            .set('original_host', 'openrouter.ai')
            .expect(200)).body.data)
            .toMatchObject({id: 'gen_abort_1', total_cost: 0, native_tokens_prompt: 100, native_tokens_completion: 0});
        expect((await request(fc.expressApp)
            .post('/v1/balances.finalize_lock')
            .set('original_host', 'api.useautumn.com')
            .send({lock_id: 'lock_abort_1', action: 'release'})
            .expect(200)).body)
            .toEqual({success: true, lock_id: 'lock_abort_1'});
    });

    it('models OpenRouter success followed by Autumn tracking failure as reconciliation-queued usage', async () => {
        await using fc = await fullcircle({listenAddress: null});
        await using autumnHarness = fc.harness('api.useautumn.com');
        await using openRouterHarness = fc.harness('openrouter.ai');

        const scenario = aiUsageScenario({
            autumn: autumnProvider(autumnHarness),
            openrouter: openRouterProvider(openRouterHarness),
            customerId: 'cust_acme',
            featureId: 'ai_tokens',
            model: 'openai/gpt-4o-mini',
            requiredTokens: 12,
            outcome: 'track_failure',
            completion: {promptTokens: 10, completionTokens: 2, cost: 0.001, content: 'Done.'},
            generationId: 'gen_track_failure_1',
            lockId: 'lock_track_failure_1',
        });

        expect(scenario.expectedLedgerDiff.inserted.ai_usage_events).toEqual([
            expect.objectContaining({status: 'reconciliation_queued'}),
        ]);
        await request(fc.expressApp)
            .post('/v1/balances.check')
            .set('original_host', 'api.useautumn.com')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens', required_balance: 12, send_event: true})
            .expect(200);
        await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .set('original_host', 'openrouter.ai')
            .send({model: 'openai/gpt-4o-mini', messages: [], stream: false, metadata: {customerId: 'cust_acme', featureId: 'ai_tokens'}})
            .expect(200);
        await request(fc.expressApp)
            .get('/api/v1/generation?id=gen_track_failure_1')
            .set('original_host', 'openrouter.ai')
            .expect(200);
        expect((await request(fc.expressApp)
            .post('/v1/balances.track_token_usage')
            .set('original_host', 'api.useautumn.com')
            .send({customer_id: 'cust_acme', feature_id: 'ai_tokens', model: 'openai/gpt-4o-mini', input_tokens: 10, output_tokens: 2})
            .expect(503)).body)
            .toEqual({error: {code: 'service_unavailable', message: 'Autumn unavailable'}});
    });
});
