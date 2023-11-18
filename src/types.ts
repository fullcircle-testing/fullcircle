export type RecordedCall = {
    time: string;
    host: string;
    requestPath: string;
    requestBody?: object;
    requestResponse: string;
}
