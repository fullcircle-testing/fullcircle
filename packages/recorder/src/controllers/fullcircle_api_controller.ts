import express from 'express';

import {SessionManager} from '../session_recording/sessions_manager';

type Deps = {sessionManager: SessionManager};

export const initFullCircleApiRouter = ({sessionManager}: Deps) => {
    const fullcircleApiRouter = express.Router();

    fullcircleApiRouter.get('/status', async (req, res) => {
        res.json(sessionManager.getStatus());
    });

    fullcircleApiRouter.post('/record/start', async (req, res) => {
        sessionManager.startNewSession();
        res.json({
            message: 'Started recording',
            ...sessionManager.getStatus(),
        });
    });

    fullcircleApiRouter.post('/record/stop', async (req, res) => {
        const result = await sessionManager.finishCurrentSessionDetails(req.body?.name || '');
        res.json({
            message: result?.message,
            result,
            ...sessionManager.getStatus(),
        });
    });

    fullcircleApiRouter.post('/browser-events', async (req, res) => {
        sessionManager.recordBrowserEvent(req.body);
        res.status(202).json({ok: true});
    });

    return fullcircleApiRouter;
};
