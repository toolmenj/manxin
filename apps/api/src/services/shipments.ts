/**
 * 投郵筒（建立寄件）、寄件列表、追蹤、修改收件信箱。
 */
import {
  D,
  canEditEmail,
  domain,
  parsePlace,
  placeById,
  plan,
  rerouteDeliverAt,
  returnPostmark,
  status,
  trackNo,
  initialRecv,
  type Plan,
  type PlanEvent,
  type ShipStatus,
  type StatusInput,
} from '@manxin/engine';
import type { CounterDTO, EnvAddress, ShipmentDTO, TrackDTO } from '@manxin/shared';
import { asc, desc, eq } from 'drizzle-orm';
import { ms, type Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { emailEdits, letters, shipments, trips } from '../db/schema.ts';
import { EMAIL_RE, normEmail } from '../lib/crypto.ts';
import { fail, notFound } from '../lib/errors.ts';
import { readyToPost } from './counter.ts';
import { assertCanSend, lockUser } from './abuse.ts';
import { enqueue } from './jobs.ts';
import { LIST_CONCURRENCY, mapLimit } from '../lib/async.ts';
import { currentSheet, EMPTY_ENV } from './letters.ts';

export type ShipmentRow = typeof shipments.$inferSelect;

/** 寄出時存下來的信封快照（收件人看到的樣子） */
export type Pkg = Omit<CounterDTO, 'letterId' | 'missing' | 'envLocked' | 'addrOk' | 'emode'> & { efont: string };

export async function editsOf(db: Db, shipmentId: string) {
  return db.select().from(emailEdits).where(eq(emailEdits.shipmentId, shipmentId)).orderBy(asc(emailEdits.seq));
}

export function statusInput(s: ShipmentRow, edits: (typeof emailEdits.$inferSelect)[]): StatusInput {
  const env = s.env as EnvAddress;
  return {
    plan: s.plan as Plan,
    toEmail: env.toEmail,
    signedAt: ms(s.signedAt),
    edits: edits.map((e) => ({ t: e.at.getTime(), email: e.email, deliverAt: e.deliverAt.getTime() })),
  };
}

export async function shipStatus(db: Db, s: ShipmentRow, now: number): Promise<{ st: ShipStatus; input: StatusInput }> {
  const input = statusInput(s, await editsOf(db, s.id));
  return { st: status(input, now), input };
}

/* ---------- 投郵筒 ---------- */

export async function postLetter(ctx: Ctx, userId: string, letterId: string): Promise<ShipmentDTO> {
  // 外部服務（天氣、快遞天數）在交易外先準備好，不要在交易裡等外部 API（review H7）
  const L0 = (await ctx.db.select().from(letters).where(eq(letters.id, letterId)))[0];
  const env0 = { ...EMPTY_ENV, ...((L0?.userId === userId ? L0.env : {}) as Partial<EnvAddress>) };
  const now0 = ctx.clock.now();
  const weather = await ctx.weather.prepare(parsePlace(env0.toAddr)?.city ?? domain(env0.toEmail), now0, now0 + 40 * D);
  const courier = await ctx.courier.prepare(env0.fromAddr, env0.toAddr);

  const s = await ctx.db.transaction(async (tx) => {
    // 鎖住使用者：同一個人同時投好幾封，上限計數也不會被繞過
    const u = await lockUser(tx, userId);
    const { L, dto, trip } = await readyToPost(ctx, tx, userId, letterId);
    // 寄件人信箱一律用帳號信箱：提醒信、退信只會寄回本人（review 低：fromEmail 未驗證）
    const env = { ...EMPTY_ENV, ...(L.env as Partial<EnvAddress>), fromEmail: u.email };
    const now = ctx.clock.now();
    await assertCanSend(tx, u, env.toEmail, now, ctx.cfg.sendLimit);
    const office = placeById(trip.place)?.name ?? trip.place;
    const sh = await currentSheet(tx, L.id);
    const { letterId: _l, missing: _m, envLocked: _e, addrOk: _a, emode: _em, ...rest } = dto;
    const pkg: Pkg = { ...rest, efont: sh.font };
    let row: ShipmentRow | undefined;
    // 單號撞號（同時寄出、雜湊剛好一樣）就換一個再試；用 savepoint，失敗不會讓整個交易作廢（review 低）
    for (let i = 0; !row; i++) {
      const no = trackNo(i === 0 ? L.id + now : `${L.id}${now}#${i}`);
      const P = plan({ no, sentAt: now, office, box: trip.box as 'green' | 'red', env }, { calendar: ctx.calendar, weather, courier });
      try {
        row = await tx.transaction(async (sp) => {
          const [r] = await sp
            .insert(shipments)
            .values({
              no,
              letterId: L.id,
              userId,
              sentAt: new Date(now),
              office,
              box: trip.box,
              env,
              pkg,
              plan: P,
              deliverAt: new Date(P.deliver),
              recv: initialRecv(),
              createdAt: new Date(now),
            })
            .returning();
          return r!;
        });
      } catch (e) {
        const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
        if (code !== '23505' || i >= 5) throw e;
        const dup = await tx.select({ id: shipments.id }).from(shipments).where(eq(shipments.letterId, L.id));
        if (dup.length) fail(409, 'LETTER_LOCKED', '這封信已經寄出了');
      }
    }
    const P = row.plan as Plan;
    await tx.update(letters).set({ status: 'sent', sentAt: new Date(now) }).where(eq(letters.id, L.id));
    await tx.update(trips).set({ endedAt: new Date(now), endReason: 'posted' }).where(eq(trips.id, trip.id));
    const id = row.id;
    const jobs: [string, string, number, Record<string, unknown>][] = [
      ['deliver', `deliver:${id}:0`, P.deliver, { seq: 0 }],
      ['remind24', `remind24:${id}`, P.deliver + D, {}],
      ['remind48', `remind48:${id}`, P.deliver + 2 * D, {}],
      ['return30', `return30:${id}`, P.deliver + 30 * D, {}],
    ];
    for (const [kind, uniqueKey, runAt, payload] of jobs) await enqueue(tx, { kind, uniqueKey, refId: id, runAt, payload, now });
    return row;
  });
  return shipmentDTO(ctx, s);
}

/* ---------- 給寄件人看 ---------- */

/** 寄件人看到的時間軸（原型 renderTrack），只列出已經發生的事，新到舊 */
function timeline(s: ShipmentRow, st: ShipStatus, input: StatusInput, now: number): PlanEvent[] {
  const env = s.env as EnvAddress;
  const P = s.plan as Plan;
  const ev: PlanEvent[] = P.events.filter((e) => e.t <= now).map((e) => ({ ...e }));
  input.edits.forEach((x) => {
    if (x.t <= now) ev.push({ t: x.t, tx: `寄件人改了收件信箱，改寄 ${x.email}`, pl: '—' });
    if (x.deliverAt <= now) ev.push({ t: x.deliverAt, tx: '已重新投遞至收件人電子信箱', pl: x.email, k: 'ok' });
  });
  if (st.rem1) ev.push({ t: st.r1, tx: '送達 24 小時無人簽收，已寄提醒信給寄件人', pl: env.fromEmail, k: 'warn' });
  if (st.rem2) ev.push({ t: st.r2, tx: '送達 48 小時無人簽收，已再寄提醒信給寄件人（最後一次可改信箱）', pl: env.fromEmail, k: 'warn' });
  if (input.signedAt != null && input.signedAt <= now) ev.push({ t: input.signedAt, tx: '收件人已簽收', pl: st.curEmail, k: 'ok' });
  if (st.state === 'returned') ev.push({ t: st.ret, tx: `30 天無人簽收，已退回寄件人信箱（${env.fromEmail}）`, pl: env.fromEmail, k: 'bad' });
  return ev.sort((a, b) => b.t - a.t);
}

export async function shipmentDTO(ctx: Ctx, s: ShipmentRow, db: Db = ctx.db): Promise<ShipmentDTO> {
  const now = ctx.clock.now();
  const { st, input } = await shipStatus(db, s, now);
  const P = s.plan as Plan;
  return {
    no: s.no,
    letterId: s.letterId,
    sentAt: s.sentAt.getTime(),
    office: s.office,
    box: s.box as ShipmentDTO['box'],
    state: st.state,
    curEmail: st.curEmail,
    curDeliver: st.curDeliver,
    editsLeft: st.editsLeft,
    reminded48: st.rem2,
    reached: st.reached,
    stops: P.stops,
    events: timeline(s, st, input, now),
    // 還沒送達前不透露確切送達時間（跟真的寄信一樣只能等）
    deliverAt: now >= P.deliver ? P.deliver : null,
    signedAt: ms(s.signedAt),
    returnedAt: st.state === 'returned' ? st.ret : null,
    returnPostmark: st.state === 'returned' ? returnPostmark(P.dest, st.ret) : null,
    env: s.env as EnvAddress,
    // 計算明細跟送達時間一樣，送達之後才給（D-020）
    calc:
      now >= P.deliver
        ? { start: P.start, base: P.base, baseWhy: P.baseWhy, randDelay: P.randDelay, wDelay: P.wDelay, raw: P.raw, deliver: P.deliver }
        : null,
  };
}

export async function myShipments(ctx: Ctx, userId: string): Promise<ShipmentDTO[]> {
  const rows = await ctx.db.select().from(shipments).where(eq(shipments.userId, userId)).orderBy(desc(shipments.sentAt));
  return mapLimit(rows, LIST_CONCURRENCY, (s) => shipmentDTO(ctx, s));
}

async function myShipment(db: Db, userId: string, no: string, lock = false): Promise<ShipmentRow> {
  const q = db.select().from(shipments).where(eq(shipments.no, no));
  const rows = lock ? await q.for('update') : await q;
  const s = rows[0];
  if (!s || s.userId !== userId) notFound('找不到這個單號');
  return s!;
}

export async function getMyShipment(ctx: Ctx, userId: string, no: string): Promise<ShipmentDTO> {
  return shipmentDTO(ctx, await myShipment(ctx.db, userId, no));
}

/** 24h／48h 視窗內修改收件信箱（最多 2 次；規則見 engine status） */
export async function editRecipientEmail(ctx: Ctx, userId: string, no: string, email: string): Promise<ShipmentDTO> {
  const s = await ctx.db.transaction(async (tx) => {
    const s = await myShipment(tx, userId, no, true);
    if (!EMAIL_RE.test(email)) fail(422, 'INVALID_EMAIL', '信箱格式不對，像 name@example.com 這樣');
    const now = ctx.clock.now();
    const edits = await editsOf(tx, s.id);
    const chk = canEditEmail(statusInput(s, edits), email, now);
    if (!chk.ok) {
      const msg = {
        NOT_DELIVERED: '信還在路上，送達之後才能改',
        SIGNED: '收件人已經簽收了',
        RETURNED: '信已經退回了',
        NO_EDITS_LEFT: '現在沒有可以修改的次數（送達 24 小時、48 小時後各有一次）',
        SAME_EMAIL: '跟原本的信箱一樣',
      }[chk.code];
      fail(409, chk.code, msg);
    }
    const seq = edits.length + 1;
    const deliverAt = rerouteDeliverAt(now, ctx.calendar);
    await tx.insert(emailEdits).values({ shipmentId: s.id, seq, email: normEmail(email), at: new Date(now), deliverAt: new Date(deliverAt) });
    // 舊的開信連結立刻失效；重新投遞時發新連結
    await tx.update(shipments).set({ recipientTokenHash: null }).where(eq(shipments.id, s.id));
    await enqueue(tx, { kind: 'deliver', uniqueKey: `deliver:${s.id}:${seq}`, refId: s.id, runAt: deliverAt, payload: { seq }, now });
    return { ...s, recipientTokenHash: null };
  });
  return shipmentDTO(ctx, s);
}

/* ---------- 公開追蹤 ---------- */

export const maskEmail = (e: string): string => {
  const [u, d] = e.split('@');
  if (!d) return e;
  return `${u!.slice(0, 1)}***@${d}`;
};

/**
 * 公開查詢（D-031：只顯示狀態）。不用登入，所以不透露寄收地區、郵局、信箱與簽收時間（review M8）；
 * 只留沒有地點的物流事件與目前狀態。完整明細給寄件人登入後看（GET /shipments/:no）。
 */
export async function publicTrack(ctx: Ctx, no: string): Promise<TrackDTO> {
  const rows = await ctx.db.select().from(shipments).where(eq(shipments.no, no.toUpperCase()));
  const s = rows[0] ?? notFound('查無此單號');
  const now = ctx.clock.now();
  const { st } = await shipStatus(ctx.db, s, now);
  const P = s.plan as Plan;
  const ev: PlanEvent[] = P.events.filter((e) => e.t <= now).map((e) => ({ ...e, pl: '' }));
  if (st.state === 'returned') ev.push({ t: st.ret, tx: '30 天無人簽收，已退回', pl: '', k: 'bad' });
  ev.sort((a, b) => b.t - a.t);
  return { no: s.no, state: st.state, office: '', stops: [], reached: 0, events: ev };
}
