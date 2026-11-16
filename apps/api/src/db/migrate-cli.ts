/**
 * 資料庫遷移（npm run db:migrate；正式環境由 Kubernetes Job 在每次部署前執行一次）。
 * 只需要 DATABASE_URL，不需要寄信等其他設定。
 * 用 PostgreSQL advisory lock 保證同時只有一個程序在遷移（多個 Pod 同時啟動也不會互撞，review M16）。
 */
const url = process.env.DATABASE_URL ?? (process.env.NODE_ENV === 'development' ? 'postgres://manxin:manxin@localhost:5433/manxin' : '');
if (process.env.DB_DRIVER === 'pglite') {
  console.log('DB_DRIVER=pglite 是記憶體資料庫，啟動時會自動遷移，不需要另外執行。');
  process.exit(0);
}
if (!url) {
  console.error('DATABASE_URL 必須設定');
  process.exit(1);
}

const { connectPg, MIGRATIONS_DIR } = await import('./client.ts');
const pg = (await import('pg')).default;
const LOCK_ID = 727_001; // 慢信遷移專用的鎖號碼

const lockClient = new pg.Client({ connectionString: url, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
await lockClient.connect();
const h = await connectPg(url, { max: 2, ssl: process.env.DB_SSL === 'true' });
try {
  console.log('等待遷移鎖…');
  await lockClient.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  console.log(`取得遷移鎖，開始遷移（${MIGRATIONS_DIR}）`);
  await h.migrate();
  console.log('資料庫遷移完成。');
} catch (e) {
  console.error('資料庫遷移失敗：', e);
  process.exitCode = 1;
} finally {
  await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
  await lockClient.end();
  await h.close();
}
