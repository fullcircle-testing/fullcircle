import {initApp} from './express_app';
import {SessionManager} from './session_recording/sessions_manager';
import {initTerminal} from './terminal_interaction';
import {AppDependencies} from './types';

const defaultDestination = process.env.DESTINATION;
const useDestinationHostHeader = process.env.USE_DESTINATION_HOST_HEADER;

if (!defaultDestination && useDestinationHostHeader !== 'true') {
    console.log('Please provide a destination via the DESTINATION enviornment variable, or bypass this check by setting the USE_DESTINATION_HOST_HEADER bool environment variable');
}

import {Command} from 'commander';
const program = new Command();

const runServerForDestination = async (host: string, port: string, deps: AppDependencies) => {
    const app = initApp({
        ...deps,
        defaultDestination: host,
    });

    return new Promise<void>(r => {
        app.listen(port, () => {
            console.log(`http://localhost:${port}`);
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
    .option('-d, --destinations [host|port...]', '')
    .action(async (parsed: {destinations: string[]}, options) => {
        const destinations = parsed.destinations;
        console.log(destinations);

        const includeHeaders = false;

        const sessionManager = new SessionManager();
        const deps: AppDependencies = {
            sessionManager,
            defaultDestination,
            includeHeaders,
        };

        for (const dest of destinations) {
            const [host, port] = dest.split('|');
            await runServerForDestination(host, port, deps);
        }

        initTerminal(deps);
    });

program.parse();
