/** 收信：收件人用開信連結（不需要登入） */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomToken } from '../lib/crypto.ts';
import { REPORT_REASONS } from '../services/abuse.ts';
import { blockFromLetter, getReceive, receiveAction, recipientAttachment, recipientFont, reportFromLetter, type Actor, type RecvAction } from '../services/receive.ts';
import { sendUserFile } from '../services/storage.ts';
import { byIp, limit, MIN } from '../lib/rateLimit.ts';
import { enm, num, obj, str } from './schemas.ts';

const tokenParam = obj({ token: str({ pattern: '^[A-Za-z0-9_-]{20,100}$' }) }, ['token']);
type TP = { Params: { token: string } };

/** 這台瀏覽器的識別（D-029）。沒有就發一個，存一年 */
export const BROWSER_COOKIE = 'mx_rb';
function actor(req: FastifyRequest, reply: FastifyReply): Actor {
  let id = req.cookies[BROWSER_COOKIE];
  if (!id || !/^[A-Za-z0-9_-]{20,100}$/.test(id)) {
    id = randomToken();
    reply.setCookie(BROWSER_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: req.server.ctx.cfg.isProd, maxAge: 365 * 86400 });
  }
  return { browserId: id, email: req.user?.email ?? null };
}

export async function receiveRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  // 開信連結不用登入：限制同一個 IP 的次數，避免猜連結或洗收信動作
  app.addHook('preHandler', limit([{ name: 'recv-ip', max: 600, windowMs: 10 * MIN, key: byIp }]));

  app.get<TP>('/r/:token', { schema: { params: tokenParam } }, async (req) => getReceive(ctx, req.params.token));

  const simple = ['enter', 'pry-stamp', 'pry-wax', 'pour', 'unfold', 'collect'] as const;
  for (const type of simple) {
    app.post<TP>(`/r/:token/${type}`, { schema: { params: tokenParam } }, async (req, reply) =>
      receiveAction(ctx, req.params.token, { type } as RecvAction, actor(req, reply)),
    );
  }

  /** 開信：開信刀或手撕（易撕帶信封的「手撕」就是拉易撕帶） */
  app.post<TP & { Body: { method: 'knife' | 'tear'; cutPath?: string } }>(
    '/r/:token/open',
    { schema: { params: tokenParam, body: obj({ method: enm('knife', 'tear'), cutPath: str({ maxLength: 4000 }) }, ['method']) } },
    async (req, reply) => receiveAction(ctx, req.params.token, { type: 'open', ...req.body }, actor(req, reply)),
  );

  /** 撕毀：前端依軌跡判斷（D-013 暫定）後回報撕開的位置 x（0–1） */
  app.post<TP & { Body: { x: number } }>(
    '/r/:token/tear',
    { schema: { params: tokenParam, body: obj({ x: num({ minimum: 0, maximum: 1 }) }, ['x']) } },
    async (req, reply) => receiveAction(ctx, req.params.token, { type: 'tear', x: req.body.x }, actor(req, reply)),
  );

  /** 碎片位置（撕毀後，收件人自己拼） */
  app.post<TP & { Body: { pieces: { k: 'eL' | 'eR' | 'lL' | 'lR'; x: number; y: number; rot: number }[] } }>(
    '/r/:token/pieces',
    {
      schema: {
        params: tokenParam,
        body: obj(
          {
            pieces: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: obj({ k: enm('eL', 'eR', 'lL', 'lR'), x: num(), y: num(), rot: num() }, ['k', 'x', 'y', 'rot']),
            },
          },
          ['pieces'],
        ),
      },
    },
    async (req, reply) => receiveAction(ctx, req.params.token, { type: 'pieces', pieces: req.body.pieces }, actor(req, reply)),
  );

  app.get<TP & { Params: { attId: string } }>(
    '/r/:token/attachments/:attId',
    { schema: { params: obj({ token: str({ pattern: '^[A-Za-z0-9_-]{20,100}$' }), attId: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['token', 'attId']) } },
    async (req, reply) => {
      const a = await recipientAttachment(ctx, req.params.token, req.params.attId);
      return sendUserFile(reply, a.mime, await ctx.storage.read(a.path, ctx.db), 'private, max-age=3600');
    },
  );

  /** 字型檔（給 FontFace 用）：信封與信紙用到的自訂字型 */
  app.get<TP & { Params: { fontId: string } }>(
    '/r/:token/fonts/:fontId',
    { schema: { params: obj({ token: str({ pattern: '^[A-Za-z0-9_-]{20,100}$' }), fontId: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['token', 'fontId']) } },
    async (req, reply) => {
      const f = await recipientFont(ctx, req.params.token, req.params.fontId);
      return sendUserFile(reply, f.mime, await ctx.storage.read(f.path, ctx.db), 'private, max-age=86400');
    },
  );

  /** 不再收這個人的信（收件人本人） */
  app.post<TP>('/r/:token/block', { schema: { params: tokenParam } }, async (req, reply) => blockFromLetter(ctx, req.params.token, actor(req, reply)));

  /** 檢舉這封信（收件人本人）；block=true 同時封鎖 */
  app.post<TP & { Body: { reason: (typeof REPORT_REASONS)[number]; note?: string; block?: boolean } }>(
    '/r/:token/report',
    { schema: { params: tokenParam, body: obj({ reason: enm(...REPORT_REASONS), note: str({ maxLength: 500 }), block: { type: 'boolean' } }, ['reason']) } },
    async (req, reply) => reportFromLetter(ctx, req.params.token, actor(req, reply), req.body),
  );
}
