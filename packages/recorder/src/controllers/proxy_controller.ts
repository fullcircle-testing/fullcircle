import express from 'express';
import proxy from 'express-http-proxy';
import {IncomingHttpHeaders} from 'http';

import {AppDependencies, RecordedCall} from '../types';

const HTTP_HEADER_ORIGINAL_HOST = 'ORIGINAL_HOST';

type ResponseInfo = {
    headers: IncomingHttpHeaders;
    statusCode?: number;
}

const recordRequest = (proxyRes: ResponseInfo, proxyResBody: string, req: express.Request, deps: AppDependencies, destinationHost: string) => {
    const reqPath = req.originalUrl;
    const destinationUrl = destinationHost + reqPath;

    console.log(`FULLCIRCLE LOG: Proxying to url: ${destinationUrl}`);

    let responseBody = proxyResBody;
    const responseHeaders = proxyRes.headers;

    try {
        responseBody = JSON.parse(responseBody);
    } catch (e) {
        console.log('Tried to JSON parse response, but failed. Assuming response is not JSON.');
    }

    const call: RecordedCall = {
        time: new Date().toISOString(),
        host: destinationHost,
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
}

export const initProxyRouter = (deps: AppDependencies) => {
    const proxyRouter = express.Router();

    proxyRouter.use((req, res, next) => {
        let destinationHost = deps.defaultDestination;

        // No default destination provided. We fall back to the requester providing the host with the `ORIGINAL_HOST` HTTP header.
        if (!destinationHost) {
            const {original_host} = req.headers;

            if (!original_host || typeof original_host !== 'string') {
                res.json({error: `Please provide a host to proxy to with the HTTP header ${HTTP_HEADER_ORIGINAL_HOST}`});
                return;
            }

            destinationHost = original_host;
        }

        if (!destinationHost.startsWith('https://') && !destinationHost.startsWith('http://')) {
            destinationHost = 'https://' + destinationHost;
        }

        if (destinationHost.endsWith('/')) {
            destinationHost = destinationHost.slice(0, destinationHost.length - 1);
        }

        proxy(destinationHost, {
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
                recordRequest(proxyRes, resBody, userReq, deps, destinationHost!);

                return proxyResData;
            },

        })(req, res, next);
    });

    return proxyRouter;
};
