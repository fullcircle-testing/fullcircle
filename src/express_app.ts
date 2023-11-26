import express from 'express';

import {initFullCircleApiRouter} from './controllers/fullcircle_api_controller';

// import {initProxyRouter} from './controllers/proxy_controller';
import {initProxyRouter} from './controllers/with_express_http_proxy_library';

import {AppDependencies} from './types';

export const initApp = (deps: AppDependencies) => {
    const app = express();

    app.use(express.json());

    app.use('/fullcircle/api', initFullCircleApiRouter(deps));

    app.use(initProxyRouter(deps));

    app.use('*', (req, res) => {
        console.log('Not found');
        res.send('Not found');
    });

    return app;
};
