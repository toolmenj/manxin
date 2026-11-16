/** 收件匣、收藏重看、頁首數字（需登入） */
import type { FastifyInstance } from 'fastify';
import { requireUser, user } from '../app.ts';
import { collectionLink, getInbox } from '../services/inbox.ts';
import { obj, str } from './schemas.ts';

export async function inboxRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  app.addHook('preHandler', requireUser);

  app.get('/inbox', async (req) => getInbox(ctx, user(req).email));

  app.get<{ Params: { no: string } }>(
    '/collection/:no',
    { schema: { params: obj({ no: str({ pattern: '^[A-Za-z]{2}[0-9]{9}[A-Za-z]{2}$' }) }, ['no']) } },
    async (req) => collectionLink(ctx, user(req).email, req.params.no.toUpperCase()),
  );
}
