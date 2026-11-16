import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { DEFAULT_CALENDAR, type Calendar } from '@manxin/engine';
import type { UserDTO } from '@manxin/shared';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Clock } from './clock.ts';
import type { Config } from './config.ts';
import type { Ctx } from './context.ts';
import type { Db } from './db/client.ts';
import { AppError } from './lib/errors.ts';
import { accountRoutes } from './routes/account.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { deskRoutes } from './routes/desk.ts';
import { devRoutes } from './routes/dev.ts';
import { inboxRoutes } from './routes/inbox.ts';
import { postRoutes } from './routes/post.ts';
import { receiveRoutes } from './routes/receive.ts';
import { shipmentRoutes } from './routes/shipments.ts';
import { templateRoutes } from './routes/templates.ts';
import { makeCourier, makeMailer, makeStorage, makeWeather } from './runtime.ts';
import { SESSION_COOKIE, userBySession } from './services/auth.ts';
import type { CourierProvider } from './services/courier.ts';
import { startWorker, type Worker } from './services/jobs.ts';
import type { Mailer } from './services/mailer.ts';
import type { Storage } from './services/storage.ts';
import type { WeatherProvider } from './services/weather.ts';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx;
    worker: Worker | null;
  }
  interface FastifyRequest {
    user: UserDTO | null;
  }
}

export interface BuildOptions {
  cfg: Config;
  db: Db;
  clock?: Clock;
  mailer?: Mailer;
  weather?: WeatherProvider;
  courier?: CourierProvider;
  storage?: Storage;
  calendar?: Calendar;
  logger?: boolean | object;
  /** 是否啟動排程 worker（測試裡關掉，手動呼叫 runDueJobs） */
  startWorker?: boolean;
}

/**
 * log 裡不留登入連結與開信連結（review M12）：
 * /r/<token>、/login?token=…、?token=… 一律遮掉。
 */
export function redactUrl(url: string): string {
  return url.replace(/(\/r\/)[A-Za-z0-9_-]+/g, '$1***').replace(/([?&]token=)[^&]*/g, '$1***');
}

/** 網頁（HTML）的內容安全政策。只允許自己的網域，以及 Google Fonts */
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export async function buildApp(o: BuildOptions): Promise<FastifyInstance> {
  const cfg = o.cfg;
  const app = Fastify({
    logger: o.logger ?? {
      level: cfg.env === 'test' ? 'silent' : 'info',
      serializers: {
        req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: redactUrl(req.url), ip: req.ip }),
      },
    },
    // 前面有 Ingress 時才相信 X-Forwarded-For（頻率限制要用真正的使用者 IP）
    trustProxy: cfg.trustProxy,
    // 不偷偷刪掉多餘欄位：送了不認得的欄位（例如想改內容）就回 400
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
    bodyLimit: 2 * 1024 * 1024,
  });

  const clock = o.clock ?? new Clock(!cfg.isProd, cfg.devClockOffsetMs);
  const ctx: Ctx = {
    cfg,
    db: o.db,
    clock,
    mailer: o.mailer ?? makeMailer(cfg, app.log),
    weather: o.weather ?? makeWeather(cfg, app.log),
    courier: o.courier ?? makeCourier(),
    storage: o.storage ?? makeStorage(cfg),
    calendar: o.calendar ?? DEFAULT_CALENDAR,
    log: app.log,
  };
  app.decorate('ctx', ctx);
  app.decorate('worker', null);
  app.decorateRequest('user', null);

  // 狀態變更只收 JSON 或 multipart：表單（text/plain）不能跨站代送（review 低：Origin 檢查）
  app.removeContentTypeParser('text/plain');

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: cfg.uploadMaxBytes, files: 1 } });

  const appOrigin = new URL(cfg.appUrl || 'http://localhost').origin;
  app.addHook('onRequest', async (req, reply) => {
    // 跨站送來的狀態變更一律拒絕（cookie 是 SameSite=Lax，這是第二道防線）
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((origin && origin !== appOrigin) || site === 'cross-site') {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '不接受從別的網站送來的請求' } });
      }
    }
    req.user = await userBySession(ctx, req.cookies[SESSION_COOKIE]);
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    // 網址裡可能有開信連結 token，不讓它跟著 Referer 外流
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    if (cfg.isProd) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html') && !reply.hasHeader('content-security-policy')) reply.header('content-security-policy', PAGE_CSP);
    return payload;
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string; code?: string };
    if (e.validation) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: e.message ?? '輸入格式不正確', details: e.validation } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: 'BAD_REQUEST', message: e.message ?? '請求不正確', details: { fastify: e.code } } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: '伺服器出了點問題' } });
  });

  // Kubernetes 探針：healthz 只看程序活著；readyz 也檢查資料庫（連不上就先不要分流量進來）
  app.get('/healthz', async () => ({ ok: true }));
  const ready = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false, error: { code: 'INTERNAL', message: '資料庫連不上' } });
    }
  };
  app.get('/readyz', ready);
  app.get('/health', ready);

  await app.register(
    async (api) => {
      api.get('/time', async () => ({
        now: clock.now(),
        tz: 'Asia/Taipei',
        ...(cfg.isProd ? {} : { offsetMs: clock.offsetMs }),
      }));
      await api.register(authRoutes);
      await api.register(deskRoutes);
      await api.register(postRoutes);
      await api.register(shipmentRoutes);
      await api.register(inboxRoutes);
      await api.register(receiveRoutes);
      await api.register(templateRoutes);
      await api.register(adminRoutes);
      await api.register(accountRoutes);
      // 開發用路由：只有開發／測試環境、而且 ENABLE_DEV_ROUTES 沒關掉才註冊（review H4、D-035）
      if (cfg.enableDevRoutes && !cfg.isProd) await api.register(devRoutes);
    },
    { prefix: cfg.apiPrefix },
  );

  // 正式環境：同一個程序也提供前端網頁（apps/web/dist），前端與 API 同一個網址
  if (cfg.webDir) {
    const fstatic = (await import('@fastify/static')).default;
    await app.register(fstatic, {
      root: cfg.webDir,
      wildcard: false,
      index: false,
      setHeaders: (res: FastifyReply, filePath: string) => {
        // Vite 建置的檔名帶雜湊，可以長期快取；index.html 每次都要重新確認
        res.header('cache-control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  const apiPrefix = cfg.apiPrefix;
  app.setNotFoundHandler(async (req, reply) => {
    const pathOnly = req.url.split('?')[0]!;
    const isApi = apiPrefix ? pathOnly === apiPrefix || pathOnly.startsWith(apiPrefix + '/') : true;
    if (cfg.webDir && !isApi && (req.method === 'GET' || req.method === 'HEAD')) {
      // 單頁應用：/desk、/r/:token、/track/:no 等前端網址都回 index.html
      const file = pathOnly.match(/\.[a-z0-9]+$/i) ? null : 'index.html';
      if (file) return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').sendFile(file);
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `沒有這個路徑：${req.method} ${redactUrl(pathOnly)}` } });
  });

  if (o.startWorker ?? cfg.workerInline) {
    app.worker = startWorker(ctx, cfg.workerIntervalMs);
    app.addHook('onClose', async () => app.worker?.stop());
  }
  return app;
}

/** 需要登入的路由用 */
export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    await reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: '請先登入' } });
  }
}

export const user = (req: FastifyRequest): UserDTO => req.user!;
