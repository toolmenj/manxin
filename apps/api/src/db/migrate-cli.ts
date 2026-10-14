/** npm run db:migrate */
import { loadConfig } from '../config.ts';
import { connect } from './client.ts';

const cfg = loadConfig();
if (cfg.dbDriver === 'pglite') {
  console.log('DB_DRIVER=pglite 是記憶體資料庫，啟動時會自動遷移，不需要另外執行。');
  process.exit(0);
}
const h = await connect(cfg.dbDriver, cfg.databaseUrl);
try {
  await h.migrate();
  console.log('資料庫遷移完成。');
} finally {
  await h.close();
}
