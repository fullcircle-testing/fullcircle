import express from 'express';
import type {FullCircleInstance, SubscriptionFunc} from './fullcircle';

type PathHandlerClump = {
    path: string;
    handler: express.Handler;
    called: boolean;
}

export class TestHarness {
    private registeredMocks: PathHandlerClump[] = [];
    private registeredPassthroughs: PathHandlerClump[] = [];
    private originalRouter: express.Router;
    proxyRouter: express.Router;
    get: express.Router['get'];
    put: express.Router['put'];
    post: express.Router['post'];
    delete: express.Router['delete'];

    private verbose: boolean;

    private fc: FullCircleInstance;
    private originalHost: string;

    constructor(fc: FullCircleInstance, originalHost: string, router: express.Router, verbose: boolean, removeRouter: () => void) {
        this.fc = fc;
        this.originalHost = originalHost;
        this.originalRouter = router;
        this.proxyRouter = this.newProxyRouter(this.originalRouter);
        this.verbose = verbose;

        this.get = this.proxyRouter.get.bind(this.proxyRouter);
        this.put = this.proxyRouter.put.bind(this.proxyRouter);
        this.post = this.proxyRouter.post.bind(this.proxyRouter);
        this.delete = this.proxyRouter.delete.bind(this.proxyRouter);

        this.fc.subscribeToRequests(this.onRequest);
    }

    private handleCalled = (path: string, method: string) => {
        this.log('Called', path, method);

        const mock = this.registeredMocks.find(m => m.path === path && !m.called);
        if (mock) {
            mock.called = true;
        }

        const p = this.proxyRouter;
        const index = p.stack.findIndex(h => Boolean(h.path))
        p.stack = [...p.stack.slice(0, index), ...p.stack.slice(index + 1)];
    }

    getProxyRouter = (): express.Router => {
        return this.proxyRouter;
    }

    private newProxyRouter = (router: express.Router): express.Router => {
        return new Proxy(router, {
            get: (target, originalProp: keyof typeof router, receiver) => {
                const prop = originalProp as keyof typeof router;
                const value = Reflect.get(target, prop, receiver);

                switch (prop) {
                    case 'get':
                    case 'put':
                    case 'post':
                    case 'delete':
                        // case 'use':
                        break;
                    default:
                        return value;
                }

                const func = value as typeof target.get | typeof target.put | typeof target.post | typeof target.delete;

                return (path: string, ...handlers: express.Handler[]) => {
                    const handler: express.Handler = (req, res, next) => {
                        this.handleCalled(path, prop);
                        next();
                    }

                    this.registeredMocks.push({path, handler, called: false});

                    Reflect.apply(func, target, [path, handler, ...handlers]);
                };
            },
        });
    };

    private onRequest: SubscriptionFunc = async (req, res, next): Promise<boolean> => {
        const path = req.originalUrl;

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

        // this.log(messages);
        if (errors.length) {
            throw new Error(`harness assertions failed:\n${errors.join('\n')}`);
        }
    }

    passthrough = (path: string, handler: express.Handler) => {
        this.registeredPassthroughs.push({path, handler, called: false});
    }

    close = async () => {
        this.fc.unsubscribeToRequests(this.onRequest);
    }

    closeWithAssertions = async () => {
        await this.close();
        await this.runAssertions();
    }

    [Symbol.asyncDispose] = async () => {
        await this.closeWithAssertions();
    }

    private log = (...toLog: any[]) => {
        if (!this.verbose) {
            return;
        }

        this.log(...toLog);
    }
}
