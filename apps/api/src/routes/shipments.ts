/** 寄件、追蹤、收藏 */
import { isValidTrackNo } from '@manxin/engine';
import type { FastifyInstance } from 'fastify';
import { requireUser, user } from '../app.ts';
import { fail } from '../lib/errors.ts';
import { getCollection } from '../services/receive.ts';
import { editRecipientEmail, getMyShipment, myShipments, publicTrack } from '../services/shipments.ts';
import { obj, str } from './schemas.ts';

const noParam = obj({ no: str({ pattern: '^[A-Za-z]{2}[0-9]{9}[A-Za-z]{2}$' }) }, ['no']);
type NoP = { Params: { no: string } };

export async function shipmentRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  /** 公開查詢：信箱會遮掉 */
  app.get<NoP>('/track/:no', { schema: { params: noParam } }, async (req) => {
    const no = req.params.no.toUpperCase();
    if (!isValidTrackNo(no)) fail(404, 'NOT_FOUND', '單號的檢查碼不對，請再確認一次');
    return publicTrack(ctx, no);
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireUser);
    r.get('/shipments', async (req) => ({ shipments: await myShipments(ctx, user(req).id) }));
    r.get<NoP>('/shipments/:no', { schema: { params: noParam } }, async (req) => getMyShipment(ctx, user(req).id, req.params.no.toUpperCase()));
    r.post<NoP & { Body: { email: string } }>(
      '/shipments/:no/recipient-email',
      { schema: { params: noParam, body: obj({ email: str({ maxLength: 254 }) }, ['email']) } },
      async (req) => editRecipientEmail(ctx, user(req).id, req.params.no.toUpperCase(), req.body.email),
    );
    r.get('/collection', async (req) => getCollection(ctx, user(req).email));
  });
}
