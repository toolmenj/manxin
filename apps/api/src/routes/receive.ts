/** 收信：收件人用開信連結（不需要登入） */
import type { FastifyInstance } from 'fastify';
import { getReceive, receiveAction, recipientAttachment, recipientFont, type RecvAction } from '../services/receive.ts';
import { enm, num, obj, str } from './schemas.ts';

const tokenParam = obj({ token: str({ pattern: '^[A-Za-z0-9_-]{20,100}$' }) }, ['token']);
type TP = { Params: { token: string } };

export async function receiveRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get<TP>('/r/:token', { schema: { params: tokenParam } }, async (req) => getReceive(ctx, req.params.token));

  const simple = ['enter', 'pry-stamp', 'pry-wax', 'pour', 'unfold', 'collect'] as const;
  for (const type of simple) {
    app.post<TP>(`/r/:token/${type}`, { schema: { params: tokenParam } }, async (req) => receiveAction(ctx, req.params.token, { type } as RecvAction));
  }

  /** 開信：開信刀或手撕（易撕帶信封的「手撕」就是拉易撕帶） */
  app.post<TP & { Body: { method: 'knife' | 'tear'; cutPath?: string } }>(
    '/r/:token/open',
    { schema: { params: tokenParam, body: obj({ method: enm('knife', 'tear'), cutPath: str({ maxLength: 4000 }) }, ['method']) } },
    async (req) => receiveAction(ctx, req.params.token, { type: 'open', ...req.body }),
  );

  /** 撕毀：前端依軌跡判斷（D-013 暫定）後回報撕開的位置 x（0–1） */
  app.post<TP & { Body: { x: number } }>(
    '/r/:token/tear',
    { schema: { params: tokenParam, body: obj({ x: num({ minimum: 0, maximum: 1 }) }, ['x']) } },
    async (req) => receiveAction(ctx, req.params.token, { type: 'tear', x: req.body.x }),
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
    async (req) => receiveAction(ctx, req.params.token, { type: 'pieces', pieces: req.body.pieces }),
  );

  app.get<TP & { Params: { attId: string } }>(
    '/r/:token/attachments/:attId',
    { schema: { params: obj({ token: str({ pattern: '^[A-Za-z0-9_-]{20,100}$' }), attId: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['token', 'attId']) } },
    async (req, reply) => {
      const a = await recipientAttachment(ctx, req.params.token, req.params.attId);
      reply.header('content-type', a.mime).header('cache-control', 'private, max-age=3600');
      return reply.send(ctx.storage.read(a.path));
    },
  );

  /** 字型檔（給 FontFace 用）：信封與信紙用到的自訂字型 */
  app.get<TP & { Params: { fontId: string } }>(
    '/r/:token/fonts/:fontId',
    { schema: { params: obj({ token: str({ pattern: '^[A-Za-z0-9_-]{20,100}$' }), fontId: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['token', 'fontId']) } },
    async (req, reply) => {
      const f = await recipientFont(ctx, req.params.token, req.params.fontId);
      reply.header('content-type', f.mime).header('cache-control', 'private, max-age=86400');
      return reply.send(ctx.storage.read(f.path));
    },
  );
}
