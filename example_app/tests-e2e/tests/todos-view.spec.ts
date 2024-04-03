import {Page, expect} from '@playwright/test';

import {test} from '../utils/setup';

import {Todo} from '../../server/src/types/model';

const gotoHome = async (page: Page) => {
    await page.goto('http://localhost:9000');
};

const mockTodos = () => {

}

test.beforeEach(async ({page}) => {
    await gotoHome(page);
});

test.describe('basic loading', () => {
    test('shows button', async ({page}) => {
        await expect(page.locator('button')).toBeVisible();
    });

    test('shows blank todos container', async ({page}) => {
        await expect(page.locator('#todos-container')).toHaveText('');
    });
});

test.describe('with external api', () => {
    test('shows todos from mocked response', async ({page, fc}) => {
        await expect(page.locator('#todos-container')).toHaveText('');

        {
            // await using mockApi = fc.harness('');
            const mockApi = fc.harness('');

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

            await mockApi.closeWithAssertions();
        }
    });

    test('shows todos from mocked response again', async ({page, fc}) => {
        await page.goto('http://localhost:9000');

        await expect(page.locator('#todos-container')).toHaveText('');

        {
            // TODO: figure out why `await using` doesn't work here
            // await using mockApi = externalApi.harness('');
            const mockApi = fc.harness('');

            mockApi.get('/todos', async (req, res) => {
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

            // this should normally be called with `using` cleanup
            await mockApi.closeWithAssertions();
        }
    });

});
