import {test, expect} from '@playwright/test';
import {fullcircle} from '../../../packages/harness/src/fullcircle';

import {Todo} from '../../server/src/types/model';

test('shows button', async ({page}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('button')).toBeVisible();
});

test('shows blank todos container', async ({page}) => {
    await page.goto('http://localhost:9000');

    await expect(page.locator('#todos-container')).toHaveText('');
});

test('shows todos from mocked response', async ({page}) => {
    await using fc = await fullcircle({listenAddress: '8000', defaultDestination: 'jsonplaceholder.typicode.com'});
    await using harness = fc.harness('jsonplaceholder.typicode.com');

    await page.goto('http://localhost:9000');

    await expect(page.locator('#todos-container')).toHaveText('');

    harness.mock('/todos', async (req, res) => {
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
});
