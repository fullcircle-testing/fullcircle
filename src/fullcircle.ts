import express from 'express';
import {TestHarness} from './harness/harness';
import {Server} from 'http';

type ReplaceReturnType<T extends (...a: any) => any, TNewReturn> = (...a: Parameters<T>) => TNewReturn;

export type SubscriptionFunc = ReplaceReturnType<express.Handler, Promise<boolean>>;

export type FullCircleOptions = {
    listenAddress: string | number | null;
};

export class FullCircleInstance {
    private subscriptions: SubscriptionFunc[] = [];

    public expressApp: express.Express;
    private server?: Server;

    constructor(private options: FullCircleOptions) {
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
            this.server = this.expressApp.listen(listenAddress, () => {
                console.log(`fullcircle test harness listening on ${listenAddress}`);
                resolve();
            });
        });
    }

    private initializeSubscriptionRouter = (): express.Router => {
        const router = express.Router();
        router.use(async (req, res, next) => {
            for (const sub of this.subscriptions) {
                if (await sub(req, res, next)) {
                    return;
                }
            }

            next();
        });

        return router;
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

    harness = () => new TestHarness(this);

    [Symbol.asyncDispose] = async () => {
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
}

export const fullcircle = async (options: FullCircleOptions) => {
    const fc = new FullCircleInstance(options);
    await fc.initialize();
    return fc;
}
