import type {TestHarness} from '../harness';
import type {FullCircleBody, FullCircleHandler} from '../primitives';
import {response} from '../primitives';

type HetznerScalar = string | number | boolean;
type MaybeMatcher<T extends HetznerScalar> = T | RegExp | ((actual: HetznerScalar | undefined) => boolean);
type HetznerValues = Record<string, HetznerScalar | undefined>;
type HetznerObject = Record<string, unknown>;

export type HetznerActionStatus = 'running' | 'success' | 'error';

export type HetznerActionFixture = {
    id?: number;
    command?: string;
    status?: HetznerActionStatus;
    progress?: number;
    started?: string;
    finished?: string | null;
    error?: {code: string; message: string} | null;
    resources?: Array<{id: number; type: string}>;
};

export type HetznerErrorFixture = {
    code: string;
    message: string;
    details?: unknown;
};

export type HetznerServerCreateExpectation = {
    match?: {
        name?: MaybeMatcher<string>;
        serverType?: MaybeMatcher<string>;
        image?: MaybeMatcher<string>;
        location?: MaybeMatcher<string>;
        startAfterCreate?: MaybeMatcher<boolean>;
    };
    reply?: HetznerObject & {id?: number; name?: string; ipv4?: string};
    replyAction?: HetznerActionFixture;
    status?: number;
    error?: HetznerErrorFixture;
};

export type HetznerDeleteExpectation = {
    serverId: string | number;
    replyAction?: HetznerActionFixture;
    status?: number;
    error?: HetznerErrorFixture;
};

export type HetznerVolumeCreateExpectation = {
    match?: {
        name?: MaybeMatcher<string>;
        size?: MaybeMatcher<number>;
        location?: MaybeMatcher<string>;
        server?: MaybeMatcher<number>;
        automount?: MaybeMatcher<boolean>;
        format?: MaybeMatcher<string>;
    };
    reply?: HetznerObject & {id?: number; name?: string; size?: number};
    replyAction?: HetznerActionFixture;
    status?: number;
    error?: HetznerErrorFixture;
};

export type HetznerVolumeActionExpectation = {
    volumeId: string | number;
    match?: {
        server?: MaybeMatcher<number>;
        automount?: MaybeMatcher<boolean>;
    };
    replyAction?: HetznerActionFixture;
    status?: number;
    error?: HetznerErrorFixture;
};

export type HetznerVolumeDeleteExpectation = {
    volumeId: string | number;
    status?: number;
    reply?: unknown;
    error?: HetznerErrorFixture;
};

export type HetznerActionGetExpectation = {
    actionId: string | number;
    reply?: HetznerActionFixture;
    status?: number;
    error?: HetznerErrorFixture;
};

export type HetznerProviderHarness = {
    servers: {
        create: (expectation: HetznerServerCreateExpectation) => void;
        delete: (expectation: HetznerDeleteExpectation) => void;
    };
    volumes: {
        create: (expectation: HetznerVolumeCreateExpectation) => void;
        attach: (expectation: HetznerVolumeActionExpectation) => void;
        detach: (expectation: HetznerVolumeActionExpectation) => void;
        delete: (expectation: HetznerVolumeDeleteExpectation) => void;
    };
    actions: {
        get: (expectation: HetznerActionGetExpectation) => void;
    };
};

