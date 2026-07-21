import {IncomingMessage, ServerResponse} from 'http';
import {parse as parseQueryString} from 'querystring';

export type RecorderRequest = IncomingMessage & {
    originalUrl: string;
    path: string;
    body: unknown;
    rawBody: Buffer;
    ip?: string;
};

export type RecorderResponse = ServerResponse & {
    status: (code: number) => RecorderResponse;
    json: (body: unknown) => void;
    send: (body?: unknown) => void;
    type: (contentType: string) => RecorderResponse;
};

export type RecorderHandler = (req: RecorderRequest, res: RecorderResponse) => void | Promise<void>;

export const createHttpApp = (handler: RecorderHandler) => async (req: IncomingMessage, res: ServerResponse) => {
    const recorderReq = await decorateRequest(req);
    const recorderRes = decorateResponse(res);
    try {
        await handler(recorderReq, recorderRes);
    } catch (error) {
        if (!recorderRes.writableEnded) {
            recorderRes.status(500).json({error: error instanceof Error ? error.message : String(error)});
        }
    }
};

const decorateRequest = async (req: IncomingMessage): Promise<RecorderRequest> => {
    const originalUrl = req.url || '/';
    const parsedUrl = new URL(originalUrl, 'http://fullcircle.local');
    const rawBody = await readBody(req);
    return Object.assign(req, {
        originalUrl,
        path: parsedUrl.pathname,
        rawBody,
        body: parseBody(rawBody, header(req, 'content-type') || ''),
        ip: req.socket.remoteAddress,
    });
};

const decorateResponse = (res: ServerResponse): RecorderResponse => {
    const recorderRes = res as RecorderResponse;
    recorderRes.status = (code: number) => {
        recorderRes.statusCode = code;
        return recorderRes;
    };
    recorderRes.type = (contentType: string) => {
        recorderRes.setHeader('content-type', contentType === 'html' ? 'text/html; charset=utf-8' : contentType);
        return recorderRes;
    };
    recorderRes.json = (body: unknown) => {
        if (!recorderRes.hasHeader('content-type')) {
            recorderRes.setHeader('content-type', 'application/json; charset=utf-8');
        }
        recorderRes.end(JSON.stringify(body));
    };
    recorderRes.send = (body?: unknown) => {
        if (body === undefined) {
            recorderRes.end();
            return;
        }
        if (Buffer.isBuffer(body) || body instanceof Uint8Array || typeof body === 'string') {
            recorderRes.end(body);
            return;
        }
        recorderRes.json(body);
    };
    return recorderRes;
};

const readBody = (req: IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks.map(chunk => new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)))));
    req.on('error', reject);
});

const parseBody = (body: Buffer, contentType: string): unknown => {
    if (body.length === 0) {
        return {};
    }
    const text = body.toString('utf8');
    if (contentType.includes('application/json')) {
        return JSON.parse(text);
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
        return parseQueryString(text);
    }
    return text;
};

export const header = (req: IncomingMessage, name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
};
