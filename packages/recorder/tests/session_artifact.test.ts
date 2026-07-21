import {
    FULLCIRCLE_SESSION_SCHEMA_VERSION,
    createEmptySessionArtifact,
    recordedCallsToSessionArtifact,
} from '../src/session_artifact';
import {RecordedCall} from '../src/types';

describe('FullCircle session artifact schema', () => {
    it('creates an empty canonical session artifact with stable top-level collections', () => {
        expect(createEmptySessionArtifact({
            name: 'checkout subscription',
            startedAt: '2026-06-14T00:00:00.000Z',
            metadata: {source: 'test'},
        })).toEqual({
            schemaVersion: FULLCIRCLE_SESSION_SCHEMA_VERSION,
            name: 'checkout subscription',
            startedAt: '2026-06-14T00:00:00.000Z',
            endedAt: '2026-06-14T00:00:00.000Z',
            timeline: [],
            providerFixtures: [],
            webhookDeliveries: [],
            browserEvents: [],
            resources: [],
            database: {
                snapshots: [],
                diffs: [],
            },
            redactions: [],
            metadata: {source: 'test'},
        });
    });

    it('normalizes recorded HTTP calls into timeline exchange events', () => {
        const call: RecordedCall = {
            time: '2026-06-14T00:00:01.000Z',
            host: 'https://api.stripe.com',
            requestMethod: 'POST',
            requestPath: '/v1/checkout/sessions',
            requestHeaders: {
                'content-type': 'application/x-www-form-urlencoded',
                'authorization': 'Bearer sk_test_fullcircle',
            },
            requestBody: {
                mode: 'subscription',
                'line_items[0][price]': 'price_pro_monthly',
            },
            responseHeaders: {
                'content-type': 'application/json',
            },
            responseBody: {
                id: 'cs_test_fullcircle_123',
                object: 'checkout.session',
            },
            requestIp: '127.0.0.1',
            status: 200,
        };

        expect(recordedCallsToSessionArtifact({
            name: 'checkout subscription',
            startedAt: '2026-06-14T00:00:00.000Z',
            endedAt: '2026-06-14T00:00:02.000Z',
            calls: [call],
        })).toMatchObject({
            schemaVersion: 'fullcircle.session.v1',
            name: 'checkout subscription',
            timeline: [{
                id: 'http-1',
                at: '2026-06-14T00:00:01.000Z',
                kind: 'http.exchange',
                destination: 'https://api.stripe.com',
                request: {
                    method: 'POST',
                    path: '/v1/checkout/sessions',
                    body: {
                        kind: 'json',
                        value: {
                            mode: 'subscription',
                            'line_items[0][price]': 'price_pro_monthly',
                        },
                    },
                },
                response: {
                    status: 200,
                    body: {
                        kind: 'json',
                        value: {
                            id: 'cs_test_fullcircle_123',
                            object: 'checkout.session',
                        },
                    },
                },
            }],
        });
    });

    it('adds browser events to session artifacts and keeps timeline chronology', () => {
        expect(recordedCallsToSessionArtifact({
            name: 'checkout browser flow',
            startedAt: '2026-06-15T12:00:00.000Z',
            endedAt: '2026-06-15T12:00:03.000Z',
            calls: [],
            browserEvents: [{
                id: 'browser-click-upgrade',
                at: '2026-06-15T12:00:01.000Z',
                correlationId: 'fc-correlation-1',
                event: {
                    type: 'click',
                    url: 'http://localhost:5173/billing',
                    selector: 'button#upgrade',
                    label: 'Upgrade to Pro',
                },
            }],
        })).toMatchObject({
            browserEvents: [{
                type: 'click',
                url: 'http://localhost:5173/billing',
                selector: 'button#upgrade',
                label: 'Upgrade to Pro',
            }],
            timeline: [{
                id: 'browser-click-upgrade',
                at: '2026-06-15T12:00:01.000Z',
                correlationId: 'fc-correlation-1',
                kind: 'browser.event',
                event: {
                    type: 'click',
                    url: 'http://localhost:5173/billing',
                    selector: 'button#upgrade',
                    label: 'Upgrade to Pro',
                },
            }],
        });
    });
});
