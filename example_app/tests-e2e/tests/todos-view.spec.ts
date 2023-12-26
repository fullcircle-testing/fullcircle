(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');
(Symbol as any).dispose ??= Symbol('Symbol.dispose');

import {test as base, expect} from '@playwright/test';
import {FullCircleInstance, fullcircle} from '../../../packages/harness/src/fullcircle';

import {Todo} from '../../server/src/types/model';

type ExtendedFixtures = {
    externalApi: FullCircleInstance;
}

// export const t = base.extend<{}, ExtendedFixtures>({
//     externalApi: [async ({}, use) => {
//         const fc = await fullcircle({listenAddress: 8000, defaultDestination: 'jsonplaceholder.typicode.com'});
//         await use(fc);
//     }, {scope: 'worker'}],
// });

export const test = base.extend<{}, ExtendedFixtures>({
    externalApi: [async ({}, use) => {
        const fc = await fullcircle({listenAddress: 8000});
        // const fc = await fullcircle({listenAddress: 8000, assertionAdapter});
        await use(fc);
        await fc.close();
    }, {scope: 'worker'}],
});

test('shows button', async ({page}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('button')).toBeVisible();
});

test('shows blank todos container', async ({page}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('#todos-container')).toHaveText('');
});

test('shows todos from mocked response', async ({page, externalApi}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('#todos-container')).toHaveText('');

    {
        // TODO: figure out why `await using` doesn't work here
        // await using mockApi = externalApi.harness('');
        const mockApi = externalApi.harness('');

        await using d = {async [Symbol.asyncDispose]() {

        }}

        mockApi.get('/todos', async (req, res) => {
            const todos: Todo[] = [{
                id: 1,
                userId: 1,
                title: 'my todo',
                completed: false,
            }]
            res.json(todos);
        });

        await page.locator('button').click();

        await expect(page.locator('#todos-container')).toHaveText('my todo');

        // this should normally be called with `using` cleanup
        await mockApi.close();
    }
});

test('shows todos from mocked response2', async ({page, externalApi}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('#todos-container')).toHaveText('');

    {
        // TODO: figure out why `await using` doesn't work here
        // await using mockApi = externalApi.harness('');
        const mockApi = externalApi.harness('');

        await using d = {async [Symbol.asyncDispose]() {

        }}

        mockApi.get('/todos', async (req, res) => {
            const todos: Todo[] = [{
                id: 1,
                userId: 1,
                title: 'my todo',
                completed: false,
            }]
            res.json(todos);
        });

        await page.locator('button').click();

        await expect(page.locator('#todos-container')).toHaveText('my todo');

        // this should normally be called with `using` cleanup
        await mockApi.close();
    }
});
