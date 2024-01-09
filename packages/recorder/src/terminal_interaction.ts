import readline from 'readline';
import {AppDependencies} from './types';

export const initTerminal = (deps: AppDependencies) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    deps.sessionManager.startNewSession();

    rl.on('line', async (input) => {
        console.log('\n');

        const text = await deps.sessionManager.finishCurrentSession(input);
        console.log(text);

        deps.sessionManager.startNewSession();
    });

    console.log('\nType your session name and press Enter to save your session.');
}
