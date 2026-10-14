/**
 * 開發用端點（NODE_ENV=production 時整個不註冊）：
 * - 本機信箱（ConsoleMailer 寄出的信）
 * - 時鐘偏移（等同原型右上角的「快轉」），調整後會立刻跑一次排程
 */
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { devOutbox } from '../db/schema.ts';
import { fail } from '../lib/errors.ts';
import { runDueJobs } from '../services/jobs.ts';
import { bool, int, num, obj, str } from './schemas.ts';

export async function devRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  if (ctx.cfg.isProd) return;

  app.get<{ Querystring: { to?: string; limit?: number } }>(
    '/dev/outbox',
    { schema: { querystring: obj({ to: str({ maxLength: 254 }), limit: int({ minimum: 1, maximum: 500 }) }) } },
    async (req) => {
      const q = ctx.db.select().from(devOutbox);
      const rows = await (req.query.to ? q.where(eq(devOutbox.toEmail, req.query.to.toLowerCase())) : q)
        .orderBy(desc(devOutbox.id))
        .limit(req.query.limit ?? 100);
      return {
        mails: rows.map((m) => ({ id: m.id, key: m.idempotencyKey, to: m.toEmail, subject: m.subject, text: m.text, meta: m.meta, createdAt: m.createdAt.getTime() })),
      };
    },
  );

  const clockState = () => ({ now: ctx.clock.now(), offsetMs: ctx.clock.offsetMs });
  app.get('/dev/clock', async () => clockState());

  /** advanceMs：往前快轉；offsetMs：直接設定偏移；reset：歸零 */
  app.post<{ Body: { advanceMs?: number; offsetMs?: number; reset?: boolean } }>(
    '/dev/clock',
    { schema: { body: obj({ advanceMs: num({ minimum: 0, maximum: 400 * 86400_000 }), offsetMs: num(), reset: bool }) } },
    async (req) => {
      if (!ctx.clock.canShift) fail(403, 'DEV_ONLY', '正式環境不能調整時鐘');
      const b = req.body ?? {};
      if (b.reset) ctx.clock.setOffset(0);
      else if (b.offsetMs !== undefined) ctx.clock.setOffset(b.offsetMs);
      else if (b.advanceMs !== undefined) ctx.clock.advance(b.advanceMs);
      const jobs = await runDueJobs(ctx);
      return { ...clockState(), jobs };
    },
  );

  app.post('/dev/worker/run', async () => ({ jobs: await runDueJobs(ctx) }));
}
