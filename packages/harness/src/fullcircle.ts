import {Server} from 'http';

import express from 'express';
require('express-async-errors');

import {TestHarness} from './harness';

type ReplaceReturnType<T extends (...a: any) => any, TNewReturn> = (...a: Parameters<T>) => TNewReturn;

export type SubscriptionFunc = ReplaceReturnType<express.Handler, Promise<boolean>>;

export type FullCircleOptions = {
    listenAddress: string | number | null;
    defaultDestination?: string;
    verbose?: boolean;
};

export type HarnessRouter = express.Router & TestHarness;

export class FullCircleInstance {
    private subscriptions: SubscriptionFunc[] = [];
    private subscriptionRouter!: express.Router;

    public expressApp: express.Express;
    private server?: Server;

    constructor(public options: FullCircleOptions) {
        this.expressApp = express();
    }

    initialize = async () => {
        this.subscriptionRouter = this.initializeSubscriptionRouter();
        this.expressApp.use(this.subscriptionRouter);
        this.expressApp.use(this.initializeNotFoundRouter());

        const {listenAddress} = this.options;

        if (!listenAddress) {
            return;
        }

        return new Promise<void>(resolve => {
            this.server = this.expressApp.listen(listenAddress, async () => {
                this.log(`fullcircle test harness listening on ${listenAddress}`);
                await new Promise(r => setTimeout(r, 10));
                resolve();
            });
        });
    }

    private initializeSubscriptionRouter = (): express.Router => {
        const router = express.Router();

        return router;
    }

    harness = (originalHost: string) => {
        const router = express.Router();
        const th = new TestHarness(this, originalHost, router, Boolean(this.options.verbose), async () => {
            const r = this.subscriptionRouter;

            // });

            // TODO: clean up the adhoc router

            // const index = r.stack.findIndex(h => Boolean(h.path));
            // r.stack = [...r.stack.slice(0, index), ...r.stack.slice(index + 1)];
            // console.log(r.stack);
        });

        this.subscriptionRouter.use(th.getProxyRouter());

        return th;
    }

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

    private log = (...toLog: any[]) => {
        if (!this.options.verbose) {
            return;
        }

        console.log(...toLog);
    };
}

export const fullcircle = async (options: FullCircleOptions) => {
    const fc = new FullCircleInstance(options);
    await fc.initialize();
    return fc;
}
