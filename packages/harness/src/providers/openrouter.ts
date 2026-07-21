import {isDeepStrictEqual} from 'node:util';

import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type OpenRouterScalar = string | number | boolean;
type MaybeMatcher<T extends OpenRouterScalar> = T | RegExp | ((actual: OpenRouterScalar | undefined) => boolean);

type OpenRouterRequestBody = Record<string, unknown>;

export type OpenRouterMessageExpectation = {
    role?: MaybeMatcher<string>;
    contentIncludes?: string;
};

export type OpenRouterChatCompletionMatch = {
    model?: MaybeMatcher<string>;
    messages?: OpenRouterMessageExpectation[];
    stream?: MaybeMatcher<boolean>;
    metadata?: Record<string, unknown>;
    authorization?: MaybeMatcher<string>;
};

export type OpenRouterUsage = {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number;
    nativeTokensPrompt?: number;
    nativeTokensCompletion?: number;
};

export type OpenRouterChatCompletionReply = Record<string, unknown>;

export type OpenRouterChatCompletionExpectation = {
    match?: OpenRouterChatCompletionMatch;
    reply: OpenRouterChatCompletionReply;
    status?: number;
};

export type OpenRouterStreamError = {
    code: string;
    message: string;
};

export type OpenRouterChatCompletionStreamExpectation = {
    match?: OpenRouterChatCompletionMatch;
    id?: string;
    model?: string;
    chunks?: string[];
    usage?: OpenRouterUsage;
    finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
    error?: OpenRouterStreamError;
    abrupt?: boolean;
    status?: number;
};

export type OpenRouterGenerationGetExpectation = {
    id: string;
    reply?: {
        totalCost?: number;
        nativeTokens?: number;
        nativeTokensPrompt?: number;
        nativeTokensCompletion?: number;
        finishReason?: string;
        [key: string]: unknown;
    };
    status?: number;
    error?: OpenRouterStreamError;
};

export type OpenRouterProviderHarness = {
    chat: {
        completions: {
            create: (expectation: OpenRouterChatCompletionExpectation) => void;
            stream: (expectation: OpenRouterChatCompletionStreamExpectation) => void;
        };
    };
    generation: {
        get: (expectation: OpenRouterGenerationGetExpectation) => void;
    };
    fixtures: {
        chatCompletion: (input: {
            id?: string;
            model?: string;
            content?: string;
            usage?: OpenRouterUsage;
            finishReason?: string;
        }) => OpenRouterChatCompletionReply;
    };
};

export const openRouterProvider = (harness: TestHarness): OpenRouterProviderHarness => ({
    chat: {
        completions: {
            create: expectation => {
                harness.mockRoute({method: 'POST', path: '/api/v1/chat/completions'}, makeChatCompletionHandler({
                    label: 'chat completion',
                    match: expectation.match,
                    status: expectation.status ?? 200,
                    reply: expectation.reply,
                }), {name: 'OpenRouter chat completion'});
            },
            stream: expectation => {
                harness.mockRoute({method: 'POST', path: '/api/v1/chat/completions'}, makeChatCompletionStreamHandler(expectation), {
                    name: `OpenRouter chat completion stream ${expectation.id || expectation.match?.model || ''}`.trim(),
                });
            },
        },
    },
    generation: {
        get: expectation => {
            harness.mockRoute({
                method: 'GET',
                path: '/api/v1/generation',
                query: {id: expectation.id},
            }, () => {
                if (expectation.error) {
                    return response.json({error: expectation.error}, {status: expectation.status ?? 500});
                }
                return response.json({data: generationFixture(expectation)}, {status: expectation.status ?? 200});
            }, {name: `OpenRouter generation ${expectation.id}`});
        },
    },
    fixtures: {
        chatCompletion: input => chatCompletionFixture(input),
    },
});

const makeChatCompletionHandler = (input: {
    label: string;
    match: OpenRouterChatCompletionMatch | undefined;
    status: number;
    reply: OpenRouterChatCompletionReply;
}): FullCircleHandler => request => {
    const body = requestJson(request.body);
    const mismatches = collectChatCompletionMismatches(body, input.match, request.headers);
    if (mismatches.length) {
        return response.json({
            error: `OpenRouter ${input.label} request did not match expectations`,
            mismatches,
        }, {status: 422});
    }

    return response.json(input.reply, {status: input.status});
};

const makeChatCompletionStreamHandler = (
    expectation: OpenRouterChatCompletionStreamExpectation,
): FullCircleHandler => request => {
    const body = requestJson(request.body);
    const mismatches = collectChatCompletionMismatches(body, expectation.match, request.headers);
    if (mismatches.length) {
        return response.json({
            error: 'OpenRouter chat completion request did not match expectations',
            mismatches,
        }, {status: 422});
    }

    return response.text(sseStream(body, expectation), {
        status: expectation.status ?? 200,
        headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
        },
    });
};

const requestJson = (body: FullCircleBody): OpenRouterRequestBody => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        return body.value as OpenRouterRequestBody;
    }
    return {};
};

