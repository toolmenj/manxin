/**
 * 收件匣（D-024）與收藏重看（D-025）。
 * 收件人用「收到信的那個信箱」登入就找得到信，不必靠瀏覽器記住開信連結（review H6）。
 * 只列目前有效的投遞（已送達、沒退回、沒改寄到別的信箱）。
 */
import type { EnvelopeKind, RecvState } from '@manxin/engine';
import type { EnvAddress, InboxDTO, InboxItemDTO } from '@manxin/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import { collectionItems, shipments } from '../db/schema.ts';
import { normEmail } from '../lib/crypto.ts';
import { notFound } from '../lib/errors.ts';
import { recipientToken } from './jobs.ts';
import type { Pkg, ShipmentRow } from './shipments.ts';

const linkOf = (ctx: Ctx, s: ShipmentRow) => `/r/${recipientToken(ctx.cfg.appSecret, s.id, s.deliverySeq)}`;

function itemDTO(ctx: Ctx, s: ShipmentRow): InboxItemDTO {
  const recv = s.recv as RecvState;
  return {
    no: s.no,
    fromName: (s.env as EnvAddress).fromName,
    sentAt: s.sentAt.getTime(),
    postcard: ((s.pkg as Pkg).env as EnvelopeKind) === 'card',
    signed: !!s.signedAt,
    opened: !!(recv.opened || recv.torn || s.signedAt),
    link: linkOf(ctx, s),
  };
}

export async function getInbox(ctx: Ctx, email: string): Promise<InboxDTO> {
  const rows = await ctx.db
    .select()
    .from(shipments)
    .where(and(eq(shipments.recipientEmail, normEmail(email)), isNotNull(shipments.recipientTokenHash)))
    .orderBy(desc(shipments.deliverAt))
    .limit(500);
  const now = ctx.clock.now();
  // 送達時間還沒到的（理論上 token 只在送達時才產生）保險起見濾掉
  const letters = rows.filter((s) => s.deliverAt.getTime() <= now || s.deliverySeq > 0).map((s) => itemDTO(ctx, s));
  return { letters, unopened: letters.filter((l) => !l.opened).length };
}

/** 收藏重看：只要收藏裡有這封信，就給開信連結（簽收後連結只能看，見 D-029） */
export async function collectionLink(ctx: Ctx, email: string, no: string): Promise<{ link: string }> {
  const rows = await ctx.db
    .select({ s: shipments })
    .from(collectionItems)
    .innerJoin(shipments, eq(shipments.id, collectionItems.shipmentId))
    .where(and(eq(collectionItems.recipientEmail, normEmail(email)), eq(shipments.no, no), eq(collectionItems.kind, 'letter')))
    .limit(1);
  const s = rows[0]?.s;
  if (!s || !s.recipientTokenHash) notFound('收藏裡沒有這封信');
  return { link: linkOf(ctx, s!) };
}
