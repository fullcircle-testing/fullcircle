import {createServer, IncomingMessage, Server, ServerResponse} from 'http';
import {parse as parseQueryString} from 'querystring';

export type NextFunction = (error?: unknown) => void;

export type AppRequest = IncomingMessage & {
    originalUrl: string;
    path: string;
    body: unknown;
    ip?: string;
    query: Record<string, unknown>;
    header: (name: string) => string | undefined;
};

export type AppResponse = ServerResponse & {
    status: (code: number) => AppResponse;
    json: (body: unknown) => void;
    send: (body?: unknown) => void;
    type: (contentType: string) => AppResponse;
};

export type Handler = (req: AppRequest, res: AppResponse, next: NextFunction) => void | Promise<void>;

export type MiniApp = ((req: IncomingMessage, res: ServerResponse) => void) & {
    use: (handler: Handler) => void;
    listen: (port: number | string, hostname: string, callback?: () => void) => Server;
};

export const createMiniApp = (): MiniApp => {
    const handlers: Handler[] = [];

    const app = (async (req: IncomingMessage, res: ServerResponse) => {
        const appReq = await decorateRequest(req);
        const appRes = decorateResponse(res);
        let index = -1;

        const next: NextFunction = (error?: unknown) => {
            if (error) {
                appRes.status(500).json({error: error instanceof Error ? error.message : String(error)});
                return;
            }

            index += 1;
            const handler = handlers[index];
            if (!handler) {
                if (!appRes.writableEnded) {
                    appRes.status(404).json({error: `FC server received unexpected request. No registered mocks for ${appReq.originalUrl}`});
                }
                return;
            }

            Promise.resolve(handler(appReq, appRes, next)).catch(next);
        };

        next();
    }) as unknown as MiniApp;

    app.use = (handler: Handler) => {
        handlers.push(handler);
    };

    app.listen = (port: number | string, hostname: string, callback?: () => void) => {
        return createServer(app).listen(Number(port), hostname, callback);
    };

    return app;
};

const decorateRequest = async (req: IncomingMessage): Promise<AppRequest> => {
    const originalUrl = req.url || '/';
    const parsedUrl = new URL(originalUrl, 'http://fullcircle.local');
    const bodyBuffer = await readBody(req);
    const contentType = getHeader(req, 'content-type') || '';

    return Object.assign(req, {
        originalUrl,
        path: parsedUrl.pathname,
        query: queryObject(parsedUrl),
        body: parseBody(bodyBuffer, contentType),
        ip: req.socket.remoteAddress,
        header: (name: string) => getHeader(req, name),
    });
};

const decorateResponse = (res: ServerResponse): AppResponse => {
    const appRes = res as AppResponse;

    appRes.status = (code: number) => {
        appRes.statusCode = code;
        return appRes;
    };

    appRes.type = (contentType: string) => {
        const normalized = contentType === 'html' ? 'text/html; charset=utf-8' : contentType;
        appRes.setHeader('content-type', normalized);
        return appRes;
    };

    appRes.json = (body: unknown) => {
        if (!appRes.hasHeader('content-type')) {
            appRes.setHeader('content-type', 'application/json; charset=utf-8');
        }
        appRes.end(JSON.stringify(body));
    };

    appRes.send = (body?: unknown) => {
        if (body === undefined) {
            appRes.end();
            return;
        }
        if (Buffer.isBuffer(body) || body instanceof Uint8Array || typeof body === 'string') {
            appRes.end(body);
            return;
        }
        appRes.json(body);
    };

    return appRes;
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

const queryObject = (url: URL): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams) {
        const existing = result[key];
        if (existing === undefined) {
            result[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            result[key] = [existing, value];
        }
    }
    return result;
};

const getHeader = (req: IncomingMessage, name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
};
