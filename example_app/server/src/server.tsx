/// <reference types="@kitajs/html/htmx.d.ts" />

import express from 'express';
import Html from '@kitajs/html';

import {ExampleAppDependencies} from './types';

import {ExternalClient} from './external_service/external_client';

export const initApp = (deps: ExampleAppDependencies) => {
    const app = express();

    const externalClient = new ExternalClient(deps.externalUrl);

    app.get('/', (req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(<html><body>{'yep'}</body></html>);
    });

    app.get('/api/posts', async (req, res) => {
        const posts = await externalClient.getPosts();
        res.json(posts);
    });

    return app;
}
