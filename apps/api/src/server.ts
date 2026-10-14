/** npm run dev／npm start */
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { connect } from './db/client.ts';

const cfg = loadConfig();
const h = await connect(cfg.dbDriver, cfg.databaseUrl);
if (cfg.dbDriver === 'pglite') {
  // 記憶體資料庫：每次啟動都是空的，自動遷移並放入範例資料
  await h.migrate();
  const { seed } = await import('./db/seed.ts');
  await seed(h.db, cfg);
}
const app = await buildApp({ cfg, db: h.db });
app.addHook('onClose', async () => h.close());

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info(
  `慢信 API 已啟動：http://${cfg.host}:${cfg.port}（資料庫 ${h.driver}，排程 ${cfg.workerInline ? '同程序' : '另開 npm run worker'}，時鐘偏移 ${app.ctx.clock.offsetMs} ms）`,
);
