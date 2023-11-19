import {MockServer} from 'jest-mock-server';
import request from 'supertest';

import {initApp} from '../src/express_app';

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

        const app = initApp();

        const response = await request(app)
            .get('/user')
            .set('original_host' as unknown as 'Cookie', url as unknown as string[])
            .expect(200)

        expect(response.body).toEqual(testBody);

        expect(route).toHaveBeenCalledTimes(1);
    });
});
