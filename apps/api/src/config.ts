/**
 * 環境變數。秘密只放 .env 或 Kubernetes Secret（不進版控），範例見根目錄 .env.example。
 *
 * 安全原則（review H4、H5）：
 * - 只有 NODE_ENV 明確是 development 或 test 才是開發環境；沒設、拼錯、staging 一律當正式環境。
 * - 開發用路由（本機信箱、快轉）必須 ENABLE_DEV_ROUTES=true 而且是開發環境才會註冊。
 * - 正式環境的必填設定缺少或格式不對就拒絕啟動，不會默默用開發預設值。
 */
import path from 'node:path';

export interface Config {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  port: number;
  host: string;
  appUrl: string;
  /** API 路由前綴。正式環境前端與 API 同一個網址，API 在 /api 底下；開發時 Vite proxy 已去掉前綴 */
  apiPrefix: string;
  /** 前端建置結果（apps/web/dist）。有設就由 API 程序一起提供網頁（正式環境用） */
  webDir: string | undefined;
  dbDriver: 'pg' | 'pglite';
  databaseUrl: string;
  dbPoolMax: number;
  dbSsl: boolean;
  appSecret: string;
  mailer: 'console' | 'smtp';
  mailFrom: string;
  smtp: { host: string; port: number; secure: boolean; user: string | undefined; pass: string | undefined };
  weatherProvider: 'mock' | 'cwa';
  cwaApiKey: string | undefined;
  /** 檔案存放：disk（開發）或 db（存進 PostgreSQL，正式環境，多個 API 副本共用） */
  storage: 'disk' | 'db';
  uploadDir: string;
  uploadMaxBytes: number;
  /** 字型檔上限（中文字型常常十幾 MB，和圖片分開設） */
  fontMaxBytes: number;
  workerInline: boolean;
  workerIntervalMs: number;
  devClockOffsetMs: number;
  enableDevRoutes: boolean;
  /** 前面有 Ingress／反向代理時設 true，才會用 X-Forwarded-For 判斷使用者 IP（頻率限制用） */
  trustProxy: boolean;
  /** 管理員信箱（逗號分隔）。用這些信箱登入才看得到 /admin（只有數字與狀態，看不到信件內容） */
  adminEmails: string[];
  /** 聯絡信箱（隱私權政策、使用條款、停權說明上顯示）。部署時設定，不寫死在程式裡 */
  contactEmail: string;
  /** 寄信上限（防騷擾）：每人每 24 小時幾封、同一個收件信箱每 24 小時幾封 */
  sendLimit: { perDay: number; perRecipient: number };
  /** 頻率限制開關（測試預設關，個別測試再打開） */
  rateLimit: boolean;
}

