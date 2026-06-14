import express from 'express';
import type {FullCircleInstance, SubscriptionFunc} from './fullcircle';
import {fullCircleHandlerToExpress, toFullCircleRequest} from './express_adapter';
import type {FullCircleHandler, FullCircleRouteMatcher} from './primitives';
import {matchesRoute, routeMatcherToString} from './route_matcher';

type PathHandlerClump = {
    matcher: FullCircleRouteMatcher;
    handler: express.Handler;
    called: boolean;
}

export class TestHarness {
    private registeredMocks: PathHandlerClump[] = [];
    private registeredPassthroughs: PathHandlerClump[] = [];
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

        // gets first registered mock that hasn't been called
        const mock = this.registeredMocks.find(m => !m.called && matchesRoute(m.matcher, fullCircleRequest));
        if (mock) {
            mock.called = true;

            await Promise.resolve(mock.handler(req, res, next));
            return true;
        }

        const passthrough = this.registeredPassthroughs.find(m => !m.called && matchesRoute(m.matcher, fullCircleRequest));
        if (passthrough) {
            passthrough.called = true;

            // we are mocking but in reality this needs to be passed to the proxy middleware
            await Promise.resolve(passthrough.handler(req, res, next));
            return true;
        }

        return false;
    }

    private runAssertions = async () => {
        const messages: string[] = [];
        const errors: string[] = [];

        for (const mock of this.registeredMocks) {
            if (mock.called) {
                messages.push(`Mocked response for ${routeMatcherToString(mock.matcher)}`);
            } else {
                messages.push(`Did not receive request to mock for ${routeMatcherToString(mock.matcher)}`);
                errors.push(`Did not receive request to mock for ${routeMatcherToString(mock.matcher)}`);
            }
        }

        for (const pt of this.registeredPassthroughs) {
            if (pt.called) {
                messages.push(`Proxied response to external host for ${routeMatcherToString(pt.matcher)}`);
            } else {
                messages.push(`Did not receive request to proxy for ${routeMatcherToString(pt.matcher)}`);
                errors.push(`Did not receive request to proxy for ${routeMatcherToString(pt.matcher)}`);
            }
        }

        // console.log(messages);
        if (errors.length) {
            throw new Error(`harness assertions failed:\n${errors.join('\n')}`);
        }
    }

    mock = (path: string, handler: express.Handler) => {
        this.registeredMocks.push({matcher: path, handler, called: false});
    }

    mockRoute = (matcher: FullCircleRouteMatcher, handler: FullCircleHandler) => {
        this.registeredMocks.push({
            matcher,
            handler: fullCircleHandlerToExpress(handler, this.originalHost),
            called: false,
        });
    }

    passthrough = (path: string, handler: express.Handler) => {
        this.registeredPassthroughs.push({matcher: path, handler, called: false});
    }

    [Symbol.asyncDispose] = async () => {
        this.fc.unsubscribeToRequests(this.onRequest);
        await this.runAssertions();
    }
}
