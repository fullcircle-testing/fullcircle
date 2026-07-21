import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type AttioScalar = string | number | boolean;
type MaybeMatcher<T extends AttioScalar> = T | RegExp | ((actual: AttioScalar | undefined) => boolean);
type AttioObject = Record<string, unknown>;

export type AttioErrorFixture = {
    type?: string;
    code?: string;
    message: string;
    [key: string]: unknown;
};

export type AttioPeopleQueryByEmailExpectation = {
    email: MaybeMatcher<string>;
    reply?: AttioObject[];
    status?: number;
    error?: AttioErrorFixture;
};

export type AttioPeopleUpsertByEmailExpectation = {
    email: MaybeMatcher<string>;
    reply?: AttioObject;
    status?: number;
    error?: AttioErrorFixture;
};

export type AttioRecordsSearchExpectation = {
    match?: {query?: MaybeMatcher<string>};
    reply?: AttioObject[];
    status?: number;
    error?: AttioErrorFixture;
};

export type AttioProviderHarness = {
    people: {
        queryByEmail: (expectation: AttioPeopleQueryByEmailExpectation) => void;
        upsertByEmail: (expectation: AttioPeopleUpsertByEmailExpectation) => void;
    };
    records: {
        search: (expectation: AttioRecordsSearchExpectation) => void;
    };
};

export const attioProvider = (harness: TestHarness): AttioProviderHarness => ({
    people: {
        queryByEmail: expectation => {
            harness.mockRoute({method: 'POST', path: '/v2/objects/people/records/query'}, makeQueryByEmailHandler(expectation), {
                name: 'Attio query person by email',
            });
        },
        upsertByEmail: expectation => {
            harness.mockRoute({
                method: 'PUT',
                path: '/v2/objects/people/records',
                query: {matching_attribute: 'email_addresses'},
            }, makeUpsertByEmailHandler(expectation), {name: 'Attio upsert person by email'});
        },
    },
    records: {
        search: expectation => {
            harness.mockRoute({method: 'POST', path: '/v2/objects/records/search'}, makeRecordsSearchHandler(expectation), {
                name: 'Attio records search',
            });
        },
    },
});

const makeQueryByEmailHandler = (expectation: AttioPeopleQueryByEmailExpectation): FullCircleHandler => request => {
    const body = jsonBody(request.body);
    const email = findEmailInUnknown(body.filter);
    const mismatches: string[] = [];
    assertMatch(mismatches, 'email', email, expectation.email);

    if (mismatches.length) {
        return response.json({
            error: 'Attio query person by email request did not match expectations',
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json(expectation.error, {status: expectation.status || 500});
    }

    return response.json({data: expectation.reply || []}, {status: expectation.status || 200});
};

const makeUpsertByEmailHandler = (expectation: AttioPeopleUpsertByEmailExpectation): FullCircleHandler => request => {
    const body = jsonBody(request.body);
    const email = findEmailInUnknown(body.data);
    const mismatches: string[] = [];
    assertMatch(mismatches, 'email', email, expectation.email);

    if (mismatches.length) {
        return response.json({
            error: 'Attio upsert person by email request did not match expectations',
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json(expectation.error, {status: expectation.status || 500});
    }

    return response.json({
        data: expectation.reply || {
            id: {record_id: 'attio_person_fullcircle_123'},
            values: {email_addresses: [{email_address: email}]},
        },
    }, {status: expectation.status || 200});
};

const makeRecordsSearchHandler = (expectation: AttioRecordsSearchExpectation): FullCircleHandler => request => {
    const body = jsonBody(request.body);
    const mismatches: string[] = [];
    assertMatch(mismatches, 'query', scalar(body.query), expectation.match?.query);

    if (mismatches.length) {
        return response.json({
            error: 'Attio records search request did not match expectations',
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json(expectation.error, {status: expectation.status || 500});
    }

    return response.json({data: expectation.reply || []}, {status: expectation.status || 200});
};

const jsonBody = (body: FullCircleBody): Record<string, unknown> => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        return body.value as Record<string, unknown>;
    }
    return {};
};

const findEmailInUnknown = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.includes('@')) {
        return value;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findEmailInUnknown(item);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            if ((key === 'email_address' || key === 'email' || key === '$eq' || key === '$contains') && typeof item === 'string') {
                return item;
            }
            const found = findEmailInUnknown(item);
            if (found) {
                return found;
            }
        }
    }

    return undefined;
};

const assertMatch = <T extends AttioScalar>(
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

const scalar = (value: unknown): AttioScalar | undefined => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return undefined;
};
