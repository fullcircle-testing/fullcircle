import {IncomingHttpHeaders} from 'http';

import {SessionManager} from './session_recording.ts/sessions_manager';

export type AppDependencies = {
    sessionManager: SessionManager;
    shouldProxy: boolean;
};

export type RecordedCall = {
    time: string;
    host: string;
    requestMethod: string;
    requestPath: string;
    requestHeaders: IncomingHttpHeaders;
    requestBody?: object;
    responseHeaders: IncomingHttpHeaders;
    responseBody: string | object;
    status: number;
    requestIp: string;
}
