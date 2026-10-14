import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { DEFAULT_CALENDAR, type Calendar } from '@manxin/engine';
import type { UserDTO } from '@manxin/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Clock } from './clock.ts';
import type { Config } from './config.ts';
import type { Ctx } from './context.ts';
import type { Db } from './db/client.ts';
import { AppError } from './lib/errors.ts';
import { authRoutes } from './routes/auth.ts';
import { deskRoutes } from './routes/desk.ts';
import { devRoutes } from './routes/dev.ts';
import { postRoutes } from './routes/post.ts';
import { receiveRoutes } from './routes/receive.ts';
import { shipmentRoutes } from './routes/shipments.ts';
import { SESSION_COOKIE, userBySession } from './services/auth.ts';
import { CountyTableCourier, type CourierProvider } from './services/courier.ts';
import { startWorker } from './services/jobs.ts';
import { ConsoleMailer, ResendMailer, type Mailer } from './services/mailer.ts';
import { LocalDiskStorage, type Storage } from './services/storage.ts';
import { CwaWeather, MockWeather, type WeatherProvider } from './services/weather.ts';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx;
    worker: { stop(): void; kick(): Promise<unknown> } | null;
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

export async function buildApp(o: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: o.logger ?? { level: o.cfg.env === 'test' ? 'silent' : 'info' },
    // 不偷偷刪掉多餘欄位：送了不認得的欄位（例如想改內容）就回 400
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
    bodyLimit: 2 * 1024 * 1024,
  });

  const cfg = o.cfg;
  const clock = o.clock ?? new Clock(!cfg.isProd, cfg.devClockOffsetMs);
  const ctx: Ctx = {
    cfg,
    db: o.db,
    clock,
    mailer: o.mailer ?? (cfg.mailer === 'resend' ? new ResendMailer(cfg.resendApiKey, cfg.mailFrom) : new ConsoleMailer(app.log, cfg.mailFrom)),
    weather: o.weather ?? (cfg.weatherProvider === 'cwa' ? new CwaWeather(cfg.cwaApiKey) : new MockWeather()),
    courier: o.courier ?? new CountyTableCourier(),
    storage: o.storage ?? new LocalDiskStorage(cfg.uploadDir),
    calendar: o.calendar ?? DEFAULT_CALENDAR,
    log: app.log,
  };
  app.decorate('ctx', ctx);
  app.decorate('worker', null);
  app.decorateRequest('user', null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: cfg.uploadMaxBytes, files: 1 } });

  app.addHook('onRequest', async (req) => {
    req.user = await userBySession(ctx, req.cookies[SESSION_COOKIE]);
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
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `沒有這個路徑：${req.method} ${req.url.split('?')[0]}` } }),
  );

  app.get('/health', async () => ({ ok: true }));
  app.get('/time', async () => ({
    now: clock.now(),
    tz: 'Asia/Taipei',
    ...(cfg.isProd ? {} : { offsetMs: clock.offsetMs }),
  }));

  await app.register(authRoutes);
  await app.register(deskRoutes);
  await app.register(postRoutes);
  await app.register(shipmentRoutes);
  await app.register(receiveRoutes);
  if (!cfg.isProd) await app.register(devRoutes);

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
