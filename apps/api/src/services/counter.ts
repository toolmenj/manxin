/**
 * 前往郵局與郵局櫃台：選信封／郵票／郵戳、確認地址、信封上的字、摺信、裝信、封口、貼郵票、蓋郵戳、投郵筒。
 */
import {
  applyFold,
  envLocked,
  fits,
  initialPack,
  missing,
  MISSING_LABEL,
  placeById,
  splitChars,
  tripMin,
  ENVS,
  PENS,
  STAMPS,
  POSTMARKS,
  type EnvelopeKind,
  type Fold,
  type FoldEdge,
  type Pack,
  type Pos,
  type Stroke,
  type TravelMode,
  type MailboxColor,
} from '@manxin/engine';
import type { CounterDTO, EnvAddress, EnvelopeText, TripDTO } from '@manxin/shared';
import { asc, eq } from 'drizzle-orm';
import { ms, type Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { counters, envelopeOps, letters, trips } from '../db/schema.ts';
import { EMAIL_RE } from '../lib/crypto.ts';
import { fail } from '../lib/errors.ts';
import {
  activeTrip,
  currentSheet,
  EMPTY_ENV,
  getLetter,
  letterHas,
  ownAttachment,
  refSheets,
  tripDTO,
} from './letters.ts';

type CounterRow = typeof counters.$inferSelect;
type LetterRow = typeof letters.$inferSelect;

/* ---------- 前往郵局 ---------- */

export async function startTrip(
  ctx: Ctx,
  userId: string,
  letterId: string,
  body: { place: string; mode: TravelMode; box: MailboxColor },
): Promise<TripDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    if (L.status !== 'drafting') fail(409, 'LETTER_LOCKED', '這封信不在書桌上');
    if (await activeTrip(tx, L.id)) fail(409, 'TRIP_ACTIVE', '已經在去郵局的路上了');
    if ((await refSheets(tx, L.id)).length) fail(409, 'REFS_PENDING', '桌邊還有舊信紙沒處理');
    if (!(await letterHas(tx, L.id))) fail(409, 'LETTER_EMPTY', '書桌上還沒有信');
    const pl = placeById(body.place) ?? fail(400, 'BAD_REQUEST', '沒有這個郵局');
    const now = ctx.clock.now();
    const [t] = await tx
      .insert(trips)
      .values({
        userId,
        letterId: L.id,
        place: pl.id,
        mode: body.mode,
        box: body.box,
        startAt: new Date(now),
        arriveAt: new Date(now + tripMin(pl, body.mode) * 60_000),
      })
      .returning();
    return tripDTO(t!, now);
  });
}

export async function getTrip(ctx: Ctx, userId: string, letterId: string): Promise<TripDTO | null> {
  const L = await getLetter(ctx.db, userId, letterId);
  const t = await activeTrip(ctx.db, L.id);
  return t ? tripDTO(t, ctx.clock.now()) : null;
}

/** 走進郵局：時間由伺服器判定，沒到就是 409 */
export async function enterPostOffice(ctx: Ctx, userId: string, letterId: string): Promise<{ trip: TripDTO; counter: CounterDTO }> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    const t = (await activeTrip(tx, L.id)) ?? fail(409, 'NO_TRIP', '還沒出發');
    const now = ctx.clock.now();
    if (now < t.arriveAt.getTime()) {
      fail(409, 'NOT_ARRIVED', '還沒走到郵局', { arriveAt: t.arriveAt.getTime(), serverNow: now });
    }
    if (!t.enteredAt) await tx.update(trips).set({ enteredAt: new Date(now) }).where(eq(trips.id, t.id));
    const c = await ensureCounter(tx, L, now);
    return { trip: tripDTO({ ...t, enteredAt: t.enteredAt ?? new Date(now) }, now), counter: await counterDTO(tx, c) };
  });
}

/** 掉頭回家／先帶著信回家：櫃台做過的事都留著 */
export async function goHome(ctx: Ctx, userId: string, letterId: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    const t = (await activeTrip(tx, L.id)) ?? fail(409, 'NO_TRIP', '沒有出門');
    await tx.update(trips).set({ endedAt: ctx.clock.date(), endReason: 'home' }).where(eq(trips.id, t.id));
  });
}

/* ---------- 櫃台 ---------- */

