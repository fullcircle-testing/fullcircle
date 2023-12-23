import express from 'express';

const handlers: express.Handler[] = [
    (req, res, next) => {
        console.log('called first');
        next('some error');
    },
    (req, res, next) => {
        console.log('called second');
        // next();
    },
    (req, res, next) => {
        console.log('called third');
        next();
    },
];

const req = {} as any;
const res = {} as any;
const next = () => {};

// handlers[0](req, res, () => {
//     handlers[1](req, res, () => {
//         console.log('finished')
//     });
// });

(async () => {
    let err = undefined;
    for (const h of handlers) {
        await new Promise<void>(r => {
            h(req, res, (e) => {
                if (e) {
                    err = e;
                }
                r();
            });
        });
    }
})();
