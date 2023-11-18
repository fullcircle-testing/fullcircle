const host = 'http://localhost:1334';
const proxyURL = host + '/proxy';
const startRecordingURL = host + '/record/start';
const stopRecordingURL = host + '/record/stop';


const startRecording = async () => {
    return fetch(startRecordingURL, {method: 'POST'});
};

const stopRecording = async () => {
    return fetch(stopRecordingURL, {method: 'POST'});
};

setTimeout(async () => {
    await startRecording();

    let res = await fetch(proxyURL, {
        headers: {
            original_host: 'google.com/search'
        },
    }).then(r => r.text());
    console.log(res);

    res = await fetch(proxyURL, {
        headers: {
            original_host: 'https://google.com/other'
        },
    }).then(r => r.text());

    await stopRecording().then(r => r.text()).then(text => console.log(text));
});
