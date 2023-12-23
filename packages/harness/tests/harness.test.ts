(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';
import fetch from 'node-fetch';

import {fullcircle} from '../src/fullcircle';

describe('Harness tests', () => {
    it('harness.mock - fake fetch - should succeed mocked path called', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
        });

        const app = fc.expressApp;

        let blockedFinished = false;
        {
            await using th = fc.harness('api.github.com');

            th.get('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            try {
                const response = await request(app)
                .get('/api/repos')
                .set('original_host', 'api.github.com')
                .expect(200)

                expect(response.body).toEqual({data: 'My mocked data'});
            } catch (e) {
                logError(e);
                expect(e).toBe(null);
            }

            blockedFinished = true;
        }

        expect(blockedFinished).toBe(true);
    });

    it('harness.mock - fake fetch - should error when mocked path not called', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
        });

        const app = fc.expressApp;

        let blockedFinished = false;
        await (async () => {
            await using th = fc.harness('api.github.com');

            th.get('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const response = await request(app)
            .get('/api/other')
            .set('original_host', 'api.github.com')
            .expect(404)

            expect(response.body).toEqual({error: 'FC server received unexpected request. No registered mocks for /api/other'});

            blockedFinished = true;
        })().then(resolved => {
            throw new Error('Expected dispose method to throw an error');
        }, rejected => {
            if (rejected.error || rejected.suppressed) {
                logError(rejected);
            }

            expect(rejected.message).toEqual('harness assertions failed:\nDid not receive request to mock for /api/repos');
        });

        expect(blockedFinished).toBe(true);
    });

    it('harness.mock - real local fetch - should succeed mocked path called', async () => {
        await using fc = await fullcircle({
            listenAddress: 7887,
        });

        let blockedFinished = false;
        {
            await using th = fc.harness('api.github.com');

            th.get('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const reqPath = '/api/repos';

            try {
                const fetchRes = await fetch(`http://localhost:7887${reqPath}`, {
                    headers: {
                        'original_host': 'api.github.com',
                    },
                });
                expect(fetchRes.status).toEqual(200);

                const responseBody = await fetchRes.json();
                expect(responseBody).toEqual({data: 'My mocked data'});
            } catch (e) {
                logError(e);
                expect(e).toBe(null);
            }

            blockedFinished = true;
        }

        expect(blockedFinished).toBe(true);
    });

    it('harness.mock - real local fetch - should error when mocked path not called', async () => {
        await using fc = await fullcircle({
            listenAddress: 7887,
        });

        let blockedFinished = false;
        await (async () => {
            await using th = fc.harness('api.github.com');
            th.get('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const reqPath = '/api/other';
            try {
                const fetchRes = await fetch(`http://localhost:7887${reqPath}`, {
                    headers: {
                        'original_host': 'api.github.com',
                    },
                });

                const responseStatus = fetchRes.status;
                expect(responseStatus).toEqual(404);

                const responseBody = await fetchRes.json();
                expect(responseBody).toEqual({error: 'FC server received unexpected request. No registered mocks for /api/other'});
            } catch (e) {
                logError(e);
                expect(e).toBe(null);
            }

            blockedFinished = true;
        })().then(resolved => {
            throw new Error('Expected dispose method to throw an error');
        }, rejected => {
            if (rejected.error || rejected.suppressed) {
                logError(rejected);
            }

            expect(rejected.message).toEqual('harness assertions failed:\nDid not receive request to mock for /api/repos');
        });

        expect(blockedFinished).toBe(true);
    });

    it('harness.mock - real local fetch - using defaultDestination', async () => {
        await using fc = await fullcircle({
            listenAddress: 7887,
            defaultDestination: 'api.github.com',
        });

        let blockedFinished = false;
        {
            await using th = fc.harness('api.github.com');

            th.get('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const reqPath = '/api/repos';

            try {
                const fetchRes = await fetch(`http://localhost:7887${reqPath}`);
                expect(fetchRes.status).toEqual(200);

                const responseBody = await fetchRes.json();
                expect(responseBody).toEqual({data: 'My mocked data'});
            } catch (e) {
                logError(e);
                expect(e).toBe(null);
            }

            blockedFinished = true;
        }

        expect(blockedFinished).toBe(true);
    });
});

const logError = (err: any) => {
    console.error(err);
}
