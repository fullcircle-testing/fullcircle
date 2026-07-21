# FullCircle Supabase Auth, Storage, and Database Helpers

Bead: `fullcircle-64o.17 — Add Supabase auth storage and database helpers`

## Scope

These helpers support routine user-account e2e tests without standing up a fake Google OAuth server. The preferred flow is:

1. seed a local test user/session directly;
2. inject a browser auth session into localStorage;
3. run the app flow against local Supabase or mocked storage endpoints;
4. use FullCircle database snapshots/diffs to assert rows added by the flow.

Mock provider OAuth only for callback wiring tests. Normal login tests should use deterministic auth/session helpers.

## Auth helpers

```ts
installSupabaseSqliteAuthSchema(db);

const auth = supabaseAuthProvider({
  supabaseUrl: 'http://127.0.0.1:54321',
  projectRef: 'local-project',
  sqlite: db,
});

const user = await auth.users.createPasswordUser({
  email: 'member@example.test',
  password: 'test-password',
  confirmed: true,
  userMetadata: { name: 'Member' },
});

await auth.sessions.createDatabaseSession(user);
await auth.sessions.loginInBrowser(page, user);
```

`installSupabaseSqliteAuthSchema()` creates lightweight `auth_users` and `auth_sessions` tables for greenfield SQLite-first apps and examples. This is not a complete Supabase Postgres schema; it is a deterministic fixture schema for FullCircle tests. App-specific adapters can map these returned user/session objects into their real auth tables later.

`loginInBrowser()` writes the Supabase browser session payload to `sb-<project-ref>-auth-token` via `page.evaluate()`. Passing `projectRef` is recommended for local URLs; otherwise FullCircle derives a stable key from the Supabase URL host.

## Database diff integration

The helpers are designed to work with the existing database snapshot API:

```ts
const snapshots = sqliteDatabase(db, { tables: ['auth_users', 'auth_sessions', 'subscriptions'] });
const before = await snapshots.snapshot('before auth flow');

const user = await auth.users.createPasswordUser({ email, confirmed: true });
await auth.sessions.createDatabaseSession(user);

const after = await snapshots.snapshot('after auth flow');
const diff = diffDatabaseSnapshots(before, after, 'auth flow', {
  tableKeys: { auth_users: ['id'], auth_sessions: ['id'] },
});
```

This keeps seed data and expected app-side row diffs in one artifact-friendly format.

## Storage signed upload URLs

```ts
supabaseStorageProvider(harness).signedUploadUrl({
  bucket: 'listing-images',
  objectPath: 'users/user_1/photo.png',
  reply: {
    signedURL: '/storage/v1/object/upload/sign/listing-images/users/user_1/photo.png?token=signed_token',
    token: 'signed_token',
  },
});
```

The storage helper fixtures `POST /storage/v1/object/upload/sign/:bucket/:objectPath`, with strict path matching so a test cannot accidentally satisfy the wrong bucket or object path.

## Acceptance tests

`packages/harness/tests/providers/supabase.test.ts` verifies:

1. confirmed auth users and sessions can be inserted into SQLite and observed with snapshot diffs;
2. browser login writes a Supabase-compatible localStorage session key/value;
3. storage signed upload URLs are fixtureable for image upload flows;
4. wrong bucket/object path requests fail and show harness diagnostics.

## Non-goals

- Do not emulate Google OAuth for routine login tests.
- Do not claim the SQLite fixture schema is a full Supabase auth schema.
- Do not mock every Supabase storage API yet; signed upload URLs are the first Soundspace-relevant flow.
