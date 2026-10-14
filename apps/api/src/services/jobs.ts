/**
 * 排程（scheduled_jobs 表 + 輪詢 worker）。
 *
 * 冪等的三道保險：
 * 1. 排入時用 unique_key（ON CONFLICT DO NOTHING），同一件事只會有一筆。
 * 2. 認領用 SELECT … FOR UPDATE SKIP LOCKED，多個 worker 不會搶到同一筆。
 * 3. 寄信（ConsoleMailer 寫 dev_outbox，idempotency_key = unique_key）與標記完成在同一個交易；
 *    就算交易外又被重跑，同一個 key 也不會寄第二次。
 */
import {
  D,
  nextUnsentAsk,
  returnPostmark,
  status,
  unsentAskDue,
  UNSENT_ASK_EVERY,
  type EnvelopeKind,
  type Plan,
} from '@manxin/engine';
import type { EnvAddress } from '@manxin/shared';
import { and, asc, eq, lte } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { letters, scheduledJobs, shipments, users } from '../db/schema.ts';
import { hmacToken, sha256 } from '../lib/crypto.ts';
import { deliveryMail, remindMail, returnMail, unsentAskMail } from './mails.ts';
import { editsOf, statusInput, type Pkg } from './shipments.ts';

export type JobKind = 'deliver' | 'remind24' | 'remind48' | 'return30' | 'unsent_ask';
type JobRow = typeof scheduledJobs.$inferSelect;

export const MAX_ATTEMPTS = 5;

export async function enqueue(
  db: Db,
  j: { kind: string; uniqueKey: string; refId: string; runAt: number; payload?: Record<string, unknown>; now: number },
): Promise<boolean> {
  const rows = await db
    .insert(scheduledJobs)
    .values({
      kind: j.kind,
      uniqueKey: j.uniqueKey,
      refId: j.refId,
      runAt: new Date(j.runAt),
      payload: j.payload ?? {},
      createdAt: new Date(j.now),
    })
    .onConflictDoNothing({ target: scheduledJobs.uniqueKey })
    .returning({ id: scheduledJobs.id });
  return rows.length > 0;
}

/** 開信連結：由密鑰與（寄件 id, 第幾次投遞）決定，重跑時連結相同 */
export const recipientToken = (secret: string, shipmentId: string, seq: number) => hmacToken(secret, `open:${shipmentId}:${seq}`);

type Handler = (ctx: Ctx, db: Db, job: JobRow, now: number) => Promise<string>;

async function lockShipment(db: Db, id: string) {
  const rows = await db.select().from(shipments).where(eq(shipments.id, id)).for('update');
  return rows[0] ?? null;
}

const handlers: Record<JobKind, Handler> = {
  /** 送達（或改信箱後重新投遞）：寄開信連結給收件人 */
  async deliver(ctx, db, job, now) {
    const s = await lockShipment(db, job.refId);
    if (!s) return 'skipped:no-shipment';
    const seq = Number((job.payload as { seq?: number }).seq ?? 0);
    const edits = await editsOf(db, s.id);
    if (s.signedAt) return 'skipped:signed';
    if (s.returnedAt) return 'skipped:returned';
    if (seq !== edits.length) return 'skipped:superseded'; // 之後又改過信箱
    const st = status(statusInput(s, edits), now);
    if (st.state === 'returned') return 'skipped:returned';
    const env = s.env as EnvAddress;
    const to = seq === 0 ? env.toEmail : edits[seq - 1]!.email;
    const token = recipientToken(ctx.cfg.appSecret, s.id, seq);
    await db.update(shipments).set({ recipientTokenHash: sha256(token), deliverySeq: seq }).where(eq(shipments.id, s.id));
    const pkg = s.pkg as Pkg;
    const m = deliveryMail({
      fromName: env.fromName,
      postcard: (pkg.env as EnvelopeKind) === 'card',
      sentAt: s.sentAt.getTime(),
      office: s.office,
      link: `${ctx.cfg.appUrl}/r/${token}`,
    });
    const sent = await ctx.mailer.send(
      { to, ...m, idempotencyKey: job.uniqueKey, meta: { kind: 'deliver', no: s.no, seq, token } },
      db,
      now,
    );
    return sent ? 'sent' : 'skipped:already-sent';
  },

  async remind24(ctx, db, job, now) {
    return remind(ctx, db, job, now, 24);
  },
  async remind48(ctx, db, job, now) {
    return remind(ctx, db, job, now, 48);
  },

  /** 30 天無人簽收：退回寄件人，附依目的地決定的退件郵戳 */
  async return30(ctx, db, job, now) {
    const s = await lockShipment(db, job.refId);
    if (!s) return 'skipped:no-shipment';
    const st = status(statusInput(s, await editsOf(db, s.id)), now);
    if (st.state !== 'returned') return `skipped:${st.state}`;
    if (s.returnedAt) return 'skipped:already-returned';
    await db.update(shipments).set({ returnedAt: new Date(st.ret), recipientTokenHash: null }).where(eq(shipments.id, s.id));
    const P = s.plan as Plan;
    const pm = returnPostmark(P.dest, st.ret);
    const env = s.env as EnvAddress;
    const m = returnMail({ no: s.no, dest: P.dest, pm, trackLink: `${ctx.cfg.appUrl}/track/${s.no}` });
    const sent = await ctx.mailer.send(
      { to: env.fromEmail, ...m, idempotencyKey: job.uniqueKey, meta: { kind: 'return', no: s.no, postmark: pm } },
      db,
      now,
    );
    return sent ? 'sent' : 'skipped:already-sent';
  },

  /** 未寄出的信：每 30 天問一次 */
  async unsent_ask(ctx, db, job, now) {
    const p = job.payload as { shelvedAt: number; n: number };
    const rows = await db.select().from(letters).where(eq(letters.id, job.refId)).for('update');
    const L = rows[0];
    if (!L || L.status !== 'shelved' || L.shelvedAt?.getTime() !== p.shelvedAt) return 'skipped:not-shelved';
    const askedAt = L.askedAt?.getTime() ?? null;
    const nextKey = `unsent_ask:${L.id}:${p.shelvedAt}:${p.n + 1}`;
    if (!unsentAskDue(p.shelvedAt, askedAt, now)) {
      // 使用者在畫面上按了「再放 30 天」：改排到下一次
      await enqueue(db, { kind: 'unsent_ask', uniqueKey: nextKey, refId: L.id, runAt: nextUnsentAsk(p.shelvedAt, askedAt), payload: { ...p, n: p.n + 1 }, now });
      return 'skipped:snoozed';
    }
    const u = (await db.select().from(users).where(eq(users.id, L.userId)))[0];
    if (!u) return 'skipped:no-user';
    const env = L.env as EnvAddress;
    const m = unsentAskMail({ toName: env.toName, shelvedAt: p.shelvedAt, days: Math.floor((now - p.shelvedAt) / D), deskLink: `${ctx.cfg.appUrl}/tomb` });
    const sent = await ctx.mailer.send({ to: u.email, ...m, idempotencyKey: job.uniqueKey, meta: { kind: 'unsent_ask', letterId: L.id } }, db, now);
    await db.update(letters).set({ askedAt: new Date(now) }).where(eq(letters.id, L.id));
    await enqueue(db, { kind: 'unsent_ask', uniqueKey: nextKey, refId: L.id, runAt: now + UNSENT_ASK_EVERY, payload: { ...p, n: p.n + 1 }, now });
    return sent ? 'sent' : 'skipped:already-sent';
  },
};

