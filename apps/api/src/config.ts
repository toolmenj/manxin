/** 環境變數。秘密只放 .env（不進版控），範例見根目錄 .env.example。 */
import path from 'node:path';

export interface Config {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  port: number;
  host: string;
  appUrl: string;
  dbDriver: 'pg' | 'pglite';
  databaseUrl: string;
  appSecret: string;
  mailer: 'console' | 'resend';
  mailFrom: string;
  resendApiKey: string | undefined;
  weatherProvider: 'mock' | 'cwa';
  cwaApiKey: string | undefined;
  uploadDir: string;
  uploadMaxBytes: number;
  workerInline: boolean;
  workerIntervalMs: number;
  devClockOffsetMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const nodeEnv = (env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development') as Config['env'];
  const isProd = nodeEnv === 'production';
  const appSecret = env.APP_SECRET ?? (isProd ? '' : 'dev-only-secret-do-not-use-in-production');
  if (isProd && (!appSecret || appSecret.length < 32)) {
    throw new Error('APP_SECRET 必須設定且至少 32 個字元');
  }
  const cfg: Config = {
    env: nodeEnv,
    isProd,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    dbDriver: env.DB_DRIVER === 'pglite' ? 'pglite' : 'pg',
    databaseUrl: env.DATABASE_URL ?? 'postgres://manxin:manxin@localhost:5433/manxin',
    appSecret,
    mailer: env.MAILER === 'resend' ? 'resend' : 'console',
    mailFrom: env.MAIL_FROM ?? '慢信 <letters@manxin.example>',
    resendApiKey: env.RESEND_API_KEY,
    weatherProvider: env.WEATHER_PROVIDER === 'cwa' ? 'cwa' : 'mock',
    cwaApiKey: env.CWA_API_KEY,
    uploadDir: path.resolve(env.UPLOAD_DIR ?? './uploads'),
    uploadMaxBytes: Number(env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024),
    workerInline: (env.WORKER_INLINE ?? 'true') !== 'false',
    workerIntervalMs: Number(env.WORKER_INTERVAL_MS ?? 30_000),
    // 正式環境一律不允許時鐘偏移
    devClockOffsetMs: isProd ? 0 : Number(env.DEV_CLOCK_OFFSET_MS ?? 0) || 0,
    ...overrides,
  };
  return cfg;
}
