(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {acuityIframeProvider} from '../../src/providers/acuity_iframe';

describe('Acuity iframe HTML provider', () => {
    it('serves a captured schedule page patched with high-signal booking inputs', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'app.acuityscheduling.com',
        });

        await using th = fc.harness('app.acuityscheduling.com');
        acuityIframeProvider(th).schedulePage({
            owner: '18362646',
            calendarId: '7034881',
            capturedHtml: htmlFixture(),
            user: {
                firstName: 'Ada',
                lastName: 'Lovelace',
                email: 'ada@example.test',
                phone: '+15551234567',
            },
            appointmentTypes: [
                {id: '111', name: 'Two hour session', durationMinutes: 120},
                {id: '222', name: 'Three hour session', durationMinutes: 180},
            ],
            hiddenSelectors: ['#phone', '#email'],
        });

        const response = await request(fc.expressApp)
            .get('/schedule.php?owner=18362646&calendarID=7034881')
            .expect(200)
            .expect('content-type', /text\/html/);

        expect(response.text).toContain('value="Ada"');
        expect(response.text).toContain('value="Lovelace"');
        expect(response.text).toContain('value="ada@example.test"');
        expect(response.text).toContain('value="+15551234567"');
        expect(response.text).toContain('data-fullcircle-appointment-type="111"');
        expect(response.text).toContain('Two hour session');
        expect(response.text).toContain('#phone,#email{display:none !important;}');
        expect(response.text).toContain('data-fullcircle-acuity-iframe');
    });

    it('returns variant pages for insufficient credits, max hours, chooser, and unavailable states', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'app.acuityscheduling.com',
        });

        await using th = fc.harness('app.acuityscheduling.com');
        const iframe = acuityIframeProvider(th);
        iframe.schedulePage({owner: 'owner-too-little', variant: 'insufficient_credits'});
        iframe.schedulePage({owner: 'owner-max-hours', variant: 'max_hours_reached'});
        iframe.schedulePage({owner: 'owner-chooser', variant: 'multi_calendar_chooser'});
        iframe.schedulePage({owner: 'owner-unavailable', variant: 'acuity_unavailable'});

        expect((await request(fc.expressApp).get('/schedule.php?owner=owner-too-little').expect(200)).text)
            .toContain('Not enough booking credit');
        expect((await request(fc.expressApp).get('/schedule.php?owner=owner-max-hours').expect(200)).text)
            .toContain('Maximum bookable hours reached');
        expect((await request(fc.expressApp).get('/schedule.php?owner=owner-chooser').expect(200)).text)
            .toContain('Choose a calendar');
        expect((await request(fc.expressApp).get('/schedule.php?owner=owner-unavailable').expect(503)).text)
            .toContain('Acuity is unavailable');
    });

    it('matches owner and calendar query parameters before serving iframe HTML', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'app.acuityscheduling.com',
        });

        await (async () => {
            await using th = fc.harness('app.acuityscheduling.com');
            acuityIframeProvider(th).schedulePage({owner: '18362646', calendarId: '7034881'});

            await request(fc.expressApp)
                .get('/schedule.php?owner=wrong&calendarID=7034881')
                .expect(404);
        })().then(() => {
            throw new Error('Expected dispose method to throw an error');
        }, error => {
            expect(error.message).toContain('Expected mock "Acuity iframe schedule page owner=18362646 calendarID=7034881"');
            expect(error.message).toContain('Actual requests received by app.acuityscheduling.com:');
            expect(error.message).toContain('- GET /schedule.php?owner=wrong&calendarID=7034881');
        });
    });
});

const htmlFixture = () => `<!doctype html>
<html>
  <head><title>Schedule Appointment</title></head>
  <body>
    <form id="appointment-form">
      <input id="first-name" name="firstName" />
      <input id="last-name" name="lastName" />
      <input id="email" name="email" />
      <input id="phone" name="phone" />
      <select id="appointment-type" name="appointmentType"></select>
    </form>
  </body>
</html>`;
