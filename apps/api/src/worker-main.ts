/**
 * 獨立的排程 worker（D-033：正式環境與 API 分開部署）。可以開多個，FOR UPDATE SKIP LOCKED 保證不會重複處理。
 * 也負責把待寄的信透過 SMTP 寄出（outbox）。
 * 注意：開發用的時鐘偏移只存在 API 程序的記憶體裡；獨立 worker 只讀 DEV_CLOCK_OFFSET_MS。開發時建議用 WORKER_INLINE=true。
 */
import { DEFAULT_CALENDAR } from '@manxin/engine';
import pino from 'pino';
import { Clock } from './clock.ts';
import { ConfigError, loadConfig } from './config.ts';
import type { Ctx } from './context.ts';
import { connect } from './db/client.ts';
import { makeCourier, makeMailer, makeStorage, makeWeather } from './runtime.ts';
import { startWorker } from './services/jobs.ts';

const log = pino({ level: 'info' });
let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    log.fatal(e.message);
    process.exit(1);
  }
  throw e;
}
if (cfg.dbDriver === 'pglite') {
  log.fatal('DB_DRIVER=pglite 是 API 程序內的記憶體資料庫，獨立 worker 連不到。請用 WORKER_INLINE=true。');
  process.exit(1);
}
const h = await connect(cfg.dbDriver, cfg.databaseUrl, { max: cfg.dbPoolMax, ssl: cfg.dbSsl });
const ctx: Ctx = {
  cfg,
  db: h.db,
  clock: new Clock(!cfg.isProd, cfg.devClockOffsetMs),
  mailer: makeMailer(cfg, log),
  weather: makeWeather(cfg, log),
  courier: makeCourier(),
  storage: makeStorage(cfg),
  calendar: DEFAULT_CALENDAR,
  log,
};
const w = startWorker(ctx, cfg.workerIntervalMs);
log.info(`排程 worker 已啟動，每 ${cfg.workerIntervalMs / 1000} 秒輪詢一次（寄信：${cfg.mailer}）`);

let stopping = false;
const stop = async (sig: string) => {
  if (stopping) return;
  stopping = true;
  log.info(`收到 ${sig}，等這一輪跑完再結束`);
  await w.stop();
  await h.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
