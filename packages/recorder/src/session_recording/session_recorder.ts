import fs from 'node:fs/promises';

import {RecordedCall} from '../types';

export class RecordingSession {
    private startTime: Date = new Date();
    private recordedCalls: RecordedCall[] = [];

    addCallToSession = (call: RecordedCall) => {
        this.recordedCalls.push(call);
        this.logRecordedCalls();
    }

    logRecordedCalls = async (): Promise<string> => {
        const startTimeStr = this.startTime.toISOString().replaceAll(':', '-');
        const endTime = new Date().toISOString().replaceAll(':', '-');

        let dataLogsFolder = process.env.DATA_LOG_OUT_DIR;
        if (!dataLogsFolder) {
            dataLogsFolder = './data_logs';
        }

        const topFolderName = `${dataLogsFolder}/${startTimeStr}`;
        await fs.mkdir(topFolderName, {recursive: true});

        const withTopFolder = (path: string) => topFolderName + '/' + path;

        const calls = [];

        for (const call of this.recordedCalls) {
            let requestPath = call.requestPath;
            if (requestPath.length > 1 && requestPath.at(0) === '/') {
                requestPath = requestPath.slice(1);
            }

            const subpath = withTopFolder(`${requestPath.replaceAll('/', '_')}`);
            await fs.mkdir(subpath, {recursive: true});

            const fname = `${subpath}/${call.requestMethod}_${call.time.replaceAll(':', '-')}.json`;
            await fs.writeFile(fname, JSON.stringify(call, null, 2));

            calls.push({
                host: call.host,
                path: call.requestPath,
                method: call.requestMethod,
                time: call.time,
                fname,
            });
        }

        const summary = {
            start: startTimeStr,
            endTime: endTime,
            numCalls: this.recordedCalls.length,
            calls,
        }

        await fs.writeFile(withTopFolder('summary.json'), JSON.stringify(summary, null, 2));

        const message = `Recorded ${this.recordedCalls.length} calls\nStart ${this.startTime.toISOString()} End ${endTime}`;
        return message;
    }
}
