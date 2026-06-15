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
        expect(sessionManager.getCurrentSession()).toBeUndefined();
        await expect(sessionManager.finishCurrentSession('duplicate finish')).resolves.toBeUndefined();
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
        expect(sessionManager.getCurrentSession()).toBeUndefined();
        await expect(sessionManager.finishCurrentSession('duplicate finish')).resolves.toBeUndefined();
    });

    it('clears empty sessions after finishing', async () => {
        const sessionManager = new SessionManager();
        sessionManager.startNewSession();

        await expect(sessionManager.finishCurrentSession('empty')).resolves.toEqual('No calls have been made during this session');

        expect(sessionManager.getCurrentSession()).toBeUndefined();
    });

    it('exposes recorder session status and stop controls through API', async () => {
        const testBody = {ok: true};
        server.get('/session-ui-user').mockImplementationOnce((ctx) => {
            ctx.body = testBody;
            ctx.status = 200;
        });

        const url = server.getURL();
        const destination = url.toString().replace(/\/$/, '');
        const sessionManager = new SessionManager();
        const app = initApp({sessionManager, defaultDestination: url.toString(), includeHeaders: false});

        await request(app)
            .get('/fullcircle/api/status')
            .expect(200)
            .expect(response => expect(response.body).toMatchObject({
                recording: false,
                currentSession: null,
                recentCalls: [],
                lastFinishedSession: null,
            }));

        await request(app)
            .post('/fullcircle/api/record/start')
            .expect(200)
            .expect(response => expect(response.body).toMatchObject({
                recording: true,
                message: 'Started recording',
            }));

        await request(app)
            .get('/session-ui-user')
            .expect(200);

        await request(app)
            .get('/fullcircle/api/status')
            .expect(200)
            .expect(response => expect(response.body).toMatchObject({
                recording: true,
                currentSession: {
                    callCount: 1,
                    recentCalls: [{
                        host: destination,
                        path: '/session-ui-user',
                        method: 'GET',
                    }],
                },
                recentCalls: [{
                    host: destination,
                    path: '/session-ui-user',
                    method: 'GET',
                }],
            }));

        await request(app)
            .post('/fullcircle/api/record/stop')
            .send({name: 'ui session'})
            .expect(200)
            .expect(response => {
                expect(response.body).toMatchObject({
                    recording: false,
                    result: {
                        sessionName: 'ui session',
                        numCalls: 1,
                        outputPath: expect.any(String),
                    },
                    message: expect.stringContaining('Finished session "ui session"'),
                });
            });

        await request(app)
            .get('/fullcircle/api/status')
            .expect(200)
            .expect(response => expect(response.body).toMatchObject({
                recording: false,
                currentSession: null,
                lastFinishedSession: {
                    sessionName: 'ui session',
                    numCalls: 1,
                    outputPath: expect.any(String),
                },
            }));
    });

    it('serves a recorder session management web UI', async () => {
        const sessionManager = new SessionManager();
        const app = initApp({sessionManager, includeHeaders: false});

        await request(app)
            .get('/fullcircle')
            .expect(200)
            .expect('content-type', /html/)
            .expect(response => {
                expect(response.text).toContain('FullCircle Recorder');
                expect(response.text).toContain('Start recording');
                expect(response.text).toContain('Stop and save');
                expect(response.text).toContain('/fullcircle/api/status');
            });
    });
});
