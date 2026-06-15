import Database from 'better-sqlite3';

import {diffDatabaseSnapshots, sqliteDatabase} from '../src/database';

describe('database snapshot and diff API', () => {
    it('captures a SQLite database snapshot with deterministic table rows', async () => {
        const db = createDatabase();
        try {
            db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run('user_2', 'two@example.test', 'Two');
            db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run('user_1', 'one@example.test', 'One');

            const snapshot = await sqliteDatabase(db).snapshot('before checkout');

            expect(snapshot).toEqual({
                name: 'before checkout',
                at: expect.any(String),
                adapter: 'sqlite',
                tables: {
                    users: [
                        {id: 'user_1', email: 'one@example.test', name: 'One'},
                        {id: 'user_2', email: 'two@example.test', name: 'Two'},
                    ],
                    subscriptions: [],
                },
            });
        } finally {
            db.close();
        }
    });

    it('diffs inserted, updated, and deleted SQLite rows by primary key', async () => {
        const db = createDatabase();
        try {
            db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run('user_1', 'one@example.test', 'One');
            db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run('user_2', 'two@example.test', 'Two');

            const database = sqliteDatabase(db);
            const before = await database.snapshot('before');

            db.prepare('UPDATE users SET name = ? WHERE id = ?').run('One Updated', 'user_1');
            db.prepare('DELETE FROM users WHERE id = ?').run('user_2');
            db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run('user_3', 'three@example.test', 'Three');
            db.prepare(`
                INSERT INTO subscriptions (user_id, provider, provider_subscription_id, status)
                VALUES (?, ?, ?, ?)
            `).run('user_1', 'stripe', 'sub_fullcircle_123', 'active');

            const after = await database.snapshot('after');
            const diff = diffDatabaseSnapshots(before, after, 'checkout upgrade');

            expect(diff).toEqual({
                name: 'checkout upgrade',
                from: before.name,
                to: after.name,
                adapter: 'sqlite',
                tables: {
                    users: {
                        inserted: [{id: 'user_3', email: 'three@example.test', name: 'Three'}],
                        updated: [{
                            before: {id: 'user_1', email: 'one@example.test', name: 'One'},
                            after: {id: 'user_1', email: 'one@example.test', name: 'One Updated'},
                        }],
                        deleted: [{id: 'user_2', email: 'two@example.test', name: 'Two'}],
                    },
                    subscriptions: {
                        inserted: [{
                            id: 1,
                            user_id: 'user_1',
                            provider: 'stripe',
                            provider_subscription_id: 'sub_fullcircle_123',
                            status: 'active',
                        }],
                        updated: [],
                        deleted: [],
                    },
                },
            });
        } finally {
            db.close();
        }
    });

    it('can limit snapshots to selected tables', async () => {
        const db = createDatabase();
        try {
            db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run('user_1', 'one@example.test', 'One');

            const snapshot = await sqliteDatabase(db, {tables: ['users']}).snapshot('users only');

            expect(Object.keys(snapshot.tables)).toEqual(['users']);
        } finally {
            db.close();
        }
    });

    it('supports explicit table keys for non-id diff rows', () => {
        const before = {
            name: 'before',
            at: '2026-06-15T00:00:00.000Z',
            adapter: 'postgres',
            tables: {
                accounts: [{slug: 'acme', plan: 'free'}],
            },
        };
        const after = {
            name: 'after',
            at: '2026-06-15T00:00:01.000Z',
            adapter: 'postgres',
            tables: {
                accounts: [{slug: 'acme', plan: 'pro'}],
            },
        };

        expect(diffDatabaseSnapshots(before, after, 'upgrade', {
            tableKeys: {accounts: ['slug']},
        }).tables.accounts).toEqual({
            inserted: [],
            updated: [{
                before: {slug: 'acme', plan: 'free'},
                after: {slug: 'acme', plan: 'pro'},
            }],
            deleted: [],
        });
    });
});

const createDatabase = (): Database.Database => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT NOT NULL
        );
        CREATE TABLE subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            provider_subscription_id TEXT NOT NULL,
            status TEXT NOT NULL
        );
    `);
    return db;
};