/** .env.example 與文件裡出現過的範例密鑰，正式環境拒絕使用 */
const KNOWN_EXAMPLE_SECRETS = new Set([
  'dev-only-secret-do-not-use-in-production',
  'change-me-to-a-long-random-string-at-least-32-chars',
  'replace-with-64-random-hex-chars-openssl-rand-hex-32',
]);

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`設定不正確，拒絕啟動：\n- ${problems.join('\n- ')}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const nodeEnv: Config['env'] = env.NODE_ENV === 'development' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'production';
  const isProd = nodeEnv === 'production';
  const problems: string[] = [];

  const int = (name: string, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name} 必須是 ${min}～${max} 的整數（目前是「${raw}」）`);
      return def;
    }
    return n;
  };
  const bool = (name: string, def: boolean): boolean => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    problems.push(`${name} 只能是 true 或 false（目前是「${raw}」）`);
    return def;
  };

  const appSecret = env.APP_SECRET ?? (isProd ? '' : 'dev-only-secret-do-not-use-in-production');
  const appUrl = (env.APP_URL ?? (isProd ? '' : 'http://localhost:5173')).replace(/\/$/, '');
  const mailerRaw = env.MAILER ?? (isProd ? 'smtp' : 'console');

  const cfg: Config = {
    env: nodeEnv,
    isProd,
    port: int('PORT', 3000, 1, 65535),
    host: env.HOST ?? (isProd ? '0.0.0.0' : '127.0.0.1'),
    appUrl,
    apiPrefix: (env.API_PREFIX ?? (isProd ? '/api' : '')).replace(/\/$/, ''),
    webDir: env.WEB_DIR ? path.resolve(env.WEB_DIR) : undefined,
    dbDriver: env.DB_DRIVER === 'pglite' ? 'pglite' : 'pg',
    databaseUrl: env.DATABASE_URL ?? (isProd ? '' : 'postgres://manxin:manxin@localhost:5433/manxin'),
    dbPoolMax: int('DB_POOL_MAX', 10, 1, 200),
    dbSsl: bool('DB_SSL', false),
    appSecret,
    mailer: mailerRaw === 'smtp' ? 'smtp' : 'console',
    mailFrom: env.MAIL_FROM ?? '慢信 <letters@manxin.example>',
    smtp: {
      host: env.SMTP_HOST ?? 'smtp.gmail.com',
      port: int('SMTP_PORT', 465, 1, 65535),
      secure: bool('SMTP_SECURE', true),
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    // 有中央氣象署授權碼就預設用真的天氣（D-022）；沒有就是模擬天氣
    weatherProvider: (env.WEATHER_PROVIDER ?? (env.CWA_API_KEY ? 'cwa' : 'mock')) === 'cwa' ? 'cwa' : 'mock',
    cwaApiKey: env.CWA_API_KEY,
    storage: (env.STORAGE ?? (isProd ? 'db' : 'disk')) === 'db' ? 'db' : 'disk',
    uploadDir: path.resolve(env.UPLOAD_DIR ?? './uploads'),
    uploadMaxBytes: int('UPLOAD_MAX_BYTES', 10 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    fontMaxBytes: int('FONT_MAX_BYTES', 20 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    // D-033：正式環境 worker 獨立部署，API 程序預設不跑排程
    workerInline: bool('WORKER_INLINE', !isProd),
    workerIntervalMs: int('WORKER_INTERVAL_MS', 30_000, 1000, 3600_000),
    // 正式環境一律不允許時鐘偏移（D-035）
    devClockOffsetMs: isProd ? 0 : Number(env.DEV_CLOCK_OFFSET_MS ?? 0) || 0,
    enableDevRoutes: !isProd && bool('ENABLE_DEV_ROUTES', true),
    trustProxy: bool('TRUST_PROXY', isProd),
    rateLimit: bool('RATE_LIMIT', nodeEnv !== 'test'),
    contactEmail: (env.CONTACT_EMAIL ?? '').trim(),
    // 測試環境預設放寬（既有測試同一天會寄很多封），上限另有專門的測試
    sendLimit: {
      perDay: int('SEND_LIMIT_PER_DAY', nodeEnv === 'test' ? 10_000 : 5, 1, 10_000),
      perRecipient: int('SEND_LIMIT_PER_RECIPIENT', nodeEnv === 'test' ? 10_000 : 1, 1, 10_000),
    },
    adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    ...overrides,
  };

  if (isProd) {
    if (env.ENABLE_DEV_ROUTES === 'true') problems.push('正式環境不能開 ENABLE_DEV_ROUTES（本機信箱會公開所有登入連結）');
    if (!appSecret || appSecret.length < 32) problems.push('APP_SECRET 必須設定且至少 32 個字元（可用 openssl rand -hex 32 產生）');
    else if (KNOWN_EXAMPLE_SECRETS.has(appSecret)) problems.push('APP_SECRET 還是範例值，請換成自己產生的隨機字串');
    if (!/^https:\/\/[^/]+$/.test(cfg.appUrl) && env.ALLOW_HTTP_APP_URL !== 'true') {
      problems.push(`APP_URL 必須是 https:// 開頭的網站網址、不含路徑（目前是「${cfg.appUrl || '未設定'}」）`);
    }
    if (cfg.dbDriver !== 'pg') problems.push('正式環境不能用 DB_DRIVER=pglite（記憶體資料庫，重開就消失）');
    if (!cfg.databaseUrl) problems.push('DATABASE_URL 必須設定');
    if (mailerRaw !== 'smtp' && mailerRaw !== 'console') problems.push(`MAILER 只能是 smtp 或 console（目前是「${mailerRaw}」）`);
    if (cfg.mailer === 'console') problems.push('正式環境不能用 MAILER=console（信不會真的寄出）');
    if (cfg.mailer === 'smtp' && (!cfg.smtp.user || !cfg.smtp.pass)) problems.push('MAILER=smtp 需要 SMTP_USER 與 SMTP_PASS（Gmail 用應用程式密碼）');
    if (!/^[^@\s]+@[^@\s]+$/.test(cfg.contactEmail)) problems.push('CONTACT_EMAIL 必須設定（隱私權政策上的聯絡信箱）');
    if (cfg.storage !== 'db') problems.push('正式環境請用 STORAGE=db（多個 API 副本才讀得到同一份檔案）');
  }
  if (problems.length) throw new ConfigError(problems);
  return cfg;
}
