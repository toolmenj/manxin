/**
 * 收信（收件人用開信連結，不需要登入）與收藏。
 * 開信或撕壞即簽收。毛邊與紙纖維的機率由伺服器擲骰，結果存檔。
 */
import { randomUUID } from 'node:crypto';
import {
  collect,
  enter,
  movePieces,
  openEnvelope,
  pour,
  pryStamp,
  pryWax,
  status,
  tearApart,
  unfold,
  type EnvelopeKind,
  type OpenMethod,
  type Piece,
  type RecvResult,
  type RecvState,
} from '@manxin/engine';
import type { CollectionDTO, EnvAddress, ReceiveDTO } from '@manxin/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { attachments, collectionItems, shipments } from '../db/schema.ts';
import { normEmail, roll, sha256 } from '../lib/crypto.ts';
import { fail } from '../lib/errors.ts';
import { attachmentDTO, currentSheet, sheetDTO } from './letters.ts';
import { editsOf, statusInput, type Pkg, type ShipmentRow } from './shipments.ts';

async function byToken(db: Db, token: string, lock = false): Promise<ShipmentRow> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail(404, 'INVALID_TOKEN', '這個開信連結不存在或已失效');
  const q = db.select().from(shipments).where(eq(shipments.recipientTokenHash, sha256(token)));
  const rows = lock ? await q.for('update') : await q;
  const s = rows[0];
  if (!s) {
    // 退信或改寄後連結會被清空
    fail(404, 'INVALID_TOKEN', '這個開信連結不存在或已失效');
  }
  return s!;
}

async function receiveDTO(ctx: Ctx, db: Db, s: ShipmentRow, token: string): Promise<ReceiveDTO> {
  const recv = s.recv as RecvState;
  const env = s.env as EnvAddress;
  const pkg = s.pkg as Pkg;
  let letter: ReceiveDTO['letter'] = null;
  let atts: ReceiveDTO['attachments'] = null;
  if (recv.poured) {
    // 倒出來就看得到附件（原型：附件和摺著的信紙一起倒出來）
    const rows = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.letterId, s.letterId), eq(attachments.purpose, 'attachment'), isNull(attachments.takenOutAt)));
    atts = rows.map((a) => attachmentDTO(a, `/r/${token}/attachments/${a.id}`));
  }
  if (recv.unfolded) {
    const sh = await currentSheet(db, s.letterId);
    const L = (await db.query.letters.findFirst({ where: (l, { eq }) => eq(l.id, s.letterId) }))!;
    letter = {
      sheet: await sheetDTO(db, sh),
      attachments: atts ?? [],
      frontAttachmentId: L.frontAttachmentId,
    };
  }
  const { efont: _f, ...pk } = pkg;
  return { no: s.no, fromName: env.fromName, office: s.office, sentAt: s.sentAt.getTime(), pkg: pk, recv, letter, attachments: atts };
}

/** 收件人目前看得到這封信嗎：送達（或重新投遞）後、未退回 */
function assertOpenable(ctx: Ctx, s: ShipmentRow, edits: Awaited<ReturnType<typeof editsOf>>) {
  const st = status(statusInput(s, edits), ctx.clock.now());
  if (st.state === 'returned' || s.returnedAt) fail(410, 'GONE', '這封信已經退回寄件人了');
  if (st.state === 'transit' || st.state === 'rerouting') fail(404, 'INVALID_TOKEN', '這個開信連結不存在或已失效');
  return st;
}

export async function getReceive(ctx: Ctx, token: string): Promise<ReceiveDTO> {
  const s = await byToken(ctx.db, token);
  assertOpenable(ctx, s, await editsOf(ctx.db, s.id));
  return receiveDTO(ctx, ctx.db, s, token);
}

export type RecvAction =
  | { type: 'enter' }
  | { type: 'open'; method: OpenMethod; cutPath?: string }
  | { type: 'tear'; x: number }
  | { type: 'pry-stamp' }
  | { type: 'pry-wax' }
  | { type: 'pour' }
  | { type: 'unfold' }
  | { type: 'collect' }
  | { type: 'pieces'; pieces: Piece[] };

const RECV_MESSAGES: Record<string, string> = {
  ALREADY_OPENED: '信已經打開了',
  NOT_OPENED: '信還沒打開',
  NOT_POURED: '先把信紙倒出來',
  ALREADY_POURED: '已經倒出來了',
  NOT_UNFOLDED: '先把信紙攤開',
  ALREADY_UNFOLDED: '已經攤開了',
  ALREADY_COLLECTED: '已經收進收藏了',
  NO_STAMP: '信封上沒有郵票',
  ALREADY_TAKEN: '已經撬下來了',
  NO_WAX: '這個信封沒有火漆',
  NOT_TORN: '信沒有撕破，沒有碎片',
  NOT_ENTERED: '先點開連結',
  INVALID_PIECES: '碎片資料不正確',
};

