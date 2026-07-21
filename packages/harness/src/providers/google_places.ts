import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type GooglePlacesScalar = string | number | boolean;
type MaybeMatcher<T extends GooglePlacesScalar> = T | RegExp | ((actual: T | undefined) => boolean);
type GooglePlacesObject = Record<string, unknown>;

export type GooglePlacesErrorFixture = {
    error: {
        code?: number;
        status?: string;
        message: string;
        [key: string]: unknown;
    };
};

export type GooglePlacesSearchTextExpectation = {
    match?: {
        textQuery?: MaybeMatcher<string>;
        includedType?: MaybeMatcher<string>;
        fieldMask?: MaybeMatcher<string>;
    };
    reply?: GooglePlacesObject[];
    status?: number;
    error?: GooglePlacesErrorFixture;
};

export type GooglePlacesDetailsExpectation = {
    match?: {
        name?: MaybeMatcher<string>;
        fieldMask?: MaybeMatcher<string>;
    };
    reply?: GooglePlacesObject;
    status?: number;
    error?: GooglePlacesErrorFixture;
};

export type GoogleMapsJavaScriptExpectation = {
    body?: string;
    status?: number;
};

export type GooglePlacesProviderHarness = {
    searchText: (expectation: GooglePlacesSearchTextExpectation) => void;
    details: (expectation: GooglePlacesDetailsExpectation) => void;
    mapsJavaScript: (expectation?: GoogleMapsJavaScriptExpectation) => void;
};

export const googlePlacesProvider = (harness: TestHarness): GooglePlacesProviderHarness => ({
    searchText: expectation => {
        harness.mockRoute({method: 'POST', path: '/v1/places:searchText'}, makeSearchTextHandler(expectation), {
            name: 'Google Places Text Search',
        });
    },
    details: expectation => {
        harness.mockRoute({method: 'GET', path: /^\/v1\/places\/.+/}, makeDetailsHandler(expectation), {
            name: 'Google Places Details',
        });
    },
    mapsJavaScript: (expectation = {}) => {
        harness.mockRoute({method: 'GET', path: '/maps/api/js'}, () => response.text(
            expectation.body || 'window.google=window.google||{maps:{}};',
            {
                status: expectation.status || 200,
                headers: {'content-type': 'application/javascript; charset=utf-8'},
            },
        ), {name: 'Google Maps JavaScript API'});
    },
});

const makeSearchTextHandler = (expectation: GooglePlacesSearchTextExpectation): FullCircleHandler => request => {
    const body = jsonBody(request.body);
    const mismatches: string[] = [];

    assertMatch(mismatches, 'textQuery', scalarString(body.textQuery), expectation.match?.textQuery);
    assertMatch(mismatches, 'includedType', scalarString(body.includedType), expectation.match?.includedType);
    assertMatch(mismatches, 'fieldMask', fieldMask(request.headers), expectation.match?.fieldMask);

    if (mismatches.length) {
        return response.json({
            error: 'Google Places Text Search request did not match expectations',
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json(expectation.error, {status: expectation.status || expectation.error.error.code || 500});
    }

    return response.json({places: expectation.reply || []}, {status: expectation.status || 200});
};

const makeDetailsHandler = (expectation: GooglePlacesDetailsExpectation): FullCircleHandler => request => {
    const mismatches: string[] = [];
    const actualName = decodeURIComponent(request.path.replace(/^\/v1\//, ''));

    assertMatch(mismatches, 'name', actualName, expectation.match?.name);
    assertMatch(mismatches, 'fieldMask', fieldMask(request.headers), expectation.match?.fieldMask);

    if (mismatches.length) {
        return response.json({
            error: 'Google Places Details request did not match expectations',
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json(expectation.error, {status: expectation.status || expectation.error.error.code || 500});
    }

    return response.json(expectation.reply || {name: actualName}, {status: expectation.status || 200});
};

const jsonBody = (body: FullCircleBody): Record<string, unknown> => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        return body.value as Record<string, unknown>;
    }
    return {};
};

const fieldMask = (headers: Headers): string | undefined => headers.get('x-goog-fieldmask')
    || headers.get('X-Goog-FieldMask')
    || undefined;

const assertMatch = <T extends GooglePlacesScalar>(
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

const scalarString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
