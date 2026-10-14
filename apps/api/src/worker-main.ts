/**
 * 獨立的排程 worker（npm run worker）。正式環境建議與 API 分開跑；可以開多個，FOR UPDATE SKIP LOCKED 保證不會重複處理。
 * 注意：開發用的時鐘偏移只存在 API 程序的記憶體裡；獨立 worker 只讀 DEV_CLOCK_OFFSET_MS。開發時建議用 WORKER_INLINE=true。
 */
import { DEFAULT_CALENDAR } from '@manxin/engine';
import pino from 'pino';
import { Clock } from './clock.ts';
import { loadConfig } from './config.ts';
import type { Ctx } from './context.ts';
import { connect } from './db/client.ts';
import { CountyTableCourier } from './services/courier.ts';
import { startWorker } from './services/jobs.ts';
import { ConsoleMailer, ResendMailer } from './services/mailer.ts';
import { LocalDiskStorage } from './services/storage.ts';
import { CwaWeather, MockWeather } from './services/weather.ts';

const cfg = loadConfig();
if (cfg.dbDriver === 'pglite') {
  console.error('DB_DRIVER=pglite 是 API 程序內的記憶體資料庫，獨立 worker 連不到。請用 WORKER_INLINE=true。');
  process.exit(1);
}
const log = pino({ level: 'info' });
const h = await connect(cfg.dbDriver, cfg.databaseUrl);
const ctx: Ctx = {
  cfg,
  db: h.db,
  clock: new Clock(!cfg.isProd, cfg.devClockOffsetMs),
  mailer: cfg.mailer === 'resend' ? new ResendMailer(cfg.resendApiKey, cfg.mailFrom) : new ConsoleMailer(log, cfg.mailFrom),
  weather: cfg.weatherProvider === 'cwa' ? new CwaWeather(cfg.cwaApiKey) : new MockWeather(),
  courier: new CountyTableCourier(),
  storage: new LocalDiskStorage(cfg.uploadDir),
  calendar: DEFAULT_CALENDAR,
  log,
};
const w = startWorker(ctx, cfg.workerIntervalMs);
log.info(`排程 worker 已啟動，每 ${cfg.workerIntervalMs / 1000} 秒輪詢一次`);
const stop = async () => {
  w.stop();
  await h.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
