/**
 * 頻率限制（review H9）。固定時間窗，計數存在 PostgreSQL 的 rate_limits 表，多個 API 副本共用同一份。
 * 用真實時間，不受開發用「快轉」影響。
 *
 * 用法：在路由的 preHandler 放 limit([...規則])。超過回 429 RATE_LIMITED，並帶 Retry-After。
 * 整站每秒請求數的粗限制交給 Ingress（見 deploy/k8s/ingress.yaml），這裡只管容易被濫用的端點。
 */
import { sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import { AppError } from './errors.ts';
import { sha256 } from './crypto.ts';

export interface Rule {
  /** 規則名稱，會成為計數鍵的一部分 */
  name: string;
  max: number;
  windowMs: number;
  /** 回傳要計數的對象（IP、信箱、帳號…）；回傳 null 表示這條規則不適用 */
  key: (req: FastifyRequest) => string | null | undefined;
}

export async function hit(db: Db, key: string, max: number, windowMs: number, now = Date.now()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const nowD = new Date(now);
  const cutoff = new Date(now - windowMs);
  const rows = await db.execute<{ count: number; window_start: Date | string }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${nowD}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start <= ${cutoff} THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start <= ${cutoff} THEN ${nowD} ELSE rate_limits.window_start END
    RETURNING count, window_start`);
  const r = (rows as unknown as { rows?: { count: number; window_start: Date | string }[] }).rows?.[0] ??
    (rows as unknown as { count: number; window_start: Date | string }[])[0]!;
  const start = new Date(r.window_start).getTime();
  const ok = Number(r.count) <= max;
  return { ok, retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
}

/** 建立 preHandler。cfg.rateLimit=false（測試）時不檢查 */
export function limit(rules: Rule[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.server.ctx;
    if (!ctx.cfg.rateLimit) return;
    for (const r of rules) {
      const k = r.key(req);
      if (!k) continue;
      // 信箱等個資只存雜湊
      const key = `${r.name}:${sha256(k).slice(0, 32)}`;
      const res = await hit(ctx.db, key, r.max, r.windowMs);
      if (!res.ok) {
        reply.header('retry-after', String(res.retryAfterSec));
        throw new AppError(429, 'RATE_LIMITED', '太頻繁了，請稍後再試', { retryAfterSec: res.retryAfterSec });
      }
    }
  };
}

export const byIp = (req: FastifyRequest) => req.ip;
export const byUser = (req: FastifyRequest) => req.user?.id ?? null;
export const MIN = 60_000;
export const HOUR = 3600_000;
