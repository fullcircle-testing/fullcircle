import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type HubSpotScalar = string | number | boolean;
type MaybeMatcher<T extends HubSpotScalar> = T | RegExp | ((actual: HubSpotScalar | undefined) => boolean);
type HubSpotPropertiesMatcher = Record<string, MaybeMatcher<HubSpotScalar>>;
type HubSpotObject = Record<string, unknown>;

export type HubSpotErrorFixture = {
    status: string;
    message: string;
    category?: string;
    [key: string]: unknown;
};

export type HubSpotContactSearchExpectation = {
    email: MaybeMatcher<string>;
    reply?: HubSpotObject[];
    status?: number;
    error?: HubSpotErrorFixture;
};

export type HubSpotContactMutationExpectation = {
    match?: HubSpotPropertiesMatcher;
    reply?: HubSpotObject;
    status?: number;
    error?: HubSpotErrorFixture;
};

export type HubSpotContactUpdateExpectation = HubSpotContactMutationExpectation & {
    contactId: string;
};

export type HubSpotProviderHarness = {
    contacts: {
        searchByEmail: (expectation: HubSpotContactSearchExpectation) => void;
        create: (expectation: HubSpotContactMutationExpectation) => void;
        update: (expectation: HubSpotContactUpdateExpectation) => void;
    };
};

export type HubSpotFormsSinkOptions = {
    portalId?: string;
    formId?: string;
    scriptPath?: string;
    status?: number;
};

export type HubSpotFormsSinkHarness = {
    formsEmbedScript: (options?: HubSpotFormsSinkOptions) => void;
};

export const hubspotProvider = (harness: TestHarness): HubSpotProviderHarness => ({
    contacts: {
        searchByEmail: expectation => {
            harness.mockRoute({method: 'POST', path: '/crm/v3/objects/contacts/search'}, makeContactSearchHandler(expectation), {
                name: 'HubSpot contact search by email',
            });
        },
        create: expectation => {
            harness.mockRoute({method: 'POST', path: '/crm/v3/objects/contacts'}, makeContactMutationHandler('create', expectation, 201), {
                name: 'HubSpot contact create',
            });
        },
        update: expectation => {
            harness.mockRoute({method: 'PATCH', path: `/crm/v3/objects/contacts/${expectation.contactId}`}, makeContactMutationHandler('update', expectation, 200), {
                name: `HubSpot contact update ${expectation.contactId}`,
            });
        },
    },
});

export const hubspotFormsSink = (harness: TestHarness): HubSpotFormsSinkHarness => ({
    formsEmbedScript: (options = {}) => {
        const scriptPath = options.scriptPath || '/forms/embed/v2.js';
        harness.mockRoute({method: 'GET', path: scriptPath}, () => response.text(formsSinkScript(options), {
            status: options.status || 200,
            headers: {'content-type': 'application/javascript; charset=utf-8'},
        }), {name: `HubSpot forms script sink ${scriptPath}`});
    },
});

const makeContactSearchHandler = (expectation: HubSpotContactSearchExpectation): FullCircleHandler => request => {
    const body = jsonBody(request.body);
    const email = findEmailFilter(body);
    const mismatches: string[] = [];
    assertMatch(mismatches, 'filters.email', email, expectation.email);

    if (mismatches.length) {
        return response.json({
            error: 'HubSpot contact search request did not match expectations',
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json(expectation.error, {status: expectation.status || 500});
    }

    const results = expectation.reply || [];
    return response.json({total: results.length, results}, {status: expectation.status || 200});
};

const makeContactMutationHandler = (
    operation: 'create' | 'update',
    expectation: HubSpotContactMutationExpectation,
    defaultStatus: number,
): FullCircleHandler => request => {
    const properties = contactProperties(jsonBody(request.body));
    const mismatches = collectPropertyMismatches(properties, expectation.match);

    if (mismatches.length) {
        return response.json({
            error: `HubSpot contact ${operation} request did not match expectations`,
            mismatches,
        }, {status: 422});
    }

    if (expectation.error) {
        return response.json(expectation.error, {status: expectation.status || 500});
    }

    return response.json(expectation.reply || {
        id: 'hs_contact_fullcircle_123',
        properties,
    }, {status: expectation.status || defaultStatus});
};

const jsonBody = (body: FullCircleBody): Record<string, unknown> => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        return body.value as Record<string, unknown>;
    }
    return {};
};

const contactProperties = (body: Record<string, unknown>): Record<string, unknown> => {
    const properties = body.properties;
    return properties && typeof properties === 'object' && !Array.isArray(properties)
        ? properties as Record<string, unknown>
        : {};
};

const findEmailFilter = (body: Record<string, unknown>): string | undefined => {
    const filterGroups = Array.isArray(body.filterGroups) ? body.filterGroups : [];
    for (const group of filterGroups) {
        if (!group || typeof group !== 'object') {
            continue;
        }
        const filters = Array.isArray((group as {filters?: unknown}).filters)
            ? (group as {filters: unknown[]}).filters
            : [];
        for (const filter of filters) {
            if (!filter || typeof filter !== 'object') {
                continue;
            }
            const candidate = filter as {propertyName?: unknown; value?: unknown};
            if (candidate.propertyName === 'email' && typeof candidate.value === 'string') {
                return candidate.value;
            }
        }
    }
    return undefined;
};

const collectPropertyMismatches = (
    properties: Record<string, unknown>,
    match: HubSpotPropertiesMatcher | undefined,
): string[] => {
    const mismatches: string[] = [];
    for (const [field, matcher] of Object.entries(match || {})) {
        assertMatch(mismatches, `properties.${field}`, scalar(properties[field]), matcher);
    }
    return mismatches;
};

const assertMatch = <T extends HubSpotScalar>(
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

const scalar = (value: unknown): HubSpotScalar | undefined => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return undefined;
};

const formsSinkScript = (options: HubSpotFormsSinkOptions): string => {
    const portalId = JSON.stringify(options.portalId || 'fullcircle-portal');
    const formId = JSON.stringify(options.formId || 'fullcircle-form');
    return `
(function () {
  window.__fullcircleHubSpotForms = window.__fullcircleHubSpotForms || [];
  window.hbspt = window.hbspt || {};
  window.hbspt.forms = window.hbspt.forms || {};
  window.hbspt.forms.create = function (config) {
    var merged = Object.assign({ portalId:${portalId}, formId:${formId} }, config || {});
    window.__fullcircleHubSpotForms.push(merged);
    var marker = document.createElement('div');
    marker.setAttribute('data-fullcircle-hubspot-form', 'true');
    marker.setAttribute('data-portal-id', merged.portalId || '');
    marker.setAttribute('data-form-id', merged.formId || '');
    if (merged.target) {
      var target = document.querySelector(merged.target);
      if (target) target.appendChild(marker);
    }
    return marker;
  };
})();
`;
};
