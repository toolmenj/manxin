/**
 * 檔案存放。
 * - DbStorage（正式，STORAGE=db）：存進 PostgreSQL 的 blobs 表。和資料寫在同一個交易裡，交易失敗就不會留下孤兒檔；
 *   多個 API 副本、重新部署都讀得到（review H8）。
 * - LocalDiskStorage（開發）：本機資料夾。
 *
 * 讀不到檔案一律回 null，由路由回 404（不要 500）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { blobs } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';

export interface Storage {
  /** db 傳入呼叫端的交易，讓檔案與資料一起成功或一起失敗 */
  put(key: string, data: Buffer, db: Db, now: number): Promise<string>;
  read(storedPath: string, db: Db): Promise<Buffer | null>;
}

export class LocalDiskStorage implements Storage {
  constructor(private readonly dir: string) {}
  async put(key: string, data: Buffer): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    await writeFile(path.join(this.dir, safe), data);
    return safe;
  }
  async read(storedPath: string): Promise<Buffer | null> {
    try {
      return await readFile(path.join(this.dir, path.basename(storedPath)));
    } catch {
      return null;
    }
  }
}

export class DbStorage implements Storage {
  async put(key: string, data: Buffer, db: Db, now: number): Promise<string> {
    const k = `db:${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await db.insert(blobs).values({ key: k, data, size: data.length, createdAt: new Date(now) });
    return k;
  }
  async read(storedPath: string, db: Db): Promise<Buffer | null> {
    const rows = await db.select({ data: blobs.data }).from(blobs).where(eq(blobs.key, storedPath));
    return rows[0]?.data ?? null;
  }
}

/* ---------- 上傳檔案的類型判斷（review H3） ---------- */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/**
 * 依檔頭判斷圖片格式，不相信副檔名與瀏覽器給的 content-type。
 * 刻意不收 SVG：SVG 可以夾帶腳本，和網站同網域開啟時會以本站身分執行。
 */
export function sniffImage(data: Buffer): ImageMime | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const g = data.subarray(0, 6).toString('latin1');
  if (g === 'GIF87a' || g === 'GIF89a') return 'image/gif';
  return null;
}

/**
 * 送出使用者上傳的檔案。就算檔案內容有問題，也不讓瀏覽器把它當網頁執行：
 * nosniff（照 content-type，不猜）＋ CSP sandbox（不能跑腳本）＋ inline 顯示。
 */
export function sendUserFile(reply: FastifyReply, mime: string, body: Buffer | null, cacheControl: string) {
  if (!body) notFound('找不到這個檔案');
  return reply
    .header('content-type', mime)
    .header('cache-control', cacheControl)
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    .header('content-disposition', 'inline')
    .send(body);
}
