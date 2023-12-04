import {IncomingHttpHeaders} from 'http';

import {SessionManager} from './session_recording/sessions_manager';

export type RequestDestinationConfig = {
    externalHost: string;
    port: string;
}

export type AppDependencies = {
    sessionManager: SessionManager;
    defaultDestination?: string;
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
