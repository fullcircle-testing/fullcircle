import {test, expect} from '@playwright/test';
import {FullCircleInstance, fullcircle} from '../../../packages/harness/src/fullcircle';

import {Todo} from '../../server/src/types/model';

test('shows button', async ({page}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('button')).toBeVisible();
});

test('shows blank todos container', async ({page}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('#todos-container')).toHaveText('');
});

type ExtendedFixtures = {
    externalApi: FullCircleInstance;
}

export const t = test.extend<{}, ExtendedFixtures>({
    externalApi: [async ({}, use) => {
        const fc = await fullcircle({listenAddress: 8000, defaultDestination: 'jsonplaceholder.typicode.com'});
        await use(fc);
    }, {scope: 'worker'}],
});

export const t2 = test.extend<{}, ExtendedFixtures>({
    externalApi: [async ({}, use) => {
        const fc = await fullcircle({listenAddress: 8000, assertionAdapter});
        await use(fc);
    }, {scope: 'worker'}],
});

t('shows todos from mocked response', async ({page, externalApi}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('#todos-container')).toHaveText('');

    {
        await using mockApi = externalApi.harness('');

        // mockApi.mock('/todos', async (req, res) => {
        //     const todos: Todo[] = [{
        //         id: 1,
        //         userId: 1,
        //         title: 'my todo',
        //         completed: false,
        //     }]
        //     res.json(todos);
        // });

        await page.locator('button').click();

        // await expect(page.locator('#todos-container')).toHaveText('my todo');
    }
});
