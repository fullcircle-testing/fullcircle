# FullCircle OpenRouter Provider Contract

Bead: `fullcircle-64o.27 — Add OpenRouter provider`

## Scope

This provider models OpenRouter's OpenAI-compatible chat-completions API and generation usage metadata endpoint for AI usage/billing e2e tests. It supports:

- non-streaming `POST /api/v1/chat/completions` fixtures with token/cost usage;
- streaming SSE fixtures with delta chunks, final usage chunks, provider error chunks, and abrupt termination;
- `GET /api/v1/generation?id=...` fixtures for delayed cost reconciliation;
- auth/header matching so OpenCode or gateway tests can prove they are using the isolated test key and FullCircle base URL.

OpenCode-style acceptance tests should configure the provider `baseURL` to FullCircle and use an isolated auth/config directory with fake OpenRouter credentials. Real OpenRouter smoke tests should remain opt-in and env-gated.

## Provider API

```ts
const openrouter = openRouterProvider(harness);

openrouter.chat.completions.create({
  match: {
    model: 'anthropic/claude-sonnet-4.6',
    messages: [{ role: 'user', contentIncludes: 'fix the failing test' }],
    stream: false,
    metadata: { customerId: 'cust_acme' },
    authorization: /^Bearer sk-or-test-/,
  },
  reply: openrouter.fixtures.chatCompletion({
    id: 'gen_acme_1',
    model: 'anthropic/claude-sonnet-4.6',
    content: 'Done.',
    usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200, cost: 0.014 },
  }),
});

openrouter.generation.get({
  id: 'gen_acme_1',
  reply: { totalCost: 0.014, nativeTokensPrompt: 1000, nativeTokensCompletion: 200 },
});
```

## Streaming API

```ts
openrouter.chat.completions.stream({
  match: { model: 'openai/gpt-4o-mini', stream: true },
  id: 'gen_stream_1',
  chunks: ['Hel', 'lo'],
  usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, cost: 0.001 },
});
```

The stream response is `text/event-stream` and emits `data: ...` frames for content deltas, a final frame containing `finish_reason` and optional `usage`, then `data: [DONE]`.

Provider failure and transport-cutoff cases are explicit:

```ts
openrouter.chat.completions.stream({
  match: { model: 'error/model', stream: true },
  chunks: ['partial'],
  error: { code: 'provider_error', message: 'upstream overloaded' },
  finishReason: 'error',
});

openrouter.chat.completions.stream({
  match: { model: 'abrupt/model', stream: true },
  chunks: ['partial'],
  abrupt: true,
});
```

`error` emits a normalized provider error chunk and `[DONE]`; `abrupt` intentionally omits final usage and `[DONE]` so app retry/error handling can be tested.

## Request matching

`match` supports:

- `model` as exact string, regex, or predicate;
- `stream` exact boolean or predicate;
- ordered `messages` with role and `contentIncludes` checks;
- exact `metadata` object matching;
- `authorization` header checks for auth isolation.

Mismatches return `422` with field-level diagnostics before a fixture is used.

## Acceptance tests

`packages/harness/tests/providers/openrouter.test.ts` verifies:

1. non-streaming chat completions with usage and auth/baseURL isolation;
2. generation stats for delayed usage reconciliation;
3. SSE delta chunks, final usage, and `[DONE]`;
4. provider error stream chunks and abrupt stream termination;
5. mismatch diagnostics for model/message drift.

## References

- OpenRouter chat completion API: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- OpenRouter streaming API: https://openrouter.ai/docs/api/reference/streaming
- OpenRouter usage accounting: https://openrouter.ai/docs/cookbook/administration/usage-accounting
- OpenRouter generation metadata API: https://openrouter.ai/docs/api/api-reference/generations/get-generation
