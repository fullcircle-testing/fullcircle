(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {telemetrySinksProvider} from '../../src/providers/telemetry';

describe('telemetry and widget sink provider harness', () => {
    it('records PostHog captures and permits identify when configured', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'app.posthog.com'});
        await using th = fc.harness('app.posthog.com');

        const telemetry = telemetrySinksProvider(th);
        const posthog = telemetry.sink.posthog({assertNoUnexpectedIdentify: false});

        expect((await request(fc.expressApp)
            .post('/capture/')
            .send({event: '$identify', distinct_id: 'user_1', properties: {email: 'user@example.test'}})
            .expect(200)).body)
            .toEqual({status: 1});

        expect(posthog.events).toEqual([{event: '$identify', distinctId: 'user_1'}]);
    });

    it('blocks unexpected PostHog identify calls with actionable diagnostics', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'app.posthog.com'});
        await using th = fc.harness('app.posthog.com');

        telemetrySinksProvider(th).sink.posthog();

        expect((await request(fc.expressApp)
            .post('/batch/')
            .send({batch: [{event: '$pageview'}, {event: '$identify', distinct_id: 'user_1'}]})
            .expect(422)).body)
            .toEqual({
                error: 'PostHog sink received unexpected identify event',
                events: ['$identify'],
            });
    });

    it('records Rollbar items and can fail server error reports', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'api.rollbar.com'});
        await using th = fc.harness('api.rollbar.com');

        const rollbar = telemetrySinksProvider(th).sink.rollbar({failOnServerErrorReport: true});

        expect((await request(fc.expressApp)
            .post('/api/1/item/')
            .send({data: {level: 'warning', body: {message: {body: 'noncritical'}}}})
            .expect(200)).body)
            .toEqual({err: 0, result: {id: 'fullcircle-rollbar-item'}});
        expect(rollbar.items).toHaveLength(1);

        expect((await request(fc.expressApp)
            .post('/api/1/item/')
            .send({data: {level: 'error', body: {trace: {exception: {message: 'boom'}}}}})
            .expect(422)).body)
            .toEqual({error: 'Rollbar sink received a server error report', level: 'error'});
    });

    it('stubs Intercom and generic browser widget scripts', async () => {
        await using fc = await fullcircle({listenAddress: null, defaultDestination: 'widget.intercom.io'});
        await using th = fc.harness('widget.intercom.io');

        const telemetry = telemetrySinksProvider(th);
        telemetry.sink.intercom();
        telemetry.sink.browserScript({path: '/third-party/widget.js', globalName: 'ThirdPartyWidget'});

        expect((await request(fc.expressApp)
            .get('/widget/test-app-id')
            .expect(200)).text)
            .toContain('window.Intercom');
        expect((await request(fc.expressApp)
            .post('/messenger/web/ping')
            .send({app_id: 'test-app-id'})
            .expect(200)).body)
            .toEqual({ok: true});
        expect((await request(fc.expressApp)
            .get('/third-party/widget.js')
            .expect(200)).text)
            .toContain('window["ThirdPartyWidget"]');
    });
});
