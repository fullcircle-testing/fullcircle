import fetch from 'node-fetch';

import {JSON_PLACEHOLDER_HOST} from '../constants';

export class ExternalClient {
    constructor(private apiUrl: string) { }

    getPosts = () => {
        const path = '/posts';
        return this.doGet(path);
    };

    getTodo = (id: number) => {
        const path = `/todos/${id}`;
        return this.doGet(path);
    };

    private doGet = (path: string) => {
        const fullUrl = `${this.apiUrl}${path}`;

        let headers: HeadersInit = {};

        return fetch(fullUrl, {
            headers,
        }).then(r => r.json());
    }
}

const getOriginalHostHeader = (apiUrl: string): string | undefined => {
    const url = new URL(apiUrl);
    if (url.host === JSON_PLACEHOLDER_HOST) {
        return undefined;
    }

    return JSON_PLACEHOLDER_HOST;
}
