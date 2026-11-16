/** 帳號：偏好（D-034）、登出所有裝置、刪除帳號、封鎖名單；以及不用登入的公開設定 */
import type { FastifyInstance } from 'fastify';
import { requireUser, user } from '../app.ts';
import { listBlocks, unblock } from '../services/abuse.ts';
import { deleteAccount, getPrefs, logoutAll, putPrefs } from '../services/account.ts';
import { SESSION_COOKIE } from '../services/auth.ts';
import { obj, str, uuidParam } from './schemas.ts';

export async function accountRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  /** 隱私權政策、使用條款頁要用的聯絡信箱 */
  app.get('/public/config', async () => ({ contactEmail: ctx.cfg.contactEmail || null }));

  await app.register(async (r) => {
    r.addHook('preHandler', requireUser);

    r.get('/me/prefs', async (req) => getPrefs(ctx, user(req).id));
    r.put<{ Body: { prefs: Record<string, unknown> } }>(
      '/me/prefs',
      { schema: { body: { type: 'object', required: ['prefs'], additionalProperties: false, properties: { prefs: { type: 'object' } } } } },
      async (req) => putPrefs(ctx, user(req).id, req.body.prefs),
    );

    r.post('/auth/logout-all', async (req, reply) => {
      await logoutAll(ctx, user(req).id);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    });

    /** 刪除帳號：要輸入自己的信箱確認 */
    r.delete<{ Body: { confirmEmail: string } }>(
      '/me',
      { schema: { body: obj({ confirmEmail: str({ maxLength: 254 }) }, ['confirmEmail']) } },
      async (req, reply) => {
        await deleteAccount(ctx, user(req).id, req.body.confirmEmail);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(204).send();
      },
    );

    r.get('/blocks', async (req) => listBlocks(ctx, user(req).email));
    r.delete<{ Params: { id: string } }>('/blocks/:id', { schema: { params: uuidParam() } }, async (req) => unblock(ctx, user(req).email, req.params.id));
  });
}
