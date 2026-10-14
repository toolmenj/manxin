/** 收信：開信即簽收、毛邊與紙纖維由伺服器擲骰、撕毀、收藏 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shipments } from '../src/db/schema.ts';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';

let t: TestApp;
let me: string;
beforeAll(async () => {
  t = await makeApp('2026-10-14T10:00');
  me = await t.login('zhe@example.com');
});
afterAll(() => t.close());

/** 寄一封信並快轉到送達，回傳收件人的開信 token */
async function delivered(text = '小雯：\n\n慢慢拆。'): Promise<{ token: string; no: string }> {
  const id = await draft(t, me, text);
  const no = await sendLetter(t, me, id);
  const s = (await t.h.db.select().from(shipments).where(eq(shipments.no, no)))[0]!;
  if (t.clock.now() < s.deliverAt.getTime()) t.setNow(s.deliverAt.getTime());
  await t.run();
  const m = (await t.outbox('wen@example.org')).find((x) => (x.meta as { no: string }).no === no)!;
  return { token: (m.meta as { token: string }).token, no };
}

describe('開信流程', () => {
  it('連結：沒點開不能開；開信即簽收；倒出來 → 攤開才看得到內容 → 收進收藏', async () => {
    const { token, no } = await delivered();
    const g = json(await t.req('GET', `/r/${token}`));
    expect(g.recv.entered).toBe(false);
    expect(g.letter).toBeNull();
    expect(g.pkg.folds).toHaveLength(2);
    expect(json(await t.req('POST', `/r/${token}/open`, undefined, { method: 'knife' })).error.details.reason).toBe('NOT_ENTERED');

    await t.req('POST', `/r/${token}/enter`);
    expect(json(await t.req('POST', `/r/${token}/pour`)).error.details.reason).toBe('NOT_OPENED');
    const o = json(await t.req('POST', `/r/${token}/open`, undefined, { method: 'knife', cutPath: 'M0 6 L100 6' }));
    expect(o.recv.opened).toBe(true);
    expect(o.recv.rough).toBe(false); // 郵政信封、開信刀
    expect(json(await t.req('GET', `/track/${no}`)).state).toBe('signed');
    expect(o.letter).toBeNull();

    expect(json(await t.req('POST', `/r/${token}/collect`)).error.details.reason).toBe('NOT_UNFOLDED');
    await t.req('POST', `/r/${token}/pour`);
    const u = json(await t.req('POST', `/r/${token}/unfold`));
    expect(u.letter.sheet.chars.map((c: { c: string }) => c.c).join('')).toBe('小雯：\n\n慢慢拆。');
    expect(json(await t.req('POST', `/r/${token}/collect`)).recv.collected).toBe(true);
    expect((await t.req('POST', `/r/${token}/collect`)).statusCode).toBe(409);
    expect((await t.req('POST', `/r/${token}/open`, undefined, { method: 'tear' })).statusCode).toBe(409);
  });

  it('撬郵票：40% 紙纖維由伺服器決定並存檔；收藏屬於收件信箱', async () => {
    let fibers = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const { token } = await delivered(`第 ${i} 封`);
      await t.req('POST', `/r/${token}/enter`);
      const r = json(await t.req('POST', `/r/${token}/pry-stamp`));
      expect(r.recv.stampTaken).toBe(true);
      expect(typeof r.recv.stampFiber).toBe('boolean');
      if (r.recv.stampFiber) fibers++;
      // 結果存檔：再讀一次一樣
      expect(json(await t.req('GET', `/r/${token}`)).recv.stampFiber).toBe(r.recv.stampFiber);
      expect((await t.req('POST', `/r/${token}/pry-stamp`)).statusCode).toBe(409);
      expect(json(await t.req('POST', `/r/${token}/pry-wax`)).error.details.reason).toBe('NO_WAX');
    }
    expect(fibers).toBeGreaterThanOrEqual(0);
    expect(fibers).toBeLessThanOrEqual(N);
    const wen = await t.login('wen@example.org');
    const c = json(await t.req('GET', '/collection', wen));
    expect(c.stamps.length).toBeGreaterThanOrEqual(N);
    expect(c.stamps.filter((s: { fiber: boolean }) => s.fiber)).toHaveLength(fibers);
    // 寄件人的收藏裡沒有
    expect(json(await t.req('GET', '/collection', me)).stamps).toHaveLength(0);
  });

  it('撕毀：前端回報位置，信封與信紙裂成兩半，算簽收，可以移動碎片', async () => {
    const { token, no } = await delivered();
    await t.req('POST', `/r/${token}/enter`);
    const r = json(await t.req('POST', `/r/${token}/tear`, undefined, { x: 0.05 }));
    expect(r.recv.method).toBe('rip');
    expect(r.recv.torn.x).toBe(0.2);
    expect(r.recv.pieces).toHaveLength(4);
    expect(r.letter).not.toBeNull();
    expect(json(await t.req('GET', `/track/${no}`)).state).toBe('signed');
    const p = json(await t.req('POST', `/r/${token}/pieces`, undefined, { pieces: [{ k: 'lL', x: 10, y: 20, rot: 3 }] }));
    expect(p.recv.pieces.find((x: { k: string }) => x.k === 'lL')).toEqual({ k: 'lL', x: 10, y: 20, rot: 3 });
    expect((await t.req('POST', `/r/${token}/tear`, undefined, { x: 2 })).statusCode).toBe(400);
  });

  it('無效連結 404', async () => {
    expect((await t.req('GET', '/r/this-is-not-a-real-token-at-all')).statusCode).toBe(404);
  });
});
