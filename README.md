## Full Circle test harness

Learn more about your API, and how it interacts with external APIs. Full Circle has a few modes it can operate in:

- Record mode - Proxy requests and record them to JSON files. This is useful to gather data to use for text fixtures.
- Mock mode - Returns pre-recorded data for matching request URLs. This is useful for hooking into e2e tests and allow the test itself to define expected incoming requests, inspect the request body/headers, and return an appropriate response.

### HTTP Traffic Recorder

The recorder tool is meant to help record HTTP traffic between different clients and services. It's similar to ngrok, though the recorder focuses on both outgoing and incoming requests, while ngrok only focuses on incoming requests. The recorder also keeps track of multiple destinations simultaneously. The recorder can be used to examine requests such as:

- Requests sent by your frontend to your backend
- Requests sent by your backend to an external service
- Requests sent by an external service to your backend (e.g. incoming webhook requests)

The recorder tool helps organize the requests and lays them out in a linear timeline, between each actor in the given system. When you start the recorder, a recording session begins. Every request that occurs to any of the HTTP services will be recorded. You can then interact with the terminal by typing your session name and pressing enter to save your session and start a new one. A session should be treated as short segment of time/interaction, such as "fill out x form and submit", or "click button to navigate".

To use the recorder tool, (for now) clone this repo and run `npm i`, then follow the instructions below.

The command shown below is used to proxy/record requests to twitter.com by listening on local port 5005, and proxy/record requests to wikipedia.org on local port 5006. The requests for both services will be recorded in chronological order, and a new entry will be put into the `data_logs` folder from your current working directory.

```
npm run recorder record -- -- --destinations https://twitter.com\|5005 https://wikipedia.org\|5006
```

You'll see an output like this in the terminal:

```
> @fullcircle/recorder@1.0.0 start
> ts-node src/index.ts record --destinations https://twitter.com|5005 https://wikipedia.org|5006

[ 'https://twitter.com|5005', 'https://wikipedia.org|5006' ]

http://localhost:5005 -> https://twitter.com
http://localhost:5006 -> https://wikipedia.org

Type your session name and press Enter to save your session.
```

Perform these steps:
- Run the above command
- Visit http://localhost:5005
- Observe twitter.com interface is shown
- Visit http://localhost:5006
- Observe wikipedia.org interface is shown
- Type your "session name" into the terminal that is running the recorder something like "twitter_wikipedia" (it doesn't matter what you type)
- Press enter in the terminal
- Notice the new entry made in the `data_logs` folder

Then you should see a `summary.json` file in a folder within the `data_logs` folder like the one below:

```json
{
  "sessionName": "twitter and wiki",
  "startTime": "2024-01-08T17-12-22",
  "endTime": "2024-01-08T17-12-43",
  "numCalls": 6,
  "calls": [
    {
      "host": "https://twitter.com",
      "path": "/",
      "method": "GET",
      "time": "2024-01-08T17:12:28.682Z",
      "filename": "./data_logs/2024-01-08T17-12-22__twitter and wiki/twitter.com/_/GET_2024-01-08T17-12-28.682Z.json"
    },
    {
      "host": "https://twitter.com",
      "path": "/manifest.json",
      "method": "GET",
      "time": "2024-01-08T17:12:29.382Z",
      "filename": "./data_logs/2024-01-08T17-12-22__twitter and wiki/twitter.com/manifest.json/GET_2024-01-08T17-12-29.382Z.json"
    },
    {
      "host": "https://twitter.com",
      "path": "/opensearch.xml",
      "method": "GET",
      "time": "2024-01-08T17:12:29.556Z",
      "filename": "./data_logs/2024-01-08T17-12-22__twitter and wiki/twitter.com/opensearch.xml/GET_2024-01-08T17-12-29.556Z.json"
    },
    {
      "host": "https://twitter.com",
      "path": "/sw.js",
      "method": "GET",
      "time": "2024-01-08T17:12:29.745Z",
      "filename": "./data_logs/2024-01-08T17-12-22__twitter and wiki/twitter.com/sw.js/GET_2024-01-08T17-12-29.745Z.json"
    },
    {
      "host": "https://twitter.com",
      "path": "/manifest.json",
      "method": "GET",
      "time": "2024-01-08T17:12:29.944Z",
      "filename": "./data_logs/2024-01-08T17-12-22__twitter and wiki/twitter.com/manifest.json/GET_2024-01-08T17-12-29.944Z.json"
    },
    {
      "host": "https://wikipedia.org",
      "path": "/",
      "method": "GET",
      "time": "2024-01-08T17:12:34.664Z",
      "filename": "./data_logs/2024-01-08T17-12-22__twitter and wiki/wikipedia.org/_/GET_2024-01-08T17-12-34.664Z.json"
    }
  ]
}
```

Details on each of the requests can be found in the respective data log files. These pieces of data can now be used as test fixtures in automated tests.

If you would like to include headers in the data files, you can provide the `--include-headers` flag to the `record` command. Note that headers are hidden by default, since they typically contain sensitive credentials. Having them hidden by default makes it easier to share the data files with others without having to sanitize them every time.

Example file showing request details. Some data has been removed to decrease the amount of data shown here:

`./data_logs/2024-01-08T17-12-22__twitter and wiki/twitter.com/manifest.json/GET_2024-01-08T17-12-29.944Z.json`

```json
{
  "time": "2024-01-08T17:12:29.382Z",
  "host": "https://twitter.com",
  "requestMethod": "GET",
  "requestPath": "/manifest.json",
  "requestBody": {},
  "responseBody": {
    "background_color": "#ffffff",
    "categories": [
      "social",
      "news",
      "magazines"
    ],
    "description": "Get breaking news, politics, trending music, world events, sports scores, and the latest global news stories as they unfold - all with less data.",
    "display": "standalone",
    "gcm_sender_id": "49625052041",
    "gcm_user_visible_only": true
  },
  "requestHeaders": null,
  "responseHeaders": null,
  "requestIp": "::1",
  "status": 200
}
```
