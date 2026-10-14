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
    expect(g.attachments).toBeNull();
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

  it('送達後，寄件人看得到「送達時間怎麼算的」計算明細', async () => {
    const { no } = await delivered('看計算明細');
    const s = json(await t.req('GET', `/shipments/${no}`, me));
    expect(s.state).toBe('waiting');
    expect(s.calc).not.toBeNull();
    expect(s.calc.deliver).toBe(s.deliverAt);
    expect(s.calc.start).toBeLessThanOrEqual(s.calc.raw);
    expect(s.calc.base).toBeGreaterThanOrEqual(1);
    expect(typeof s.calc.baseWhy).toBe('string');
  });

  it('信封外面上傳的郵票，拆信前就看得到；信封裡的附件要倒出來之後', async () => {
    const id = await draft(t, me, '附上一張照片，還有自己畫的郵票');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const up = async (purpose: string) => {
      const boundary = '----manxin';
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const r = await t.app.inject({
        method: 'POST',
        url: `/letters/${id}/attachments?purpose=${purpose}`,
        headers: { cookie: me, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(r.statusCode, r.body).toBe(201);
      return json(r).id as string;
    };
    const att = await up('attachment');
    await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'walk', box: 'green' });
    t.advance(10 * 60_000);
    await t.req('POST', `/letters/${id}/trip/enter`, me);
    const stampId = await up('stamp');
    expect(json(await t.req('PATCH', `/letters/${id}/counter`, me, { stampAttachmentId: stampId })).stampAttachmentId).toBe(stampId);
    for (const [u, b] of [
      [`/letters/${id}/counter/confirm-address`],
      [`/letters/${id}/counter/folds`, { edge: 'b', at: (1.414 * 2) / 3 }],
      [`/letters/${id}/counter/folds`, { edge: 'b', at: 1.414 / 3 }],
      [`/letters/${id}/counter/insert`],
      [`/letters/${id}/counter/seal`],
      [`/letters/${id}/counter/stamp`, { x: 0.87, y: 0.24, r: 3 }],
    ] as [string, unknown?][]) {
      const r = await t.req('POST', u, me, b);
      expect(r.statusCode, u + r.body).toBeLessThan(300);
    }
    const no = json(await t.req('POST', `/letters/${id}/post`, me)).no as string;
    const s = (await t.h.db.select().from(shipments).where(eq(shipments.no, no)))[0]!;
    t.setNow(s.deliverAt.getTime());
    await t.run();
    const m = (await t.outbox('wen@example.org')).find((x) => (x.meta as { no: string }).no === no)!;
    const token = (m.meta as { token: string }).token;
    expect(json(await t.req('GET', `/r/${token}`)).pkg.stampAttachmentId).toBe(stampId);
    const st = await t.req('GET', `/r/${token}/attachments/${stampId}`);
    expect(st.statusCode).toBe(200);
    expect(st.rawPayload.equals(png)).toBe(true);
    expect(json(await t.req('GET', `/r/${token}/attachments/${att}`)).error.code).toBe('INVALID_STATE');
    await t.req('POST', `/r/${token}/enter`);
    await t.req('POST', `/r/${token}/open`, undefined, { method: 'knife' });
    await t.req('POST', `/r/${token}/pour`);
    expect((await t.req('GET', `/r/${token}/attachments/${att}`)).statusCode).toBe(200);
    // 倒出來就列出附件，信紙還摺著
    const g = json(await t.req('GET', `/r/${token}`));
    expect(g.letter).toBeNull();
    expect(g.attachments.map((a: { id: string }) => a.id)).toEqual([att]);
    expect(g.attachments[0].url).toBe(`/r/${token}/attachments/${att}`);
  });

  it('無效連結 404', async () => {
    expect((await t.req('GET', '/r/this-is-not-a-real-token-at-all')).statusCode).toBe(404);
  });
});
