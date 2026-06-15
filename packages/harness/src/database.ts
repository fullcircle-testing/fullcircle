import {isDeepStrictEqual} from 'node:util';

export type FullCircleDatabaseSnapshot = {
    name: string;
    at: string;
    adapter: 'sqlite' | 'postgres' | string;
    tables: Record<string, Array<Record<string, unknown>>>;
};

export type FullCircleDatabaseDiff = {
    name: string;
    from: string;
    to: string;
    adapter: 'sqlite' | 'postgres' | string;
    tables: Record<string, FullCircleTableDiff>;
};

export type FullCircleTableDiff = {
    inserted: Array<Record<string, unknown>>;
    updated: Array<{before: Record<string, unknown>; after: Record<string, unknown>}>;
    deleted: Array<Record<string, unknown>>;
};

export type FullCircleDatabaseSnapshotter = {
    snapshot: (name?: string) => Promise<FullCircleDatabaseSnapshot>;
};

export type FullCircleDatabaseAdapter = {
    name: string;
    listTables: () => Promise<string[]>;
    readTable: (table: string) => Promise<Array<Record<string, unknown>>>;
    primaryKeyColumns?: (table: string) => Promise<string[]>;
};

export type FullCircleDatabaseSnapshotOptions = {
    tables?: string[];
};

export type FullCircleDatabaseDiffOptions = {
    tableKeys?: Record<string, string[]>;
};

export type FullCircleSqliteDatabase = {
    prepare: (sql: string) => {
        all: (...params: any[]) => unknown[];
    };
};

export const database = (
    adapter: FullCircleDatabaseAdapter,
    options: FullCircleDatabaseSnapshotOptions = {},
): FullCircleDatabaseSnapshotter => ({
    snapshot: async (name = 'snapshot') => {
        const tableNames = options.tables ?? await adapter.listTables();
        const tables: Record<string, Array<Record<string, unknown>>> = {};

        for (const table of tableNames) {
            tables[table] = await adapter.readTable(table);
        }

        return {
            name,
            at: new Date().toISOString(),
            adapter: adapter.name,
            tables,
        };
    },
});

export const sqliteDatabase = (
    db: FullCircleSqliteDatabase,
    options: FullCircleDatabaseSnapshotOptions = {},
): FullCircleDatabaseSnapshotter => database(sqliteAdapter(db), options);

export const sqliteAdapter = (db: FullCircleSqliteDatabase): FullCircleDatabaseAdapter => ({
    name: 'sqlite',
    listTables: async () => {
        const rows = db.prepare(`
            SELECT name
            FROM sqlite_schema
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `).all() as Array<{name: string}>;

        return rows.map(row => row.name);
    },
    readTable: async (table) => {
        const orderBy = sqliteOrderBy(db, table);
        return db.prepare(`SELECT * FROM ${quoteSqliteIdentifier(table)}${orderBy}`).all() as Array<Record<string, unknown>>;
    },
    primaryKeyColumns: async (table) => sqlitePrimaryKeyColumns(db, table),
});

export const diffDatabaseSnapshots = (
    before: FullCircleDatabaseSnapshot,
    after: FullCircleDatabaseSnapshot,
    name = `${before.name} -> ${after.name}`,
    options: FullCircleDatabaseDiffOptions = {},
): FullCircleDatabaseDiff => {
    if (before.adapter !== after.adapter) {
        throw new Error(`Cannot diff database snapshots from different adapters: ${before.adapter} and ${after.adapter}`);
    }

    const tableNames = [...new Set([
        ...Object.keys(before.tables),
        ...Object.keys(after.tables),
    ])].sort();

    return {
        name,
        from: before.name,
        to: after.name,
        adapter: after.adapter,
        tables: Object.fromEntries(
            tableNames.map(table => [
                table,
                diffRows(before.tables[table] || [], after.tables[table] || [], options.tableKeys?.[table]),
            ]),
        ),
    };
};

const diffRows = (
    beforeRows: Array<Record<string, unknown>>,
    afterRows: Array<Record<string, unknown>>,
    keyColumns?: string[],
): FullCircleTableDiff => {
    const beforeByKey = rowsByStableKey(beforeRows, keyColumns);
    const afterByKey = rowsByStableKey(afterRows, keyColumns);
    const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();

    const inserted: Array<Record<string, unknown>> = [];
    const updated: Array<{before: Record<string, unknown>; after: Record<string, unknown>}> = [];
    const deleted: Array<Record<string, unknown>> = [];

    for (const key of keys) {
        const before = beforeByKey.get(key);
        const after = afterByKey.get(key);

        if (!before && after) {
            inserted.push(after);
            continue;
        }

        if (before && !after) {
            deleted.push(before);
            continue;
        }

        if (before && after && !isDeepStrictEqual(before, after)) {
            updated.push({before, after});
        }
    }

    return {inserted, updated, deleted};
};

const rowsByStableKey = (
    rows: Array<Record<string, unknown>>,
    keyColumns?: string[],
): Map<string, Record<string, unknown>> => {
    const keys = keyColumns ?? inferStableKeyColumns(rows);
    return new Map(rows.map((row, index) => [rowKey(row, keys, index), row]));
};

const inferStableKeyColumns = (rows: Array<Record<string, unknown>>): string[] | undefined => {
    const candidateKeys = ['id', 'event_id'];
    const key = candidateKeys.find(candidate => rows.every(row => row[candidate] !== undefined));
    return key ? [key] : undefined;
};

const rowKey = (row: Record<string, unknown>, keys: string[] | undefined, index: number): string => {
    if (!keys) {
        return `row:${index}:${JSON.stringify(row)}`;
    }

    return keys.map(key => `${key}:${JSON.stringify(row[key])}`).join('|');
};

const sqliteOrderBy = (db: FullCircleSqliteDatabase, table: string): string => {
    const primaryKeys = sqlitePrimaryKeyColumns(db, table);
    if (primaryKeys.length) {
        return ` ORDER BY ${primaryKeys.map(quoteSqliteIdentifier).join(', ')}`;
    }

    return ' ORDER BY rowid';
};

const sqlitePrimaryKeyColumns = (db: FullCircleSqliteDatabase, table: string): string[] => {
    const rows = db.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`).all() as Array<{
        name: string;
        pk: number;
    }>;

    return rows
        .filter(row => row.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(row => row.name);
};

const quoteSqliteIdentifier = (identifier: string): string => {
    return `"${identifier.replaceAll('"', '""')}"`;
};
