import express from 'express';

import {SessionManager} from '../session_recording/sessions_manager';

type Deps = {sessionManager: SessionManager};

export const initFullCircleApiRouter = ({sessionManager}: Deps) => {
    const fullcircleApiRouter = express.Router();

    fullcircleApiRouter.post('/record/start', async (req, res) => {
        sessionManager.startNewSession();
        res.send('Started recording');
    });

    fullcircleApiRouter.post('/record/stop', async (req, res) => {
        const message = await sessionManager.finishCurrentSession();
        res.send(message);
    });

    return fullcircleApiRouter;
};
