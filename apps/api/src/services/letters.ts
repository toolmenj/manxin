/**
 * 書桌：信、信紙（只有追加）、謄抄、舊信紙處理、先放著、附件。
 */
import { randomUUID } from 'node:crypto';
import {
  applyOps,
  hash,
  placeById,
  checkOp,
  hasContent,
  unsentAskDue,
  nextUnsentAsk,
  type PaperRef,
  type SheetOp,
  type SheetContent,
} from '@manxin/engine';
import type { AttachmentDTO, DiscardState, EnvAddress, LetterDTO, SheetDTO, TombDTO, TripDTO } from '@manxin/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ms, type Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { attachments, letters, sheetOps, sheets, trips } from '../db/schema.ts';
import { fail, notFound } from '../lib/errors.ts';
import { resetAddrOk } from './counter.ts';
import { assertFontUsable, customFontId, fontUrl } from './fonts.ts';
import { enqueue } from './jobs.ts';
import { isTemplate } from './paperTemplates.ts';

type LetterRow = typeof letters.$inferSelect;
type SheetRow = typeof sheets.$inferSelect;
type TripRow = typeof trips.$inferSelect;

export const EMPTY_ENV: EnvAddress = { fromName: '', fromEmail: '', fromAddr: '', toName: '', toEmail: '', toAddr: '' };

/* ---------- 讀取 ---------- */

export async function getLetter(db: Db, userId: string, letterId: string, lock = false): Promise<LetterRow> {
  if (!/^[0-9a-f-]{36}$/i.test(letterId)) notFound('找不到這封信');
  const q = db.select().from(letters).where(and(eq(letters.id, letterId), eq(letters.userId, userId)));
  const rows = lock ? await q.for('update') : await q;
  return rows[0] ?? notFound('找不到這封信');
}

/** 重放信紙內容。格位排版要知道紙種與樣式（可寫區域），所以傳整列 sheet 進來 */
export async function sheetContent(db: Db, sh: Pick<SheetRow, 'id' | 'kind' | 'style'>): Promise<{ content: SheetContent; seq: number }> {
  const ops = await db.select().from(sheetOps).where(eq(sheetOps.sheetId, sh.id)).orderBy(asc(sheetOps.seq));
  return { content: applyOps(ops.map((o) => o.op as SheetOp), paperOf(sh)), seq: ops.length };
}

export const paperOf = (sh: Pick<SheetRow, 'kind' | 'style'>): PaperRef => ({ kind: sh.kind as PaperRef['kind'], style: sh.style as PaperRef['style'] });

export async function sheetDTO(db: Db, s: SheetRow): Promise<SheetDTO> {
  const { content, seq } = await sheetContent(db, s);
  return {
    id: s.id,
    kind: s.kind as SheetDTO['kind'],
    style: s.style as SheetDTO['style'],
    mode: s.mode as SheetDTO['mode'],
    font: s.font,
    fontUrl: ((id) => (id ? fontUrl(id) : null))(customFontId(s.font)),
    bgAttachmentId: s.bgAttachmentId,
    bgTemplate: s.bgTemplate,
    seq,
    chars: content.chars,
    cursor: content.cursor,
    strokes: content.strokes,
    scan: content.scan,
    createdAt: s.createdAt.getTime(),
  };
}

export async function currentSheet(db: Db, letterId: string): Promise<SheetRow> {
  const rows = await db
    .select()
    .from(sheets)
    .where(and(eq(sheets.letterId, letterId), eq(sheets.role, 'current')));
  return rows[0] ?? fail(500, 'INTERNAL', '這封信沒有信紙');
}

export const refSheets = (db: Db, letterId: string) =>
  db
    .select()
    .from(sheets)
    .where(and(eq(sheets.letterId, letterId), eq(sheets.role, 'ref')))
    .orderBy(asc(sheets.createdAt));

export const attachmentUrl = (id: string) => `/attachments/${id}`;

export function attachmentDTO(a: typeof attachments.$inferSelect, url = attachmentUrl(a.id)): AttachmentDTO {
  return { id: a.id, name: a.name, mime: a.mime, size: a.size, url, createdAt: a.createdAt.getTime() };
}

