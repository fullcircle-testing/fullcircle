(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import express from 'express';
import request from 'supertest';

import {FullCircleInstance, fullcircle} from '../../../dist/harness';
import {initApp} from '../src/server';

import savedPostsTestData from './testdata/posts.json';

describe('Example app', () => {
    let fc: FullCircleInstance;
    let app: express.Express;

    beforeEach(() => {
        app = initApp({externalUrl: 'http://localhost:7887'});
    });

    beforeAll(async () => {
        fc = await fullcircle({listenAddress: 7887, defaultDestination: 'jsonplaceholder.typicode.com'});
    });

    afterAll(async () => {
        await fc.close();
    });

    it('integrates with fullcircle', async () => {
        try {
            await using th = fc.harness('jsonplaceholder.typicode.com');

            th.get('/posts', (req, res) => {
                res.json({data: 'My mocked data'});
            });

            const response = await request(app)
            .get('/api/posts')
            .expect(200)

            expect(response.body).toEqual({data: 'My mocked data'});
        } catch (e) {
            console.error(e);
            expect(e).toBe(null);
        }
    });

    it('integrates with fullcircle - multiple requests', async () => {
        {
            await using th = fc.harness('jsonplaceholder.typicode.com');

            th.get('/posts', (req, res) => {
                res.json({data: 'My first mocked data'});
            });

            th.get('/posts', (req, res) => {
                res.json({data: 'My second mocked data'});
            });

            const response1 = await request(app)
                .get('/api/posts')
                .expect(200);

            const response2 = await request(app)
                .get('/api/posts')
                .expect(200);

            expect(response1.body).toEqual({data: 'My first mocked data'});
            expect(response2.body).toEqual({data: 'My second mocked data'});
        }

        {
            await using th = fc.harness('jsonplaceholder.typicode.com');

            th.get('/posts', (req, res) => {
                res.json({data: 'My third mocked data'});
            });

            th.get('/posts', (req, res) => {
                res.json({data: 'My fourth mocked data'});
            });

            const response3 = await request(app)
                .get('/api/posts')
                .expect(200);

            const response4 = await request(app)
                .get('/api/posts')
                .expect(200);

            expect(response3.body).toEqual({data: 'My third mocked data'});
            expect(response4.body).toEqual({data: 'My fourth mocked data'});
        }
    });

    it('integrates with fullcircle - with stored data', async () => {
        await using th = fc.harness('jsonplaceholder.typicode.com');

        const mockResponse = savedPostsTestData;

        th.get('/posts', (req, res) => {
            res.json(mockResponse);
        });

        const response = await request(app)
            .get('/api/posts')
            .expect(200)

        expect(response.body).toEqual(mockResponse);
        expect(mockResponse).toHaveLength(100);
    });
});
