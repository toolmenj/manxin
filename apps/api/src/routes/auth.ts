import type { FastifyInstance } from 'fastify';
import { requireUser, user } from '../app.ts';
import { logout, requestMagicLink, SESSION_COOKIE, verifyMagicLink } from '../services/auth.ts';

export async function authRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.post<{ Body: { email: string } }>(
    '/auth/magic-link',
    {
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

  app.get('/me', { preHandler: requireUser }, async (req) => ({ user: user(req) }));
}