export const letterAttachments = (db: Db, letterId: string) =>
  db
    .select()
    .from(attachments)
    .where(and(eq(attachments.letterId, letterId), eq(attachments.purpose, 'attachment'), isNull(attachments.takenOutAt)))
    .orderBy(asc(attachments.createdAt));

export async function activeTrip(db: Db, letterId: string): Promise<TripRow | null> {
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.letterId, letterId), isNull(trips.endedAt)));
  return rows[0] ?? null;
}

export function tripDTO(t: TripRow, now: number): TripDTO {
  return {
    id: t.id,
    letterId: t.letterId,
    place: t.place as TripDTO['place'],
    placeName: placeById(t.place)?.name ?? t.place,
    mode: t.mode as TripDTO['mode'],
    box: t.box as TripDTO['box'],
    startAt: t.startAt.getTime(),
    arriveAt: t.arriveAt.getTime(),
    enteredAt: ms(t.enteredAt),
    serverNow: now,
    arrived: now >= t.arriveAt.getTime(),
  };
}

export async function letterDTO(ctx: Ctx, L: LetterRow, db: Db = ctx.db): Promise<LetterDTO> {
  const now = ctx.clock.now();
  const [cur, refs, atts, trip] = await Promise.all([
    currentSheet(db, L.id),
    refSheets(db, L.id),
    letterAttachments(db, L.id),
    activeTrip(db, L.id),
  ]);
  return {
    id: L.id,
    status: L.status as LetterDTO['status'],
    env: { ...EMPTY_ENV, ...(L.env as Partial<EnvAddress>) },
    sheet: await sheetDTO(db, cur),
    refs: await Promise.all(refs.map((r) => sheetDTO(db, r))),
    attachments: atts.map((a) => attachmentDTO(a)),
    frontAttachmentId: L.frontAttachmentId,
    createdAt: L.createdAt.getTime(),
    shelvedAt: ms(L.shelvedAt),
    askedAt: ms(L.askedAt),
    askDue: L.status === 'shelved' && L.shelvedAt ? unsentAskDue(L.shelvedAt.getTime(), ms(L.askedAt), now) : false,
    trip: trip ? tripDTO(trip, now) : null,
  };
}

/** 書桌上有沒有東西（原型 letterHas） */
export async function letterHas(db: Db, letterId: string): Promise<boolean> {
  const cur = await currentSheet(db, letterId);
  const { content } = await sheetContent(db, cur);
  if (hasContent(content)) return true;
  if ((await refSheets(db, letterId)).length) return true;
  return (await letterAttachments(db, letterId)).length > 0;
}

/** 信紙能不能寫：在書桌上、而且沒有帶出門 */
export async function assertWritable(db: Db, L: LetterRow): Promise<void> {
  if (L.status === 'sent') fail(409, 'LETTER_LOCKED', '信已經寄出，內容不能再改');
  if (L.status === 'shelved') fail(409, 'LETTER_LOCKED', '這封信先放著了，拿出來才能繼續寫');
  if (await activeTrip(db, L.id)) fail(409, 'LETTER_LOCKED', '信帶去郵局了，回家才能繼續寫');
}

/* ---------- 建立 ---------- */

export interface NewLetterInput {
  kind?: SheetDTO['kind'];
  style?: SheetDTO['style'];
  mode?: SheetDTO['mode'];
  font?: string;
  env?: Partial<EnvAddress>;
}

export async function createLetter(ctx: Ctx, user: { id: string; email: string }, input: NewLetterInput): Promise<LetterDTO> {
  const now = ctx.clock.date();
  return ctx.db.transaction(async (tx) => {
    if (input.font) await assertFontUsable(tx, user.id, input.font);
    // 原型 newLetter：沿用上一封的寄件人資料
    const prev = await tx
      .select({ env: letters.env })
      .from(letters)
      .where(eq(letters.userId, user.id))
      .orderBy(desc(letters.createdAt))
      .limit(1);
    const pe = (prev[0]?.env ?? {}) as Partial<EnvAddress>;
    const env: EnvAddress = {
      ...EMPTY_ENV,
      fromName: pe.fromName ?? '',
      fromEmail: pe.fromEmail || user.email,
      fromAddr: pe.fromAddr ?? '',
      ...input.env,
    };
    const [L] = await tx.insert(letters).values({ userId: user.id, status: 'drafting', env, createdAt: now }).returning();
    const kind = input.kind ?? 'letter';
    let style = input.style ?? 'lined';
    if (kind === 'postcard' && (style === 'grid' || style === 'bahang')) style = 'lined';
    await tx.insert(sheets).values({
      userId: user.id,
      letterId: L!.id,
      role: 'current',
      kind,
      style,
      mode: input.mode ?? 'type',
      font: input.font ?? 'typewriter',
      createdAt: now,
    });
    return letterDTO(ctx, L!, tx);
  });
}

