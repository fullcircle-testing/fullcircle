import fetch from 'node-fetch';

const host = 'http://localhost:3000';

const destinationHost = 'jsonplaceholder.typicode.com';

const startRecordingURL = host + '/fullcircle/api/record/start';
const stopRecordingURL = host + '/fullcircle/api/record/stop';

const externalRoute1 = host + '/todos/1';
const externalRoute2 = host + '/posts';

const startRecording = async () => {
    return fetch(startRecordingURL, {method: 'POST'});
};

const stopRecording = async () => {
    return fetch(stopRecordingURL, {method: 'POST'});
};

setTimeout(async () => {
    await startRecording();

    let res = await fetch(externalRoute1, {
        headers: {
            original_host: destinationHost,
        },
    }).then(r => r.text());
    console.log(res);

    res = await fetch(externalRoute2, {
        headers: {
            original_host: destinationHost,
        },
    }).then(r => r.text());

    await stopRecording().then(r => r.text()).then(text => console.log(text));
});
