import {initApp} from './express_app';
import {
    DEFAULT_RECORDER_CONFIG_PATH,
    loadRecorderConfig,
    resolveRecorderConfig,
} from './recorder_config';
import {SessionManager} from './session_recording/sessions_manager';
import {initTerminal} from './terminal_interaction';
import {AppDependencies} from './types';

import {Command} from 'commander';
const program = new Command();

const runServerForDestination = async (host: string, port: string, deps: AppDependencies) => {
    const app = initApp({
        ...deps,
        defaultDestination: host,
    });

    return new Promise<void>(r => {
        app.listen(port, () => {
            console.log(`http://localhost:${port} -> ${host}`);
            setTimeout(() => {
                r();
            }, 50);
        });
    });
}

program
    .name('fc-record')
    .description('CLI to record HTTP request sessions')
    .version('0.0.1');

program.command('record')
    .description('Record requests')
    .option('-c, --config <path>', 'Recorder config file path', DEFAULT_RECORDER_CONFIG_PATH)
    .option('-d, --destinations <host|port...>', 'Destination/port mappings to proxy and record requests; overrides config destinations')
    .option('-H, --include-headers', 'Include HTTP headers in output; overrides config includeHeaders')
    .action(async (options: {config: string; destinations?: string[]; includeHeaders?: boolean}, command) => {
        const config = loadRecorderConfig(options.config);
        const recorderConfig = resolveRecorderConfig({
            config,
            destinationArgs: options.destinations,
            includeHeadersOverride: options.includeHeaders,
        });

        const sessionManager = new SessionManager();
        const deps: AppDependencies = {
            sessionManager,
            defaultDestination: '',
            includeHeaders: recorderConfig.includeHeaders,
        };

        for (const destination of recorderConfig.destinations) {
            await runServerForDestination(destination.host, destination.port, deps);
        }

        initTerminal(deps);

        const shutdown = async () => {
            await sessionManager.finishCurrentSession('');
            process.exit(0);
        }

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    });

program.parseAsync().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
