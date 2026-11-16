import type { FastifyInstance } from 'fastify';
import { requireUser, user } from '../app.ts';
import { byIp, HOUR, limit, MIN } from '../lib/rateLimit.ts';
import { normEmail } from '../lib/crypto.ts';
import { isAdmin } from '../services/admin.ts';
import { logout, requestMagicLink, SESSION_COOKIE, verifyMagicLink } from '../services/auth.ts';

export async function authRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.post<{ Body: { email: string } }>(
    '/auth/magic-link',
    {
      // 同一個信箱一小時最多 5 封登入信、同一個 IP 一小時 30 次（避免寄信轟炸、燒寄信額度）
      preHandler: limit([
        { name: 'login-email', max: 5, windowMs: HOUR, key: (req) => normEmail((req.body as { email?: string })?.email ?? '') || null },
        { name: 'login-ip', max: 30, windowMs: HOUR, key: byIp },
      ]),
      schema: {
        body: { type: 'object', required: ['email'], additionalProperties: false, properties: { email: { type: 'string', maxLength: 254 } } },
      },
    },
    async (req, reply) => {
      await requestMagicLink(ctx, req.body.email);
      return reply.status(202).send({ ok: true });
    },
  );

  app.post<{ Body: { token: string } }>(
    '/auth/verify',
    {
      preHandler: limit([{ name: 'verify-ip', max: 30, windowMs: 10 * MIN, key: byIp }]),
      schema: {
        body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: { type: 'string', maxLength: 200 } } },
      },
    },
    async (req, reply) => {
      const r = await verifyMagicLink(ctx, req.body.token);
      reply.setCookie(SESSION_COOKIE, r.sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.cfg.isProd,
        expires: new Date(r.expiresAt),
      });
      return { user: r.user };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    await logout(ctx, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  // admin：前端用來決定要不要顯示管理頁入口（真正的權限檢查在 /admin 路由）
  app.get('/me', { preHandler: requireUser }, async (req) => ({ user: user(req), admin: isAdmin(ctx, user(req).email) }));
}
