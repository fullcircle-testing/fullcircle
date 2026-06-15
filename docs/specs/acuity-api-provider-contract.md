# FullCircle Acuity API Provider Contract

Bead: `fullcircle-64o.14 — Add Acuity API provider`

## Scope

This provider models the Acuity Scheduling API calls needed by Soundspace-style booking e2e tests. It is API-only; the embeddable/legacy iframe flow belongs to the separate Acuity iframe provider bead.

The first implementation covers:

- appointment type discovery
- existing appointments queried by email/date window
- calendars
- availability dates, times, and check-times
- forms for a selected appointment type
- appointment creation
- appointment cancellation
- resource-derived appointment usage fixtures

## Provider API

```ts
const acuity = acuityProvider(harness);

acuity.appointmentTypes.list({ calendarId: 7034881, reply: [halfHour, twoHour] });
acuity.appointments.listByEmail({ email, minDate: '2026-06-01', reply: bookedAppointments });
acuity.calendars.list({ reply: [calendarHq] });
acuity.availability.dates({ calendarId, appointmentTypeId, month: '2026-06', reply: [{ date: '2026-06-12' }] });
acuity.availability.times({ calendarId, appointmentTypeId, date: '2026-06-12', reply: [{ time: '2026-06-12T10:00:00-0400' }] });
acuity.availability.checkTimes({ match: { calendarId, appointmentTypeId, datetime }, reply: { valid: true } });
acuity.forms.list({ appointmentTypeId, reply: [bookingForm] });
acuity.appointments.create({ match: { calendarId, appointmentTypeId, email, datetime }, reply: createdAppointment });
acuity.appointments.cancel({ appointmentId: createdAppointment.id, reply: { id: createdAppointment.id, canceled: true } });
```

The provider uses FullCircle-owned `mockRoute()` primitives instead of Express handlers. Query/body mismatches return `422` with a field-level diagnostic so agents can see which app payload drifted from the fixture.

## Endpoints modeled

| Provider helper | Method/path | Match fields |
| --- | --- | --- |
| `appointmentTypes.list()` | `GET /api/v1/appointment-types` | `calendarID` |
| `appointments.listByEmail()` | `GET /api/v1/appointments` | `email`, `minDate`, `maxDate` |
| `calendars.list()` | `GET /api/v1/calendars` | none |
| `availability.dates()` | `GET /api/v1/availability/dates` | `calendarID`, `appointmentTypeID`, `month` |
| `availability.times()` | `GET /api/v1/availability/times` | `calendarID`, `appointmentTypeID`, `date` |
| `availability.checkTimes()` | `POST /api/v1/availability/check-times` | `calendarID`, `appointmentTypeID`, `datetime` |
| `forms.list()` | `GET /api/v1/forms` | `appointmentTypeID` |
| `appointments.create()` | `POST /api/v1/appointments` | `calendarID`, `appointmentTypeID`, `email`, `datetime`, optional names |
| `appointments.cancel()` | `PUT /api/v1/appointments/:id/cancel` | appointment id in path |

## Failure fixtures

Every list/mutation helper accepts `status` and `reply`, which lets e2e tests fixture cases like:

- no availability: `availability.times({ ..., reply: [] })`
- invalid time: `availability.checkTimes({ ..., status: 409, reply: { valid: false, message: 'time unavailable' } })`
- create conflict: `appointments.create({ ..., status: 409, reply: { error: 'slot unavailable' } })`
- cancel failure: `appointments.cancel({ ..., status: 400, reply: { error: 'cannot cancel' } })`

## Resource usage derivation

For tests that care about subscription balance or booked minutes, prefer resource fixtures over hand-written Acuity JSON:

```ts
const derived = acuity.resources.calendarUsage({
  email: 'member@example.test',
  calendars: [{
    calendarId: 7034881,
    appointments: [
      { durationMinutes: 60, datetime: '2026-06-12T10:00:00-0400' },
      { durationMinutes: 30, datetime: '2026-06-13T11:00:00-0400' },
    ],
  }],
});
```

This registers `GET /api/v1/appointments?email=...` and returns deterministic appointment objects with `calendarID`, `duration`, `datetime`, and stable ids. The same `derived` array can be reused by database seed/diff expectations so booking usage calculations do not drift from provider fixtures.
