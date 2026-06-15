import fs from 'node:fs/promises';

import {
    FullCircleBrowserEvent,
    FullCircleSessionArtifact,
    recordedCallsToSessionArtifact,
} from '../session_artifact';
import {RecordedCall} from '../types';

export type HttpRequestSummary = {
    host: string;
    path: string;
    method: string;
    time: string;
    filename?: string;
};

export type SessionSummary = {
    sessionName: string;
    startTime: string;
    endTime: string;
    numCalls: number;
    calls: HttpRequestSummary[];
}

export type FinishedSessionResult = SessionSummary & {
    outputPath?: string;
    message: string;
    artifact: FullCircleSessionArtifact;
};

export type RecordingSessionStatus = {
    startedAt: string;
    callCount: number;
    browserEventCount: number;
    recentCalls: HttpRequestSummary[];
};

export type RecordedBrowserEvent = {
    id?: string;
    at: string;
    correlationId?: string;
    event: FullCircleBrowserEvent;
};

export class RecordingSession {
    private startTime: Date = new Date();
    private recordedCalls: RecordedCall[] = [];
    private browserEvents: RecordedBrowserEvent[] = [];

    addCallToSession = (call: RecordedCall) => {
        this.recordedCalls.push(call);
        // this.logRecordedCalls('');
    }

    addBrowserEventToSession = (event: RecordedBrowserEvent) => {
        this.browserEvents.push(event);
    }

    getStatus = (): RecordingSessionStatus => ({
        startedAt: this.startTime.toISOString(),
        callCount: this.recordedCalls.length,
        browserEventCount: this.browserEvents.length,
        recentCalls: this.recordedCalls.slice(-20).map(call => ({
            host: call.host,
            path: call.requestPath,
            method: call.requestMethod,
            time: call.time,
        })),
    });

    finish = async (sessionName: string): Promise<FinishedSessionResult> => {
        if (!this.recordedCalls.length && !this.browserEvents.length) {
            const endTime = new Date().toISOString();
            const artifact = recordedCallsToSessionArtifact({
                name: sessionName,
                startedAt: this.startTime.toISOString(),
                endedAt: endTime,
                calls: [],
                browserEvents: this.browserEvents,
            });
            return {
                sessionName,
                startTime: this.startTime.toISOString(),
                endTime,
                numCalls: 0,
                calls: [],
                artifact,
                message: 'No calls have been made during this session',
            };
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
        const artifact = recordedCallsToSessionArtifact({
            name: sessionName,
            startedAt: this.startTime.toISOString(),
            endedAt: new Date().toISOString(),
            calls: this.recordedCalls,
            browserEvents: this.browserEvents,
        });
        await fs.writeFile(withTopFolder('session.fullcircle.json'), JSON.stringify(artifact, null, 2));

        const message = `Finished session "${sessionName}"\nRecorded ${this.recordedCalls.length} calls\nStart ${this.startTime.toISOString()} End ${endTime}\nOutput ${topFolderName}`;
        return {
            ...summary,
            outputPath: topFolderName,
            artifact,
            message,
        };
    }

    logRecordedCalls = async (sessionName: string): Promise<string> => {
        const result = await this.finish(sessionName);
        return result.message;
    }
}
