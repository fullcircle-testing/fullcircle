import express from 'express';
import {SessionManager} from '../session_recording.ts/sessions_manager';
import {RecordedCall} from '../types';


type Deps = {sessionManager: SessionManager};

export const initProxyRouter = (deps: Deps) => {
    const proxyRouter = express.Router();

    proxyRouter.use('*', async (req, res) => {
        const {original_host, ...reqHeaders} = req.headers;

        if (!original_host) {
            res.json({error: 'No original_host header provided'});
            return;
        }

        if (typeof original_host !== 'string') {
            res.json({error: 'Provided original_host header is not a string'});
            return;
        }

        let host = original_host;
        if (!host.startsWith('https://') && !host.startsWith('http://')) {
            host = 'https://' + host;
        }

        const headers: Record<string, string> = {};
        for (const headerName of Object.keys(reqHeaders)) {
            const headerValue = reqHeaders[headerName];
            if (!headerValue) {
                continue;
            }

            if (typeof headerValue === 'string') {
                headers[headerName] = headerValue;
            } else {
                headers[headerName] = headerValue.join(',');
            }
        }

        const fetchRes = await fetch(host, {
            headers,
        });

        const responseHeaders = fetchRes.headers;
        let responseBody: string | object = await fetchRes.text();
        try {
            responseBody = JSON.parse(responseBody);
        } catch (e) {
        }

        const fullUrl = req.originalUrl;
        console.log(fullUrl);

        const call: RecordedCall = {
            time: new Date().toISOString(),
            host,
            requestMethod: req.method,
            requestPath: fullUrl,
            requestHeaders: headers,
            requestBody: req.body,
            responseHeaders: Array.from(responseHeaders).reduce<Record<string, string>>((accum, current) => {
                accum[current[0]] = current[1];
                return accum;
            }, {}),
            responseBody,
            requestIp: req.ip || '',
        }

        deps.sessionManager.getCurrentSession()?.addCallToSession(call);

        res.send(fetchRes);
    });

    return proxyRouter;
};