export async function receiveAction(ctx: Ctx, token: string, a: RecvAction): Promise<ReceiveDTO> {
  return ctx.db.transaction(async (tx) => {
    const s = await byToken(tx, token, true);
    const st = assertOpenable(ctx, s, await editsOf(tx, s.id));
    const pkg = s.pkg as Pkg;
    const env = pkg.env as EnvelopeKind;
    const r0 = s.recv as RecvState;
    const now = ctx.clock.now();
    let r: RecvResult;
    switch (a.type) {
      case 'enter':
        r = enter(r0, env);
        break;
      case 'open':
        if (env === 'card') fail(422, 'INVALID_STATE', '明信片不用拆');
        r = openEnvelope(r0, env, a.method, roll(), a.cutPath ?? '');
        break;
      case 'tear':
        if (env === 'card') fail(422, 'INVALID_STATE', '明信片不會撕成兩半');
        r = tearApart(r0, a.x, randomUUID());
        break;
      case 'pry-stamp':
        r = pryStamp(r0, !!pkg.stampPos, roll());
        break;
      case 'pry-wax':
        r = pryWax(r0, env, roll());
        break;
      case 'pour':
        r = pour(r0);
        break;
      case 'unfold':
        r = unfold(r0);
        break;
      case 'collect':
        r = collect(r0);
        break;
      case 'pieces':
        r = movePieces(r0, a.pieces);
        break;
    }
    if (!r.ok) fail(409, 'INVALID_STATE', RECV_MESSAGES[r.code] ?? r.code, { reason: r.code });
    const patch: Partial<ShipmentRow> = { recv: r.state };
    if (r.signs && !s.signedAt) patch.signedAt = new Date(now);
    await tx.update(shipments).set(patch).where(eq(shipments.id, s.id));
    // 收藏屬於收件信箱
    const email = normEmail(st.curEmail);
    const item = (kind: string, fiber = false) =>
      tx.insert(collectionItems).values({ recipientEmail: email, shipmentId: s.id, kind, fiber, at: new Date(now) }).onConflictDoNothing();
    if (a.type === 'collect') await item('letter');
    if (a.type === 'pry-stamp') await item('stamp', r.state.stampFiber);
    if (a.type === 'pry-wax') await item('wax', r.state.waxFiber);
    return receiveDTO(ctx, tx, { ...s, ...patch }, token);
  });
}

export async function recipientAttachment(ctx: Ctx, token: string, attId: string) {
  const s = await byToken(ctx.db, token);
  assertOpenable(ctx, s, await editsOf(ctx.db, s.id));
  const rows = await ctx.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attId), eq(attachments.letterId, s.letterId)));
  const a = rows[0];
  if (!a || !['attachment', 'front', 'bg', 'scan', 'stamp', 'postmark', 'skin'].includes(a.purpose)) fail(404, 'NOT_FOUND', '找不到這個檔案');
  // 信封外面看得到的（上傳的郵票、郵戳、信封圖）一開始就能看；信封裡的東西要倒出來之後
  if (!['stamp', 'postmark', 'skin'].includes(a!.purpose) && !(s.recv as RecvState).poured) fail(409, 'INVALID_STATE', '附件還在信封裡');
  return a!;
}

export async function getCollection(ctx: Ctx, email: string): Promise<CollectionDTO> {
  const items = await ctx.db
    .select()
    .from(collectionItems)
    .where(eq(collectionItems.recipientEmail, normEmail(email)))
    .orderBy(desc(collectionItems.at));
  const ids = [...new Set(items.map((i) => i.shipmentId))];
  const ships = ids.length ? await ctx.db.select().from(shipments).where(inArray(shipments.id, ids)) : [];
  const byId = new Map(ships.map((s) => [s.id, s]));
  const out: CollectionDTO = { letters: [], stamps: [], waxes: [] };
  for (const i of items) {
    const s = byId.get(i.shipmentId);
    if (!s) continue;
    const fromName = (s.env as EnvAddress).fromName;
    const at = i.at.getTime();
    if (i.kind === 'letter') out.letters.push({ no: s.no, fromName, at, torn: !!(s.recv as RecvState).torn });
    else if (i.kind === 'stamp') {
      const pkg = s.pkg as Pkg;
      out.stamps.push({ no: s.no, stamp: pkg.stamp, stampAttachmentId: pkg.stampAttachmentId, fiber: i.fiber, fromName, at });
    } else out.waxes.push({ no: s.no, fiber: i.fiber, fromName, at });
  }
  return out;
}
