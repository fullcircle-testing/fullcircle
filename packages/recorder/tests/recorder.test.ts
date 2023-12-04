import {MockServer} from 'jest-mock-server';
import request from 'supertest';

import {initApp} from '../src/express_app';
import {SessionManager} from '../session_recording.ts/sessions_manager';

describe('Test proxy', () => {
    const server = new MockServer();

    beforeAll(() => server.start());
    afterAll(() => server.stop());
    beforeEach(() => server.reset());

    it('Receives response defined by test', async () => {
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
        const app = initApp({sessionManager, shouldProxy: true});

        const response = await request(app)
            .get('/user')
            .set('original_host' as unknown as 'Cookie', url as unknown as string[])
            .expect(200)

        expect(response.body).toEqual(testBody);

        expect(route).toHaveBeenCalledTimes(1);

        const message = await sessionManager.finishCurrentSession();
        expect(message?.split('\n')[0]).toEqual('Recorded 1 calls');
    });
});
