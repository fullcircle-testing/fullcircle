(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';
import fetch from 'node-fetch';

import {fullcircle} from '../src/fullcircle';
import {response} from '../src/primitives';

describe('Harness tests', () => {

    it('fullcircle - dynamic listenAddress 0 exposes the bound port and url', async () => {
        await using fc = await fullcircle({
            listenAddress: 0,
            defaultDestination: 'api.github.com',
        });

        expect(fc.port).toEqual(expect.any(Number));
        expect(fc.port).toBeGreaterThan(0);
        expect(fc.url).toEqual(`http://127.0.0.1:${fc.port}`);

        await using th = fc.harness('api.github.com');
        th.mock('/api/repos', (req, res) => {
            res.json({data: 'My dynamically bound mocked data'});
        });

        const fetchRes = await fetch(`${fc.url}/api/repos`);
        expect(fetchRes.status).toEqual(200);
        await expect(fetchRes.json()).resolves.toEqual({data: 'My dynamically bound mocked data'});
    });

    it('fullcircle - rejects initialization when the listen port is already in use', async () => {
        await using fc = await fullcircle({listenAddress: 0});

        await expect(fullcircle({listenAddress: fc.port})).rejects.toThrow(/listen EADDRINUSE/);
    });

    it('harness.mock - fake fetch - should succeed mocked path called', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
        });

        const app = fc.expressApp;

        let blockedFinished = false;
        {
            await using th = fc.harness('api.github.com');

            th.mock('/api/repos', (req, res) => {
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

            th.mock('/api/repos', (req, res) => {
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
            listenAddress: 0,
        });

        let blockedFinished = false;
        {
            await using th = fc.harness('api.github.com');

            th.mock('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const reqPath = '/api/repos';

            try {
                const fetchRes = await fetch(`${fc.url}${reqPath}`, {
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
            listenAddress: 0,
        });

        let blockedFinished = false;
        await (async () => {
            await using th = fc.harness('api.github.com');
            th.mock('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const reqPath = '/api/other';
            try {
                const fetchRes = await fetch(`${fc.url}${reqPath}`, {
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
            listenAddress: 0,
            defaultDestination: 'api.github.com',
        });

        let blockedFinished = false;
        {
            await using th = fc.harness('api.github.com');

            th.mock('/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const reqPath = '/api/repos';

            try {
                const fetchRes = await fetch(`${fc.url}${reqPath}`);
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

    it('harness.mockRoute - handles framework-neutral request and response primitives', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        const app = fc.expressApp;

        {
            await using th = fc.harness('api.stripe.com');

            th.mockRoute({
                method: 'POST',
                path: '/v1/checkout/sessions',
                query: {'expand[]': 'line_items'},
                headers: {authorization: /^Bearer sk_test_/},
                body: {mode: 'subscription'},
            }, async (req) => {
                expect(req.method).toBe('POST');
                expect(req.path).toBe('/v1/checkout/sessions');
                expect(req.query.get('expand[]')).toBe('line_items');
                expect(req.headers.get('authorization')).toBe('Bearer sk_test_fullcircle');
                expect(req.destination).toBe('api.stripe.com');
                expect(req.body).toEqual({
                    kind: 'form',
                    value: {
                        mode: 'subscription',
                        'line_items[0][price]': 'price_pro_monthly',
                    },
                });

                return response.json({
                    id: 'cs_test_fullcircle_123',
                    object: 'checkout.session',
                }, {
                    status: 201,
                    headers: {'x-fullcircle': 'yes'},
                });
            });

            const responseBody = await request(app)
                .post('/v1/checkout/sessions?expand[]=line_items')
                .set('authorization', 'Bearer sk_test_fullcircle')
                .type('form')
                .send({
                    mode: 'subscription',
                    'line_items[0][price]': 'price_pro_monthly',
                })
                .expect(201)
                .expect('x-fullcircle', 'yes');

            expect(responseBody.body).toEqual({
                id: 'cs_test_fullcircle_123',
                object: 'checkout.session',
            });
        }
    });

    it('harness.mockRoute - strict mode rejects unexpected query and body fields', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await (async () => {
            await using th = fc.harness('api.stripe.com');

            th.mockRoute({
                method: 'POST',
                path: '/v1/checkout/sessions',
                query: {'expand[]': 'line_items'},
                body: {mode: 'subscription'},
                strict: true,
            }, () => response.json({id: 'cs_test_fullcircle_123'}));

            const responseBody = await request(fc.expressApp)
                .post('/v1/checkout/sessions?expand[]=line_items&expand[]=customer')
                .type('form')
                .send({
                    mode: 'subscription',
                    customer: 'cus_fullcircle_123',
                })
                .expect(404);

            expect(responseBody.body).toEqual({
                error: 'FC server received unexpected request. No registered mocks for /v1/checkout/sessions?expand[]=line_items&expand[]=customer',
            });
        })().then(() => {
            throw new Error('Expected dispose method to throw an error');
        }, error => {
            expect(error.message).toEqual('harness assertions failed:\nDid not receive request to mock for POST /v1/checkout/sessions');
        });
    });

    it('harness.passthrough - fake fetch - should route registered passthrough path', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
        });

        const app = fc.expressApp;

        {
            await using th = fc.harness('api.github.com');

            th.passthrough('/api/repos', (req, res) => {
                res.json({data: 'My passthrough data'});
            });

            const response = await request(app)
                .get('/api/repos')
                .set('original_host', 'api.github.com')
                .expect(200);

            expect(response.body).toEqual({data: 'My passthrough data'});
        }
    });

});

const logError = (err: any) => {
    console.error(err);
}