export async function listLetters(ctx: Ctx, userId: string, status?: string): Promise<LetterDTO[]> {
  const where = status ? and(eq(letters.userId, userId), eq(letters.status, status)) : eq(letters.userId, userId);
  const rows = await ctx.db.select().from(letters).where(where).orderBy(desc(letters.createdAt));
  return Promise.all(rows.map((L) => letterDTO(ctx, L)));
}

/** 地址與明信片正面圖。改了任一個信箱，櫃台的「地址確認」要重來 */
export async function patchLetter(
  ctx: Ctx,
  userId: string,
  letterId: string,
  body: { env?: Partial<EnvAddress>; frontAttachmentId?: string | null },
): Promise<LetterDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    if (L.status === 'sent') fail(409, 'LETTER_LOCKED', '信已經寄出，地址不能再改');
    const old = { ...EMPTY_ENV, ...(L.env as Partial<EnvAddress>) };
    const env = { ...old };
    if (body.env) for (const [k, v] of Object.entries(body.env)) (env as Record<string, string>)[k] = String(v ?? '').trim();
    const patch: Partial<LetterRow> = { env };
    if (body.frontAttachmentId !== undefined) {
      if (body.frontAttachmentId) await ownAttachment(tx, userId, body.frontAttachmentId);
      patch.frontAttachmentId = body.frontAttachmentId;
    }
    await tx.update(letters).set(patch).where(eq(letters.id, L.id));
    if (env.fromEmail !== old.fromEmail || env.toEmail !== old.toEmail) {
      await resetAddrOk(tx, L.id, ctx.clock.date());
    }
    return letterDTO(ctx, { ...L, ...patch }, tx);
  });
}

/* ---------- 信紙設定 ---------- */

export async function patchSheet(
  ctx: Ctx,
  userId: string,
  letterId: string,
  body: {
    kind?: SheetDTO['kind'];
    style?: SheetDTO['style'];
    mode?: SheetDTO['mode'];
    font?: string;
    bgAttachmentId?: string | null;
    bgTemplate?: string | null;
  },
): Promise<SheetDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    await assertWritable(tx, L);
    const sh = await currentSheet(tx, L.id);
    const { content } = await sheetContent(tx, sh);
    // 已落筆的紙不能換（PRD 2.1）：紙種、樣式、圖樣（上傳的或範本）都算「紙」
    if (
      (body.kind !== undefined || body.style !== undefined || body.bgAttachmentId !== undefined || body.bgTemplate !== undefined) &&
      hasContent(content)
    ) {
      fail(409, 'SHEET_NOT_EMPTY', '這張已經落筆了，要換紙請用謄抄');
    }
    if (body.bgAttachmentId && body.bgTemplate) fail(422, 'INVALID_OP', '上傳的圖樣和範本只能選一個');
    const patch: Partial<SheetRow> = {};
    if (body.kind) patch.kind = body.kind;
    if (body.style) patch.style = body.style;
    if (body.mode) patch.mode = body.mode;
    if (body.font) {
      await assertFontUsable(tx, userId, body.font);
      patch.font = body.font;
    }
    if (body.bgAttachmentId !== undefined) {
      if (body.bgAttachmentId) await ownAttachment(tx, userId, body.bgAttachmentId);
      patch.bgAttachmentId = body.bgAttachmentId;
      if (body.bgAttachmentId) {
        patch.style = 'custom';
        patch.bgTemplate = null;
      }
    }
    if (body.bgTemplate !== undefined) {
      if (body.bgTemplate && !isTemplate(body.bgTemplate)) fail(422, 'INVALID_OP', '沒有這個信紙範本');
      patch.bgTemplate = body.bgTemplate;
      if (body.bgTemplate) {
        patch.style = 'custom';
        patch.bgAttachmentId = null;
      }
    }
    const kind = patch.kind ?? sh.kind;
    if (kind === 'postcard' && (patch.style ?? sh.style) !== 'custom' && ['grid', 'bahang'].includes(patch.style ?? sh.style)) {
      patch.style = 'lined';
    }
    if (Object.keys(patch).length) await tx.update(sheets).set(patch).where(eq(sheets.id, sh.id));
    return sheetDTO(tx, { ...sh, ...patch });
  });
}

