/** 管理頁 API（ADMIN_EMAILS 裡的信箱登入才用得到；只有數字與狀態） */
import type { FastifyInstance } from 'fastify';
import { requireUser, user } from '../app.ts';
import { adminReports, dismissReport, setSuspended } from '../services/abuse.ts';
import { adminFailures, adminStats, assertAdmin, retryJob, retryMail } from '../services/admin.ts';
import { obj, str } from './schemas.ts';

const idParam = obj({ id: str({ pattern: '^[0-9]{1,15}$' }) }, ['id']);
const uuidP = obj({ id: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['id']);

export async function adminRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  app.addHook('preHandler', requireUser);
  app.addHook('preHandler', async (req) => assertAdmin(ctx, req.user?.email));

  app.get('/admin/stats', async () => adminStats(ctx));
  app.get('/admin/failures', async () => adminFailures(ctx));
  app.post<{ Params: { id: string } }>('/admin/jobs/:id/retry', { schema: { params: idParam } }, async (req) => {
    req.log.info({ admin: user(req).id, job: req.params.id }, 'admin retry job');
    return retryJob(ctx, Number(req.params.id));
  });
  app.post<{ Params: { id: string } }>('/admin/mails/:id/retry', { schema: { params: idParam } }, async (req) => {
    req.log.info({ admin: user(req).id, mail: req.params.id }, 'admin retry mail');
    return retryMail(ctx, Number(req.params.id));
  });

  /* ---- 檢舉（只看理由與次數，看不到信件內容） ---- */
  app.get('/admin/reports', async () => adminReports(ctx));
  app.post<{ Params: { id: string } }>('/admin/reports/:id/dismiss', { schema: { params: uuidP } }, async (req) => {
    req.log.info({ admin: user(req).id, report: req.params.id }, 'admin dismiss report');
    return dismissReport(ctx, req.params.id);
  });
  app.post<{ Params: { id: string } }>('/admin/users/:id/suspend', { schema: { params: uuidP } }, async (req) => {
    req.log.info({ admin: user(req).id, target: req.params.id }, 'admin suspend user');
    return setSuspended(ctx, req.params.id, true);
  });
  app.post<{ Params: { id: string } }>('/admin/users/:id/unsuspend', { schema: { params: uuidP } }, async (req) => {
    req.log.info({ admin: user(req).id, target: req.params.id }, 'admin unsuspend user');
    return setSuspended(ctx, req.params.id, false);
  });
}
