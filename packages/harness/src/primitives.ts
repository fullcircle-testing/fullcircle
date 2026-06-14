export type FullCircleBody =
    | {kind: 'empty'}
    | {kind: 'json'; value: unknown}
    | {kind: 'form'; value: Record<string, string | string[]>}
    | {kind: 'text'; value: string}
    | {kind: 'bytes'; value: Uint8Array};

export type FullCircleRequest = {
    method: string;
    url: string;
    path: string;
    query: URLSearchParams;
    headers: Headers;
    body: FullCircleBody;
    destination: string;
};

export type FullCircleResponse = {
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
};

export type FullCircleHandler = (
    request: FullCircleRequest,
) => FullCircleResponse | Promise<FullCircleResponse>;

export type FullCircleResponseInit = {
    status?: number;
    headers?: Record<string, string>;
};

export const response = {
    json: (body: unknown, init: FullCircleResponseInit = {}): FullCircleResponse => ({
        status: init.status ?? 200,
        headers: {
            'content-type': 'application/json',
            ...init.headers,
        },
        body,
    }),
    text: (body: string, init: FullCircleResponseInit = {}): FullCircleResponse => ({
        status: init.status ?? 200,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            ...init.headers,
        },
        body,
    }),
    status: (status: number, body?: unknown, headers?: Record<string, string>): FullCircleResponse => ({
        status,
        headers,
        body,
    }),
};