export const hetznerProvider = (harness: TestHarness): HetznerProviderHarness => ({
    servers: {
        create: expectation => {
            harness.mockRoute({method: 'POST', path: '/v1/servers'}, makeHetznerHandler({
                label: 'create server',
                match: normalizeServerCreateMatch(expectation.match),
                status: expectation.status ?? (expectation.error ? 500 : 201),
                error: expectation.error,
                body: values => ({
                    server: buildServerFixture(values, expectation.reply),
                    action: buildActionFixture('create_server', expectation.replyAction, expectation.reply?.id || 1001, 'server'),
                    next_actions: [],
                    root_password: null,
                }),
            }), {name: 'Hetzner create server'});
        },
        delete: expectation => {
            harness.mockRoute({method: 'DELETE', path: `/v1/servers/${expectation.serverId}`}, makeStaticHetznerHandler({
                status: expectation.status ?? (expectation.error ? 500 : 200),
                error: expectation.error,
                body: {action: buildActionFixture('delete_server', expectation.replyAction, Number(expectation.serverId), 'server')},
            }), {name: `Hetzner delete server ${expectation.serverId}`});
        },
    },
    volumes: {
        create: expectation => {
            harness.mockRoute({method: 'POST', path: '/v1/volumes'}, makeHetznerHandler({
                label: 'create volume',
                match: normalizeVolumeCreateMatch(expectation.match),
                status: expectation.status ?? (expectation.error ? 500 : 201),
                error: expectation.error,
                body: values => ({
                    volume: buildVolumeFixture(values, expectation.reply),
                    action: buildActionFixture('create_volume', expectation.replyAction, expectation.reply?.id || 2001, 'volume'),
                }),
            }), {name: 'Hetzner create volume'});
        },
        attach: expectation => {
            harness.mockRoute({method: 'POST', path: `/v1/volumes/${expectation.volumeId}/actions/attach`}, makeHetznerHandler({
                label: 'attach volume',
                match: normalizeVolumeActionMatch(expectation.match),
                status: expectation.status ?? (expectation.error ? 500 : 201),
                error: expectation.error,
                body: () => ({
                    action: buildActionFixture('attach_volume', expectation.replyAction, Number(expectation.volumeId), 'volume'),
                }),
            }), {name: `Hetzner attach volume ${expectation.volumeId}`});
        },
        detach: expectation => {
            harness.mockRoute({method: 'POST', path: `/v1/volumes/${expectation.volumeId}/actions/detach`}, makeHetznerHandler({
                label: 'detach volume',
                match: normalizeVolumeActionMatch(expectation.match),
                status: expectation.status ?? (expectation.error ? 500 : 201),
                error: expectation.error,
                body: () => ({
                    action: buildActionFixture('detach_volume', expectation.replyAction, Number(expectation.volumeId), 'volume'),
                }),
            }), {name: `Hetzner detach volume ${expectation.volumeId}`});
        },
        delete: expectation => {
            harness.mockRoute({method: 'DELETE', path: `/v1/volumes/${expectation.volumeId}`}, makeStaticHetznerHandler({
                status: expectation.status ?? (expectation.error ? 500 : 204),
                error: expectation.error,
                body: expectation.reply,
            }), {name: `Hetzner delete volume ${expectation.volumeId}`});
        },
    },
    actions: {
        get: expectation => {
            harness.mockRoute({method: 'GET', path: `/v1/actions/${expectation.actionId}`}, makeStaticHetznerHandler({
                status: expectation.status ?? (expectation.error ? 500 : 200),
                error: expectation.error,
                body: {action: buildActionFixture('poll_action', expectation.reply, Number(expectation.actionId), 'action')},
            }), {name: `Hetzner get action ${expectation.actionId}`});
        },
    },
});

const makeHetznerHandler = (input: {
    label: string;
    match?: Record<string, MaybeMatcher<HetznerScalar> | undefined>;
    status: number;
    error?: HetznerErrorFixture;
    body: (values: HetznerValues) => unknown;
}): FullCircleHandler => request => {
    const values = valuesFromBody(request.body);
    const mismatches = collectMismatches(values, input.match);

    if (mismatches.length) {
        return response.json({
            error: `Hetzner ${input.label} request did not match expectations`,
            mismatches,
        }, {status: 422});
    }

    if (input.error) {
        return response.json({error: input.error}, {status: input.status});
    }

    return response.json(input.body(values), {status: input.status});
};

const makeStaticHetznerHandler = (input: {
    status: number;
    error?: HetznerErrorFixture;
    body?: unknown;
}): FullCircleHandler => () => {
    if (input.error) {
        return response.json({error: input.error}, {status: input.status});
    }

    if (input.status === 204 && input.body === undefined) {
        return response.status(204);
    }

    return response.json(input.body ?? {}, {status: input.status});
};

