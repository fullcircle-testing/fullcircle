import express from 'express';
const app = express();
const router = express.Router();

const wrappedRouter = new Proxy(router, {
    get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') {
            return Reflect.get(target, prop, receiver);
        }

        return function(routePath: string, ...middlewares: express.Handler[]) {
            if (!middlewares.length) {
                Reflect.apply(value, target, [routePath, ...middlewares]);
                return;
            }

            const firstMiddleware = middlewares[0];
            const wrappedMiddleware: express.Handler = (req, res, next) => {
                console.log(`Route ${routePath} triggered.`);
                Reflect.apply(firstMiddleware, target, [req, res, next]);

                // TODO: mark the handler as "called", and remove the handler from the router's stack
            };

            middlewares[0] = wrappedMiddleware;
            Reflect.apply(value, target, [routePath, ...middlewares]);
        };
    }
});

const middleware1: express.Handler = (req, res, next) => {
    console.log('middleware1');
    res.json({yep: 'haha'});
    // next();
}

const middleware2: express.Handler = (req, res, next) => {
    console.log('middleware2');
    next();
}

wrappedRouter.get('/myroute', middleware1, middleware2, (req, res) => {
    res.send('Handler called');
});

app.use(wrappedRouter);

app.listen(3010, () => {
    console.log('Server is running on port 3000');
});
