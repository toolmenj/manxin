/**
 * 帳號：email magic link（D-008 暫定）。
 * 登入連結的 token 只存雜湊、15 分鐘有效、只能用一次；session token 同樣只存雜湊，30 天有效。
 */
import type { UserDTO } from '@manxin/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import { loginTokens, sessions, users } from '../db/schema.ts';
import { EMAIL_RE, normEmail, randomToken, sha256 } from '../lib/crypto.ts';
import { fail } from '../lib/errors.ts';
import { flushMail } from './jobs.ts';
import { magicLinkMail } from './mails.ts';

/** 登入與 session 的有效期限用真實時間，不受開發用「快轉」影響（否則快轉 30 天就被登出） */
const realNow = () => Date.now();

export const SESSION_COOKIE = 'mx_session';
export const MAGIC_TTL_MIN = 15;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

export async function requestMagicLink(ctx: Ctx, rawEmail: string): Promise<void> {
  const email = normEmail(rawEmail);
  if (!EMAIL_RE.test(email)) fail(422, 'INVALID_EMAIL', '信箱格式不對');
  const token = randomToken();
  const now = realNow();
  await ctx.db.transaction(async (tx) => {
    await tx.insert(loginTokens).values({
      tokenHash: sha256(token),
      email,
      expiresAt: new Date(now + MAGIC_TTL_MIN * 60_000),
      createdAt: new Date(now),
    });
    const m = magicLinkMail({ link: `${ctx.cfg.appUrl}/login?token=${token}`, minutes: MAGIC_TTL_MIN });
    // token 只放開發用本機信箱的 meta（測試與本機信箱頁要用）；正式環境的 outbox 不存 meta（review M12）
    await ctx.mailer.send({ to: email, ...m, idempotencyKey: `login:${sha256(token)}`, meta: { kind: 'login', token } }, tx, now);
  });
  // 交易成功後馬上寄出（登入信要快）；寄信失敗不影響回應，worker 之後會重試。頻率限制在路由層（routes/auth.ts）
  await flushMail(ctx);
}

/** 用登入連結換 session。回傳 session token（放進 cookie） */
export async function verifyMagicLink(ctx: Ctx, token: string): Promise<{ user: UserDTO; sessionToken: string; expiresAt: number }> {
  const now = realNow();
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(loginTokens)
      .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date(now))))
      .for('update');
    const lt = rows[0] ?? fail(401, 'INVALID_TOKEN', '登入連結無效或已過期，請重新索取');
    await tx.update(loginTokens).set({ usedAt: new Date(now) }).where(eq(loginTokens.tokenHash, lt.tokenHash));
    await tx.insert(users).values({ email: lt.email, createdAt: new Date(now) }).onConflictDoNothing({ target: users.email });
    const u = (await tx.select().from(users).where(eq(users.email, lt.email)))[0]!;
    const sessionToken = randomToken();
    const expiresAt = now + SESSION_TTL_MS;
    await tx.insert(sessions).values({ idHash: sha256(sessionToken), userId: u.id, expiresAt: new Date(expiresAt), createdAt: new Date(now) });
    return { user: { id: u.id, email: u.email }, sessionToken, expiresAt };
  });
}

export async function userBySession(ctx: Ctx, sessionToken: string | undefined): Promise<UserDTO | null> {
  if (!sessionToken) return null;
  const rows = await ctx.db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, sha256(sessionToken)), gt(sessions.expiresAt, new Date(realNow()))));
  return rows[0] ?? null;
}

export async function logout(ctx: Ctx, sessionToken: string | undefined): Promise<void> {
  if (sessionToken) await ctx.db.delete(sessions).where(eq(sessions.idHash, sha256(sessionToken)));
}