async function remind(ctx: Ctx, db: Db, job: JobRow, now: number, which: 24 | 48): Promise<string> {
  const s = await lockShipment(db, job.refId);
  if (!s) return 'skipped:no-shipment';
  const st = status(statusInput(s, await editsOf(db, s.id)), now);
  // 已簽收、已退回就不再提醒
  if (st.state === 'signed' || st.state === 'returned') return `skipped:${st.state}`;
  if (!(which === 24 ? st.rem1 : st.rem2)) return 'skipped:not-due';
  const env = s.env as EnvAddress;
  const m = remindMail({ which, no: s.no, toLabel: env.toName || st.curEmail, trackLink: `${ctx.cfg.appUrl}/track/${s.no}` });
  const sent = await ctx.mailer.send({ to: env.fromEmail, ...m, idempotencyKey: job.uniqueKey, meta: { kind: `remind${which}`, no: s.no } }, db, now);
  return sent ? 'sent' : 'skipped:already-sent';
}

export interface RunResult {
  id: number;
  kind: string;
  uniqueKey: string;
  result: string;
}

/** 跑完所有到期的工作。回傳每一筆的結果（測試與 /dev/worker/run 用） */
export async function runDueJobs(ctx: Ctx, limit = 500): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (let i = 0; i < limit; i++) {
    const now = ctx.clock.now();
    let claimed: JobRow | null = null;
    try {
      const r = await ctx.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(scheduledJobs)
          .where(and(eq(scheduledJobs.status, 'pending'), lte(scheduledJobs.runAt, new Date(now))))
          .orderBy(asc(scheduledJobs.runAt), asc(scheduledJobs.id))
          .limit(1)
          .for('update', { skipLocked: true });
        const job = rows[0];
        if (!job) return null;
        claimed = job;
        const h = handlers[job.kind as JobKind];
        const result = h ? await h(ctx, tx, job, now) : 'skipped:unknown-kind';
        await tx
          .update(scheduledJobs)
          .set({ status: result.startsWith('skipped') ? 'skipped' : 'done', result, attempts: job.attempts + 1, doneAt: new Date(now) })
          .where(eq(scheduledJobs.id, job.id));
        return { id: job.id, kind: job.kind, uniqueKey: job.uniqueKey, result };
      });
      if (!r) break;
      out.push(r);
    } catch (e) {
      const job = claimed as JobRow | null;
      if (!job) throw e;
      const attempts = job.attempts + 1;
      ctx.log.error({ err: e, job: job.uniqueKey }, 'scheduled job failed');
      await ctx.db
        .update(scheduledJobs)
        .set({
          attempts,
          lastError: String((e as Error)?.message ?? e).slice(0, 2000),
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          runAt: new Date(now + Math.min(60, 2 ** attempts) * 60_000),
        })
        .where(eq(scheduledJobs.id, job.id));
      out.push({ id: job.id, kind: job.kind, uniqueKey: job.uniqueKey, result: `error:${(e as Error)?.message}` });
    }
  }
  return out;
}

/** 每 interval 毫秒輪詢一次 */
export function startWorker(ctx: Ctx, intervalMs: number): { stop(): void; kick(): Promise<RunResult[]> } {
  let running: Promise<RunResult[]> | null = null;
  const kick = () => {
    if (!running) {
      running = runDueJobs(ctx)
        .catch((e) => {
          ctx.log.error({ err: e }, 'worker tick failed');
          return [] as RunResult[];
        })
        .finally(() => {
          running = null;
        });
    }
    return running;
  };
  const timer = setInterval(() => void kick(), intervalMs);
  timer.unref?.();
  void kick();
  return { stop: () => clearInterval(timer), kick };
}
