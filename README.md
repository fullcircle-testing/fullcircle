### Full Circle test harness

Learn more about your API, and how it interacts with external APIs. Full Circle has a few modes it can operate in:

- Record mode - Proxy requests and record them to JSON files. This is useful to gather data to use for text fixtures.
- Mock mode - Returns pre-recorded data for matching request URLs. This is useful for hooking into e2e tests and allow the test itself to define expected incoming requests, inspect the request body/headers, and return an appropriate response.