/* ---------- 只有追加 ---------- */

export type AppendInput =
  | { kind: 'chars'; text: string }
  | { kind: 'mark'; from?: number; to?: number; at?: number[]; tool: string }
  | { kind: 'move'; at: [number, number] }
  | { kind: 'stroke'; stroke: { pen: string; color: string; pts: number[][] } }
  | { kind: 'scan'; attachmentId: string };

/** 追加請求的附帶資訊（見 AppendMeta）；舊的呼叫可以只傳 seq */
export interface AppendOpts {
  seq?: number;
  sheetId?: string;
  opId?: string;
}

/**
 * 追加一筆操作。檢查順序：
 * 1. 信能不能寫（寄出、先放著、帶出門都不行）
 * 2. sheetId 不是目前的信紙 → 409 SHEET_CHANGED（舊分頁的字不會寫到謄抄後的新紙）
 * 3. opId 已經寫過 → 不再寫，直接回目前的信紙（replayed）。要在 seq 檢查之前，重送才不會被當成衝突
 * 4. seq 不一致 → 409 SEQ_CONFLICT
 * 5. 操作合不合法（含可寫區域、不能疊打）→ 422 INVALID_OP
 */
export async function appendToSheet(
  ctx: Ctx,
  userId: string,
  letterId: string,
  input: AppendInput,
  optsIn?: number | AppendOpts,
): Promise<SheetDTO & { replayed?: boolean }> {
  const opts: AppendOpts = typeof optsIn === 'number' ? { seq: optsIn } : (optsIn ?? {});
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    await assertWritable(tx, L);
    const sh = await currentSheet(tx, L.id);
    if (opts.sheetId !== undefined && opts.sheetId.toLowerCase() !== sh.id) {
      fail(409, 'SHEET_CHANGED', '這封信已經換了一張信紙（可能在別的地方謄抄過），請重新載入', { sheetId: sh.id });
    }
    if (opts.opId) {
      const done = await tx
        .select({ seq: sheetOps.seq })
        .from(sheetOps)
        .where(and(eq(sheetOps.sheetId, sh.id), eq(sheetOps.opId, opts.opId.toLowerCase())));
      if (done.length) return { ...(await sheetDTO(tx, sh)), replayed: true };
    }
    const { content, seq } = await sheetContent(tx, sh);
    if (opts.seq !== undefined && opts.seq !== seq) {
      fail(409, 'SEQ_CONFLICT', '信紙已經有新的內容，請重新載入', { seq });
    }
    let op: SheetOp;
    if (input.kind === 'mark') {
      op = input.at
        ? { kind: 'mark', at: input.at, tool: input.tool as never, g: randomUUID() }
        : { kind: 'mark', from: input.from, to: input.to, tool: input.tool as never, g: randomUUID() };
    } else if (input.kind === 'move') op = { kind: 'move', at: [input.at[0], input.at[1]] };
    else if (input.kind === 'scan') {
      const a = await ownAttachment(tx, userId, input.attachmentId);
      if (a.purpose !== 'scan') fail(422, 'INVALID_OP', '這個檔案不是紙本匯入用的');
      op = { kind: 'scan', attachmentId: a.id };
    } else if (input.kind === 'stroke') {
      const pts = input.stroke.pts.map((p) => p.map((v) => Math.round(v * 1e4) / 1e4)) as [number, number, number][];
      op = { kind: 'stroke', stroke: { pen: input.stroke.pen as never, color: input.stroke.color, pts } };
    } else op = { kind: 'chars', text: input.text };
    const err = checkOp(content, sh.mode as 'type' | 'hand', op, paperOf(sh));
    if (err) fail(422, 'INVALID_OP', opErrorMessage(err), { reason: err });
    await tx.insert(sheetOps).values({ sheetId: sh.id, seq, op, opId: opts.opId?.toLowerCase() ?? null, createdAt: ctx.clock.date() });
    return sheetDTO(tx, sh);
  });
}

