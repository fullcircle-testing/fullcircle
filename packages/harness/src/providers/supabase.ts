import crypto from 'node:crypto';

import type {TestHarness} from '../harness';
import {response} from '../primitives';

export type SupabaseSqliteDatabase = {
    exec: (sql: string) => unknown;
    prepare: (sql: string) => {
        run: (...params: any[]) => unknown;
    };
};

export type SupabaseAuthProviderOptions = {
    supabaseUrl: string;
    projectRef?: string;
    sqlite?: SupabaseSqliteDatabase;
    now?: () => Date;
};

export type SupabasePasswordUserInput = {
    id?: string;
    email: string;
    password?: string;
    confirmed?: boolean;
    appMetadata?: Record<string, unknown>;
    userMetadata?: Record<string, unknown>;
};

export type SupabaseAuthUser = {
    id: string;
    email: string;
    emailConfirmedAt: string | null;
    appMetadata: Record<string, unknown>;
    userMetadata: Record<string, unknown>;
    createdAt: string;
};

export type SupabaseAuthSessionOptions = {
    id?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
};

export type SupabaseAuthSession = {
    id: string;
    userId: string;
    accessToken: string;
    refreshToken: string;
    tokenType: 'bearer';
    expiresAt: number;
    createdAt: string;
};

export type SupabaseBrowserPage = {
    evaluate: (
        fn: (payload: {storageKey: string; value: string}) => void | Promise<void>,
        payload: {storageKey: string; value: string},
    ) => Promise<void> | void;
};

export type SupabaseAuthProviderHarness = {
    users: {
        createPasswordUser: (input: SupabasePasswordUserInput) => Promise<SupabaseAuthUser>;
    };
    sessions: {
        createDatabaseSession: (
            user: SupabaseAuthUser,
            options?: SupabaseAuthSessionOptions,
        ) => Promise<SupabaseAuthSession>;
        loginInBrowser: (
            page: SupabaseBrowserPage,
            user: SupabaseAuthUser,
            options?: SupabaseAuthSessionOptions,
        ) => Promise<SupabaseAuthSession>;
    };
};

export type SupabaseStorageSignedUploadUrlExpectation = {
    bucket: string;
    objectPath: string;
    reply?: {
        signedURL: string;
        token: string;
    };
    status?: number;
};

export type SupabaseStorageProviderHarness = {
    signedUploadUrl: (expectation: SupabaseStorageSignedUploadUrlExpectation) => void;
};

