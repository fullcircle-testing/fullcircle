import type {AutumnProviderHarness} from './autumn';
import type {OpenRouterProviderHarness} from './openrouter';

export type AiUsageScenarioOutcome =
    | 'success'
    | 'denied'
    | 'track_failure'
    | 'stream_aborted';

export type AiUsageCompletion = {
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
    cost: number;
    content?: string;
    chunks?: string[];
};

export type AiUsageScenarioInput = {
    autumn: AutumnProviderHarness;
    openrouter?: OpenRouterProviderHarness;
    customerId: string;
    featureId: string;
    model: string;
    requiredTokens: number;
    promptIncludes?: string;
    metadata?: Record<string, unknown>;
    completion?: AiUsageCompletion;
    generationId?: string;
    lockId?: string;
    stream?: boolean;
    outcome?: AiUsageScenarioOutcome;
    remainingBalance?: number;
    upgradeUrl?: string;
};

export type AiUsageLedgerRow = {
    customer_id: string;
    feature_id: string;
    model: string;
    generation_id: string;
    autumn_lock_id: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost: number;
    status: 'confirmed' | 'reconciliation_queued' | 'released';
};

export type AiUsageScenarioResult = {
    ids: {
        generationId: string;
        lockId: string;
    };
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost: number;
    };
    expectedLedgerDiff: {
        inserted: {
            ai_usage_events: AiUsageLedgerRow[];
        };
    };
};

export const aiUsageScenario = (input: AiUsageScenarioInput): AiUsageScenarioResult => {
    const outcome = input.outcome || 'success';
    const generationId = input.generationId || 'gen_fullcircle_ai_usage_123';
    const lockId = input.lockId || 'lock_fullcircle_ai_usage_123';
    const completion = normalizeCompletion(input.completion, input.requiredTokens);
    const metadata = input.metadata || {customerId: input.customerId, featureId: input.featureId};

    input.autumn.balances.check({
        match: {
            customerId: input.customerId,
            featureId: input.featureId,
            requiredBalance: input.requiredTokens,
            sendEvent: true,
        },
        reply: outcome === 'denied'
            ? {allowed: false, upgradeUrl: input.upgradeUrl || 'https://billing.fullcircle.test/upgrade'}
            : {allowed: true, balance: {remaining: input.remainingBalance ?? 8800}, lockId},
    });

    if (outcome === 'denied') {
        return result(input, generationId, lockId, completion, []);
    }

    if (!input.openrouter) {
        throw new Error('aiUsageScenario requires openrouter when outcome is not denied');
    }

    registerOpenRouter(input, generationId, completion, metadata, outcome);

    if (outcome === 'success') {
        input.autumn.balances.trackTokenUsage({
            match: {
                customerId: input.customerId,
                featureId: input.featureId,
                model: input.model,
                inputTokens: completion.promptTokens,
                outputTokens: completion.completionTokens,
            },
            reply: {success: true},
        });
        input.autumn.balances.finalize({lockId, action: 'confirm', reply: {success: true, lock_id: lockId}});
        return result(input, generationId, lockId, completion, [ledgerRow(input, generationId, lockId, completion, 'confirmed')]);
    }

    if (outcome === 'track_failure') {
        input.autumn.balances.trackTokenUsage({
            match: {
                customerId: input.customerId,
                featureId: input.featureId,
                model: input.model,
                inputTokens: completion.promptTokens,
                outputTokens: completion.completionTokens,
            },
            status: 503,
            error: {code: 'service_unavailable', message: 'Autumn unavailable'},
        });
        return result(input, generationId, lockId, completion, [ledgerRow(input, generationId, lockId, completion, 'reconciliation_queued')]);
    }

    input.autumn.balances.finalize({lockId, action: 'release', reply: {success: true, lock_id: lockId}});
    return result(input, generationId, lockId, completion, [ledgerRow(input, generationId, lockId, completion, 'released')]);
};

const registerOpenRouter = (
    input: AiUsageScenarioInput & {openrouter?: OpenRouterProviderHarness},
    generationId: string,
    completion: Required<AiUsageCompletion>,
    metadata: Record<string, unknown>,
    outcome: AiUsageScenarioOutcome,
): void => {
    const openrouter = input.openrouter;
    if (!openrouter) {
        return;
    }

    const match = {
        model: input.model,
        messages: input.promptIncludes ? [{role: 'user', contentIncludes: input.promptIncludes}] : undefined,
        stream: Boolean(input.stream),
        metadata,
    };

    if (input.stream) {
        openrouter.chat.completions.stream({
            match,
            id: generationId,
            chunks: completion.chunks,
            usage: outcome === 'stream_aborted'
                ? undefined
                : {
                    promptTokens: completion.promptTokens,
                    completionTokens: completion.completionTokens,
                    totalTokens: completion.totalTokens,
                    cost: completion.cost,
                },
            abrupt: outcome === 'stream_aborted',
        });
    } else {
        openrouter.chat.completions.create({
            match,
            reply: openrouter.fixtures.chatCompletion({
                id: generationId,
                model: input.model,
                content: completion.content,
                usage: {
                    promptTokens: completion.promptTokens,
                    completionTokens: completion.completionTokens,
                    totalTokens: completion.totalTokens,
                    cost: completion.cost,
                },
            }),
        });
    }

    openrouter.generation.get({
        id: generationId,
        reply: {
            totalCost: completion.cost,
            nativeTokensPrompt: completion.promptTokens,
            nativeTokensCompletion: completion.completionTokens,
        },
    });
};

const normalizeCompletion = (
    completion: AiUsageCompletion | undefined,
    requiredTokens: number,
): Required<AiUsageCompletion> => {
    const promptTokens = completion?.promptTokens ?? requiredTokens;
    const completionTokens = completion?.completionTokens ?? 0;
    return {
        promptTokens,
        completionTokens,
        totalTokens: completion?.totalTokens ?? promptTokens + completionTokens,
        cost: completion?.cost ?? 0,
        content: completion?.content ?? '',
        chunks: completion?.chunks ?? [],
    };
};

const ledgerRow = (
    input: AiUsageScenarioInput,
    generationId: string,
    lockId: string,
    completion: Required<AiUsageCompletion>,
    status: AiUsageLedgerRow['status'],
): AiUsageLedgerRow => ({
    customer_id: input.customerId,
    feature_id: input.featureId,
    model: input.model,
    generation_id: generationId,
    autumn_lock_id: lockId,
    input_tokens: completion.promptTokens,
    output_tokens: completion.completionTokens,
    total_tokens: completion.totalTokens,
    cost: completion.cost,
    status,
});

const result = (
    input: AiUsageScenarioInput,
    generationId: string,
    lockId: string,
    completion: Required<AiUsageCompletion>,
    rows: AiUsageLedgerRow[],
): AiUsageScenarioResult => ({
    ids: {generationId, lockId},
    usage: {
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        totalTokens: completion.totalTokens,
        cost: completion.cost,
    },
    expectedLedgerDiff: {
        inserted: {
            ai_usage_events: rows,
        },
    },
});
