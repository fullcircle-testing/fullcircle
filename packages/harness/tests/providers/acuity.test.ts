(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import request from 'supertest';

import {fullcircle} from '../../src/fullcircle';
import {acuityProvider} from '../../src/providers/acuity';

describe('Acuity provider harness', () => {
    it('fixtures booking discovery endpoints with strict query matching', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'acuityscheduling.com',
        });

        await using th = fc.harness('acuityscheduling.com');
        const acuity = acuityProvider(th);
        acuity.appointmentTypes.list({
            calendarId: 7034881,
            reply: [{id: 111, name: 'Two hour session', duration: 120, calendarIDs: [7034881]}],
        });
        acuity.calendars.list({
            reply: [{id: 7034881, name: 'HQ Studio'}],
        });
        acuity.availability.dates({
            calendarId: 7034881,
            appointmentTypeId: 111,
            month: '2026-06',
            reply: [{date: '2026-06-12'}],
        });
        acuity.availability.times({
            calendarId: 7034881,
            appointmentTypeId: 111,
            date: '2026-06-12',
            reply: [{time: '2026-06-12T10:00:00-0400'}],
        });
        acuity.forms.list({
            appointmentTypeId: 111,
            reply: [{id: 9001, name: 'Booking questions'}],
        });

        expect((await request(fc.expressApp)
            .get('/api/v1/appointment-types?calendarID=7034881')
            .expect(200)).body)
            .toEqual([{id: 111, name: 'Two hour session', duration: 120, calendarIDs: [7034881]}]);
        expect((await request(fc.expressApp).get('/api/v1/calendars').expect(200)).body)
            .toEqual([{id: 7034881, name: 'HQ Studio'}]);
        expect((await request(fc.expressApp)
            .get('/api/v1/availability/dates?calendarID=7034881&appointmentTypeID=111&month=2026-06')
            .expect(200)).body)
            .toEqual([{date: '2026-06-12'}]);
        expect((await request(fc.expressApp)
            .get('/api/v1/availability/times?calendarID=7034881&appointmentTypeID=111&date=2026-06-12')
            .expect(200)).body)
            .toEqual([{time: '2026-06-12T10:00:00-0400'}]);
        expect((await request(fc.expressApp)
            .get('/api/v1/forms?appointmentTypeID=111')
            .expect(200)).body)
            .toEqual([{id: 9001, name: 'Booking questions'}]);
    });

    it('supports appointments by email, create, cancel, and check-times fixtures', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'acuityscheduling.com',
        });

        await using th = fc.harness('acuityscheduling.com');
        const acuity = acuityProvider(th);
        acuity.appointments.listByEmail({
            email: 'booker@example.test',
            minDate: '2026-06-01',
            reply: [{id: 123, email: 'booker@example.test', calendarID: 7034881}],
        });
        acuity.availability.checkTimes({
            match: {
                calendarId: 7034881,
                appointmentTypeId: 111,
                datetime: '2026-06-12T10:00:00-0400',
            },
            reply: {valid: true},
        });
        acuity.appointments.create({
            match: {
                calendarId: 7034881,
                appointmentTypeId: 111,
                email: 'booker@example.test',
                datetime: '2026-06-12T10:00:00-0400',
            },
            reply: {id: 456, email: 'booker@example.test', calendarID: 7034881, canceled: false},
        });
        acuity.appointments.cancel({
            appointmentId: 456,
            reply: {id: 456, canceled: true},
        });

        expect((await request(fc.expressApp)
            .get('/api/v1/appointments?email=booker%40example.test&minDate=2026-06-01')
            .expect(200)).body)
            .toEqual([{id: 123, email: 'booker@example.test', calendarID: 7034881}]);
        expect((await request(fc.expressApp)
            .post('/api/v1/availability/check-times')
            .send({calendarID: 7034881, appointmentTypeID: 111, datetime: '2026-06-12T10:00:00-0400'})
            .expect(200)).body)
            .toEqual({valid: true});
        expect((await request(fc.expressApp)
            .post('/api/v1/appointments')
            .send({calendarID: 7034881, appointmentTypeID: 111, email: 'booker@example.test', datetime: '2026-06-12T10:00:00-0400'})
            .expect(200)).body)
            .toEqual({id: 456, email: 'booker@example.test', calendarID: 7034881, canceled: false});
        expect((await request(fc.expressApp)
            .put('/api/v1/appointments/456/cancel')
            .expect(200)).body)
            .toEqual({id: 456, canceled: true});
    });

    it('derives appointment list fixtures from calendar resource usage', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'acuityscheduling.com',
        });

        await using th = fc.harness('acuityscheduling.com');
        acuityProvider(th).resources.calendarUsage({
            email: 'member@example.test',
            calendars: [{
                calendarId: 7034881,
                appointments: [
                    {durationMinutes: 60, datetime: '2026-06-12T10:00:00-0400'},
                    {durationMinutes: 30, datetime: '2026-06-13T11:00:00-0400'},
                ],
            }],
        });

        expect((await request(fc.expressApp)
            .get('/api/v1/appointments?email=member%40example.test&minDate=2026-06-01')
            .expect(200)).body)
            .toEqual([
                expect.objectContaining({
                    id: 7034881001,
                    email: 'member@example.test',
                    calendarID: 7034881,
                    duration: 60,
                    datetime: '2026-06-12T10:00:00-0400',
                }),
                expect.objectContaining({
                    id: 7034881002,
                    email: 'member@example.test',
                    calendarID: 7034881,
                    duration: 30,
                    datetime: '2026-06-13T11:00:00-0400',
                }),
            ]);
    });

    it('returns actionable diagnostics for mismatched Acuity requests', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'acuityscheduling.com',
        });

        await using th = fc.harness('acuityscheduling.com');
        acuityProvider(th).appointments.create({
            match: {
                calendarId: 7034881,
                appointmentTypeId: 111,
                email: 'booker@example.test',
                datetime: '2026-06-12T10:00:00-0400',
            },
            reply: {id: 456},
        });

        const response = await request(fc.expressApp)
            .post('/api/v1/appointments')
            .send({calendarID: 7034882, appointmentTypeID: 111, email: 'booker@example.test', datetime: '2026-06-12T10:00:00-0400'})
            .expect(422);

        expect(response.body).toEqual({
            error: 'Acuity create appointment request did not match expectations',
            mismatches: ['Expected calendarID to match 7034881 but received 7034882'],
        });
    });

    it('supports explicit Acuity failure fixtures without losing expected request matching', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: 'acuityscheduling.com',
        });

        await using th = fc.harness('acuityscheduling.com');
        const acuity = acuityProvider(th);
        acuity.availability.checkTimes({
            match: {
                calendarId: 7034881,
                appointmentTypeId: 111,
                datetime: '2026-06-12T10:00:00-0400',
            },
            status: 409,
            reply: {valid: false, message: 'time unavailable'},
        });
        acuity.appointments.cancel({
            appointmentId: 456,
            status: 400,
            reply: {error: 'cannot cancel appointment'},
        });

        expect((await request(fc.expressApp)
            .post('/api/v1/availability/check-times')
            .send({calendarID: 7034881, appointmentTypeID: 111, datetime: '2026-06-12T10:00:00-0400'})
            .expect(409)).body)
            .toEqual({valid: false, message: 'time unavailable'});
        expect((await request(fc.expressApp)
            .put('/api/v1/appointments/456/cancel')
            .expect(400)).body)
            .toEqual({error: 'cannot cancel appointment'});
    });
});
