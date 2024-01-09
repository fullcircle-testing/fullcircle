import {initApp} from './express_app';
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

// Usage: Destination host and local port pairs. A vertical bar is used to join the destination host and local port. The destinations are separated by spaces.
program.command('record')
    .description('Record requests')
    .option('-d, --destinations [host|port...]', 'Destination/port mappings to proxy and record requests')
    .option('-h, --includeHeaders', 'Include HTTP headers in output', false)
    .action(async ({destinations, includeHeaders}: {destinations: string[], includeHeaders: boolean}, options) => {
        console.log(destinations, '\n');

        const sessionManager = new SessionManager();
        const deps: AppDependencies = {
            sessionManager,
            defaultDestination: '',
            includeHeaders,
        };

        for (const dest of destinations) {
            const [host, port] = dest.split('|');
            await runServerForDestination(host, port, deps);
        }

        initTerminal(deps);

        const shutdown = async () => {
            await sessionManager.finishCurrentSession('');
            process.exit(0);
        }

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    });

program.parse();
