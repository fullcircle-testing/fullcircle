import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type AcuityScalar = string | number | boolean;
type MaybeMatcher<T extends AcuityScalar> = T | RegExp | ((actual: AcuityScalar | undefined) => boolean);

type AcuityValues = Record<string, AcuityScalar | undefined>;
type AcuityFixture = Record<string, unknown>;

type AcuityListExpectation<TFixture extends AcuityFixture = AcuityFixture> = {
    reply?: TFixture[];
    status?: number;
};

export type AcuityAppointmentTypesListExpectation = AcuityListExpectation & {
    calendarId?: MaybeMatcher<number>;
};

export type AcuityAppointmentsListByEmailExpectation = AcuityListExpectation & {
    email: MaybeMatcher<string>;
    minDate?: MaybeMatcher<string>;
    maxDate?: MaybeMatcher<string>;
};

export type AcuityCalendarsListExpectation = AcuityListExpectation;

export type AcuityAvailabilityDatesExpectation = AcuityListExpectation & {
    calendarId?: MaybeMatcher<number>;
    appointmentTypeId: MaybeMatcher<number>;
    month: MaybeMatcher<string>;
};

export type AcuityAvailabilityTimesExpectation = AcuityListExpectation & {
    calendarId?: MaybeMatcher<number>;
    appointmentTypeId: MaybeMatcher<number>;
    date: MaybeMatcher<string>;
};

export type AcuityFormsListExpectation = AcuityListExpectation & {
    appointmentTypeId?: MaybeMatcher<number>;
};

export type AcuityMutationExpectation<TFixture extends AcuityFixture = AcuityFixture> = {
    match?: {
        calendarId?: MaybeMatcher<number>;
        appointmentTypeId?: MaybeMatcher<number>;
        email?: MaybeMatcher<string>;
        datetime?: MaybeMatcher<string>;
        firstName?: MaybeMatcher<string>;
        lastName?: MaybeMatcher<string>;
    };
    reply?: TFixture;
    status?: number;
};

export type AcuityAppointmentCancelExpectation<TFixture extends AcuityFixture = AcuityFixture> = {
    appointmentId: string | number;
    reply?: TFixture;
    status?: number;
};

export type AcuityCalendarUsage = {
    email: string;
    calendars: Array<{
        calendarId: number;
        appointments: Array<{
            id?: string | number;
            appointmentTypeId?: number;
            durationMinutes: number;
            datetime?: string;
            date?: string;
            firstName?: string;
            lastName?: string;
            notes?: string;
        }>;
    }>;
};

export type AcuityProviderHarness = {
    appointmentTypes: {
        list: (expectation: AcuityAppointmentTypesListExpectation) => void;
    };
    appointments: {
        listByEmail: (expectation: AcuityAppointmentsListByEmailExpectation) => void;
        create: (expectation: AcuityMutationExpectation) => void;
        cancel: (expectation: AcuityAppointmentCancelExpectation) => void;
    };
    calendars: {
        list: (expectation: AcuityCalendarsListExpectation) => void;
    };
    availability: {
        dates: (expectation: AcuityAvailabilityDatesExpectation) => void;
        times: (expectation: AcuityAvailabilityTimesExpectation) => void;
        checkTimes: (expectation: AcuityMutationExpectation) => void;
    };
    forms: {
        list: (expectation: AcuityFormsListExpectation) => void;
    };
    resources: {
        calendarUsage: (usage: AcuityCalendarUsage) => AcuityFixture[];
    };
};

export const acuityProvider = (harness: TestHarness): AcuityProviderHarness => ({
    appointmentTypes: {
        list: expectation => {
            harness.mockRoute({method: 'GET', path: '/api/v1/appointment-types'}, makeAcuityHandler({
                label: 'list appointment types',
                source: 'query',
                match: {calendarID: expectation.calendarId},
                reply: expectation.reply || [],
                status: expectation.status,
            }));
        },
    },
    appointments: {
        listByEmail: expectation => {
            harness.mockRoute({method: 'GET', path: '/api/v1/appointments'}, makeAcuityHandler({
                label: 'list appointments by email',
                source: 'query',
                match: {email: expectation.email, minDate: expectation.minDate, maxDate: expectation.maxDate},
                reply: expectation.reply || [],
                status: expectation.status,
            }));
        },
        create: expectation => {
            harness.mockRoute({method: 'POST', path: '/api/v1/appointments'}, makeAcuityHandler({
                label: 'create appointment',
                source: 'body',
                match: normalizeAcuityMutationMatch(expectation.match),
                reply: expectation.reply || {},
                status: expectation.status,
            }));
        },
        cancel: expectation => {
            harness.mockRoute({method: 'PUT', path: `/api/v1/appointments/${expectation.appointmentId}/cancel`}, () => response.json(
                expectation.reply || {id: expectation.appointmentId, canceled: true},
                {status: expectation.status || 200},
            ));
        },
    },
    calendars: {
        list: expectation => {
            harness.mockRoute({method: 'GET', path: '/api/v1/calendars'}, () => response.json(
                expectation.reply || [],
                {status: expectation.status || 200},
            ));
        },
    },
    availability: {
        dates: expectation => {
            harness.mockRoute({method: 'GET', path: '/api/v1/availability/dates'}, makeAcuityHandler({
                label: 'list availability dates',
                source: 'query',
                match: {
                    calendarID: expectation.calendarId,
                    appointmentTypeID: expectation.appointmentTypeId,
                    month: expectation.month,
                },
                reply: expectation.reply || [],
                status: expectation.status,
            }));
        },
        times: expectation => {
            harness.mockRoute({method: 'GET', path: '/api/v1/availability/times'}, makeAcuityHandler({
                label: 'list availability times',
                source: 'query',
                match: {
                    calendarID: expectation.calendarId,
                    appointmentTypeID: expectation.appointmentTypeId,
                    date: expectation.date,
                },
                reply: expectation.reply || [],
                status: expectation.status,
            }));
        },
        checkTimes: expectation => {
            harness.mockRoute({method: 'POST', path: '/api/v1/availability/check-times'}, makeAcuityHandler({
                label: 'check availability time',
                source: 'body',
                match: normalizeAcuityMutationMatch(expectation.match),
                reply: expectation.reply || {valid: true},
                status: expectation.status,
            }));
        },
    },
    forms: {
        list: expectation => {
            harness.mockRoute({method: 'GET', path: '/api/v1/forms'}, makeAcuityHandler({
                label: 'list forms',
                source: 'query',
                match: {appointmentTypeID: expectation.appointmentTypeId},
                reply: expectation.reply || [],
                status: expectation.status,
            }));
        },
    },
    resources: {
        calendarUsage: usage => {
            const appointments = deriveAppointmentsFromCalendarUsage(usage);
            harness.mockRoute({method: 'GET', path: '/api/v1/appointments'}, makeAcuityHandler({
                label: 'list appointments from calendar usage',
                source: 'query',
                match: {email: usage.email},
                reply: appointments,
            }));
            return appointments;
        },
    },
});