function opErrorMessage(code: string): string {
  return (
    {
      WRONG_MODE: '這張信紙目前不是這種書寫模式',
      EMPTY_TEXT: '沒有字',
      TEXT_TOO_LONG: '一次送太多字了',
      SHEET_FULL: '這張紙寫滿了，寫不下了',
      MARK_OUT_OF_RANGE: '塗改的位置不在信紙上',
      MARK_NOTHING: '塗改範圍裡沒有字',
      BAD_TOOL: '沒有這種塗改工具',
      BAD_STROKE: '筆畫資料不正確',
      STROKE_OUT_OF_AREA: '這裡不能寫正文（明信片右半邊是寫地址、貼郵票的地方）',
      MOVE_OUT_OF_AREA: '打字頭移不到那裡（不在可以寫字的地方）',
      MOVE_OCCUPIED: '那一格已經有字了，不能疊著打',
      SHEET_NOT_EMPTY: '這張已經落筆了，先謄一張新的再匯入紙本',
    } as Record<string, string>
  )[code] ?? code;
}

/* ---------- 謄抄 ---------- */

export async function transcribe(ctx: Ctx, userId: string, letterId: string): Promise<LetterDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    await assertWritable(tx, L);
    const sh = await currentSheet(tx, L.id);
    const { content } = await sheetContent(tx, sh);
    if (!hasContent(content)) fail(409, 'SHEET_EMPTY', '這張還是空的，不用謄抄');
    await tx.update(sheets).set({ role: 'ref' }).where(eq(sheets.id, sh.id));
    await tx.insert(sheets).values({
      userId,
      letterId: L.id,
      role: 'current',
      kind: sh.kind,
      style: sh.style,
      mode: sh.mode,
      font: sh.font,
      bgAttachmentId: sh.bgAttachmentId,
      bgTemplate: sh.bgTemplate,
      createdAt: ctx.clock.date(),
    });
    return letterDTO(ctx, L, tx);
  });
}

/** 舊信紙處理：字紙冢（保存，保留狀態）／垃圾桶（真的刪除，D-009 暫照規格） */
export async function discardRef(
  ctx: Ctx,
  userId: string,
  letterId: string,
  sheetId: string,
  state: DiscardState,
  to: 'tomb' | 'trash',
): Promise<LetterDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    await assertWritable(tx, L);
    const rows = await tx
      .select()
      .from(sheets)
      .where(and(eq(sheets.id, sheetId), eq(sheets.letterId, L.id), eq(sheets.role, 'ref')));
    const sh = rows[0] ?? notFound('桌邊沒有這張舊信紙');
    if (to === 'trash') {
      await tx.delete(sheets).where(eq(sheets.id, sh.id));
    } else {
      // 角度與原型相同：由信紙 id 決定
      await tx
        .update(sheets)
        .set({ role: 'tomb', discardState: state, discardAngle: Math.round((hash(sh.id) % 70) - 35), discardedAt: ctx.clock.date() })
        .where(eq(sheets.id, sh.id));
    }
    return letterDTO(ctx, L, tx);
  });
}

export async function tomb(ctx: Ctx, userId: string): Promise<TombDTO> {
  const rows = await ctx.db
    .select()
    .from(sheets)
    .where(and(eq(sheets.userId, userId), eq(sheets.role, 'tomb')))
    .orderBy(desc(sheets.discardedAt));
  return {
    sheets: await Promise.all(
      rows.map(async (s) => ({
        sheet: await sheetDTO(ctx.db, s),
        state: s.discardState as DiscardState,
        angle: s.discardAngle ?? 0,
        discardedAt: ms(s.discardedAt) ?? 0,
        letterId: s.letterId,
      })),
    ),
    unsent: await listLetters(ctx, userId, 'shelved'),
  };
}

