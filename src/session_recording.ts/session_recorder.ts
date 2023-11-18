import fs from 'node:fs/promises';

import {RecordedCall} from '../types';

export class RecordingSession {
    private startTime: Date = new Date();
    private recordedCalls: RecordedCall[] = [];

    addCallToSession = (call: RecordedCall) => {
        this.recordedCalls.push(call);
    }

    logRecordedCalls = async (): Promise<string> => {
        const startTimeStr = this.startTime.toISOString();
        const endTime = new Date().toISOString();

        const topFolderName = `data_logs/${startTimeStr}__${endTime}`;
        await fs.mkdir(topFolderName, {recursive: true});

        const withTopFolder = (path: string) => topFolderName + '/' + path;

        const calls = [];

        for (const call of this.recordedCalls) {
            const subpath = withTopFolder(`${call.requestPath.replaceAll('/', '_')}`);
            await fs.mkdir(subpath, {recursive: true});

            const fname = `${subpath}/${call.requestMethod}_${call.time}.json`;
            await fs.writeFile(fname, JSON.stringify(call, null, 2));

            calls.push({
                host: call.host,
                path: call.requestPath,
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
