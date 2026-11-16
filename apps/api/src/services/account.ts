/**
 * 帳號：刪除帳號、登出所有裝置、個人偏好跟著帳號走（D-034）。
 *
 * 刪除帳號（2026-11-12 使用者決定：寄出的信留給收件人）：
 * - 刪掉：草稿、抽屜裡的信、字紙冢、這些信的附件、沒被寄出的信用到的字型、登入紀錄、偏好、
 *   自己的封鎖名單、自己收到的收藏。
 * - 保留：已寄出的信（屬於收件人），但拿掉寄件人信箱；寄件人名稱、地址是信封上的字，跟著信留著。
 * - 使用者這一列不真的刪（寄出的信還指向它），信箱改成 deleted:<id>，之後同一個信箱可以重新註冊。
 */
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import {
  attachments,
  blobs,
  blocks,
  collectionItems,
  fonts,
  letters,
  loginTokens,
  reports,
  sessions,
  sheets,
  shipments,
  userPrefs,
  users,
} from '../db/schema.ts';
import { normEmail } from '../lib/crypto.ts';
import { fail } from '../lib/errors.ts';
import { lockUser } from './abuse.ts';
import { customFontId } from './fonts.ts';

/** 已寄出的信用到的字型 id（信紙與信封）——這些字型要留給收件人 */
async function fontsUsedBySent(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ font: sheets.font, pkg: shipments.pkg })
    .from(shipments)
    .innerJoin(sheets, eq(sheets.letterId, shipments.letterId))
    .where(eq(shipments.userId, userId));
  const out = new Set<string>();
  for (const r of rows) {
    for (const f of [r.font, (r.pkg as { efont?: string }).efont]) {
      const id = customFontId(f);
      if (id) out.add(id);
    }
  }
  return out;
}

export async function deleteAccount(ctx: Ctx, userId: string, confirmEmail: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const u = await lockUser(tx, userId);
    if (normEmail(confirmEmail) !== u.email) fail(422, 'INVALID_EMAIL', '請輸入自己的信箱確認要刪除');
    const now = new Date(ctx.clock.now());
    const email = u.email;

    // 1. 沒寄出的信（書桌上、抽屜裡）：信、信紙、櫃台、行程一起刪
    const unsent = await tx
      .select({ id: letters.id })
      .from(letters)
      .where(and(eq(letters.userId, userId), ne(letters.status, 'sent')));
    const unsentIds = unsent.map((l) => l.id);
    // 附件：沒寄出的信的、以及已經不屬於任何信的；檔案內容一起刪
    const attRows = await tx
      .select({ id: attachments.id, path: attachments.path })
      .from(attachments)
      .where(
        and(
          eq(attachments.userId, userId),
          unsentIds.length ? or(isNull(attachments.letterId), inArray(attachments.letterId, unsentIds)) : isNull(attachments.letterId),
        ),
      );
    if (unsentIds.length) await tx.delete(letters).where(inArray(letters.id, unsentIds));
    if (attRows.length) {
      await tx.delete(attachments).where(inArray(attachments.id, attRows.map((a) => a.id)));
      await tx.delete(blobs).where(inArray(blobs.key, attRows.map((a) => a.path)));
    }
    // 字紙冢、刪信後留下的空信紙（letter_id 已經變成 null）
    await tx.delete(sheets).where(and(eq(sheets.userId, userId), or(eq(sheets.role, 'tomb'), isNull(sheets.letterId))));

    // 2. 字型：已寄出的信用到的留著（收件人還要用），其他刪掉
    const keep = await fontsUsedBySent(tx, userId);
    const myFonts = await tx.select({ id: fonts.id, path: fonts.path }).from(fonts).where(eq(fonts.userId, userId));
    const drop = myFonts.filter((f) => !keep.has(f.id));
    if (drop.length) {
      await tx.delete(fonts).where(inArray(fonts.id, drop.map((f) => f.id)));
      await tx.delete(blobs).where(inArray(blobs.key, drop.map((f) => f.path)));
    }

    // 3. 寄出的信留給收件人，拿掉寄件人信箱（之後的提醒、退信不會寄出）
    await tx
      .update(shipments)
      .set({ env: sql`jsonb_set(${shipments.env}, '{fromEmail}', '""'::jsonb)` })
      .where(eq(shipments.userId, userId));

    // 4. 以這個信箱收到的東西、做過的設定
    await tx.delete(collectionItems).where(eq(collectionItems.recipientEmail, email));
    await tx.delete(blocks).where(eq(blocks.recipientEmail, email));
    await tx.update(reports).set({ reporterEmail: `deleted:${userId}` }).where(eq(reports.reporterEmail, email));
    await tx.delete(userPrefs).where(eq(userPrefs.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(loginTokens).where(eq(loginTokens.email, email));

    // 5. 帳號本身：匿名化
    await tx.update(users).set({ email: `deleted:${userId}`, deletedAt: now }).where(eq(users.id, userId));
  });
}

export async function logoutAll(ctx: Ctx, userId: string): Promise<void> {
  await ctx.db.delete(sessions).where(eq(sessions.userId, userId));
}

/* ---------- 個人偏好（D-034） ---------- */

/** 偏好只存小東西（年代風格、書桌、打字機設定…），上限 4 KB */
export const PREFS_MAX_BYTES = 4096;

export async function getPrefs(ctx: Ctx, userId: string): Promise<{ prefs: Record<string, unknown> | null; updatedAt: number | null }> {
  const rows = await ctx.db.select().from(userPrefs).where(eq(userPrefs.userId, userId));
  const r = rows[0];
  return { prefs: (r?.prefs as Record<string, unknown>) ?? null, updatedAt: r ? r.updatedAt.getTime() : null };
}

export async function putPrefs(ctx: Ctx, userId: string, prefs: Record<string, unknown>): Promise<{ ok: true; updatedAt: number }> {
  if (Buffer.byteLength(JSON.stringify(prefs)) > PREFS_MAX_BYTES) fail(413, 'BAD_REQUEST', '偏好設定太大');
  const now = new Date();
  await ctx.db
    .insert(userPrefs)
    .values({ userId, prefs, updatedAt: now })
    .onConflictDoUpdate({ target: userPrefs.userId, set: { prefs, updatedAt: now } });
  return { ok: true, updatedAt: now.getTime() };
}
