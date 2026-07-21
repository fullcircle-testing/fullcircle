(Symbol as any).asyncDispose ??= Symbol('Symbol.asyncDispose');

import Database from 'better-sqlite3';
import request from 'supertest';

import {diffDatabaseSnapshots, sqliteDatabase} from '../../src/database';
import {fullcircle} from '../../src/fullcircle';
import {
    supabaseAuthProvider,
    supabaseStorageProvider,
    installSupabaseSqliteAuthSchema,
} from '../../src/providers/supabase';

describe('Supabase auth/storage helpers', () => {
    it('creates confirmed local auth users and sessions in SQLite for snapshot diffs', async () => {
        const db = new Database(':memory:');
        try {
            installSupabaseSqliteAuthSchema(db);
            const snapshots = sqliteDatabase(db, {tables: ['auth_users', 'auth_sessions']});
            const before = await snapshots.snapshot('before auth seed');

            const auth = supabaseAuthProvider({
                supabaseUrl: 'http://127.0.0.1:54321',
                sqlite: db,
                now: () => new Date('2026-06-15T12:00:00.000Z'),
            });
            const user = await auth.users.createPasswordUser({
                email: 'member@example.test',
                password: 'correct horse battery staple',
                confirmed: true,
                userMetadata: {name: 'Member'},
            });
            const session = await auth.sessions.createDatabaseSession(user, {accessToken: 'token_member'});

            expect(user).toMatchObject({
                id: expect.stringMatching(/^usr_/),
                email: 'member@example.test',
                emailConfirmedAt: '2026-06-15T12:00:00.000Z',
                userMetadata: {name: 'Member'},
            });
            expect(session).toMatchObject({
                userId: user.id,
                accessToken: 'token_member',
                tokenType: 'bearer',
            });

            const after = await snapshots.snapshot('after auth seed');
            const diff = diffDatabaseSnapshots(before, after, 'auth seed', {
                tableKeys: {auth_users: ['id'], auth_sessions: ['id']},
            });

            expect(diff.tables.auth_users.inserted).toEqual([expect.objectContaining({
                id: user.id,
                email: 'member@example.test',
                email_confirmed_at: '2026-06-15T12:00:00.000Z',
            })]);
            expect(diff.tables.auth_sessions.inserted).toEqual([expect.objectContaining({
                user_id: user.id,
                access_token: 'token_member',
            })]);
        } finally {
            db.close();
        }
    });

    it('injects browser localStorage sessions without needing a mocked Google OAuth server', async () => {
        const writes: Array<{key: string; value: string}> = [];
        const page = {
            evaluate: async (fn: (payload: {storageKey: string; value: string}) => void, payload: {storageKey: string; value: string}) => {
                writes.push({key: payload.storageKey, value: payload.value});
                fn(payload);
            },
        };
        const auth = supabaseAuthProvider({
            supabaseUrl: 'http://127.0.0.1:54321',
            projectRef: 'local-project',
            now: () => new Date('2026-06-15T12:00:00.000Z'),
        });
        const user = await auth.users.createPasswordUser({email: 'member@example.test', confirmed: true});

        await auth.sessions.loginInBrowser(page, user, {accessToken: 'token_browser'});

        expect(writes).toHaveLength(1);
        expect(writes[0].key).toBe('sb-local-project-auth-token');
        expect(JSON.parse(writes[0].value)).toMatchObject({
            access_token: 'token_browser',
            token_type: 'bearer',
            user: {
                id: user.id,
                email: 'member@example.test',
            },
        });
    });

    it('fixtures Supabase storage signed upload URLs with bucket and object path matching', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: '127.0.0.1:54321',
        });

        await using th = fc.harness('127.0.0.1:54321');
        supabaseStorageProvider(th).signedUploadUrl({
            bucket: 'listing-images',
            objectPath: 'users/user_1/photo.png',
            reply: {
                signedURL: '/storage/v1/object/upload/sign/listing-images/users/user_1/photo.png?token=signed_token',
                token: 'signed_token',
            },
        });

        const response = await request(fc.expressApp)
            .post('/storage/v1/object/upload/sign/listing-images/users/user_1/photo.png')
            .send({upsert: true})
            .expect(200);

        expect(response.body).toEqual({
            signedURL: '/storage/v1/object/upload/sign/listing-images/users/user_1/photo.png?token=signed_token',
            token: 'signed_token',
        });
    });

    it('rejects signed upload URL requests for the wrong bucket or object path', async () => {
        await using fc = await fullcircle({
            listenAddress: null,
            defaultDestination: '127.0.0.1:54321',
        });

        await (async () => {
            await using th = fc.harness('127.0.0.1:54321');
            supabaseStorageProvider(th).signedUploadUrl({
                bucket: 'listing-images',
                objectPath: 'users/user_1/photo.png',
            });

            await request(fc.expressApp)
                .post('/storage/v1/object/upload/sign/avatars/users/user_1/photo.png')
                .expect(404);
        })().then(() => {
            throw new Error('Expected dispose method to throw an error');
        }, error => {
            expect(error.message).toContain('Expected mock "Supabase storage signed upload URL listing-images/users/user_1/photo.png"');
            expect(error.message).toContain('Actual requests received by 127.0.0.1:54321:');
        });
    });
});
