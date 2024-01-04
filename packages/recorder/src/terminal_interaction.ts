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
        console.log('Saving current session');

        const text = await deps.sessionManager.finishCurrentSession(input);
        console.log(text);

        deps.sessionManager.startNewSession();
    });

    console.log('Press Enter to save the current session.');
}