const makeAcuityHandler = (input: {
    label: string;
    source: 'query' | 'body';
    match?: Record<string, MaybeMatcher<AcuityScalar> | undefined>;
    reply: unknown;
    status?: number;
}): FullCircleHandler => request => {
    const values = input.source === 'query'
        ? valuesFromQuery(request.query)
        : valuesFromBody(request.body);
    const mismatches = collectMismatches(values, input.match);

    if (mismatches.length) {
        return response.json({
            error: `Acuity ${input.label} request did not match expectations`,
            mismatches,
        }, {status: 422});
    }

    return response.json(input.reply, {status: input.status || 200});
};

const normalizeAcuityMutationMatch = (
    match: AcuityMutationExpectation['match'],
): Record<string, MaybeMatcher<AcuityScalar> | undefined> | undefined => {
    if (!match) {
        return undefined;
    }

    return {
        calendarID: match.calendarId,
        appointmentTypeID: match.appointmentTypeId,
        email: match.email,
        datetime: match.datetime,
        firstName: match.firstName,
        lastName: match.lastName,
    };
};

const valuesFromQuery = (query: URLSearchParams): AcuityValues => {
    const values: AcuityValues = {};
    for (const [key, value] of query.entries()) {
        values[key] = parseScalar(value);
    }
    return values;
};

const valuesFromBody = (body: FullCircleBody): AcuityValues => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object') {
        return Object.fromEntries(
            Object.entries(body.value as Record<string, unknown>)
                .map(([key, value]) => [key, parseUnknownScalar(value)]),
        );
    }

    if (body.kind === 'form') {
        return Object.fromEntries(
            Object.entries(body.value).map(([key, value]) => [
                key,
                parseScalar(Array.isArray(value) ? value[0] : value),
            ]),
        );
    }

    return {};
};

const parseUnknownScalar = (value: unknown): string | number | boolean | undefined => {
    if (typeof value === 'string') {
        return parseScalar(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    return undefined;
};

const parseScalar = (value: string | undefined): string | number | boolean | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return Number(value);
    }

    if (value === 'true') {
        return true;
    }

    if (value === 'false') {
        return false;
    }

    return value;
};

const collectMismatches = (
    values: AcuityValues,
    match: Record<string, MaybeMatcher<AcuityScalar> | undefined> | undefined,
): string[] => {
    const mismatches: string[] = [];
    for (const [field, matcher] of Object.entries(match || {})) {
        assertMatch(mismatches, field, values[field], matcher);
    }
    return mismatches;
};

const assertMatch = <T extends AcuityScalar>(
    mismatches: string[],
    field: string,
    actual: T | undefined,
    matcher: MaybeMatcher<T> | undefined,
) => {
    if (matcher === undefined) {
        return;
    }

    const matched = typeof matcher === 'function'
        ? matcher(actual)
        : matcher instanceof RegExp
            ? typeof actual === 'string' && matcher.test(actual)
        : actual === matcher;

    if (!matched) {
        mismatches.push(`Expected ${field} to match ${String(matcher)} but received ${String(actual)}`);
    }
};

const deriveAppointmentsFromCalendarUsage = (usage: AcuityCalendarUsage): AcuityFixture[] => {
    return usage.calendars.flatMap(calendar => calendar.appointments.map((appointment, index) => ({
        id: appointment.id || (calendar.calendarId * 1000) + index + 1,
        email: usage.email,
        calendarID: calendar.calendarId,
        appointmentTypeID: appointment.appointmentTypeId,
        duration: appointment.durationMinutes,
        datetime: appointment.datetime,
        date: appointment.date || appointment.datetime?.slice(0, 10),
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        notes: appointment.notes,
        canceled: false,
    })));
};
