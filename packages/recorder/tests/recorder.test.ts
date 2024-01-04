import {MockServer} from 'jest-mock-server';
import request from 'supertest';

import {initApp} from '../src/express_app';
import {SessionManager} from '../src/session_recording/sessions_manager';

describe('Test proxy', () => {
    const server = new MockServer();

    beforeAll(() => server.start());
    afterAll(() => server.stop());
    beforeEach(() => server.reset());

    it('Receives response defined by test. Use original_host header', async () => {
        const testBody = {i: 'e'}

        const route = server
            .get('/user')
            .mockImplementationOnce((ctx) => {
                ctx.body = testBody;
                ctx.status = 200;
            })
            .mockImplementationOnce((ctx) => {
                ctx.status = 201;
            });

        const url = server.getURL();

        const sessionManager = new SessionManager();
        sessionManager.startNewSession();
        const app = initApp({sessionManager, includeHeaders: false});

        const response = await request(app)
            .get('/user')
            .set('original_host' as unknown as 'Cookie', url as unknown as string[])
            .expect(200)

        expect(response.body).toEqual(testBody);

        expect(route).toHaveBeenCalledTimes(1);

        const message = await sessionManager.finishCurrentSession('first session');

        const lines = message?.split('\n');
        expect(lines?.length).toBeGreaterThan(2);
        expect(lines![0]!).toEqual('Finished session \"first session\"');
        expect(lines![1]!).toEqual('Recorded 1 calls');
    });

    it('Receives response defined by test. Use default destination', async () => {
        const testBody = {i: 'e'}

        const route = server
            .get('/user')
            .mockImplementationOnce((ctx) => {
                ctx.body = testBody;
                ctx.status = 200;
            })
            .mockImplementationOnce((ctx) => {
                ctx.status = 201;
            });

        const url = server.getURL();

        const sessionManager = new SessionManager();
        sessionManager.startNewSession();
        const app = initApp({sessionManager, defaultDestination: url.toString(), includeHeaders: false});

        const response = await request(app)
            .get('/user')
            .expect(200)

        expect(response.body).toEqual(testBody);

        expect(route).toHaveBeenCalledTimes(1);

        const message = await sessionManager.finishCurrentSession('my session');

        const lines = message?.split('\n');
        expect(lines?.length).toBeGreaterThan(2);
        expect(lines![0]!).toEqual('Finished session \"my session\"');
        expect(lines![1]!).toEqual('Recorded 1 calls');
    });
});
