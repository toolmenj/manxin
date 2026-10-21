/**
 * 書桌。信紙內容只有追加端點（chars／marks／strokes／moves，外加空白紙的紙本匯入 scan），
 * 沒有任何修改或刪除內容的端點。moves 只是移動打字頭，不改任何已寫的字。
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser, user } from '../app.ts';
import { fail } from '../lib/errors.ts';
import {
  addAttachment,
  appendToSheet,
  askLater,
  createLetter,
  discardRef,
  getLetter,
  letterDTO,
  listLetters,
  ownAttachment,
  patchLetter,
  patchSheet,
  PURPOSES,
  shelve,
  takeOutAttachment,
  tomb,
  transcribe,
  unshelve,
  type Purpose,
} from '../services/letters.ts';
import { addFont, listFonts, ownFont } from '../services/fonts.ts';
import { appendMetaProps, enm, envSchema, int, obj, str, strokeSchema, uuidParam } from './schemas.ts';

type IdP = { Params: { id: string } };

const sheetProps = {
  kind: enm('letter', 'postcard'),
  style: enm('lined', 'bahang', 'grid', 'plain', 'custom'),
  mode: enm('type', 'hand'),
  font: str({ minLength: 1, maxLength: 40 }),
};

export async function deskRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  // 這個外掛裡的路由都要登入（Fastify 外掛有封裝，不影響其他路由）
  app.addHook('preHandler', requireUser);

  app.post<{ Body: { kind?: 'letter' | 'postcard'; style?: never; mode?: never; font?: string; env?: never } }>(
    '/letters',
    { schema: { body: obj({ ...sheetProps, env: envSchema }) } },
    async (req, reply) => reply.status(201).send(await createLetter(ctx, user(req), req.body ?? {})),
  );

  app.get<{ Querystring: { status?: string } }>(
    '/letters',
    { schema: { querystring: obj({ status: enm('drafting', 'shelved', 'sent') }) } },
    async (req) => ({ letters: await listLetters(ctx, user(req).id, req.query.status) }),
  );

  app.get<IdP>('/letters/:id', { schema: { params: uuidParam() } }, async (req) =>
    letterDTO(ctx, await getLetter(ctx.db, user(req).id, req.params.id)),
  );

  app.patch<IdP & { Body: { env?: Record<string, string>; frontAttachmentId?: string | null } }>(
    '/letters/:id',
    {
      schema: {
        params: uuidParam(),
        body: obj({ env: envSchema, frontAttachmentId: { type: ['string', 'null'], pattern: '^[0-9a-fA-F-]{36}$' } }),
      },
    },
    async (req) => patchLetter(ctx, user(req).id, req.params.id, req.body),
  );

  /** 信紙設定（不是內容）：紙種、樣式、圖樣（上傳的或範本）只能在空白時改；書寫模式、字型隨時可換 */
  app.patch<IdP & { Body: Record<string, never> }>(
    '/letters/:id/sheet',
    {
      schema: {
        params: uuidParam(),
        body: obj({
          ...sheetProps,
          bgAttachmentId: { type: ['string', 'null'], pattern: '^[0-9a-fA-F-]{36}$' },
          bgTemplate: { type: ['string', 'null'], pattern: '^[a-z0-9-]{1,40}$' },
        }),
      },
    },
    async (req) => patchSheet(ctx, user(req).id, req.params.id, req.body),
  );

  /* ---- 只有追加 ---- */

  type Meta = { seq?: number; sheetId?: string; opId?: string };
  const meta = (b: Meta) => ({ seq: b.seq, sheetId: b.sheetId, opId: b.opId });
  /** 已經寫過的 opId（重送）回 200，第一次寫入回 201；回應本體都是目前的信紙 */
  const done = (reply: FastifyReply, r: Awaited<ReturnType<typeof appendToSheet>>) => {
    const { replayed, ...sheet } = r;
    return reply.status(replayed ? 200 : 201).send(sheet);
  };

  app.post<IdP & { Body: { text: string } & Meta }>(
    '/letters/:id/sheet/chars',
    { schema: { params: uuidParam(), body: obj({ text: str({ minLength: 1, maxLength: 4000 }), ...appendMetaProps }, ['text']) } },
    async (req, reply) => done(reply, await appendToSheet(ctx, user(req).id, req.params.id, { kind: 'chars', text: req.body.text }, meta(req.body))),
  );

  /** 塗改：at（第幾個字的清單）或舊的 from–to 範圍，兩者擇一 */
  app.post<IdP & { Body: { from?: number; to?: number; at?: number[]; tool: string } & Meta }>(
    '/letters/:id/sheet/marks',
    {
      schema: {
        params: uuidParam(),
        body: {
          ...obj(
            {
              from: int({ minimum: 0 }),
              to: int({ minimum: 0 }),
              at: { type: 'array', minItems: 1, maxItems: 2000, items: int({ minimum: 0 }) },
              tool: enm('s1', 's2', 'x', 'blk', 'tape'),
              ...appendMetaProps,
            },
            ['tool'],
          ),
          oneOf: [{ required: ['at'], not: { anyOf: [{ required: ['from'] }, { required: ['to'] }] } }, { required: ['from', 'to'], not: { required: ['at'] } }],
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      return done(reply, await appendToSheet(ctx, user(req).id, req.params.id, { kind: 'mark', from: b.from, to: b.to, at: b.at, tool: b.tool }, meta(b)));
    },
  );

  /** 移動打字頭：[行, 半格]。不寫字、不蓋字；只能停在可寫區域裡的空格 */
  app.post<IdP & { Body: { at: [number, number] } & Meta }>(
    '/letters/:id/sheet/moves',
    {
      schema: {
        params: uuidParam(),
        body: obj({ at: { type: 'array', minItems: 2, maxItems: 2, items: int({ minimum: 0, maximum: 10000 }) }, ...appendMetaProps }, ['at']),
      },
    },
    async (req, reply) => done(reply, await appendToSheet(ctx, user(req).id, req.params.id, { kind: 'move', at: req.body.at }, meta(req.body))),
  );

  app.post<IdP & { Body: { stroke: { pen: string; color: string; pts: number[][] } } & Meta }>(
    '/letters/:id/sheet/strokes',
    { schema: { params: uuidParam(), body: obj({ stroke: strokeSchema, ...appendMetaProps }, ['stroke']) } },
    async (req, reply) => done(reply, await appendToSheet(ctx, user(req).id, req.params.id, { kind: 'stroke', stroke: req.body.stroke }, meta(req.body))),
  );

  app.post<IdP & { Body: { attachmentId: string } }>(
    '/letters/:id/sheet/scan',
    { schema: { params: uuidParam(), body: obj({ attachmentId: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['attachmentId']) } },
    async (req, reply) =>
      reply.status(201).send(await appendToSheet(ctx, user(req).id, req.params.id, { kind: 'scan', attachmentId: req.body.attachmentId })),
  );

  /* ---- 謄抄與舊信紙 ---- */

  app.post<IdP>('/letters/:id/transcribe', { schema: { params: uuidParam() } }, async (req) => transcribe(ctx, user(req).id, req.params.id));

  app.post<{ Params: { id: string; sheetId: string }; Body: { state: 'crumple' | 'fold' | 'keep'; to: 'tomb' | 'trash' } }>(
    '/letters/:id/refs/:sheetId/discard',
    {
      schema: {
        params: obj({ id: str({ pattern: '^[0-9a-fA-F-]{36}$' }), sheetId: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['id', 'sheetId']),
        body: obj({ state: enm('crumple', 'fold', 'keep'), to: enm('tomb', 'trash') }, ['state', 'to']),
      },
    },
    async (req) => discardRef(ctx, user(req).id, req.params.id, req.params.sheetId, req.body.state, req.body.to),
  );

  app.get('/tomb', async (req) => tomb(ctx, user(req).id));

  /* ---- 先放著 ---- */

  app.post<IdP>('/letters/:id/shelve', { schema: { params: uuidParam() } }, async (req) => shelve(ctx, user(req).id, req.params.id));
  app.post<IdP>('/letters/:id/unshelve', { schema: { params: uuidParam() } }, async (req) => unshelve(ctx, user(req).id, req.params.id));
  app.post<IdP>('/letters/:id/ask-later', { schema: { params: uuidParam() } }, async (req) => askLater(ctx, user(req).id, req.params.id));

  /* ---- 附件（開發用本機磁碟） ---- */

  app.post<IdP & { Querystring: { purpose?: Purpose } }>(
    '/letters/:id/attachments',
    { schema: { params: uuidParam(), querystring: obj({ purpose: enm(...PURPOSES) }) } },
    async (req, reply) => {
      if (!req.isMultipart()) fail(415, 'BAD_REQUEST', '請用 multipart/form-data 上傳，欄位名稱 file');
      const file = await req.file();
      if (!file) fail(400, 'BAD_REQUEST', '沒有檔案');
      const data = await file!.toBuffer();
      if (file!.file.truncated) fail(413, 'BAD_REQUEST', '檔案太大');
      const a = await addAttachment(ctx, user(req).id, req.params.id, req.query.purpose ?? 'attachment', {
        name: file!.filename,
        mime: file!.mimetype,
        data,
      });
      return reply.status(201).send(a);
    },
  );

  app.post<{ Params: { id: string; attId: string } }>(
    '/letters/:id/attachments/:attId/take-out',
    { schema: { params: obj({ id: str({ pattern: '^[0-9a-fA-F-]{36}$' }), attId: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, ['id', 'attId']) } },
    async (req) => takeOutAttachment(ctx, user(req).id, req.params.id, req.params.attId),
  );

  app.get<IdP>('/attachments/:id', { schema: { params: uuidParam() } }, async (req, reply) => {
    const a = await ownAttachment(ctx.db, user(req).id, req.params.id);
    reply.header('content-type', a.mime).header('cache-control', 'private, max-age=3600');
    return reply.send(ctx.storage.read(a.path));
  });

  /* ---- 自訂字型（D-027：存在後端；信紙設定 font = 'f:<id>'） ---- */

  app.post('/fonts', async (req, reply) => {
    if (!req.isMultipart()) fail(415, 'BAD_REQUEST', '請用 multipart/form-data 上傳，欄位名稱 file');
    // 中文字型檔很大，上限另外設（FONT_MAX_BYTES），不跟圖片共用
    const file = await req.file({ limits: { fileSize: ctx.cfg.fontMaxBytes, files: 1 } });
    if (!file) fail(400, 'BAD_REQUEST', '沒有檔案');
    const data = await file!.toBuffer().catch((e: { code?: string }) => {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') fail(413, 'BAD_REQUEST', '字型檔太大', { max: ctx.cfg.fontMaxBytes });
      throw e;
    });
    if (file!.file.truncated) fail(413, 'BAD_REQUEST', '字型檔太大', { max: ctx.cfg.fontMaxBytes });
    return reply.status(201).send(await addFont(ctx, user(req).id, { name: file!.filename, data }));
  });

  app.get('/fonts', async (req) => ({ fonts: await listFonts(ctx, user(req).id) }));

  app.get<IdP>('/fonts/:id', { schema: { params: uuidParam() } }, async (req, reply) => {
    const f = await ownFont(ctx.db, user(req).id, req.params.id);
    reply.header('content-type', f.mime).header('cache-control', 'private, max-age=86400');
    return reply.send(ctx.storage.read(f.path));
  });
}
