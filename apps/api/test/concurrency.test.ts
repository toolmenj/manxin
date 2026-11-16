/**
 * 多人同時操作（review：測試全在 PGlite，看不出併發問題）。
 * 只在真的 PostgreSQL 上跑（設定 TEST_DATABASE_URL）；PGlite 只有一條連線，同時送也會排隊，測不出東西。
 *
 *   docker compose up -d postgres
 *   TEST_DATABASE_URL=postgres://manxin:manxin@localhost:5433/manxin npm run test:api
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduledJobs, sheetOps, shipments } from '../src/db/schema.ts';
import { hit } from '../src/lib/rateLimit.ts';
import { runDueJobs } from '../src/services/jobs.ts';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';

const realPg = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!realPg)('多人同時操作（真的 PostgreSQL）', () => {
  let t: TestApp;
  let me: string;
  beforeAll(async () => {
    t = await makeApp('2026-10-14T10:00');
    me = await t.login('zhe@example.com');
  });
  afterAll(() => t.close());

  it('兩個分頁同時用同一個 seq 寫字：只有一個寫進去，另一個 SEQ_CONFLICT；不會重複、不會交錯', async () => {
    const id = await draft(t, me, '開頭');
    const sh = json(await t.req('GET', `/letters/${id}`, me)).sheet;
    const send = (text: string) => t.req('POST', `/letters/${id}/sheet/chars`, me, { text, seq: sh.seq, sheetId: sh.id, opId: crypto.randomUUID() });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => send(`分頁${i}`)));
    const codes = rs.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(7);
    const ops = await t.h.db.select().from(sheetOps).where(eq(sheetOps.sheetId, sh.id));
    expect(ops.filter((o) => o.seq === sh.seq)).toHaveLength(1);
  });

  it('同一個 opId 同時重送 5 次：只寫一次', async () => {
    const id = await draft(t, me, '開頭');
    const sh = json(await t.req('GET', `/letters/${id}`, me)).sheet;
    const opId = crypto.randomUUID();
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '我喜歡你', sheetId: sh.id, opId })),
    );
    expect(rs.every((r) => r.statusCode < 500), rs.map((r) => r.body).join('\n')).toBe(true);
    const fresh = json(await t.req('GET', `/letters/${id}`, me)).sheet;
    expect(fresh.chars.map((c: { c: string }) => c.c).join('')).toContain('我喜歡你');
    expect(fresh.chars.map((c: { c: string }) => c.c).join('')).not.toContain('我喜歡你我喜歡你');
  });

  it('同一封信同時按兩次投郵筒：只寄出一次', async () => {
    const id = await draft(t, me, '只寄一次');
    // 走到可以投的狀態
    let no: string | null = null;
    try {
      no = await sendLetter(t, me, id);
    } catch {
      /* sendLetter 自己會投；這裡只是要確認再投一次不會多一筆 */
    }
    const again = await Promise.all([t.req('POST', `/letters/${id}/post`, me), t.req('POST', `/letters/${id}/post`, me)]);
    expect(again.every((r) => r.statusCode === 409)).toBe(true);
    const rows = await t.h.db.select().from(shipments).where(eq(shipments.letterId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.no).toBe(no);
  });

  it('三個 worker 同時跑排程：每件事只處理一次、每封通知只寄一次', async () => {
    const ids = await Promise.all([1, 2, 3].map((i) => draft(t, me, `第${i}封`)));
    const nos: string[] = [];
    for (const id of ids) nos.push(await sendLetter(t, me, id));
    t.advance(30 * 86400_000);
    const results = await Promise.all([runDueJobs(t.app.ctx), runDueJobs(t.app.ctx), runDueJobs(t.app.ctx)]);
    const done = results.flat().filter((r) => !r.result.startsWith('error'));
    const keys = done.map((r) => r.uniqueKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const no of nos) {
      const mails = (await t.outbox('wen@example.org')).filter((m) => (m.meta as { no?: string }).no === no);
      expect(mails, no).toHaveLength(1);
    }
    const pending = await t.h.db.select().from(scheduledJobs).where(eq(scheduledJobs.status, 'pending'));
    expect(pending.filter((j) => j.runAt.getTime() <= t.clock.now() && j.kind !== 'unsent_ask')).toHaveLength(0);
  });

  it('頻率限制同時打 50 次：計數不會少算（只放行 max 次）', async () => {
    const key = `test-${crypto.randomUUID()}`;
    const rs = await Promise.all(Array.from({ length: 50 }, () => hit(t.h.db, key, 10, 60_000)));
    expect(rs.filter((r) => r.ok)).toHaveLength(10);
  });
});
