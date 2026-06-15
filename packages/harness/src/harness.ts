import express from 'express';
import type {FullCircleInstance, SubscriptionFunc} from './fullcircle';
import {fullCircleHandlerToExpress, toFullCircleRequest} from './express_adapter';
import type {
    FullCircleBody,
    FullCircleExpectationOptions,
    FullCircleHandler,
    FullCircleInvocationCardinality,
    FullCircleRequest,
    FullCircleRouteMatcher,
} from './primitives';
import {matchesRoute, routeMatcherToString} from './route_matcher';

type PathHandlerClump = {
    matcher: FullCircleRouteMatcher;
    handler: express.Handler;
    options: Required<Pick<FullCircleExpectationOptions, 'times'>> & Pick<FullCircleExpectationOptions, 'name'>;
    callCount: number;
}

type ActualRequestLog = {
    method: string;
    url: string;
    body: FullCircleBody;
}

export class TestHarness {
    private registeredMocks: PathHandlerClump[] = [];
    private registeredPassthroughs: PathHandlerClump[] = [];
    private actualRequests: ActualRequestLog[] = [];
    private fc: FullCircleInstance;
    private originalHost: string;

    constructor(fc: FullCircleInstance, originalHost: string) {
        this.fc = fc;
        this.originalHost = originalHost;

        this.fc.subscribeToRequests(this.onRequest);
    }

    private onRequest: SubscriptionFunc = async (req, res, next): Promise<boolean> => {
        let destinationHost = this.fc.options.defaultDestination;

        if (!destinationHost) {
            const originalHost = req.headers.original_host;
            if (!originalHost) {
                return false;
            }

            if (typeof originalHost !== 'string') {
                return false;
            }

            destinationHost = originalHost;
        }

        if (this.originalHost !== destinationHost) {
            return false;
        }

        const fullCircleRequest = toFullCircleRequest(req, destinationHost);
        this.actualRequests.push({
            method: fullCircleRequest.method,
            url: fullCircleRequest.url,
            body: fullCircleRequest.body,
        });

        const mock = this.findExpectation(this.registeredMocks, fullCircleRequest);
        if (mock) {
            await this.invokeExpectation(mock, req, res, next);
            return true;
        }

        const passthrough = this.findExpectation(this.registeredPassthroughs, fullCircleRequest);
        if (passthrough) {
            // we are mocking but in reality this needs to be passed to the proxy middleware
            await this.invokeExpectation(passthrough, req, res, next);
            return true;
        }

        return false;
    }

    private findExpectation = (
        expectations: PathHandlerClump[],
        request: FullCircleRequest,
    ): PathHandlerClump | undefined => {
        const matchingExpectations = expectations.filter(m => matchesRoute(m.matcher, request));
        const available = matchingExpectations.find(canAcceptCall);
        if (available) {
            return available;
        }

        const exhausted = matchingExpectations[0];
        if (exhausted) {
            exhausted.callCount += 1;
        }

        return undefined;
    }

    private invokeExpectation = async (
        expectation: PathHandlerClump,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
    ) => {
        expectation.callCount += 1;
        try {
            await Promise.resolve(expectation.handler(req, res, next));
        } catch (error) {
            expectation.callCount -= 1;
            throw error;
        }
    }

    private runAssertions = async () => {
        const messages: string[] = [];
        const errors: string[] = [];

        for (const mock of this.registeredMocks) {
            const result = expectationAssertionMessage('mock', mock);
            messages.push(result.message);
            errors.push(...result.errors);
        }

        for (const pt of this.registeredPassthroughs) {
            const result = expectationAssertionMessage('proxy', pt);
            messages.push(result.message);
            errors.push(...result.errors);
        }

        // console.log(messages);
        if (errors.length) {
            const actualRequests = this.actualRequests.length
                ? [
                    `Actual requests received by ${this.originalHost}:`,
                    ...this.actualRequests.map(request => `- ${formatActualRequest(request)}`),
                ]
                : [`No actual requests received by ${this.originalHost}.`];
            throw new Error(`harness assertions failed:\n${[...errors, ...actualRequests].join('\n')}`);
        }
    }

