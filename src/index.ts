import express from 'express';

import {RecordedCall} from './types';
import {RecordingSession} from './log_recorded_session';

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.json({message: 'Hello World'});
});

app.use('/proxy', async (req, res) => {
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

    const fetchRes = await fetch(host, {
        // headers,
    }).then(r => r.text());

    const call: RecordedCall = {
        time: new Date().toISOString(),
        host,
        requestPath: req.path,
        requestBody: req.body,
        requestResponse: fetchRes,
    }

    session.addCallToSession(call);

    res.send(fetchRes);
});

let session = new RecordingSession();
let recorded: RecordedCall[] = [];
let startTime = new Date();

app.post('/record/start', async (req, res) => {
    session = new RecordingSession();
    res.send('Started recording');
});

app.post('/record/stop', async (req, res) => {
    const message = await session.logRecordedCalls();
    res.send(message);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`http://localhost:${port}`);
});
