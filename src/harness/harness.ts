import express from 'express';
import {FullCircleInstance, SubscriptionFunc} from '../fullcircle';

type PathHandlerClump = {
    path: string;
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
        const path = req.originalUrl;

        const originalHost = req.headers.original_host;
        if (!originalHost) {
            return false;
        }

        if (typeof originalHost !== 'string') {
            return false;
        }

        if (this.originalHost !== originalHost) {
            return false;
        }

        // gets first registered mock that hasn't been called
        const mock = this.registeredMocks.find(m => m.path === path && !m.called);
        if (mock) {
            mock.called = true;

            mock.handler(req, res, next);
            return true;
        }

        const passthrough = this.registeredMocks.find(m => m.path === path && !m.called);
        if (passthrough) {
            passthrough.called = true;

            // we are mocking but in reality this needs to be passed to the proxy middleware
            passthrough.handler(req, res, next);
            return true;
        }

        return false;
    }

    private runAssertions = async () => {
        const messages: string[] = [];
        const errors: string[] = [];

        for (const mock of this.registeredMocks) {
            if (mock.called) {
                messages.push(`Mocked response for ${mock.path}`);
            } else {
                messages.push(`Did not receive request to mock for ${mock.path}`);
                errors.push(`Did not receive request to mock for ${mock.path}`);
            }
        }

        for (const pt of this.registeredPassthroughs) {
            if (pt.called) {
                messages.push(`Proxied response to external host for ${pt.path}`);
            } else {
                messages.push(`Did not receive request to proxy for ${pt.path}`);
                errors.push(`Did not receive request to proxy for ${pt.path}`);
            }
        }

        // console.log(messages);
        if (errors.length) {
            throw new Error(`harness assertions failed:\n${errors.join('\n')}`);
        }
    }

    mock = (path: string, handler: express.Handler) => {
        this.registeredMocks.push({path, handler, called: false});
    }

    passthrough = (path: string, handler: express.Handler) => {
        this.registeredPassthroughs.push({path, handler, called: false});
    }

    [Symbol.asyncDispose] = async () => {
        this.fc.unsubscribeToRequests(this.onRequest);
        await this.runAssertions();
    }
}
