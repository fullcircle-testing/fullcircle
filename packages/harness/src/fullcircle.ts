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
    private boundPort?: number;
    private boundUrl?: string;

    public expressApp: express.Express;
    private server?: Server;

    constructor(public options: FullCircleOptions) {
        this.expressApp = express();
    }

    get port(): number {
        if (this.boundPort === undefined) {
            throw new Error('FullCircle is not listening on a TCP port');
        }

        return this.boundPort;
    }

    get url(): string {
        if (!this.boundUrl) {
            throw new Error('FullCircle is not listening on a TCP URL');
        }

        return this.boundUrl;
    }

    initialize = async () => {
        this.expressApp.use(express.urlencoded({extended: false}));
        this.expressApp.use(express.json());
        this.expressApp.use(this.initializeSubscriptionRouter());
        this.expressApp.use(this.initializeNotFoundRouter());

        const {listenAddress} = this.options;

        if (listenAddress === null) {
            return;
        }

        const normalizedListenAddress = normalizeListenAddress(listenAddress);

        return new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                this.server?.off('listening', onListening);
                reject(error);
            };

            const onListening = async () => {
                this.server?.off('error', onError);
                this.captureBoundAddress();
                console.log(`fullcircle test harness listening on ${this.boundUrl || normalizedListenAddress}`);
                await new Promise(r => setTimeout(r, 10));
                resolve();
            };

            this.server = this.expressApp.listen(normalizedListenAddress);
            this.server.once('error', onError);
            this.server.once('listening', onListening);
        });
    }

    private captureBoundAddress = () => {
        const address = this.server?.address();
        if (!address || typeof address === 'string') {
            return;
        }

        this.boundPort = address.port;
        this.boundUrl = `http://127.0.0.1:${address.port}`;
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

                this.server = undefined;
                this.boundPort = undefined;
                this.boundUrl = undefined;
                resolve();
            });
        });
    }

    [Symbol.asyncDispose] = this.close;
}

const normalizeListenAddress = (listenAddress: string | number): string | number => {
    if (typeof listenAddress === 'string' && /^\d+$/.test(listenAddress)) {
        return Number(listenAddress);
    }

    return listenAddress;
};

export const fullcircle = async (options: FullCircleOptions) => {
    const fc = new FullCircleInstance(options);
    await fc.initialize();
    return fc;
}
