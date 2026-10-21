/**
 * 自訂字型（PRD 2.3、D-027：字型存在後端）。
 * 字型屬於帳號；信紙設定 font = 'f:<字型 id>' 就是用這個字型，寄出時信封快照 efont 也會跟著（D-028）。
 * 收件人不一定登入，所以另有用開信連結讀字型檔的路徑（routes/receive.ts）。
 */
import { randomUUID } from 'node:crypto';
import type { FontDTO } from '@manxin/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import type { Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { fonts } from '../db/schema.ts';
import { fail, notFound } from '../lib/errors.ts';

type FontRow = typeof fonts.$inferSelect;

/** 一個帳號最多存幾個字型（字型檔動輒十幾 MB，先設個上限） */
export const FONT_MAX_PER_USER = 30;

export const FONT_PREFIX = 'f:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 'f:<uuid>' → uuid；內建字型（typewriter、kai…）回傳 null */
export function customFontId(font: string | null | undefined): string | null {
  if (!font || !font.startsWith(FONT_PREFIX)) return null;
  const id = font.slice(FONT_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}

export const fontKey = (id: string) => FONT_PREFIX + id;
export const fontUrl = (id: string) => `/fonts/${id}`;
export const recvFontUrl = (token: string, id: string) => `/r/${token}/fonts/${id}`;

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

const MIME: Record<FontFormat, string> = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

/** 依檔頭判斷字型格式（不相信副檔名與瀏覽器給的 content-type） */
export function sniffFont(data: Buffer): FontFormat | null {
  if (data.length < 12) return null;
  const tag = data.subarray(0, 4);
  if (tag.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || tag.toString('latin1') === 'true') return 'ttf';
  const s = tag.toString('latin1');
  if (s === 'OTTO') return 'otf';
  if (s === 'wOFF') return 'woff';
  if (s === 'wOF2') return 'woff2';
  return null;
}

/** 副檔名和檔頭要對得上。.otf 也可能是 TrueType 外框（檔頭 00010000），一樣收 */
function extOk(ext: string, fmt: FontFormat): boolean {
  if (ext === 'otf') return fmt === 'otf' || fmt === 'ttf';
  return ext === fmt;
}

export function fontDTO(f: FontRow): FontDTO {
  return { id: f.id, font: fontKey(f.id), name: f.name, format: f.format as FontFormat, size: f.size, url: fontUrl(f.id), createdAt: f.createdAt.getTime() };
}

export async function listFonts(ctx: Ctx, userId: string): Promise<FontDTO[]> {
  const rows = await ctx.db.select().from(fonts).where(eq(fonts.userId, userId)).orderBy(asc(fonts.createdAt));
  return rows.map(fontDTO);
}

export async function ownFont(db: Db, userId: string, id: string): Promise<FontRow> {
  if (!UUID_RE.test(id)) notFound('找不到這個字型');
  const rows = await db
    .select()
    .from(fonts)
    .where(and(eq(fonts.id, id), eq(fonts.userId, userId)));
  return rows[0] ?? notFound('找不到這個字型');
}

export async function fontById(db: Db, id: string): Promise<FontRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(fonts).where(eq(fonts.id, id));
  return rows[0] ?? null;
}

/** 信紙設定的 font：自訂字型必須是自己上傳的 */
export async function assertFontUsable(db: Db, userId: string, font: string): Promise<void> {
  if (!font.startsWith(FONT_PREFIX)) return;
  const id = customFontId(font);
  if (!id) fail(422, 'INVALID_OP', '沒有這個字型');
  const rows = await db
    .select({ id: fonts.id })
    .from(fonts)
    .where(and(eq(fonts.id, id!), eq(fonts.userId, userId)));
  if (!rows.length) fail(422, 'INVALID_OP', '沒有這個字型，請先上傳');
}

export async function addFont(ctx: Ctx, userId: string, file: { name: string; data: Buffer }): Promise<FontDTO> {
  const m = /\.([A-Za-z0-9]+)$/.exec(file.name);
  const ext = m?.[1]!.toLowerCase() ?? '';
  if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) fail(422, 'INVALID_OP', '只接受 ttf、otf、woff、woff2 字型檔', { reason: 'BAD_EXT' });
  const fmt = sniffFont(file.data);
  if (!fmt || !extOk(ext, fmt)) fail(422, 'INVALID_OP', '這個檔案讀不成字型，請用 ttf、otf、woff 或 woff2', { reason: 'BAD_FONT' });
  return ctx.db.transaction(async (tx) => {
    const [c] = await tx.select({ n: count() }).from(fonts).where(eq(fonts.userId, userId));
    if ((c?.n ?? 0) >= FONT_MAX_PER_USER) fail(409, 'CONFLICT', `字型最多存 ${FONT_MAX_PER_USER} 個`, { max: FONT_MAX_PER_USER });
    const id = randomUUID();
    const stored = await ctx.storage.put(`font-${id}`, file.data);
    const name = file.name.replace(/\.[A-Za-z0-9]+$/, '').trim().slice(0, 60) || '自訂字型';
    const [row] = await tx
      .insert(fonts)
      .values({ id, userId, name, format: fmt!, mime: MIME[fmt!], size: file.data.length, path: stored, createdAt: ctx.clock.date() })
      .returning();
    return fontDTO(row!);
  });
}
