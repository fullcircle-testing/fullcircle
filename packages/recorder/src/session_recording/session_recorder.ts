import fs from 'node:fs/promises';

import {RecordedCall} from '../types';

type HttpRequestSummary = {
    host: string;
    path: string;
    method: string;
    time: string;
    filename: string;
};

type SessionSummary = {
    sessionName: string;
    startTime: string;
    endTime: string;
    numCalls: number;
    calls: HttpRequestSummary[];
}

export class RecordingSession {
    private startTime: Date = new Date();
    private recordedCalls: RecordedCall[] = [];

    addCallToSession = (call: RecordedCall) => {
        this.recordedCalls.push(call);
        // this.logRecordedCalls('');
    }

    logRecordedCalls = async (sessionName: string): Promise<string> => {
        if (!this.recordedCalls.length) {
            return 'No calls have been made during this session';
        }

        const startTime = this.startTime.toISOString().replaceAll(':', '-').substring(0, 19);
        const endTime = new Date().toISOString().replaceAll(':', '-').substring(0, 19);

        let dataLogsFolder = process.env.DATA_LOG_OUT_DIR;
        if (!dataLogsFolder) {
            dataLogsFolder = './data_logs';
        }

        let topFolderName = `${dataLogsFolder}/${startTime}`;
        if (sessionName) {
            topFolderName = `${dataLogsFolder}/${startTime}__${sessionName}`;
        }

        try {
            await fs.mkdir(topFolderName, {recursive: true});
        } catch (e) {
            topFolderName = `${dataLogsFolder}/${startTime}`;
            await fs.mkdir(topFolderName, {recursive: true});
        }

        const withTopFolder = (path: string) => topFolderName + '/' + path;

        const withHostFolder = (host: string, path: string) => withTopFolder(
            host.replaceAll('https://', '').replaceAll('http://', '').replaceAll('/', '_')
            + '/' + path);

        const calls: HttpRequestSummary[] = [];

        for (const call of this.recordedCalls) {
            let requestPath = call.requestPath;
            if (requestPath.length > 1 && requestPath.at(0) === '/') {
                requestPath = requestPath.slice(1);
            }

            const subpath = withHostFolder(call.host, `${requestPath.replaceAll('/', '_')}`);
            await fs.mkdir(subpath, {recursive: true});

            const filename = `${subpath}/${call.requestMethod}_${call.time.replaceAll(':', '-')}.json`;
            await fs.writeFile(filename, JSON.stringify(call, null, 2));

            calls.push({
                host: call.host,
                path: call.requestPath,
                method: call.requestMethod,
                time: call.time,
                filename,
            });
        }

        const summary: SessionSummary = {
            sessionName,
            startTime,
            endTime,
            numCalls: this.recordedCalls.length,
            calls,
        }

        await fs.writeFile(withTopFolder('summary.json'), JSON.stringify(summary, null, 2));

        const message = `Finished session "${sessionName}"\nRecorded ${this.recordedCalls.length} calls\nStart ${this.startTime.toISOString()} End ${endTime}`;
        return message;
    }
}
