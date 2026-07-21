import {createServer} from 'http';

import {SessionManager} from './session_recording/sessions_manager';
import {AppDependencies, RecordedCall} from './types';
import {createHttpApp, header, RecorderRequest, RecorderResponse} from './http_app';
import {recorderUiHtml} from './controllers/fullcircle_ui_controller';

const HTTP_HEADER_ORIGINAL_HOST = 'ORIGINAL_HOST';

export const initApp = (deps: AppDependencies) => createHttpApp(async (req, res) => {
    if (req.path === '/fullcircle/api/status' && req.method === 'GET') {
        res.json(deps.sessionManager.getStatus());
        return;
    }

    if (req.path === '/fullcircle/api/record/start' && req.method === 'POST') {
        const autoFinished = await deps.sessionManager.startNewSession();
        res.json({
            message: autoFinished
                ? `Started recording; auto-finished previous session as "${autoFinished.sessionName}"`
                : 'Started recording',
            autoFinished,
            ...deps.sessionManager.getStatus(),
        });
        return;
    }

    if (req.path === '/fullcircle/api/record/stop' && req.method === 'POST') {
        const body = isRecord(req.body) ? req.body : {};
        const result = await deps.sessionManager.finishCurrentSessionDetails(String(body.name || ''));
        res.json({
            message: result?.message,
            result,
            ...deps.sessionManager.getStatus(),
        });
        return;
    }

    if (req.path === '/fullcircle/api/browser-events' && req.method === 'POST') {
        deps.sessionManager.recordBrowserEvent(req.body as Parameters<SessionManager['recordBrowserEvent']>[0]);
        res.status(202).json({ok: true});
        return;
    }

    if (req.path === '/fullcircle' && req.method === 'GET') {
        res.type('html').send(recorderUiHtml);
        return;
    }

    await proxyAndRecord(req, res, deps);
});

export const listenApp = (
    deps: AppDependencies,
    port: string | number,
    host = '127.0.0.1',
    onListening?: () => void,
) => createServer(initApp(deps)).listen(Number(port), host, onListening);

const proxyAndRecord = async (req: RecorderRequest, res: RecorderResponse, deps: AppDependencies) => {
    const destinationHost = normalizeDestinationHost(deps.defaultDestination || header(req, 'original_host'));
    if (!destinationHost) {
        res.json({error: `Please provide a host to proxy to with the HTTP header ${HTTP_HEADER_ORIGINAL_HOST}`});
        return;
    }

    const destinationUrl = destinationHost + req.originalUrl;
    console.log(`FULLCIRCLE LOG: Proxying to url: ${destinationUrl}`);

    const proxyResponse = await fetch(destinationUrl, {
        method: req.method,
        headers: requestHeaders(req, destinationHost),
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (req.rawBody as unknown as BodyInit),
        redirect: 'manual',
    });
    const responseBuffer = Buffer.from(await proxyResponse.arrayBuffer());

    for (const [key, value] of proxyResponse.headers) {
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
            res.setHeader(key, value);
        }
    }
    res.statusCode = proxyResponse.status;

    recordRequest(proxyResponse, responseBuffer, req, deps, destinationHost);
    res.end(responseBuffer);
};

const normalizeDestinationHost = (input?: string): string | undefined => {
    if (!input) {
        return undefined;
    }
    let destinationHost = input;
    if (!destinationHost.startsWith('https://') && !destinationHost.startsWith('http://')) {
        destinationHost = 'https://' + destinationHost;
    }
    return destinationHost.endsWith('/') ? destinationHost.slice(0, -1) : destinationHost;
};

const requestHeaders = (req: RecorderRequest, destinationHost: string): Headers => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (['host', 'content-length', 'original_host'].includes(key.toLowerCase())) {
            continue;
        }
        if (Array.isArray(value)) {
            value.forEach(entry => headers.append(key, entry));
        } else if (value !== undefined) {
            headers.set(key, value);
        }
    }
    headers.set('host', new URL(destinationHost).host);
    return headers;
};

const recordRequest = (proxyRes: Response, proxyResBody: Buffer, req: RecorderRequest, deps: AppDependencies, destinationHost: string) => {
    let responseBody: string | object = proxyResBody.toString('utf8');
    try {
        responseBody = JSON.parse(responseBody);
    } catch (e) {
        console.log('Tried to JSON parse response, but failed. Assuming response is not JSON.');
    }

    const responseHeaders: Record<string, string> = {};
    proxyRes.headers.forEach((value, key) => responseHeaders[key] = value);

    const call: RecordedCall = {
        time: new Date().toISOString(),
        host: destinationHost,
        requestMethod: req.method || 'GET',
        requestPath: req.originalUrl,
        requestBody: req.body as object,
        responseBody,
        requestHeaders: deps.includeHeaders ? req.headers : null,
        responseHeaders: deps.includeHeaders ? responseHeaders : null,
        requestIp: req.ip || '',
        status: proxyRes.status,
    };

    deps.sessionManager.getCurrentSession()?.addCallToSession(call);
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
