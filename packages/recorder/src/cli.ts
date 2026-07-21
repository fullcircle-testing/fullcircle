#!/usr/bin/env node
import {Command} from 'commander';

import {listenApp} from './recorder_app';
import {
    DEFAULT_RECORDER_CONFIG_PATH,
    loadRecorderConfig,
    resolveRecorderConfig,
} from './recorder_config';
import {SessionManager} from './session_recording/sessions_manager';
import {initTerminal} from './terminal_interaction';
import {AppDependencies} from './types';

const DEFAULT_HOST = '127.0.0.1';

export const runServerForDestination = async (
    destinationHost: string,
    port: string,
    deps: AppDependencies,
    listenHost = DEFAULT_HOST,
) => new Promise<void>((resolve, reject) => {
    const server = listenApp({
        ...deps,
        defaultDestination: destinationHost,
    }, port, listenHost);

    server.once('error', reject);
    server.once('listening', () => {
        server.off('error', reject);
        console.log(`http://${listenHost}:${port} -> ${destinationHost}`);
        setTimeout(resolve, 50);
    });
});

export const createProgram = () => {
    const program = new Command();

    program
        .name('fc-record')
        .description('CLI to record HTTP request sessions')
        .version('0.0.1');

    program.command('record')
        .description('Record requests')
        .option('-c, --config <path>', 'Recorder config file path', DEFAULT_RECORDER_CONFIG_PATH)
        .option('-d, --destinations <host|port...>', 'Destination/port mappings to proxy and record requests; overrides config destinations')
        .option('-H, --include-headers', 'Include HTTP headers in output; overrides config includeHeaders')
        .option('--host <host>', 'Host/interface to bind recorder servers to; use 0.0.0.0 to opt into remote access', DEFAULT_HOST)
        .action(async (options: {config: string; destinations?: string[]; includeHeaders?: boolean; host: string}) => {
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
                await runServerForDestination(destination.host, destination.port, deps, options.host);
            }

            await initTerminal(deps);

            const shutdown = async () => {
                await sessionManager.finishCurrentSession('');
                process.exit(0);
            };

            process.on('SIGTERM', shutdown);
            process.on('SIGINT', shutdown);
        });

    return program;
};

export const main = async (argv = process.argv) => {
    await createProgram().parseAsync(argv);
};

main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
