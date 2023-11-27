(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';
import fetch from 'node-fetch';

import {fullcircle} from '../src/fullcircle';

describe('Harness tests', () => {
    it('harness.mock - should succeed mocked path called', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
        });

        const app = fc.expressApp;

        {
            await using th = fc.harness();

            th.mock('api.github.com', '/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const response = await request(app)
            .get('/api/repos')
            .set('original_host', 'api.github.com')
            .expect(200)

            expect(response.body).toEqual({data: 'My mocked data'});
        }
    });

    it('harness.mock - should error when mocked path not called', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
        });

        const app = fc.expressApp;

        await (async () => {
            await using th = fc.harness();

            th.mock('api.github.com', '/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const response = await request(app)
            .get('/api/other')
            .set('original_host', 'api.github.com')
            .expect(200)

            expect(response.body).toEqual({data: 'My mocked data'});
        })().then(resolved => {
            throw new Error('Expected dispose method to throw an error');
        }, rejected => {
            expect(rejected.error.message).toEqual('harness assertions failed:\nDid not receive request to mock for /api/repos');
        });
    });

    it('harness.mock - use real local fetch call', async () => {
        await using fc = await fullcircle({
            listenAddress: 7887,
        });

        {
            await using th = fc.harness();

            th.mock('api.github.com', '/api/repos', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const fetchRes = await fetch('http://localhost:7887/api/repos', {
                headers: {
                    'original_host': 'api.github.com',
                },
            });
            expect(fetchRes.status).toEqual(200);

            const jsonResponse = await fetchRes.json();
            expect(jsonResponse).toEqual({data: 'My mocked data'});
        }
    });
});
