(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {
    replaySessionArtifact,
    replaySessionArtifactFile,
    type FullCircleReplayBodyArtifact,
    type FullCircleReplayHttpExchangeEvent,
    type FullCircleReplaySessionArtifact,
} from '../../src/providers/session_replay';

describe('generic session replay provider', () => {
    it('replays a captured HTTP exchange from a session artifact', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        {
            await using th = fc.harness('api.stripe.com');
            replaySessionArtifact(th, artifact({
                destination: 'https://api.stripe.com',
                method: 'POST',
                path: '/v1/customers',
                requestBody: {
                    kind: 'json',
                    value: {email: 'customer@example.test'},
                },
                responseStatus: 201,
                responseHeaders: {'x-stripe-request-id': 'req_fullcircle_123'},
                responseBody: {
                    kind: 'json',
                    value: {
                        id: 'cus_fullcircle_123',
                        object: 'customer',
                        email: 'customer@example.test',
                    },
                },
            }));

            const replayed = await request(fc.expressApp)
                .post('/v1/customers')
                .send({email: 'customer@example.test'})
                .expect(201)
                .expect('x-stripe-request-id', 'req_fullcircle_123');

            expect(replayed.body).toEqual({
                id: 'cus_fullcircle_123',
                object: 'customer',
                email: 'customer@example.test',
            });
        }
    });

    it('matches captured request bodies before replaying', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        await (async () => {
            await using th = fc.harness('api.stripe.com');
            replaySessionArtifact(th, artifact({
                destination: 'https://api.stripe.com',
                method: 'POST',
                path: '/v1/customers',
                requestBody: {
                    kind: 'json',
                    value: {email: 'expected@example.test'},
                },
                responseStatus: 201,
                responseBody: {
                    kind: 'json',
                    value: {id: 'cus_fullcircle_123'},
                },
            }));

            await request(fc.expressApp)
                .post('/v1/customers')
                .send({email: 'actual@example.test'})
                .expect(404);
        })().then(() => {
            throw new Error('Expected dispose method to throw an error');
        }, error => {
            expect(error.message).toEqual([
                'harness assertions failed:',
                'Expected mock "POST /v1/customers from captured provider calls" for POST /v1/customers to be called at least 1 time, but it was called 0 times',
                'Actual requests received by api.stripe.com:',
                '- POST /v1/customers body={"email":"actual@example.test"}',
            ].join('\n'));
        });
    });

    it('replays repeated captured exchanges in capture order', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        {
            await using th = fc.harness('api.stripe.com');
            replaySessionArtifact(th, {
                schemaVersion: 'fullcircle.session.v1',
                name: 'event polling',
                startedAt: '2026-06-15T00:00:00.000Z',
                endedAt: '2026-06-15T00:00:02.000Z',
                timeline: [
                    httpExchange({
                        id: 'http-1',
                        responseBody: {kind: 'json', value: {object: 'list', has_more: true}},
                    }),
                    httpExchange({
                        id: 'http-2',
                        responseBody: {kind: 'json', value: {object: 'list', has_more: false}},
                    }),
                ],
                providerFixtures: [],
                webhookDeliveries: [],
                browserEvents: [],
                resources: [],
                database: {snapshots: [], diffs: []},
                redactions: [],
                metadata: {},
            });

            const first = await request(fc.expressApp)
                .get('/v1/events')
                .expect(200);
            expect(first.body).toEqual({object: 'list', has_more: true});

            const second = await request(fc.expressApp)
                .get('/v1/events')
                .expect(200);
            expect(second.body).toEqual({object: 'list', has_more: false});
        }
    });

    it('loads and replays a session artifact JSON file', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fullcircle-session-replay-'));
        const artifactPath = path.join(tmpDir, 'session.fullcircle.json');
        await fs.writeFile(artifactPath, JSON.stringify(artifact({
            destination: 'https://api.stripe.com',
            method: 'GET',
            path: '/v1/prices/price_pro_monthly',
            responseBody: {
                kind: 'json',
                value: {id: 'price_pro_monthly', object: 'price'},
            },
        }), null, 2));

        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'api.stripe.com',
        });

        {
            await using th = fc.harness('api.stripe.com');
            await replaySessionArtifactFile(th, artifactPath);

            const replayed = await request(fc.expressApp)
                .get('/v1/prices/price_pro_monthly')
                .expect(200);
            expect(replayed.body).toEqual({id: 'price_pro_monthly', object: 'price'});
        }
    });
});

const artifact = (input: {
    destination: string;
    method: string;
    path: string;
    requestBody?: FullCircleReplayBodyArtifact;
    responseStatus?: number;
    responseHeaders?: Record<string, string | string[]>;
    responseBody: FullCircleReplayBodyArtifact;
}): FullCircleReplaySessionArtifact => ({
    schemaVersion: 'fullcircle.session.v1',
    name: 'captured provider calls',
    startedAt: '2026-06-15T00:00:00.000Z',
    endedAt: '2026-06-15T00:00:01.000Z',
    timeline: [httpExchange({
        destination: input.destination,
        method: input.method,
        path: input.path,
        requestBody: input.requestBody,
        responseStatus: input.responseStatus,
        responseHeaders: input.responseHeaders,
        responseBody: input.responseBody,
    })],
    providerFixtures: [],
    webhookDeliveries: [],
    browserEvents: [],
    resources: [],
    database: {snapshots: [], diffs: []},
    redactions: [],
    metadata: {},
});

const httpExchange = (input: {
    id?: string;
    destination?: string;
    method?: string;
    path?: string;
    requestBody?: FullCircleReplayBodyArtifact;
    responseStatus?: number;
    responseHeaders?: Record<string, string | string[]>;
    responseBody: FullCircleReplayBodyArtifact;
}): FullCircleReplayHttpExchangeEvent => ({
    id: input.id || 'http-1',
    at: '2026-06-15T00:00:01.000Z',
    kind: 'http.exchange',
    destination: input.destination || 'https://api.stripe.com',
    request: {
        method: input.method || 'GET',
        path: input.path || '/v1/events',
        headers: null,
        body: input.requestBody || {kind: 'empty'},
    },
    response: {
        status: input.responseStatus || 200,
        headers: input.responseHeaders || null,
        body: input.responseBody,
    },
});