const normalizeServerCreateMatch = (
    match: HetznerServerCreateExpectation['match'],
): Record<string, MaybeMatcher<HetznerScalar> | undefined> | undefined => match && ({
    name: match.name,
    server_type: match.serverType,
    image: match.image,
    location: match.location,
    start_after_create: match.startAfterCreate,
});

const normalizeVolumeCreateMatch = (
    match: HetznerVolumeCreateExpectation['match'],
): Record<string, MaybeMatcher<HetznerScalar> | undefined> | undefined => match && ({
    name: match.name,
    size: match.size,
    location: match.location,
    server: match.server,
    automount: match.automount,
    format: match.format,
});

const normalizeVolumeActionMatch = (
    match: HetznerVolumeActionExpectation['match'],
): Record<string, MaybeMatcher<HetznerScalar> | undefined> | undefined => match && ({
    server: match.server,
    automount: match.automount,
});

const buildServerFixture = (
    values: HetznerValues,
    reply: HetznerServerCreateExpectation['reply'] = {},
): HetznerObject => {
    const id = reply.id ?? 1001;
    const ipv4 = reply.ipv4 ?? '203.0.113.10';
    return {
        id,
        name: values.name ?? reply.name ?? `server-${id}`,
        status: 'running',
        created: '2026-06-15T00:00:00+00:00',
        server_type: {name: values.server_type ?? 'cpx21'},
        image: {name: values.image ?? 'snapshot-fullcircle'},
        datacenter: {location: {name: values.location ?? 'nbg1'}},
        public_net: {
            ipv4: {ip: ipv4, blocked: false, dns_ptr: `${id}.fullcircle.test`},
            ipv6: null,
            floating_ips: [],
            ...(typeof reply.public_net === 'object' && reply.public_net ? reply.public_net : {}),
        },
        private_net: [],
        labels: {},
        ...Object.fromEntries(Object.entries(reply).filter(([key]) => key !== 'public_net')),
    };
};

const buildVolumeFixture = (
    values: HetznerValues,
    reply: HetznerVolumeCreateExpectation['reply'] = {},
): HetznerObject => ({
    id: reply.id ?? 2001,
    name: values.name ?? reply.name ?? 'volume-fullcircle',
    size: values.size ?? reply.size ?? 10,
    linux_device: '/dev/disk/by-id/scsi-0HC_Volume_fullcircle',
    location: {name: values.location ?? 'nbg1'},
    protection: {delete: false},
    labels: {},
    status: 'available',
    created: '2026-06-15T00:00:00+00:00',
    ...reply,
});

const buildActionFixture = (
    command: string,
    reply: HetznerActionFixture = {},
    resourceId: number,
    resourceType: string,
): HetznerActionFixture => ({
    id: reply.id ?? 3001,
    command,
    status: 'success',
    progress: 100,
    started: '2026-06-15T00:00:00+00:00',
    finished: '2026-06-15T00:00:01+00:00',
    resources: [{id: resourceId, type: resourceType}],
    error: null,
    ...reply,
});

const valuesFromBody = (body: FullCircleBody): HetznerValues => {
    if (body.kind === 'json' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
        return Object.fromEntries(Object.entries(body.value as Record<string, unknown>).map(([key, value]) => [
            key,
            parseScalar(value),
        ]));
    }

    if (body.kind === 'form') {
        return Object.fromEntries(Object.entries(body.value).map(([key, value]) => [
            key,
            parseScalar(Array.isArray(value) ? value[0] : value),
        ]));
    }

    return {};
};

const parseScalar = (value: unknown): HetznerScalar | undefined => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    return undefined;
};

const collectMismatches = (
    values: HetznerValues,
    match: Record<string, MaybeMatcher<HetznerScalar> | undefined> | undefined,
): string[] => {
    const mismatches: string[] = [];
    for (const [field, matcher] of Object.entries(match || {})) {
        assertMatch(mismatches, field, values[field], matcher);
    }
    return mismatches;
};

const assertMatch = <T extends HetznerScalar>(
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
