/** 信紙圖樣範本庫（公開：收件人沒登入也要看得到信紙的圖樣） */
import type { FastifyInstance } from 'fastify';
import { fail } from '../lib/errors.ts';
import { listTemplates, templateSvg } from '../services/paperTemplates.ts';
import { obj, str } from './schemas.ts';

export async function templateRoutes(app: FastifyInstance) {
  app.get('/paper-templates', async () => ({ templates: listTemplates() }));

  app.get<{ Params: { file: string } }>(
    '/paper-templates/:file',
    { schema: { params: obj({ file: str({ pattern: '^[a-z0-9-]{1,40}\.svg$' }) }, ['file']) } },
    async (req, reply) => {
      const s = templateSvg(req.params.file.replace(/\.svg$/, ''));
      if (!s) fail(404, 'NOT_FOUND', '沒有這個信紙範本');
      reply.header('content-type', 'image/svg+xml; charset=utf-8').header('cache-control', 'public, max-age=86400');
      return reply.send(s);
    },
  );
}
