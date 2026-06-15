export type FullCircleVitePluginOptions = {
    recorderUrl?: string;
    sessionId?: string;
    enabledInBuild?: boolean;
};

type ViteLikeResolvedConfig = {
    command?: 'serve' | 'build' | string;
};

export type ViteLikePlugin = {
    name: string;
    enforce?: 'pre' | 'post';
    configResolved?: (config: ViteLikeResolvedConfig) => void;
    transformIndexHtml?: (html: string) => string;
};

export const fullCircleVitePlugin = (options: FullCircleVitePluginOptions = {}): ViteLikePlugin => {
    let command = 'serve';

    return {
        name: 'vite-plugin-fullcircle-browser-capture',
        enforce: 'post',
        configResolved(config) {
            command = config.command || command;
        },
        transformIndexHtml(html) {
            if (command === 'build' && !options.enabledInBuild) {
                return html;
            }

            return injectBrowserCapture(html, options);
        },
    };
};

export const injectBrowserCapture = (
    html: string,
    options: FullCircleVitePluginOptions = {},
): string => {
    const script = `<script data-fullcircle-browser-capture>\n${browserCaptureClient(options)}\n</script>`;

    if (html.includes('</head>')) {
        return html.replace('</head>', `${script}\n</head>`);
    }

    return `${script}\n${html}`;
};

const browserCaptureClient = (options: FullCircleVitePluginOptions): string => {
    const config = JSON.stringify({
        recorderUrl: options.recorderUrl || '',
        sessionId: options.sessionId || null,
    });

    return `(() => {
  // FullCircle browser capture injected by Vite.
  const config = ${config};
  const endpoint = (config.recorderUrl || window.location.origin).replace(/\\/$/, '') + '/fullcircle/api/browser-events';
  let lastCorrelationId = 'fc-' + Date.now().toString(36);

  const cssPath = (element) => {
    if (!element || !element.tagName) return undefined;
    if (element.id) return element.tagName.toLowerCase() + '#' + element.id;
    const name = element.getAttribute && element.getAttribute('name');
    if (name) return element.tagName.toLowerCase() + '[name="' + name + '"]';
    return element.tagName.toLowerCase();
  };

  const labelFor = (element) => {
    if (!element) return undefined;
    const aria = element.getAttribute && element.getAttribute('aria-label');
    if (aria) return aria;
    const text = element.innerText || element.textContent || element.value;
    return typeof text === 'string' ? text.trim().slice(0, 120) : undefined;
  };

  const emit = (type, target, extra) => {
    const id = 'browser-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    lastCorrelationId = id;
    const event = {
      id,
      at: new Date().toISOString(),
      correlationId: id,
      event: {
        type,
        url: window.location.href,
        selector: cssPath(target),
        label: labelFor(target),
        value: extra && extra.value,
        metadata: {sessionId: config.sessionId, tagName: target && target.tagName, ...(extra && extra.metadata || {})},
      },
    };
    navigator.sendBeacon
      ? navigator.sendBeacon(endpoint, new Blob([JSON.stringify(event)], {type: 'application/json'}))
      : fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(event), keepalive: true}).catch(() => {});
  };

  document.addEventListener('click', (event) => emit('click', event.target), true);
  document.addEventListener('submit', (event) => emit('submit', event.target), true);
  document.addEventListener('change', (event) => emit('input', event.target, {value: event.target && event.target.value}), true);
  window.addEventListener('popstate', () => emit('navigation', document.body, {metadata: {navigationType: 'popstate'}}));
  window.addEventListener('load', () => emit('navigation', document.body, {metadata: {navigationType: 'load'}}));

  const originalFetch = window.fetch;
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || (input && input.headers) || undefined);
    headers.set('x-fullcircle-correlation-id', lastCorrelationId);
    if (config.sessionId) headers.set('x-fullcircle-session-id', config.sessionId);
    return originalFetch(input, {...init, headers});
  };
})();`;
};