    mock = (path: string, handler: express.Handler, options: FullCircleExpectationOptions = {}) => {
        this.registeredMocks.push(createExpectation(path, handler, options));
    }

    mockRoute = (
        matcher: FullCircleRouteMatcher,
        handler: FullCircleHandler,
        options: FullCircleExpectationOptions = {},
    ) => {
        this.registeredMocks.push(createExpectation(
            matcher,
            fullCircleHandlerToExpress(handler, this.originalHost),
            options,
        ));
    }

    passthrough = (path: string, handler: express.Handler, options: FullCircleExpectationOptions = {}) => {
        this.registeredPassthroughs.push(createExpectation(path, handler, options));
    }

    [Symbol.asyncDispose] = async () => {
        this.fc.unsubscribeToRequests(this.onRequest);
        await this.runAssertions();
    }
}

const createExpectation = (
    matcher: FullCircleRouteMatcher,
    handler: express.Handler,
    options: FullCircleExpectationOptions,
): PathHandlerClump => ({
    matcher,
    handler,
    options: {
        name: options.name,
        times: options.times ?? 1,
    },
    callCount: 0,
});

const canAcceptCall = (expectation: PathHandlerClump): boolean => {
    const cardinality = normalizeCardinality(expectation.options.times);
    return cardinality.max === undefined || expectation.callCount < cardinality.max;
};

const expectationAssertionMessage = (
    kind: 'mock' | 'proxy',
    expectation: PathHandlerClump,
): {message: string; errors: string[]} => {
    const cardinality = normalizeCardinality(expectation.options.times);
    const expected = expectationLabel(kind, expectation);
    const callCount = expectation.callCount;

    if (cardinality.min !== undefined && callCount < cardinality.min) {
        const legacyMessage = cardinality.min === 1 && cardinality.max === 1 && !expectation.options.name
            ? `Did not receive request to ${kind} for ${routeMatcherToString(expectation.matcher)}`
            : `Expected ${expected} to be called at least ${cardinality.min} ${pluralize('time', cardinality.min)}, but it was called ${callCount} ${pluralize('time', callCount)}`;
        return {message: legacyMessage, errors: [legacyMessage]};
    }

    if (cardinality.max !== undefined && callCount > cardinality.max) {
        const error = `Expected ${expected} to be called at most ${cardinality.max} ${pluralize('time', cardinality.max)}, but it was called ${callCount} ${pluralize('time', callCount)}`;
        return {message: error, errors: [error]};
    }

    if (kind === 'mock') {
        return {message: `Mocked response for ${routeMatcherToString(expectation.matcher)} (${callCount} ${pluralize('call', callCount)})`, errors: []};
    }

    return {message: `Proxied response to external host for ${routeMatcherToString(expectation.matcher)} (${callCount} ${pluralize('call', callCount)})`, errors: []};
};

const expectationLabel = (kind: 'mock' | 'proxy', expectation: PathHandlerClump): string => {
    const name = expectation.options.name ? ` "${expectation.options.name}"` : '';
    return `${kind}${name} for ${routeMatcherToString(expectation.matcher)}`;
};

const normalizeCardinality = (
    cardinality: FullCircleInvocationCardinality,
): {min?: number; max?: number} => {
    if (cardinality === 'any') {
        return {min: 0};
    }

    if (typeof cardinality === 'number') {
        return {min: cardinality, max: cardinality};
    }

    return cardinality;
};

const pluralize = (word: string, count: number): string => count === 1 ? word : `${word}s`;

const formatActualRequest = (request: ActualRequestLog): string => {
    const body = formatBody(request.body);
    return body ? `${request.method} ${request.url} body=${body}` : `${request.method} ${request.url}`;
};

const formatBody = (body: FullCircleBody): string | undefined => {
    if (body.kind === 'empty') {
        return undefined;
    }

    if (body.kind === 'bytes') {
        return `<${body.value.byteLength} bytes>`;
    }

    return JSON.stringify(body.value);
};
