export type RecordedCall = {
    time: string;
    host: string;
    requestMethod: string;
    requestPath: string;
    requestHeaders: Record<string, string>;
    requestBody?: object;
    responseHeaders: Record<string, string>;
    responseBody: string | object;
    requestIp: string;
}
