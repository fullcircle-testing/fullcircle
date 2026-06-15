(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {openRouterProvider} from '../../src/providers/openrouter';

describe('OpenRouter provider harness', () => {
    it('fixtures non-streaming chat completions with usage and auth/baseURL isolation', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'openrouter.ai'});
        await using th = fc.harness('openrouter.ai');

        const openrouter = openRouterProvider(th);
        openrouter.chat.completions.create({
            match: {
                model: 'anthropic/claude-sonnet-4.6',
                messages: [{role: 'user', contentIncludes: 'fix the failing test'}],
                stream: false,
                metadata: {customerId: 'cust_acme'},
                authorization: /^Bearer sk-or-test-/,
            },
            reply: openrouter.fixtures.chatCompletion({
                id: 'gen_acme_1',
                model: 'anthropic/claude-sonnet-4.6',
                content: 'Done.',
                usage: {promptTokens: 1000, completionTokens: 200, totalTokens: 1200, cost: 0.014},
            }),
        });

        const response = await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .set('authorization', 'Bearer sk-or-test-opencode')
            .send({
                model: 'anthropic/claude-sonnet-4.6',
                messages: [{role: 'user', content: 'please fix the failing test'}],
                stream: false,
                metadata: {customerId: 'cust_acme'},
            })
            .expect(200);

        expect(response.body).toMatchObject({
            id: 'gen_acme_1',
            object: 'chat.completion',
            model: 'anthropic/claude-sonnet-4.6',
            choices: [{message: {role: 'assistant', content: 'Done.'}, finish_reason: 'stop'}],
            usage: {
                prompt_tokens: 1000,
                completion_tokens: 200,
                total_tokens: 1200,
                cost: 0.014,
            },
        });
    });

    it('fixtures generation stats for delayed usage reconciliation', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'openrouter.ai'});
        await using th = fc.harness('openrouter.ai');

        openRouterProvider(th).generation.get({
            id: 'gen_acme_1',
            reply: {totalCost: 0.014, nativeTokensPrompt: 1000, nativeTokensCompletion: 200},
        });

        expect((await request(fc.expressApp)
            .get('/api/v1/generation?id=gen_acme_1')
            .expect(200)).body)
            .toEqual({
                data: expect.objectContaining({
                    id: 'gen_acme_1',
                    total_cost: 0.014,
                    native_tokens_prompt: 1000,
                    native_tokens_completion: 200,
                }),
            });
    });

    it('streams SSE chunks including final usage and DONE', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'openrouter.ai'});
        await using th = fc.harness('openrouter.ai');

        const openrouter = openRouterProvider(th);
        openrouter.chat.completions.stream({
            match: {model: 'openai/gpt-4o-mini', stream: true},
            id: 'gen_stream_1',
            chunks: ['Hel', 'lo'],
            usage: {promptTokens: 10, completionTokens: 2, totalTokens: 12, cost: 0.001},
        });

        const response = await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .send({model: 'openai/gpt-4o-mini', messages: [{role: 'user', content: 'say hello'}], stream: true})
            .expect(200)
            .expect('content-type', /text\/event-stream/);

        expect(response.text).toContain('data: {"id":"gen_stream_1"');
        expect(response.text).toContain('"delta":{"content":"Hel"}');
        expect(response.text).toContain('"delta":{"content":"lo"}');
        expect(response.text).toContain('"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"cost":0.001}');
        expect(response.text.trim().endsWith('data: [DONE]')).toBe(true);
    });

    it('supports provider error stream chunks and abrupt stream termination', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'openrouter.ai'});
        await using th = fc.harness('openrouter.ai');

        const openrouter = openRouterProvider(th);
        openrouter.chat.completions.stream({
            match: {model: 'error/model', stream: true},
            id: 'gen_error_1',
            chunks: ['partial'],
            error: {code: 'provider_error', message: 'upstream overloaded'},
            finishReason: 'error',
        });
        openrouter.chat.completions.stream({
            match: {model: 'abrupt/model', stream: true},
            id: 'gen_abrupt_1',
            chunks: ['partial'],
            abrupt: true,
        });

        const errorStream = await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .send({model: 'error/model', messages: [], stream: true})
            .expect(200);
        expect(errorStream.text).toContain('"finish_reason":"error"');
        expect(errorStream.text).toContain('"error":{"code":"provider_error","message":"upstream overloaded"}');
        expect(errorStream.text.trim().endsWith('data: [DONE]')).toBe(true);

        const abruptStream = await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .send({model: 'abrupt/model', messages: [], stream: true})
            .expect(200);
        expect(abruptStream.text).toContain('"delta":{"content":"partial"}');
        expect(abruptStream.text).not.toContain('[DONE]');
    });

    it('returns actionable diagnostics for mismatched OpenRouter requests', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'openrouter.ai'});
        await using th = fc.harness('openrouter.ai');

        openRouterProvider(th).chat.completions.create({
            match: {model: 'openai/gpt-4o-mini', messages: [{role: 'user', contentIncludes: 'expected'}], stream: false},
            reply: {id: 'gen_1'},
        });

        const response = await request(fc.expressApp)
            .post('/api/v1/chat/completions')
            .send({model: 'anthropic/wrong', messages: [{role: 'user', content: 'actual'}], stream: false})
            .expect(422);

        expect(response.body).toEqual({
            error: 'OpenRouter chat completion request did not match expectations',
            mismatches: [
                'Expected model to match openai/gpt-4o-mini but received anthropic/wrong',
                'Expected messages[0].content to include expected but received actual',
            ],
        });
    });
});