async function ensureCounter(db: Db, L: LetterRow, now: number): Promise<CounterRow> {
  const rows = await db.select().from(counters).where(eq(counters.letterId, L.id));
  if (rows[0]) return rows[0];
  const sh = await currentSheet(db, L.id);
  const pc = sh.kind === 'postcard';
  const [c] = await db
    .insert(counters)
    .values({
      letterId: L.id,
      env: pc ? 'card' : 'post',
      stamp: 'plum',
      pm: 'date',
      folds: [],
      pack: pc ? null : initialPack(),
      rot: false,
      inserted: pc,
      sealed: pc,
      addrOk: false,
      emode: sh.mode,
      updatedAt: new Date(now),
    })
    .returning();
  return c!;
}

export async function resetAddrOk(db: Db, letterId: string, now: Date): Promise<void> {
  await db.update(counters).set({ addrOk: false, updatedAt: now }).where(eq(counters.letterId, letterId));
}

async function envelopeText(db: Db, letterId: string): Promise<{ from: EnvelopeText; to: EnvelopeText }> {
  const ops = await db.select().from(envelopeOps).where(eq(envelopeOps.letterId, letterId)).orderBy(asc(envelopeOps.seq));
  const out = { from: { c: [] as string[], s: [] as Stroke[] }, to: { c: [] as string[], s: [] as Stroke[] } };
  for (const o of ops) {
    const z = out[o.zone as 'from' | 'to'];
    const op = o.op as { kind: 'chars'; text: string } | { kind: 'stroke'; stroke: Stroke };
    if (op.kind === 'chars') z.c.push(...splitChars(op.text));
    else z.s.push(op.stroke);
  }
  return out;
}

const written = (e: { from: EnvelopeText; to: EnvelopeText }) =>
  e.from.c.length + e.from.s.length + e.to.c.length + e.to.s.length > 0;

export async function counterDTO(db: Db, c: CounterRow): Promise<CounterDTO> {
  const etxt = await envelopeText(db, c.letterId);
  const like = {
    env: c.env as EnvelopeKind,
    inserted: c.inserted,
    sealed: c.sealed,
    addrOk: c.addrOk,
    stampPos: (c.stampPos as Pos | null) ?? null,
    envelopeWritten: written(etxt),
  };
  return {
    letterId: c.letterId,
    env: like.env,
    envLocked: envLocked(like),
    stamp: c.stamp as CounterDTO['stamp'],
    stampAttachmentId: c.stampAttachmentId,
    pm: c.pm as CounterDTO['pm'],
    pmAttachmentId: c.pmAttachmentId,
    skinAttachmentId: c.skinAttachmentId,
    stampPos: like.stampPos,
    pmPos: (c.pmPos as Pos | null) ?? null,
    pmAt: ms(c.pmAt),
    folds: c.folds as Fold[],
    pack: (c.pack as Pack | null) ?? null,
    rot: c.rot,
    inserted: c.inserted,
    sealed: c.sealed,
    addrOk: c.addrOk,
    etxt,
    emode: c.emode as CounterDTO['emode'],
    missing: missing(like),
  };
}

/** 櫃台操作的共同前提：人在郵局裡、信還沒寄出 */
async function atCounter(ctx: Ctx, db: Db, userId: string, letterId: string): Promise<{ L: LetterRow; c: CounterRow }> {
  const L = await getLetter(db, userId, letterId, true);
  if (L.status !== 'drafting') fail(409, 'LETTER_LOCKED', L.status === 'sent' ? '信已經寄出' : '這封信不在書桌上');
  const t = await activeTrip(db, L.id);
  if (!t || !t.enteredAt) fail(409, 'NOT_AT_POST_OFFICE', '人不在郵局裡');
  const rows = await db.select().from(counters).where(eq(counters.letterId, L.id)).for('update');
  return { L, c: rows[0] ?? (await ensureCounter(db, L, ctx.clock.now())) };
}

export async function getCounter(ctx: Ctx, userId: string, letterId: string): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    return counterDTO(tx, c);
  });
}

async function save(ctx: Ctx, db: Db, c: CounterRow, patch: Partial<CounterRow>): Promise<CounterDTO> {
  const next = { ...c, ...patch, updatedAt: ctx.clock.date() };
  await db.update(counters).set({ ...patch, updatedAt: next.updatedAt }).where(eq(counters.letterId, c.letterId));
  return counterDTO(db, next);
}

export interface CounterPatch {
  env?: EnvelopeKind;
  skinAttachmentId?: string;
  stamp?: string;
  stampAttachmentId?: string | null;
  pm?: string;
  pmAttachmentId?: string | null;
  rot?: boolean;
  emode?: 'type' | 'hand';
}

