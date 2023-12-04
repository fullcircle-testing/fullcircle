import express from 'express';

import {ExampleAppDependencies} from './types/app_dependencies';

import {ExternalClient} from './external_service/external_client';
import {renderRoot, renderTodos} from './views/root';

export const initApp = (deps: ExampleAppDependencies) => {
    const app = express();

    const externalClient = new ExternalClient(deps.externalUrl);

    app.get('/', (req, res) => {
        res.setHeader('content-type', 'text/html');
        const root = renderRoot();
        res.end(root);
    });

    app.get('/views/todos', async (req, res) => {
        res.setHeader('content-type', 'text/html');
        const todos = await externalClient.getTodos();
        const todosRendered = renderTodos(todos);
        res.end(todosRendered);
    });

    app.get('/api/posts', async (req, res) => {
        const posts = await externalClient.getPosts();
        res.json(posts);
    });

    app.get('/api/todos/:id', async (req, res) => {
        const todos = await externalClient.getTodo(req.params.id);
        res.json(todos);
    });

    return app;
}
