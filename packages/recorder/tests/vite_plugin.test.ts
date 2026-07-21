import {fullCircleVitePlugin} from '../src/vite_plugin';

describe('FullCircle Vite browser capture plugin', () => {
    it('injects browser capture configuration into Vite HTML', () => {
        const plugin = fullCircleVitePlugin({
            recorderUrl: 'http://127.0.0.1:4010',
            sessionId: 'session_test_123',
        });

        const html = plugin.transformIndexHtml!('<html><head></head><body><div id="app"></div></body></html>') as string;

        expect(html).toContain('FullCircle browser capture injected by Vite');
        expect(html).toContain('"recorderUrl":"http://127.0.0.1:4010"');
        expect(html).toContain('"sessionId":"session_test_123"');
        expect(html).toContain('/fullcircle/api/browser-events');
        expect(html).toContain('x-fullcircle-correlation-id');
    });

    it('does not inject browser capture in build mode unless explicitly enabled', () => {
        const plugin = fullCircleVitePlugin();
        plugin.configResolved?.({command: 'build'});

        expect(plugin.transformIndexHtml!('<html><head></head><body></body></html>')).toBe('<html><head></head><body></body></html>');
    });
});
