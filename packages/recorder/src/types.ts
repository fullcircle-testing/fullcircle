import {IncomingHttpHeaders} from 'http';

import {SessionManager} from './session_recording/sessions_manager';

export type RequestDestinationConfig = {
    externalHost: string;
    port: string;
}

export type AppDependencies = {
    sessionManager: SessionManager;
    defaultDestination?: string;
    includeHeaders: boolean;
};

export type RecordedCall = {
    time: string;
    host: string;
    requestMethod: string;
    requestPath: string;
    requestHeaders: IncomingHttpHeaders | null;
    requestBody?: object;
    responseHeaders: IncomingHttpHeaders | null;
    responseBody: string | object;
    status: number;
    requestIp: string;
}
