import readline from 'readline';
import {AppDependencies} from './types';

export const initTerminal = async (deps: AppDependencies) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    await deps.sessionManager.startNewSession();

    rl.on('line', async (input) => {
        console.log('\n');

        const text = await deps.sessionManager.finishCurrentSession(input);
        console.log(text);

        await deps.sessionManager.startNewSession();
    });

    console.log('\nType your session name and press Enter to save your session.');
}
