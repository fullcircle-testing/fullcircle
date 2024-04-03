(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');
(Symbol as any).dispose ??= Symbol('Symbol.dispose');

import {Page, test as base, expect} from '@playwright/test';
import {FullCircleInstance, TestHarness, fullcircle} from '../../../dist/harness';

import {Todo} from '../../server/src/types/model';

export const test = base.extend<{}, ExtendedFixtures>({
    fc: [async ({}, use) => {
        const fc = await fullcircle({listenAddress: 8000});
        await use(fc);
        await fc.close();
    }, {scope: 'worker'}],
});

type ExtendedFixtures = {
    fc: FullCircleInstance;
}
