/** 前往郵局、櫃台、投郵筒 */
import { MODES, PLACES, tripMin } from '@manxin/engine';
import type { FastifyInstance } from 'fastify';
import { requireUser, user } from '../app.ts';
import {
  appendEnvelope,
  confirmAddress,
  enterPostOffice,
  fold,
  getCounter,
  getTrip,
  goHome,
  insertLetter,
  patchCounter,
  placePostmark,
  placeStamp,
  seal,
  startTrip,
  type CounterPatch,
} from '../services/counter.ts';
import { postLetter } from '../services/shipments.ts';
import { bool, enm, num, obj, posSchema, str, strokeSchema, uuidParam } from './schemas.ts';

type IdP = { Params: { id: string } };
const uuidOrNull = { type: ['string', 'null'], pattern: '^[0-9a-fA-F-]{36}$' };

export async function postRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  /** 附近的郵局與前往方式（公開） */
  app.get('/places', async () => ({
    places: PLACES.map((p) => ({ ...p, minutes: Object.fromEntries(Object.keys(MODES).map((m) => [m, tripMin(p, m as never)])) })),
    modes: MODES,
  }));

  await app.register(async (r) => {
    r.addHook('preHandler', requireUser);

    r.post<IdP & { Body: { place: string; mode: 'walk' | 'bike' | 'car'; box: 'green' | 'red' } }>(
      '/letters/:id/trip',
      {
        schema: {
          params: uuidParam(),
          body: obj({ place: enm(...PLACES.map((p) => p.id)), mode: enm('walk', 'bike', 'car'), box: enm('green', 'red') }, ['place', 'mode', 'box']),
        },
      },
      async (req, reply) => reply.status(201).send(await startTrip(ctx, user(req).id, req.params.id, req.body)),
    );
    r.get<IdP>('/letters/:id/trip', { schema: { params: uuidParam() } }, async (req) => ({ trip: await getTrip(ctx, user(req).id, req.params.id) }));
    r.post<IdP>('/letters/:id/trip/enter', { schema: { params: uuidParam() } }, async (req) => enterPostOffice(ctx, user(req).id, req.params.id));
    r.post<IdP>('/letters/:id/trip/home', { schema: { params: uuidParam() } }, async (req, reply) => {
      await goHome(ctx, user(req).id, req.params.id);
      return reply.status(204).send();
    });

    /* ---- 櫃台 ---- */
    r.get<IdP>('/letters/:id/counter', { schema: { params: uuidParam() } }, async (req) => getCounter(ctx, user(req).id, req.params.id));

    r.patch<IdP & { Body: CounterPatch }>(
      '/letters/:id/counter',
      {
        schema: {
          params: uuidParam(),
          body: obj({
            env: enm('post', 'kraft', 'chinese', 'wax', 'custom', 'card'),
            skinAttachmentId: str({ pattern: '^[0-9a-fA-F-]{36}$' }),
            stamp: enm('plum', 'junk', 'bird', 'tear'),
            stampAttachmentId: uuidOrNull,
            pm: enm('date', 'wave'),
            pmAttachmentId: uuidOrNull,
            rot: bool,
            emode: enm('type', 'hand'),
          }),
        },
      },
      async (req) => patchCounter(ctx, user(req).id, req.params.id, req.body),
    );

    r.post<IdP>('/letters/:id/counter/confirm-address', { schema: { params: uuidParam() } }, async (req) =>
      confirmAddress(ctx, user(req).id, req.params.id),
    );

    r.post<IdP & { Body: { zone: 'from' | 'to'; text?: string; stroke?: never } }>(
      '/letters/:id/counter/envelope-text',
      {
        schema: {
          params: uuidParam(),
          body: obj({ zone: enm('from', 'to'), text: str({ minLength: 1, maxLength: 400 }), stroke: strokeSchema }, ['zone']),
        },
      },
      async (req, reply) => reply.status(201).send(await appendEnvelope(ctx, user(req).id, req.params.id, req.body)),
    );

    r.post<IdP & { Body: { edge: 't' | 'b' | 'l' | 'r'; at: number } }>(
      '/letters/:id/counter/folds',
      { schema: { params: uuidParam(), body: obj({ edge: enm('t', 'b', 'l', 'r'), at: num() }, ['edge', 'at']) } },
      async (req, reply) => reply.status(201).send(await fold(ctx, user(req).id, req.params.id, req.body.edge, req.body.at)),
    );

    r.post<IdP>('/letters/:id/counter/insert', { schema: { params: uuidParam() } }, async (req) => insertLetter(ctx, user(req).id, req.params.id));
    r.post<IdP>('/letters/:id/counter/seal', { schema: { params: uuidParam() } }, async (req) => seal(ctx, user(req).id, req.params.id));
    r.post<IdP & { Body: { x: number; y: number; r: number } }>(
      '/letters/:id/counter/stamp',
      { schema: { params: uuidParam(), body: posSchema } },
      async (req) => placeStamp(ctx, user(req).id, req.params.id, req.body),
    );
    r.post<IdP & { Body: { x: number; y: number; r: number } }>(
      '/letters/:id/counter/postmark',
      { schema: { params: uuidParam(), body: posSchema } },
      async (req) => placePostmark(ctx, user(req).id, req.params.id, req.body),
    );

    /** 投郵筒：檢查寄出前條件，建立寄件與排程 */
    r.post<IdP>('/letters/:id/post', { schema: { params: uuidParam() } }, async (req, reply) =>
      reply.status(201).send(await postLetter(ctx, user(req).id, req.params.id)),
    );
  });
}
