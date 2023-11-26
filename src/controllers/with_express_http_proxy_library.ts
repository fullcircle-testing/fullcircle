import express from 'express';
import proxy from 'express-http-proxy';
import {IncomingHttpHeaders} from 'http';

import {AppDependencies, RecordedCall} from '../types';

const HTTP_HEADER_ORIGINAL_HOST = 'ORIGINAL_HOST';

const mockedResponseDataCache: Record<string, object> = {
    '/api/repos': {
        items: [
            {name: 'Some name'},
        ],
    },
};

const getCachedData = (req: express.Request, deps: AppDependencies): any => {
    return mockedResponseDataCache[req.originalUrl] || '';
};

type ResponseInfo = {
    headers: IncomingHttpHeaders;
    statusCode?: number;
}

const recordRequest = (proxyRes: ResponseInfo, proxyResBody: string, req: express.Request, deps: AppDependencies) => {
    const {original_host, ...reqHeaders} = req.headers;

    const logErr = (message: string) => {
        console.error(`Error recording request: ${message}`);
    }

    if (!original_host) {
        logErr('No original_host header provided');
        return;
    }

    if (typeof original_host !== 'string') {
        logErr('Provided original_host header is not a string');
        return;
    }

    let host = original_host;
    if (!host.startsWith('https://') && !host.startsWith('http://')) {
        host = 'https://' + host;
    }

    if (host.endsWith('/')) {
        host = host.slice(0, host.length - 1);
    }

    const reqPath = req.originalUrl;
    const destinationUrl = host + reqPath;

    console.log(`FULLCIRCLE LOG: Proxying to url: ${destinationUrl}`);

    // const fetchRes = await fetch(destinationUrl, {
    //     headers,
    // });

    let responseBody = proxyResBody;
    const responseHeaders = proxyRes.headers;

    // const responseHeaders = fetchRes.headers;
    // let responseBody: string | object = await fetchRes.text();
    // let isJSON = false;
    try {
        responseBody = JSON.parse(responseBody);
        // isJSON = true;
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
        requestHeaders: req.headers,
        responseHeaders,
        requestIp: req.ip || '',
        status: proxyRes.statusCode || 0,
    }

    deps.sessionManager.getCurrentSession()?.addCallToSession(call);

    // if (isJSON) {
    //     res.json(responseBody);
    // } else {
    //     res.send(responseBody);
    // }
}

export const initProxyRouter = (deps: AppDependencies) => {
    const proxyRouter = express.Router();

    proxyRouter.use((req, res, next) => {
        const {original_host, ...reqHeaders} = req.headers;

        if (!deps.shouldProxy) {
            const data = getCachedData(req, deps);

            recordRequest({headers: {}, statusCode: 200}, JSON.stringify(data), req, deps);

            res.json(data);
            return;
        }

        if (!original_host || typeof original_host !== 'string') {
            res.json({error: `Please provide a host to proxy to with the HTTP header ${HTTP_HEADER_ORIGINAL_HOST}`});
            return;
        }

        proxy(original_host, {
            proxyReqPathResolver: async (req) => {
                // Optionally rewrite the path going out
                return req.url;
            },

            // proxyReqBodyDecorator: function (bodyContent, srcReq) {
            //     return srcReq.rawBody || bodyContent;
            // },

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
                const resBody = proxyResData.toString('utf8') as string;
                recordRequest(proxyRes, resBody, userReq, deps);

                return proxyResData;
            },

        })(req, res, next);
    });

    return proxyRouter;
};
