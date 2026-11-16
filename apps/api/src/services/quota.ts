/**
 * 容量配額（review M13）：每個帳號上傳的檔案（附件、信紙圖樣、字型）總共 USER_STORAGE_QUOTA，
 * 每封信的附件最多 ATTACHMENTS_PER_LETTER 個。呼叫端要先鎖住使用者（lockUser），同時上傳才不會超過。
 */
import { and, count, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { attachments, fonts } from '../db/schema.ts';
import { fail } from '../lib/errors.ts';

export const USER_STORAGE_QUOTA = 300 * 1024 * 1024;
export const ATTACHMENTS_PER_LETTER = 20;

export async function usedStorage(db: Db, userId: string): Promise<number> {
  const [a] = await db.select({ b: sql<string>`coalesce(sum(${attachments.size}), 0)::text` }).from(attachments).where(eq(attachments.userId, userId));
  const [f] = await db.select({ b: sql<string>`coalesce(sum(${fonts.size}), 0)::text` }).from(fonts).where(eq(fonts.userId, userId));
  return Number(a?.b ?? 0) + Number(f?.b ?? 0);
}

export async function assertStorageQuota(db: Db, userId: string, adding: number): Promise<void> {
  const used = await usedStorage(db, userId);
  if (used + adding > USER_STORAGE_QUOTA) {
    fail(413, 'BAD_REQUEST', `上傳空間用完了（每人 ${USER_STORAGE_QUOTA / 1024 / 1024} MB）。刪掉沒用的字型再試試。`, {
      reason: 'QUOTA',
      used,
      quota: USER_STORAGE_QUOTA,
    });
  }
}

export async function assertAttachmentSlots(db: Db, letterId: string): Promise<void> {
  const [c] = await db
    .select({ n: count() })
    .from(attachments)
    .where(and(eq(attachments.letterId, letterId)));
  if ((c?.n ?? 0) >= ATTACHMENTS_PER_LETTER) fail(409, 'CONFLICT', `一封信最多 ${ATTACHMENTS_PER_LETTER} 個檔案`, { reason: 'TOO_MANY_FILES' });
}
