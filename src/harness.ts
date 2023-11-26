import express from 'express';

type PathHandlerPair = {
    path: string;
    handler: express.Handler;
    called: boolean;
}

type FullCircleInstance = {
    subscribeToRequests: (handler: express.Handler) => void;
    unsubscribeToRequests: (handler: express.Handler) => void;
}

export class TestHarness {
    private registeredMocks: PathHandlerPair[] = [];
    private registeredPassthroughs: PathHandlerPair[] = [];
    private fc: FullCircleInstance;

    constructor(fc: FullCircleInstance) {
        this.fc = fc;

        this.fc.subscribeToRequests(this.onRequest);
    }

    private onRequest: express.Handler = (req, res, next) => {
        const path = req.originalUrl;
        const mock = this.registeredMocks.find(m => m.path === path && !m.called);
        if (mock) {
            mock.called = true;

            mock.handler(req, res, next);
            return;
        }

        const passthrough = this.registeredMocks.find(m => m.path === path && !m.called);
        if (passthrough) {
            passthrough.called = true;

            // in reality this needs to be passed to the proxy middleware
            passthrough.handler(req, res, next);
            return;
        }

        throw new Error(`Unexpected request to path ${path}`);
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

export const newHarness = (fc: FullCircleInstance): TestHarness => {
    const h = new TestHarness(fc);
    return h;
}
