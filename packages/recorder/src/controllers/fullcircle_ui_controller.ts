export const recorderUiHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FullCircle Recorder</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 1rem; }
    button, input { font: inherit; padding: 0.5rem 0.75rem; }
    button { cursor: pointer; }
    .panel { border: 1px solid #ddd; border-radius: 0.75rem; padding: 1rem; margin: 1rem 0; }
    .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
    .status { font-weight: 700; }
    code { background: #f5f5f5; padding: 0.125rem 0.25rem; border-radius: 0.25rem; }
    li { margin: 0.35rem 0; }
  </style>
</head>
<body>
  <h1>FullCircle Recorder</h1>
  <p>Start and stop capture sessions, review recent provider calls, and copy the saved session path into your e2e fixture workflow.</p>

  <section class="panel">
    <h2>Session controls</h2>
    <p>Status: <span id="recording-status" class="status">Loading…</span></p>
    <div class="row">
      <button id="start-recording">Start recording</button>
      <input id="session-name" placeholder="Session name" aria-label="Session name">
      <button id="stop-recording">Stop and save</button>
    </div>
    <p id="message"></p>
  </section>

  <section class="panel">
    <h2>Recent calls</h2>
    <ol id="recent-calls"></ol>
  </section>

  <section class="panel">
    <h2>Last saved session</h2>
    <p id="last-session">No session saved yet.</p>
  </section>

  <script>
    const statusEl = document.querySelector('#recording-status');
    const messageEl = document.querySelector('#message');
    const recentCallsEl = document.querySelector('#recent-calls');
    const lastSessionEl = document.querySelector('#last-session');
    const sessionNameEl = document.querySelector('#session-name');

    async function fetchJson(url, init) {
      const response = await fetch(url, {
        headers: {'content-type': 'application/json'},
        ...init,
      });
      return response.json();
    }

    function render(status) {
      statusEl.textContent = status.recording ? 'Recording' : 'Idle';
      recentCallsEl.innerHTML = '';
      for (const call of status.recentCalls || []) {
        const item = document.createElement('li');
        item.textContent = call.method + ' ' + call.host + call.path;
        recentCallsEl.appendChild(item);
      }

      if (status.lastFinishedSession && status.lastFinishedSession.outputPath) {
        lastSessionEl.textContent = 'Saved ' + status.lastFinishedSession.outputPath + ' with ' + status.lastFinishedSession.numCalls + ' call(s).';
      } else {
        lastSessionEl.textContent = 'No session saved yet.';
      }
    }

    async function refresh() {
      render(await fetchJson('/fullcircle/api/status'));
    }

    document.querySelector('#start-recording').addEventListener('click', async () => {
      const status = await fetchJson('/fullcircle/api/record/start', {method: 'POST', body: '{}'});
      messageEl.textContent = status.message || '';
      render(status);
    });

    document.querySelector('#stop-recording').addEventListener('click', async () => {
      const status = await fetchJson('/fullcircle/api/record/stop', {
        method: 'POST',
        body: JSON.stringify({name: sessionNameEl.value}),
      });
      messageEl.textContent = status.message || 'No active recording session.';
      render(status);
    });

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