export const installSupabaseSqliteAuthSchema = (db: SupabaseSqliteDatabase): void => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS auth_users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            encrypted_password TEXT,
            email_confirmed_at TEXT,
            app_metadata TEXT NOT NULL,
            user_metadata TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            token_type TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
    `);
};

export const supabaseAuthProvider = (
    options: SupabaseAuthProviderOptions,
): SupabaseAuthProviderHarness => {
    const clock = options.now || (() => new Date());

    const createSession = async (
        user: SupabaseAuthUser,
        sessionOptions: SupabaseAuthSessionOptions = {},
    ): Promise<SupabaseAuthSession> => {
        const now = clock();
        const createdAt = now.toISOString();
        const expiresAt = Math.floor(now.getTime() / 1000) + (sessionOptions.expiresIn ?? 3600);
        const session: SupabaseAuthSession = {
            id: sessionOptions.id || deterministicId('ses', user.id, createdAt),
            userId: user.id,
            accessToken: sessionOptions.accessToken || deterministicId('access', user.id, createdAt),
            refreshToken: sessionOptions.refreshToken || deterministicId('refresh', user.id, createdAt),
            tokenType: 'bearer',
            expiresAt,
            createdAt,
        };

        insertSession(options.sqlite, session);
        return session;
    };

    return {
        users: {
            createPasswordUser: async input => {
                const createdAt = clock().toISOString();
                const user: SupabaseAuthUser = {
                    id: input.id || deterministicId('usr', input.email),
                    email: input.email,
                    emailConfirmedAt: input.confirmed ? createdAt : null,
                    appMetadata: input.appMetadata || {provider: 'email', providers: ['email']},
                    userMetadata: input.userMetadata || {},
                    createdAt,
                };

                insertUser(options.sqlite, user, input.password);
                return user;
            },
        },
        sessions: {
            createDatabaseSession: createSession,
            loginInBrowser: async (page, user, sessionOptions) => {
                const session = await createSession(user, sessionOptions);
                await page.evaluate((payload) => {
                    globalThis.localStorage?.setItem(payload.storageKey, payload.value);
                }, {
                    storageKey: supabaseStorageKey(options),
                    value: JSON.stringify(browserSessionPayload(user, session)),
                });
                return session;
            },
        },
    };
};

export const supabaseStorageProvider = (harness: TestHarness): SupabaseStorageProviderHarness => ({
    signedUploadUrl: expectation => {
        const path = `/storage/v1/object/upload/sign/${expectation.bucket}/${expectation.objectPath}`;
        harness.mockRoute({
            method: 'POST',
            path,
        }, () => response.json(expectation.reply || {
            signedURL: `${path}?token=${deterministicId('signed', expectation.bucket, expectation.objectPath)}`,
            token: deterministicId('signed', expectation.bucket, expectation.objectPath),
        }, {status: expectation.status || 200}), {
            name: `Supabase storage signed upload URL ${expectation.bucket}/${expectation.objectPath}`,
        });
    },
});

const insertUser = (
    db: SupabaseSqliteDatabase | undefined,
    user: SupabaseAuthUser,
    password: string | undefined,
): void => {
    if (!db) {
        return;
    }

    db.prepare(`
        INSERT INTO auth_users (
            id,
            email,
            encrypted_password,
            email_confirmed_at,
            app_metadata,
            user_metadata,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        user.id,
        user.email,
        password ? testPasswordHash(password) : null,
        user.emailConfirmedAt,
        JSON.stringify(user.appMetadata),
        JSON.stringify(user.userMetadata),
        user.createdAt,
        user.createdAt,
    );
};

const insertSession = (
    db: SupabaseSqliteDatabase | undefined,
    session: SupabaseAuthSession,
): void => {
    if (!db) {
        return;
    }

    db.prepare(`
        INSERT INTO auth_sessions (
            id,
            user_id,
            access_token,
            refresh_token,
            token_type,
            expires_at,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        session.id,
        session.userId,
        session.accessToken,
        session.refreshToken,
        session.tokenType,
        session.expiresAt,
        session.createdAt,
    );
};

const browserSessionPayload = (
    user: SupabaseAuthUser,
    session: SupabaseAuthSession,
) => ({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: session.tokenType,
    expires_at: session.expiresAt,
    expires_in: Math.max(0, session.expiresAt - Math.floor(Date.parse(session.createdAt) / 1000)),
    user: {
        id: user.id,
        email: user.email,
        app_metadata: user.appMetadata,
        user_metadata: user.userMetadata,
        email_confirmed_at: user.emailConfirmedAt,
        created_at: user.createdAt,
    },
});

const supabaseStorageKey = (options: SupabaseAuthProviderOptions): string => {
    return `sb-${options.projectRef || projectRefFromUrl(options.supabaseUrl)}-auth-token`;
};

const projectRefFromUrl = (supabaseUrl: string): string => {
    const host = new URL(supabaseUrl).host;
    const firstSegment = host.split('.')[0];
    return firstSegment.replace(/[^a-zA-Z0-9_-]/g, '-');
};

const deterministicId = (prefix: string, ...parts: string[]): string => {
    const hash = crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
    return `${prefix}_${hash}`;
};

const testPasswordHash = (password: string): string => {
    return `fullcircle-test-sha256:${crypto.createHash('sha256').update(password).digest('hex')}`;
};
