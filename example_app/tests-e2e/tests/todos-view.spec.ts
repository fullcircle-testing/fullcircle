(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import {ChildProcess, spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

import {test, expect} from '@playwright/test';

import {fullcircle} from '../../../packages/harness/src/fullcircle';
import {Todo} from '../../server/src/types/model';

const getFreePort = async (): Promise<number> => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
            reject(new Error('Expected TCP address'));
            return;
        }

        const port = address.port;
        server.close(() => resolve(port));
    });
});

const waitForPort = async (port: number, timeoutMs = 30_000): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await canConnect(port)) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for example app to listen on port ${port}`);
};

const canConnect = (port: number): Promise<boolean> => new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
        socket.destroy();
        resolve(true);
    });
    socket.once('error', () => resolve(false));
});

const startExampleApp = async (externalUrl: string) => {
    const port = await getFreePort();
    const serverDir = path.resolve(__dirname, '../../server');
    const child = spawn('npm', ['run', 'start-with-fc', '--prefix', serverDir], {
        env: {
            ...process.env,
            PORT: String(port),
            FULLCIRCLE_HOST: externalUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const output: string[] = [];
    child.stdout?.on('data', chunk => output.push(chunk.toString()));
    child.stderr?.on('data', chunk => output.push(chunk.toString()));

    try {
        await waitForPort(port);
    } catch (error) {
        await stopProcess(child, output).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nExample app output:\n${output.join('')}`);
    }

    return {
        url: `http://127.0.0.1:${port}`,
        close: () => stopProcess(child, output),
    };
};

const stopProcess = async (child: ChildProcess, output: string[]) => {
    if (child.exitCode !== null) {
        return;
    }

    child.kill('SIGTERM');
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`Timed out stopping example app:\n${output.join('')}`));
        }, 5_000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
};

test('shows button', async ({page}) => {
    const app = await startExampleApp('http://127.0.0.1:1');
    try {
        await page.goto(app.url);

        await expect(page.locator('button')).toBeVisible();
        await expect(page.locator('script[src^="https://unpkg.com"]')).toHaveCount(0);
    } finally {
        await app.close();
    }
});

test('shows blank todos container', async ({page}) => {
    const app = await startExampleApp('http://127.0.0.1:1');
    try {
        await page.goto(app.url);

        await expect(page.locator('#todos-container')).toHaveText('');
    } finally {
        await app.close();
    }
});

test('shows todos from a FullCircle-controlled external service response', async ({page}) => {
    await using fc = await fullcircle({listenAddress: 0, defaultDestination: 'jsonplaceholder.typicode.com'});
    await using harness = fc.harness('jsonplaceholder.typicode.com');
    const app = await startExampleApp(fc.url);

    try {
        await page.goto(app.url);

        await expect(page.locator('#todos-container')).toHaveText('');

        harness.mock('/todos', async (req, res) => {
            const todos: Todo[] = [{
                id: 1,
                userId: 1,
                title: 'my todo',
                completed: false,
            }];
            res.json(todos);
        });

        await page.locator('button').click();

        await expect(page.locator('#todos-container')).toHaveText('my todo');
    } finally {
        await app.close();
    }
});
