import {Server} from 'http';

import express from 'express';
require('express-async-errors');

import {TestHarness} from './harness';

type ReplaceReturnType<T extends (...a: any) => any, TNewReturn> = (...a: Parameters<T>) => TNewReturn;

export type SubscriptionFunc = ReplaceReturnType<express.Handler, Promise<boolean>>;

export type FullCircleOptions = {
    listenAddress: string | number | null;
    defaultDestination?: string;
};

export class FullCircleInstance {
    private subscriptions: SubscriptionFunc[] = [];

    public expressApp: express.Express;
    private server?: Server;

    constructor(public options: FullCircleOptions) {
        this.expressApp = express();
    }

    initialize = async () => {
        this.expressApp.use(this.initializeSubscriptionRouter());
        this.expressApp.use(this.initializeNotFoundRouter());

        const {listenAddress} = this.options;

        if (!listenAddress) {
            return;
        }

        return new Promise<void>(resolve => {
            this.server = this.expressApp.listen(listenAddress, async () => {
                console.log(`fullcircle test harness listening on ${listenAddress}`);
                await new Promise(r => setTimeout(r, 10));
                resolve();
            });
        });
    }

    private initializeSubscriptionRouter = (): express.Router & FullCircleInstance => {
        const router = express.Router();

        // so this will actually return (express.Router & TestHarness) eventually
        // fc.mock will return router (express.Router & TestHarness)
        // fc.harness will go away, replaced by fc.mock

        // fc.passthrough will work a little differently, in that you won't provide an express.Handler to its methods
        // pt = fc.passthrough('api.github.com'); // or infer default host
        // pt.use('/api/repos/:repoId', 'GET', (req, resBody) => {

        // });

        // don't support passthrough yet. unclear use cases atm. this is supposed to be a closed system.

        const p = new Proxy(router, {
            get: (target, originalProp: (keyof typeof router) | (keyof FullCircleInstance), receiver) => {
                if (originalProp in this) {
                    const prop = originalProp as keyof FullCircleInstance;
                    // return this[prop];
                    return Reflect.get(target, prop, receiver);
                }

                const prop = originalProp as keyof typeof router;

                switch (prop) {
                    case 'stack':
                    case 'route':
                    case 'param':
                        return target[prop];
                }

                const value = target[prop];
                return (url: string, ...handlers: express.Handler[]) => {
                    value(url, (req, res, next) => {
                        // called = true;
                        const index = p.stack.findIndex(h => Boolean(h.path))
                        p.stack = [...p.stack.slice(0, index), ...p.stack.slice(index + 1)];
                        [...handlers].reverse().reduce((current, previous) => {
                            if (!previous) {
                                return current;
                            }

                            return
                        }, null);
                        // handler(req, res, next);
                    });
                };
            },
        });

        p.get('/todos/:id', (req, res) => {
            req.params.id;
        });

        router.use(async (req, res, next) => {
            for (const sub of this.subscriptions) {
                if (await sub(req, res, next)) {
                    return;
                }
            }

            next();
        });

        return Object.assign(p, this);
    };

    private initializeNotFoundRouter = (): express.Router => {
        const router = express.Router();
        router.use(async (req, res, next) => {
            const errMsg = `FC server received unexpected request. No registered mocks for ${req.originalUrl}`;

            res.statusCode = 404;
            res.json({error: errMsg});
        });

        return router;
    };

    subscribeToRequests = (handler: SubscriptionFunc) => {
        this.subscriptions.push(handler);
    };

    unsubscribeToRequests = (handler: SubscriptionFunc) => {
        const index = this.subscriptions.findIndex(s => s === handler);
        if (index === -1) {
            return;
        }

        this.subscriptions = [...this.subscriptions.slice(0, index), ...this.subscriptions.slice(index + 1)];
    };

    harness = (originalHost: string) => new TestHarness(this, originalHost);

    close = async () => {
        return new Promise<void>((resolve, reject) => {
            if (!this.server) {
                resolve();
                return;
            }

            this.server?.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve();
            });
        });
    }

    [Symbol.asyncDispose] = this.close;
}

export const fullcircle = async (options: FullCircleOptions) => {
    const fc = new FullCircleInstance(options);
    await fc.initialize();
    return fc;
}
