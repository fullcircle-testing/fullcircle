import type express from 'express';

import type {
    FullCircleBody,
    FullCircleHandler,
    FullCircleRequest,
    FullCircleResponse,
} from './primitives';

export const toFullCircleRequest = (
    req: express.Request,
    destination: string,
): FullCircleRequest => {
    const absoluteUrl = new URL(req.originalUrl, 'http://fullcircle.local');

    return {
        method: req.method,
        url: req.originalUrl,
        path: req.path,
        query: absoluteUrl.searchParams,
        headers: toHeaders(req.headers),
        body: toFullCircleBody(req),
        destination,
    };
};

export const fullCircleHandlerToExpress = (
    handler: FullCircleHandler,
    destination: string,
): express.Handler => async (req, res, next) => {
    try {
        const fcResponse = await handler(toFullCircleRequest(req, destination));
        sendFullCircleResponse(res, fcResponse);
    } catch (error) {
        next(error);
    }
};

export const sendFullCircleResponse = (
    res: express.Response,
    fcResponse: FullCircleResponse,
) => {
    res.status(fcResponse.status ?? 200);

    for (const [key, value] of Object.entries(fcResponse.headers || {})) {
        res.setHeader(key, value);
    }

    if (fcResponse.body === undefined) {
        res.end();
        return;
    }

    if (fcResponse.body instanceof Uint8Array) {
        res.send(Buffer.from(fcResponse.body));
        return;
    }

    if (typeof fcResponse.body === 'string') {
        res.send(fcResponse.body);
        return;
    }

    res.json(fcResponse.body);
};

const toHeaders = (headers: express.Request['headers']): Headers => {
    const result = new Headers();
    for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
            for (const entry of value) {
                result.append(key, entry);
            }
            continue;
        }

        if (value !== undefined) {
            result.set(key, value);
        }
    }

    return result;
};

const toFullCircleBody = (req: express.Request): FullCircleBody => {
    if (req.body === undefined || req.body === null || req.body === '') {
        return {kind: 'empty'};
    }

    const contentType = req.header('content-type') || '';

    if (Buffer.isBuffer(req.body)) {
        return {kind: 'bytes', value: new Uint8Array(req.body)};
    }

    if (typeof req.body === 'string') {
        return {kind: 'text', value: req.body};
    }

    if (contentType.includes('application/x-www-form-urlencoded') && isStringRecord(req.body)) {
        return {kind: 'form', value: req.body};
    }

    return {kind: 'json', value: req.body};
};

const isStringRecord = (value: unknown): value is Record<string, string | string[]> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).every(item => typeof item === 'string' || (
        Array.isArray(item) && item.every(entry => typeof entry === 'string')
    ));
};