/** 選信封、郵票、郵戳、轉方向、信封書寫模式 */
export async function patchCounter(ctx: Ctx, userId: string, letterId: string, body: CounterPatch): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    const cur = await counterDTO(tx, c);
    const patch: Partial<CounterRow> = {};
    if (body.env !== undefined || body.skinAttachmentId !== undefined) {
      if (cur.envLocked) fail(409, 'ENVELOPE_LOCKED', '信放進去、貼了郵票或寫了字之後，就不能換信封');
      const env = body.env ?? (body.skinAttachmentId ? 'custom' : cur.env);
      if (!(env in ENVS)) fail(400, 'BAD_REQUEST', '沒有這種信封');
      if ((env === 'card') !== (cur.env === 'card')) fail(422, 'INVALID_OP', '明信片不用信封；信紙一定要信封');
      if (body.skinAttachmentId) {
        const a = await ownAttachment(tx, userId, body.skinAttachmentId);
        if (a.purpose !== 'skin') fail(422, 'INVALID_OP', '這個檔案不是信封圖');
        patch.skinAttachmentId = a.id;
      }
      if (env === 'custom' && !(patch.skinAttachmentId ?? c.skinAttachmentId)) {
        fail(422, 'INVALID_OP', '自己上傳的信封要先上傳信封圖');
      }
      patch.env = env;
    }
    if (body.stamp !== undefined || body.stampAttachmentId !== undefined) {
      if (cur.stampPos) fail(409, 'STAMP_LOCKED', '郵票已經貼上去了');
      if (body.stamp !== undefined) {
        if (!(body.stamp in STAMPS)) fail(400, 'BAD_REQUEST', '沒有這種郵票');
        patch.stamp = body.stamp;
        patch.stampAttachmentId = null;
      }
      if (body.stampAttachmentId) {
        const a = await ownAttachment(tx, userId, body.stampAttachmentId);
        if (a.purpose !== 'stamp') fail(422, 'INVALID_OP', '這個檔案不是郵票');
        patch.stampAttachmentId = a.id;
      } else if (body.stampAttachmentId === null) patch.stampAttachmentId = null;
    }
    if (body.pm !== undefined || body.pmAttachmentId !== undefined) {
      if (cur.pmPos) fail(409, 'POSTMARK_LOCKED', '郵戳已經蓋下去了');
      if (body.pm !== undefined) {
        if (!(body.pm in POSTMARKS)) fail(400, 'BAD_REQUEST', '沒有這種郵戳');
        patch.pm = body.pm;
        patch.pmAttachmentId = null;
      }
      if (body.pmAttachmentId) {
        const a = await ownAttachment(tx, userId, body.pmAttachmentId);
        if (a.purpose !== 'postmark') fail(422, 'INVALID_OP', '這個檔案不是郵戳');
        patch.pmAttachmentId = a.id;
      } else if (body.pmAttachmentId === null) patch.pmAttachmentId = null;
    }
    if (body.rot !== undefined) {
      if (c.inserted) fail(409, 'ALREADY_DONE', '信已經在信封裡了');
      patch.rot = body.rot;
    }
    if (body.emode !== undefined) patch.emode = body.emode;
    return save(ctx, tx, c, patch);
  });
}

/** 確認地址：寄件人與收件人的信箱都要有效 */
export async function confirmAddress(ctx: Ctx, userId: string, letterId: string): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { L, c } = await atCounter(ctx, tx, userId, letterId);
    const env = { ...EMPTY_ENV, ...(L.env as Partial<EnvAddress>) };
    const bad = [!EMAIL_RE.test(env.fromEmail) && 'fromEmail', !EMAIL_RE.test(env.toEmail) && 'toEmail'].filter(Boolean);
    if (bad.length) fail(422, 'INVALID_EMAIL', '寄件人和收件人的電子信箱都要填，格式像 name@example.com', { fields: bad });
    return save(ctx, tx, c, { addrOk: true });
  });
}

/** 信封上的字：只追加 */
export async function appendEnvelope(
  ctx: Ctx,
  userId: string,
  letterId: string,
  body: { zone: 'from' | 'to'; text?: string; stroke?: Stroke },
): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    let op;
    if (body.text !== undefined && body.stroke === undefined) {
      const n = splitChars(body.text).length;
      if (n === 0 || n > 200) fail(422, 'INVALID_OP', '信封上一次寫 1～200 個字');
      op = { kind: 'chars', text: body.text };
    } else if (body.stroke !== undefined && body.text === undefined) {
      const s = body.stroke;
      const okPts =
        Array.isArray(s.pts) && s.pts.length >= 1 && s.pts.length <= 5000 && s.pts.every((p) => p.length === 3 && p.every(Number.isFinite));
      if (!PENS.includes(s.pen) || !/^#[0-9A-Fa-f]{6}$/.test(s.color) || !okPts) fail(422, 'INVALID_OP', '筆畫資料不正確');
      op = { kind: 'stroke', stroke: { pen: s.pen, color: s.color, pts: s.pts.map((p) => p.map((v) => Math.round(v * 1e4) / 1e4)) } };
    } else fail(400, 'BAD_REQUEST', 'text 與 stroke 要剛好給一個');
    const cnt = await tx.select({ seq: envelopeOps.seq }).from(envelopeOps).where(eq(envelopeOps.letterId, c.letterId));
    await tx.insert(envelopeOps).values({ letterId: c.letterId, seq: cnt.length, zone: body.zone, op, createdAt: ctx.clock.date() });
    return counterDTO(tx, c);
  });
}

