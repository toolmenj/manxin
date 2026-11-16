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

/** 遷移檔資料夾。打包成單一檔案（Docker）時用環境變數指定 */
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export interface PgOptions {
  max?: number;
  ssl?: boolean;
}

export async function connectPg(url: string, o: PgOptions = {}): Promise<DbHandle> {
  const { Pool } = (await import('pg')).default;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new Pool({
    connectionString: url,
    max: o.max ?? 10,
    ssl: o.ssl ? { rejectUnauthorized: true } : undefined,
    // 卡住的查詢與閒置連線不要無限期佔著（review 低：DB 連線設定）
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
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

export const connect = (driver: 'pg' | 'pglite', url: string, o: PgOptions = {}): Promise<DbHandle> =>
  driver === 'pglite' ? connectPglite() : connectPg(url, o);
