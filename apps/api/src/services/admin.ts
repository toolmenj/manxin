/**
 * 管理頁（只有數字與狀態）。依使用者決定：管理員看不到信件內容、信紙上的字、附件；信箱只顯示遮掉一半的版本。
 * 要查原始資料請走 pgAdmin（只能從叢集內部連，見 deploy/k8s/pgadmin.yaml）。
 */
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import { blobs, emailOutbox, letters, reports, scheduledJobs, shipments, users } from '../db/schema.ts';
import { fail, notFound } from '../lib/errors.ts';
import { flushMail } from './jobs.ts';
import { maskEmail } from './shipments.ts';

const n = sql<number>`count(*)::int`;

async function countBy(rows: Promise<{ k: string | null; n: number }[]>): Promise<Record<string, number>> {
  return Object.fromEntries((await rows).map((r) => [r.k ?? 'null', r.n]));
}

function firstRow<T>(res: unknown): T | undefined {
  const r = res as { rows?: T[] } | T[];
  return Array.isArray(r) ? r[0] : r.rows?.[0];
}

export async function adminStats(ctx: Ctx) {
  const db = ctx.db;
  const day = new Date(Date.now() - 86400_000);
  const [u] = await db.select({ n }).from(users).where(sql`${users.deletedAt} is null`);
  const [susp] = await db.select({ n }).from(users).where(sql`${users.suspendedAt} is not null`);
  const [openReports] = await db.select({ n }).from(reports).where(eq(reports.status, 'open'));
  const [u24] = await db.select({ n }).from(users).where(gt(users.createdAt, day));
  const letterStatus = await countBy(db.select({ k: letters.status, n }).from(letters).groupBy(letters.status));
  const [ship] = await db
    .select({
      total: n,
      signed: sql<number>`(count(*) filter (where ${shipments.signedAt} is not null))::int`,
      returned: sql<number>`(count(*) filter (where ${shipments.returnedAt} is not null))::int`,
      waiting: sql<number>`(count(*) filter (where ${shipments.recipientTokenHash} is not null and ${shipments.signedAt} is null))::int`,
      last24h: sql<number>`(count(*) filter (where ${shipments.sentAt} > ${day}))::int`,
    })
    .from(shipments);
  const jobs = await countBy(db.select({ k: scheduledJobs.status, n }).from(scheduledJobs).groupBy(scheduledJobs.status));
  const mails = await countBy(db.select({ k: emailOutbox.status, n }).from(emailOutbox).groupBy(emailOutbox.status));
  const [files] = await db.select({ n, bytes: sql<string>`coalesce(sum(${blobs.size}), 0)::text` }).from(blobs);
  const dbSize = firstRow<{ bytes: string }>(await db.execute(sql`select pg_database_size(current_database())::text as bytes`));
  const s = ship!;
  return {
    users: { total: u!.n, last24h: u24!.n, suspended: susp!.n },
    reports: { open: openReports!.n },
    letters: letterStatus,
    shipments: {
      total: s.total,
      inTransit: s.total - s.signed - s.returned - s.waiting,
      waiting: s.waiting,
      signed: s.signed,
      returned: s.returned,
      last24h: s.last24h,
    },
    jobs,
    mails,
    mailer: ctx.cfg.mailer,
    storage: { files: files!.n, fileBytes: Number(files!.bytes), dbBytes: Number(dbSize?.bytes ?? 0) },
    serverTime: Date.now(),
  };
}

/** 失敗或重試中的排程與寄信（看錯誤原因用） */
export async function adminFailures(ctx: Ctx) {
  const jobs = await ctx.db
    .select({
      id: scheduledJobs.id,
      kind: scheduledJobs.kind,
      status: scheduledJobs.status,
      attempts: scheduledJobs.attempts,
      lastError: scheduledJobs.lastError,
      runAt: scheduledJobs.runAt,
    })
    .from(scheduledJobs)
    .where(or(eq(scheduledJobs.status, 'failed'), and(eq(scheduledJobs.status, 'pending'), isNotNull(scheduledJobs.lastError))))
    .orderBy(desc(scheduledJobs.runAt))
    .limit(100);
  const mails = await ctx.db
    .select({
      id: emailOutbox.id,
      kind: emailOutbox.kind,
      to: emailOutbox.toEmail,
      status: emailOutbox.status,
      attempts: emailOutbox.attempts,
      lastError: emailOutbox.lastError,
      nextAttemptAt: emailOutbox.nextAttemptAt,
    })
    .from(emailOutbox)
    .where(or(eq(emailOutbox.status, 'failed'), and(inArray(emailOutbox.status, ['pending', 'sending']), isNotNull(emailOutbox.lastError))))
    .orderBy(desc(emailOutbox.nextAttemptAt))
    .limit(100);
  return {
    jobs: jobs.map((j) => ({ ...j, runAt: j.runAt.getTime() })),
    mails: mails.map((m) => ({ ...m, to: maskEmail(m.to), nextAttemptAt: m.nextAttemptAt.getTime() })),
  };
}

export async function retryJob(ctx: Ctx, id: number) {
  const r = await ctx.db
    .update(scheduledJobs)
    .set({ status: 'pending', attempts: 0, runAt: new Date(ctx.clock.now()) })
    .where(and(eq(scheduledJobs.id, id), inArray(scheduledJobs.status, ['failed', 'pending'])))
    .returning({ id: scheduledJobs.id });
  if (!r.length) notFound('找不到這件排程，或它已經完成');
  return { ok: true };
}

export async function retryMail(ctx: Ctx, id: number) {
  const r = await ctx.db
    .update(emailOutbox)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date() })
    .where(and(eq(emailOutbox.id, id), inArray(emailOutbox.status, ['failed', 'pending']), isNotNull(emailOutbox.text)))
    .returning({ id: emailOutbox.id });
  if (!r.length) notFound('找不到這封信，或它已經寄出');
  await flushMail(ctx);
  return { ok: true };
}

export function isAdmin(ctx: Ctx, email: string | undefined | null): boolean {
  return !!email && ctx.cfg.adminEmails.includes(email.toLowerCase());
}

/** 不是管理員就當作沒有這個路徑，不透露管理頁存在 */
export function assertAdmin(ctx: Ctx, email: string | undefined | null): void {
  if (!isAdmin(ctx, email)) fail(404, 'NOT_FOUND', '沒有這個路徑');
}