/** 摺一次：伺服器重算外框，最多 6 次，摺了就回不去 */
export async function fold(ctx: Ctx, userId: string, letterId: string, edge: FoldEdge, at: number): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    if (c.env === 'card' || !c.pack) fail(422, 'INVALID_OP', '明信片不用摺');
    if (c.inserted) fail(409, 'ALREADY_DONE', '信已經在信封裡了');
    const folds = c.folds as Fold[];
    const r = applyFold(c.pack as Pack, folds.length, edge, at);
    if (!r.ok) {
      if (r.code === 'TOO_MANY_FOLDS') fail(409, 'TOO_MANY_FOLDS', '太厚了，摺不動了');
      fail(422, 'FOLD_OUT_OF_RANGE', '摺線要落在信紙上');
    } else return save(ctx, tx, c, { pack: r.pack, folds: [...folds, r.fold] });
    throw new Error('unreachable');
  });
}

/** 放進信封：裝不下回 422，說太寬或太長 */
export async function insertLetter(ctx: Ctx, userId: string, letterId: string): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    if (c.inserted) fail(409, 'ALREADY_DONE', '已經放進去了');
    const r = fits(c.env as EnvelopeKind, c.pack as Pack, c.rot);
    if (!r.ok) {
      const { ok: _ok, code, ...dims } = r;
      fail(422, code, `塞不進去。信紙太${code === 'TOO_WIDE' ? '寬' : '長'}了，要再摺。`, dims);
    }
    return save(ctx, tx, c, { inserted: true });
  });
}

export async function seal(ctx: Ctx, userId: string, letterId: string): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    if (!c.inserted) fail(409, 'INVALID_STATE', '信還沒放進信封');
    if (c.sealed) fail(409, 'ALREADY_DONE', '已經封好了');
    return save(ctx, tx, c, { sealed: true });
  });
}

const validPos = (p: Pos) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && Math.abs(p.r) <= 180;

/** 貼郵票：一次，不能改 */
export async function placeStamp(ctx: Ctx, userId: string, letterId: string, pos: Pos): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    if (c.stampPos) fail(409, 'ALREADY_DONE', '郵票已經貼上去了，撕不下來');
    if (!validPos(pos)) fail(422, 'INVALID_OP', '郵票要貼在信封上');
    return save(ctx, tx, c, { stampPos: { x: pos.x, y: pos.y, r: pos.r } });
  });
}

/** 蓋郵戳：一次，不能改（可不蓋） */
export async function placePostmark(ctx: Ctx, userId: string, letterId: string, pos: Pos): Promise<CounterDTO> {
  return ctx.db.transaction(async (tx) => {
    const { c } = await atCounter(ctx, tx, userId, letterId);
    if (c.pmPos) fail(409, 'ALREADY_DONE', '郵戳已經蓋下去了');
    if (!validPos(pos)) fail(422, 'INVALID_OP', '郵戳要蓋在信封上');
    return save(ctx, tx, c, { pmPos: { x: pos.x, y: pos.y, r: pos.r }, pmAt: ctx.clock.date() });
  });
}

/** 寄出前條件（給投郵筒用） */
export async function readyToPost(ctx: Ctx, db: Db, userId: string, letterId: string) {
  const { L, c } = await atCounter(ctx, db, userId, letterId);
  const dto = await counterDTO(db, c);
  if ((await refSheets(db, L.id)).length) fail(409, 'REFS_PENDING', '桌邊還有舊信紙沒處理');
  if (dto.missing.length) {
    fail(422, 'NOT_READY', `還不能寄：${dto.missing.map((m) => MISSING_LABEL[m]).join('、')}。`, { missing: dto.missing });
  }
  const t = (await activeTrip(db, L.id))!;
  return { L, c, dto, trip: t };
}