/* ---------- 先放著（未寄出的信） ---------- */

export async function shelve(ctx: Ctx, userId: string, letterId: string): Promise<LetterDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    await assertWritable(tx, L);
    if (!(await letterHas(tx, L.id))) fail(409, 'LETTER_EMPTY', '書桌上還沒有信');
    const now = ctx.clock.now();
    await tx.update(letters).set({ status: 'shelved', shelvedAt: new Date(now), askedAt: null }).where(eq(letters.id, L.id));
    await enqueue(tx, {
      kind: 'unsent_ask',
      uniqueKey: `unsent_ask:${L.id}:${now}:1`,
      refId: L.id,
      runAt: nextUnsentAsk(now, null),
      payload: { shelvedAt: now, n: 1 },
      now,
    });
    return letterDTO(ctx, { ...L, status: 'shelved', shelvedAt: new Date(now), askedAt: null }, tx);
  });
}

export async function unshelve(ctx: Ctx, userId: string, letterId: string): Promise<LetterDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    if (L.status !== 'shelved') fail(409, 'INVALID_STATE', '這封信不在抽屜裡');
    await tx.update(letters).set({ status: 'drafting', shelvedAt: null, askedAt: null }).where(eq(letters.id, L.id));
    return letterDTO(ctx, { ...L, status: 'drafting', shelvedAt: null, askedAt: null }, tx);
  });
}

/** 「再放 30 天」 */
export async function askLater(ctx: Ctx, userId: string, letterId: string): Promise<LetterDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    if (L.status !== 'shelved') fail(409, 'INVALID_STATE', '這封信不在抽屜裡');
    const askedAt = ctx.clock.date();
    await tx.update(letters).set({ askedAt }).where(eq(letters.id, L.id));
    return letterDTO(ctx, { ...L, askedAt }, tx);
  });
}

/* ---------- 附件 ---------- */

export const PURPOSES = ['attachment', 'scan', 'bg', 'front', 'stamp', 'postmark', 'skin'] as const;
export type Purpose = (typeof PURPOSES)[number];

export async function ownAttachment(db: Db, userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound('找不到這個檔案');
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)));
  return rows[0] ?? notFound('找不到這個檔案');
}

export async function addAttachment(
  ctx: Ctx,
  userId: string,
  letterId: string,
  purpose: Purpose,
  file: { name: string; mime: string; data: Buffer },
): Promise<AttachmentDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    if (L.status === 'sent') fail(409, 'LETTER_LOCKED', '信已經寄出');
    // 附件、紙本、信紙圖樣、明信片正面在書桌上處理；郵票、郵戳、信封圖在郵局處理
    if (['attachment', 'scan', 'bg', 'front'].includes(purpose)) await assertWritable(tx, L);
    if (!/^image\//.test(file.mime)) fail(422, 'INVALID_OP', '只接受圖片檔');
    const id = randomUUID();
    const stored = await ctx.storage.put(`${id}`, file.data);
    const [a] = await tx
      .insert(attachments)
      .values({
        id,
        userId,
        letterId: L.id,
        purpose,
        name: file.name.slice(0, 200),
        mime: file.mime,
        size: file.data.length,
        path: stored,
        createdAt: ctx.clock.date(),
      })
      .returning();
    return attachmentDTO(a!);
  });
}

/** 附件「拿出來」（原型有這個動作；只在書桌上、出門前可以） */
export async function takeOutAttachment(ctx: Ctx, userId: string, letterId: string, attId: string): Promise<LetterDTO> {
  return ctx.db.transaction(async (tx) => {
    const L = await getLetter(tx, userId, letterId, true);
    await assertWritable(tx, L);
    const a = await ownAttachment(tx, userId, attId);
    if (a.letterId !== L.id || a.purpose !== 'attachment' || a.takenOutAt) notFound('這封信沒有這個附件');
    await tx.update(attachments).set({ takenOutAt: ctx.clock.date() }).where(eq(attachments.id, a.id));
    return letterDTO(ctx, L, tx);
  });
}

export async function attachmentsByIds(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(attachments).where(inArray(attachments.id, ids));
}
