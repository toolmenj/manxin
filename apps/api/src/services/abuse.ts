/**
 * 防騷擾（2026-11-12 使用者決定：上限＋封鎖＋檢舉）。
 *
 * - 寄信上限：每人 24 小時最多 DAILY_SEND_LIMIT 封；同一個收件信箱 24 小時最多 SAME_RECIPIENT_PER_DAY 封。
 * - 封鎖：收件人封鎖寄件人之後，那個人寄來的信不會送到（不寄開信通知、不進收件匣）。
 *   寄件人那邊照常顯示，30 天後照一般規則退回——不讓寄件人知道被封鎖，避免騷擾升級。
 * - 檢舉：收件人從開信頁送出。管理員只看得到理由與次數，看不到信件內容；成立就停權（不能再寄信）。
 */
import type { EnvAddress } from '@manxin/shared';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { blocks, reports, shipments, users } from '../db/schema.ts';
import { normEmail } from '../lib/crypto.ts';
import { fail, notFound } from '../lib/errors.ts';

export const DAILY_SEND_LIMIT = 5;
export const SAME_RECIPIENT_PER_DAY = 1;
const DAY = 86400_000;

export const REPORT_REASONS = ['harass', 'spam', 'threat', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** 鎖住使用者這一列（同一個人同時寄好幾封時，上限計數不會被繞過） */
export async function lockUser(db: Db, userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).for('update');
  return rows[0] ?? notFound('找不到這個帳號');
}

/** 寄出前檢查：停權、每日上限、同一個收件人 */
export async function assertCanSend(
  db: Db,
  u: typeof users.$inferSelect,
  toEmail: string,
  now: number,
  limit: { perDay: number; perRecipient: number } = { perDay: DAILY_SEND_LIMIT, perRecipient: SAME_RECIPIENT_PER_DAY },
): Promise<void> {
  if (u.suspendedAt) fail(403, 'FORBIDDEN', '這個帳號因為被檢舉已經停權，不能再寄信。有疑問請來信聯絡我們。', { reason: 'SUSPENDED' });
  if (u.deletedAt) fail(403, 'FORBIDDEN', '這個帳號已經刪除', { reason: 'DELETED' });
  const since = new Date(now - DAY);
  const [all] = await db
    .select({ n: count() })
    .from(shipments)
    .where(and(eq(shipments.userId, u.id), gt(shipments.sentAt, since)));
  if ((all?.n ?? 0) >= limit.perDay) {
    fail(429, 'RATE_LIMITED', `慢慢來。一天最多寄 ${limit.perDay} 封信，明天再來吧。`, { reason: 'DAILY_LIMIT', max: limit.perDay });
  }
  const [same] = await db
    .select({ n: count() })
    .from(shipments)
    .where(and(eq(shipments.userId, u.id), gt(shipments.sentAt, since), sql`lower(${shipments.env}->>'toEmail') = ${normEmail(toEmail)}`));
  if ((same?.n ?? 0) >= limit.perRecipient) {
    fail(429, 'RATE_LIMITED', '今天已經寄過信給這個人了。等前一封慢慢走到，明天再寫。', { reason: 'SAME_RECIPIENT', max: limit.perRecipient });
  }
}

export async function isBlocked(db: Db, recipientEmail: string, senderUserId: string): Promise<boolean> {
  const rows = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(and(eq(blocks.recipientEmail, normEmail(recipientEmail)), eq(blocks.senderUserId, senderUserId)));
  return rows.length > 0;
}

/** 收件人封鎖這封信的寄件人（呼叫端已確認是收件人本人，見 receive.ts） */
export async function blockSender(db: Db, s: typeof shipments.$inferSelect, recipientEmail: string, now: number): Promise<void> {
  await db
    .insert(blocks)
    .values({ recipientEmail: normEmail(recipientEmail), senderUserId: s.userId, senderName: (s.env as EnvAddress).fromName || '某個人', createdAt: new Date(now) })
    .onConflictDoNothing();
}

export async function reportShipment(
  db: Db,
  s: typeof shipments.$inferSelect,
  reporterEmail: string,
  reason: ReportReason,
  note: string,
  now: number,
): Promise<void> {
  await db
    .insert(reports)
    .values({ shipmentId: s.id, senderUserId: s.userId, reporterEmail: normEmail(reporterEmail), reason, note: note.slice(0, 500), createdAt: new Date(now) })
    .onConflictDoNothing();
}

/* ---------- 收件人管理自己的封鎖名單 ---------- */

export async function listBlocks(ctx: Ctx, email: string) {
  const rows = await ctx.db.select().from(blocks).where(eq(blocks.recipientEmail, normEmail(email))).orderBy(desc(blocks.createdAt));
  return { blocks: rows.map((b) => ({ id: b.id, senderName: b.senderName, createdAt: b.createdAt.getTime() })) };
}

export async function unblock(ctx: Ctx, email: string, id: string) {
  const r = await ctx.db
    .delete(blocks)
    .where(and(eq(blocks.id, id), eq(blocks.recipientEmail, normEmail(email))))
    .returning({ id: blocks.id });
  if (!r.length) notFound('封鎖名單裡沒有這個人');
  return { ok: true };
}

/* ---------- 管理員 ---------- */

const maskEmail = (e: string) => {
  if (e.startsWith('deleted:')) return '（已刪除的帳號）';
  const [u, d] = e.split('@');
  return d ? `${u!.slice(0, 1)}***@${d}` : e;
};

/** 檢舉列表：只有理由、檢舉人寫的說明、次數與狀態；看不到信件內容 */
export async function adminReports(ctx: Ctx) {
  const rows = await ctx.db
    .select({ r: reports, no: shipments.no, senderEmail: users.email, suspendedAt: users.suspendedAt })
    .from(reports)
    .innerJoin(shipments, eq(shipments.id, reports.shipmentId))
    .innerJoin(users, eq(users.id, reports.senderUserId))
    .orderBy(sql`case when ${reports.status} = 'open' then 0 else 1 end`, desc(reports.createdAt))
    .limit(200);
  const counts = await ctx.db.select({ uid: reports.senderUserId, n: count() }).from(reports).groupBy(reports.senderUserId);
  const byUser = new Map(counts.map((c) => [c.uid, c.n]));
  return {
    reports: rows.map(({ r, no, senderEmail, suspendedAt }) => ({
      id: r.id,
      no,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.getTime(),
      sender: { id: r.senderUserId, email: maskEmail(senderEmail), reports: byUser.get(r.senderUserId) ?? 0, suspended: !!suspendedAt },
      reporter: maskEmail(r.reporterEmail),
    })),
  };
}

export async function dismissReport(ctx: Ctx, id: string) {
  const r = await ctx.db
    .update(reports)
    .set({ status: 'dismissed', handledAt: new Date() })
    .where(eq(reports.id, id))
    .returning({ id: reports.id });
  if (!r.length) notFound('找不到這筆檢舉');
  return { ok: true };
}

/** 停權（或解除）。停權時這個人的待處理檢舉一起標成已處理 */
export async function setSuspended(ctx: Ctx, userId: string, suspended: boolean) {
  return ctx.db.transaction(async (tx) => {
    const r = await tx
      .update(users)
      .set({ suspendedAt: suspended ? new Date() : null })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!r.length) notFound('找不到這個帳號');
    if (suspended) {
      await tx
        .update(reports)
        .set({ status: 'suspended', handledAt: new Date() })
        .where(and(eq(reports.senderUserId, userId), eq(reports.status, 'open')));
    }
    return { ok: true };
  });
}
