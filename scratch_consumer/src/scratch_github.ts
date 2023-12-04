import {Octokit} from '@octokit/rest';

const host = 'http://localhost:1334';
const startRecordingURL = host + '/fullcircle/api/record/start';
const stopRecordingURL = host + '/fullcircle/api/record/stop';

const destinationHost = 'https://api.github.com';

const octokit = new Octokit({
    baseUrl: host,
    request: {
        fetch: (url: string, options: any) => {
            options.headers ||= {};
            options.headers.original_host = destinationHost;
            return fetch(url, options);
        },
    },

});

class EnsuredRecording {
    start = async () => {
        await startRecording();
    }

    [Symbol.asyncDispose] = async () => {
        await stopRecording();
    }
}

const startRecording = async () => {
    return fetch(startRecordingURL, {method: 'POST'});
};

const stopRecording = async () => {
    return fetch(stopRecordingURL, {method: 'POST'});
};

setTimeout(async () => {
    await using recorder = new EnsuredRecording();
    await recorder.start();

    await octokit.rest.repos
        .listForOrg({
            org: "octokit",
            type: "public",
        })
        .then(({data}) => {
            console.log(data);
        });
});