const collectChatCompletionMismatches = (
    body: OpenRouterRequestBody,
    match: OpenRouterChatCompletionMatch | undefined,
    headers: Headers,
): string[] => {
    const mismatches: string[] = [];
    if (!match) {
        return mismatches;
    }

    assertMatch(mismatches, 'model', scalar(body.model), match.model);
    assertMatch(mismatches, 'stream', scalar(body.stream), match.stream);
    assertMatch(mismatches, 'authorization', headers.get('authorization') || undefined, match.authorization);

    if (match.metadata !== undefined && !isDeepStrictEqual(body.metadata, match.metadata)) {
        mismatches.push(`Expected metadata to equal ${JSON.stringify(match.metadata)} but received ${JSON.stringify(body.metadata)}`);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    match.messages?.forEach((expected, index) => {
        const actual = messages[index];
        const actualMessage = actual && typeof actual === 'object' ? actual as Record<string, unknown> : {};
        assertMatch(mismatches, `messages[${index}].role`, scalar(actualMessage.role), expected.role);
        if (expected.contentIncludes !== undefined) {
            const content = messageContent(actualMessage.content);
            if (!content.includes(expected.contentIncludes)) {
                mismatches.push(`Expected messages[${index}].content to include ${expected.contentIncludes} but received ${content}`);
            }
        }
    });

    return mismatches;
};

const assertMatch = <T extends OpenRouterScalar>(
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

const messageContent = (content: unknown): string => {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') {
                return part;
            }
            if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
                return part.text;
            }
            return '';
        }).join('');
    }

    return '';
};

const scalar = (value: unknown): OpenRouterScalar | undefined => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return undefined;
};

const stringValue = (value: unknown): string | undefined => {
    return typeof value === 'string' ? value : undefined;
};

const chatCompletionFixture = (input: {
    id?: string;
    model?: string;
    content?: string;
    usage?: OpenRouterUsage;
    finishReason?: string;
}): OpenRouterChatCompletionReply => ({
    id: input.id || 'gen_fullcircle_123',
    object: 'chat.completion',
    created: 1781481600,
    model: input.model || 'openrouter/fullcircle-test-model',
    choices: [{
        index: 0,
        message: {role: 'assistant', content: input.content || ''},
        finish_reason: input.finishReason || 'stop',
    }],
    usage: usageFixture(input.usage),
});

const usageFixture = (usage: OpenRouterUsage = {}) => ({
    prompt_tokens: usage.promptTokens ?? 0,
    completion_tokens: usage.completionTokens ?? 0,
    total_tokens: usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)),
    ...(usage.cost !== undefined ? {cost: usage.cost} : {}),
    ...(usage.nativeTokensPrompt !== undefined ? {native_tokens_prompt: usage.nativeTokensPrompt} : {}),
    ...(usage.nativeTokensCompletion !== undefined ? {native_tokens_completion: usage.nativeTokensCompletion} : {}),
});

const sseStream = (
    requestBody: OpenRouterRequestBody,
    expectation: OpenRouterChatCompletionStreamExpectation,
): string => {
    const id = expectation.id || 'gen_fullcircle_stream_123';
    const model = expectation.model || stringValue(requestBody.model) || 'openrouter/fullcircle-test-model';
    const chunks = expectation.chunks || [];
    const events: string[] = chunks.map(chunk => sseData({
        id,
        object: 'chat.completion.chunk',
        created: 1781481600,
        model,
        choices: [{index: 0, delta: {content: chunk}, finish_reason: null}],
    }));

    if (expectation.error) {
        events.push(sseData({
            id,
            object: 'chat.completion.chunk',
            created: 1781481600,
            model,
            choices: [{index: 0, delta: {}, finish_reason: expectation.finishReason || 'error'}],
            error: expectation.error,
        }));
    } else if (!expectation.abrupt) {
        events.push(sseData({
            id,
            object: 'chat.completion.chunk',
            created: 1781481600,
            model,
            choices: [{index: 0, delta: {}, finish_reason: expectation.finishReason || 'stop'}],
            ...(expectation.usage ? {usage: usageFixture(expectation.usage)} : {}),
        }));
    }

    if (!expectation.abrupt) {
        events.push('data: [DONE]\n\n');
    }

    return events.join('');
};

const sseData = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;

const generationFixture = (expectation: OpenRouterGenerationGetExpectation) => {
    const reply = expectation.reply || {};
    const totalCost = reply.totalCost;
    const nativeTokensPrompt = reply.nativeTokensPrompt;
    const nativeTokensCompletion = reply.nativeTokensCompletion;
    const nativeTokens = reply.nativeTokens ?? (
        nativeTokensPrompt !== undefined && nativeTokensCompletion !== undefined
            ? nativeTokensPrompt + nativeTokensCompletion
            : undefined
    );

    return {
        id: expectation.id,
        api_type: 'chat_completions',
        created_at: '2026-06-15T00:00:00.000000+00:00',
        finish_reason: reply.finishReason || 'stop',
        ...(totalCost !== undefined ? {total_cost: totalCost} : {}),
        ...(nativeTokens !== undefined ? {native_tokens: nativeTokens} : {}),
        ...(nativeTokensPrompt !== undefined ? {native_tokens_prompt: nativeTokensPrompt} : {}),
        ...(nativeTokensCompletion !== undefined ? {native_tokens_completion: nativeTokensCompletion} : {}),
        ...snakeCaseReply(reply),
    };
};

const snakeCaseReply = (reply: Record<string, unknown>): Record<string, unknown> => {
    const skip = new Set(['totalCost', 'nativeTokens', 'nativeTokensPrompt', 'nativeTokensCompletion', 'finishReason']);
    return Object.fromEntries(Object.entries(reply)
        .filter(([key]) => !skip.has(key))
        .map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]));
};
