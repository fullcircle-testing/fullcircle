import type {FullCircleBody, FullCircleRequest, FullCircleRouteMatcher} from './primitives';

export const matchesRoute = (
    matcher: FullCircleRouteMatcher,
    request: FullCircleRequest,
): boolean => {
    if (typeof matcher === 'string') {
        return matcher === request.url || matcher === request.path;
    }

    if (matcher.method && matcher.method.toUpperCase() !== request.method.toUpperCase()) {
        return false;
    }

    if (!matchesStringOrRegex(matcher.path, request.path)) {
        return false;
    }

    if (matcher.query && !matchesKeyValueMatchers(matcher.query, request.query, matcher.strict)) {
        return false;
    }

    if (matcher.headers && !matchesHeaderMatchers(matcher.headers, request.headers)) {
        return false;
    }

    if (matcher.body && !matchesBodyMatcher(matcher.body, request.body, matcher.strict)) {
        return false;
    }

    return true;
};

export const routeMatcherToString = (matcher: FullCircleRouteMatcher): string => {
    if (typeof matcher === 'string') {
        return matcher;
    }

    const method = matcher.method ? `${matcher.method.toUpperCase()} ` : '';
    const path = matcher.path instanceof RegExp ? matcher.path.toString() : matcher.path;
    return `${method}${path}`;
};

const matchesStringOrRegex = (matcher: string | RegExp, value: string): boolean => {
    if (matcher instanceof RegExp) {
        return matcher.test(value);
    }

    return matcher === value;
};

const matchesKeyValueMatchers = (
    matchers: Record<string, string | RegExp>,
    actual: URLSearchParams,
    strict = false,
): boolean => {
    for (const [key, matcher] of Object.entries(matchers)) {
        const value = actual.get(key);
        if (value === null || !matchesStringOrRegex(matcher, value)) {
            return false;
        }
    }

    if (!strict) {
        return true;
    }

    const actualEntries = [...actual.entries()];
    return actualEntries.length === Object.keys(matchers).length
        && actualEntries.every(([key]) => key in matchers);
};

const matchesHeaderMatchers = (
    matchers: Record<string, string | RegExp>,
    actual: Headers,
): boolean => {
    for (const [key, matcher] of Object.entries(matchers)) {
        const value = actual.get(key);
        if (value === null || !matchesStringOrRegex(matcher, value)) {
            return false;
        }
    }

    return true;
};

const matchesBodyMatcher = (
    matcher: Record<string, unknown> | ((body: FullCircleBody) => boolean),
    body: FullCircleBody,
    strict = false,
): boolean => {
    if (typeof matcher === 'function') {
        return matcher(body);
    }

    const actual = bodyToRecord(body);
    if (!actual) {
        return false;
    }

    for (const [key, expected] of Object.entries(matcher)) {
        if (actual[key] !== expected) {
            return false;
        }
    }

    if (!strict) {
        return true;
    }

    return Object.keys(actual).every(key => key in matcher);
};

const bodyToRecord = (body: FullCircleBody): Record<string, unknown> | undefined => {
    if (body.kind === 'json' && isRecord(body.value)) {
        return body.value;
    }

    if (body.kind === 'form') {
        return body.value;
    }

    return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};
