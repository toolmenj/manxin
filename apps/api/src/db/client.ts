/**
 * 資料庫連線。正式與開發用 PostgreSQL（node-postgres）；
 * 測試或沒有 Docker 時可用 PGlite（WASM 版 PostgreSQL，跑在記憶體裡，SQL 行為相同）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Db;
  driver: 'pg' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function connectPg(url: string): Promise<DbHandle> {
  const { Pool } = (await import('pg')).default;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return {
    db: db as unknown as Db,
    driver: 'pg',
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => pool.end(),
  };
}

export async function connectPglite(dataDir?: string): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    driver: 'pglite',
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close(),
  };
}

export const connect = (driver: 'pg' | 'pglite', url: string): Promise<DbHandle> =>
  driver === 'pglite' ? connectPglite() : connectPg(url);
