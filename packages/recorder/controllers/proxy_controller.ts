import express from 'express';
import {SessionManager} from '../session_recording.ts/sessions_manager';
import {RecordedCall} from '../src/types';

import fetch from 'node-fetch';

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

        if (host.endsWith('/')) {
            host = host.slice(0, host.length - 1);
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

        const reqPath = req.originalUrl;
        const destinationUrl = host + reqPath;

        console.log(`FULLCIRCLE LOG: Proxying to url: ${destinationUrl}`);

        const fetchRes = await fetch(destinationUrl, {
            headers,
        });

        const responseHeaders = fetchRes.headers;
        let responseBody: string | object = await fetchRes.text();
        let isJSON = false;
        try {
            responseBody = JSON.parse(responseBody);
            isJSON = true;
        } catch (e) {
            console.log('Tried to JSON parse response, but failed. Assuming response is not JSON.');
        }

        const call: RecordedCall = {
            time: new Date().toISOString(),
            host,
            requestMethod: req.method,
            requestPath: reqPath,
            requestBody: req.body,
            responseBody,
            requestHeaders: headers,
            responseHeaders: Array.from(responseHeaders).reduce<Record<string, string>>((accum, current) => {
                accum[current[0]] = current[1];
                return accum;
            }, {}),
            requestIp: req.ip || '',
            status: fetchRes.status,
        }

        deps.sessionManager.getCurrentSession()?.addCallToSession(call);

        if (isJSON) {
            res.json(responseBody);
        } else {
            res.send(responseBody);
        }
    });

    return proxyRouter;
};