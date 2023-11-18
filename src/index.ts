import express from 'express';

import {initFullCircleApiRouter} from './controllers/fullcircle_api_controller';
import {initProxyRouter} from './controllers/proxy_controller';
import {SessionManager} from './session_recording.ts/sessions_manager';

const app = express();

app.use(express.json());

const sessionManager = new SessionManager();

app.use('/fullcircle/api', initFullCircleApiRouter({sessionManager}));

app.use(initProxyRouter({sessionManager}));

app.use('*', (req, res) => {
    console.log('Not found');
    res.send('Not found');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`http://localhost:${port}`);
});
