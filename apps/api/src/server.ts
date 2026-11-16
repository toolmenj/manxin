/** npm run dev（開發）／正式環境的 API 程序 */
import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { connect } from './db/client.ts';

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
const h = await connect(cfg.dbDriver, cfg.databaseUrl, { max: cfg.dbPoolMax, ssl: cfg.dbSsl });
if (cfg.dbDriver === 'pglite') {
  // 記憶體資料庫：每次啟動都是空的，自動遷移並放入範例資料
  await h.migrate();
  const { seed } = await import('./db/seed.ts');
  await seed(h.db, cfg);
}
const app = await buildApp({ cfg, db: h.db });
app.addHook('onClose', async () => h.close());

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  // Kubernetes 關 Pod：先停止接新請求、等進行中的請求與排程跑完，再關資料庫連線
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info(
  `慢信 API 已啟動：http://${cfg.host}:${cfg.port}${cfg.apiPrefix}（${cfg.env}，資料庫 ${h.driver}，排程 ${cfg.workerInline ? '同程序' : '獨立 worker'}，寄信 ${cfg.mailer}，檔案 ${cfg.storage}${cfg.webDir ? '，含前端網頁' : ''}）`,
);
