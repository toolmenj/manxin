/** 前往郵局（伺服器判定抵達）、櫃台、寄出前條件 */
import { isValidTrackNo, SHEET_H } from '@manxin/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draft, json, makeApp, type TestApp } from './helpers.ts';

let t: TestApp;
let me: string;
beforeAll(async () => {
  t = await makeApp('2026-10-14T10:00');
  me = await t.login('zhe@example.com');
});
afterAll(() => t.close());

const MIN = 60_000;

describe('前往郵局：抵達時間由伺服器算、由伺服器判定', () => {
  it('GET /time 回伺服器時間', async () => {
    const r = json(await t.req('GET', '/time'));
    expect(r.tz).toBe('Asia/Taipei');
    expect(typeof r.now).toBe('number');
  });

  it('步行到總局 48 分鐘；沒到之前進郵局 409，櫃台操作 409，信紙鎖住', async () => {
    const id = await draft(t, me);
    const start = t.clock.now();
    const r = await t.req('POST', `/letters/${id}/trip`, me, { place: 'main', mode: 'walk', box: 'red' });
    expect(r.statusCode).toBe(201);
    const trip = json(r);
    expect(trip.arriveAt - trip.startAt).toBe(48 * MIN);
    expect(trip.startAt).toBe(start);

    // 前端改時間沒有用：送什麼都看伺服器
    const early = await t.req('POST', `/letters/${id}/trip/enter`, me);
    expect(early.statusCode).toBe(409);
    expect(json(early).error.code).toBe('NOT_ARRIVED');
    expect((await t.req('POST', `/letters/${id}/counter/seal`, me)).statusCode).toBe(409);
    expect(json(await t.req('GET', `/letters/${id}/counter`, me)).error.code).toBe('NOT_AT_POST_OFFICE');
    expect(json(await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '路上補一句' })).error.code).toBe('LETTER_LOCKED');
    expect((await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'car', box: 'green' })).statusCode).toBe(409);

    t.advance(48 * MIN - 1000);
    expect((await t.req('POST', `/letters/${id}/trip/enter`, me)).statusCode).toBe(409);
    t.advance(1000);
    const ok = await t.req('POST', `/letters/${id}/trip/enter`, me);
    expect(ok.statusCode).toBe(200);
    expect(json(ok).counter.missing).toEqual(['ADDRESS', 'INSERT', 'STAMP']);
  });

  it('掉頭回家：可以繼續寫，櫃台做過的事（摺痕）留著', async () => {
    const id = await draft(t, me);
    await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'walk', box: 'green' });
    t.advance(5 * MIN);
    await t.req('POST', `/letters/${id}/trip/enter`, me);
    await t.req('POST', `/letters/${id}/counter/folds`, me, { edge: 'b', at: SHEET_H / 2 });
    expect((await t.req('POST', `/letters/${id}/trip/home`, me)).statusCode).toBe(204);
    expect((await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '回家再寫' })).statusCode).toBe(201);
    await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'walk', box: 'green' });
    t.advance(5 * MIN);
    const c = json(await t.req('POST', `/letters/${id}/trip/enter`, me)).counter;
    expect(c.folds).toHaveLength(1);
  });
});

describe('櫃台', () => {
  let id: string;
  const P = (path: string, body?: unknown) => t.req('POST', `/letters/${id}/counter/${path}`, me, body);

  beforeAll(async () => {
    id = await draft(t, me);
    await t.req('PATCH', `/letters/${id}`, me, { env: { toEmail: 'not-an-email' } });
    await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'walk', box: 'green' });
    t.advance(5 * MIN);
    await t.req('POST', `/letters/${id}/trip/enter`, me);
  });

  it('什麼都沒做就投郵筒：422，列出缺什麼', async () => {
    const r = await t.req('POST', `/letters/${id}/post`, me);
    expect(r.statusCode).toBe(422);
    expect(json(r).error.code).toBe('NOT_READY');
    expect(json(r).error.details.missing).toEqual(['ADDRESS', 'INSERT', 'STAMP']);
  });

  it('信箱格式不對不能確認地址；改好再確認；之後改信箱要重新確認', async () => {
    expect(json(await P('confirm-address')).error.code).toBe('INVALID_EMAIL');
    await t.req('PATCH', `/letters/${id}`, me, { env: { toEmail: 'wen@example.org' } });
    expect(json(await P('confirm-address')).addrOk).toBe(true);
    await t.req('PATCH', `/letters/${id}`, me, { env: { toEmail: 'wen2@example.org' } });
    expect(json(await t.req('GET', `/letters/${id}/counter`, me)).addrOk).toBe(false);
    await t.req('PATCH', `/letters/${id}`, me, { env: { toEmail: 'wen@example.org' } });
    expect(json(await P('confirm-address')).addrOk).toBe(true);
  });

  it('沒摺的信紙放不進郵政信封：422 太長；轉方向：422 太寬', async () => {
    let r = await P('insert');
    expect(r.statusCode).toBe(422);
    expect(json(r).error.code).toBe('TOO_LONG');
    expect(json(r).error.message).toContain('太長');
    await t.req('PATCH', `/letters/${id}/counter`, me, { rot: true });
    r = await P('insert');
    expect(json(r).error.code).toBe('TOO_WIDE');
    expect(json(r).error.message).toContain('太寬');
    await t.req('PATCH', `/letters/${id}/counter`, me, { rot: false });
  });

  it('摺線不在紙上 422；伺服器重算外框', async () => {
    expect(json(await P('folds', { edge: 'b', at: 2 })).error.code).toBe('FOLD_OUT_OF_RANGE');
    let c = json(await P('folds', { edge: 'b', at: (SHEET_H * 2) / 3 }));
    expect(c.pack.y1).toBeCloseTo((SHEET_H * 2) / 3, 6);
    expect(json(await P('insert')).error.code).toBe('TOO_LONG');
    c = json(await P('folds', { edge: 'b', at: SHEET_H / 3 }));
    expect(c.pack).toEqual({ x0: 0, y0: 0, x1: 1, y1: SHEET_H / 3 });
    expect(c.folds).toHaveLength(2);
  });

  it('信封上的字只能追加，寫了就不能換信封', async () => {
    expect((await t.req('PATCH', `/letters/${id}/counter`, me, { env: 'kraft' })).statusCode).toBe(200);
    const r = await P('envelope-text', { zone: 'to', text: '小雯 收' });
    expect(r.statusCode).toBe(201);
    expect(json(r).etxt.to.c.join('')).toBe('小雯 收');
    expect(json(r).envLocked).toBe(true);
    const lock = await t.req('PATCH', `/letters/${id}/counter`, me, { env: 'wax' });
    expect(lock.statusCode).toBe(409);
    expect(json(lock).error.code).toBe('ENVELOPE_LOCKED');
    expect((await t.req('DELETE', `/letters/${id}/counter/envelope-text`, me)).statusCode).toBe(404);
  });

  it('放進信封 → 摺不了、轉不了；封口；郵票貼一次就鎖定', async () => {
    expect(json(await P('seal')).error.code).toBe('INVALID_STATE');
    expect(json(await P('insert')).inserted).toBe(true);
    expect(json(await P('insert')).error.code).toBe('ALREADY_DONE');
    expect(json(await P('folds', { edge: 'r', at: 0.5 })).error.code).toBe('ALREADY_DONE');
    expect(json(await P('seal')).sealed).toBe(true);
    expect((await t.req('PATCH', `/letters/${id}/counter`, me, { stamp: 'bird' })).statusCode).toBe(200);
    expect(json(await P('stamp', { x: 1.5, y: 0.2, r: 0 })).error.code).toBe('INVALID_OP');
    expect(json(await P('stamp', { x: 0.86, y: 0.22, r: 3 })).stampPos).toEqual({ x: 0.86, y: 0.22, r: 3 });
    expect(json(await P('stamp', { x: 0.5, y: 0.5, r: 0 })).error.code).toBe('ALREADY_DONE');
    expect(json(await t.req('PATCH', `/letters/${id}/counter`, me, { stamp: 'plum' })).error.code).toBe('STAMP_LOCKED');
    const pm = json(await P('postmark', { x: 0.77, y: 0.3, r: -10 }));
    expect(pm.pmAt).toBe(t.clock.now());
    expect(json(await P('postmark', { x: 0.7, y: 0.3, r: 0 })).error.code).toBe('ALREADY_DONE');
  });

  it('條件都齊了：投郵筒，建立寄件、單號有效、計畫由伺服器算、信變唯讀', async () => {
    const r = await t.req('POST', `/letters/${id}/post`, me);
    expect(r.statusCode).toBe(201);
    const s = json(r);
    expect(isValidTrackNo(s.no)).toBe(true);
    expect(s.state).toBe('transit');
    expect(s.deliverAt).toBeNull(); // 送達前不透露確切時間
    expect(s.stops[0]).toBe('臺北大安區 巷口郵筒');
    expect(json(await t.req('GET', `/letters/${id}`, me)).status).toBe('sent');
    expect((await t.req('POST', `/letters/${id}/post`, me)).statusCode).toBe(409);
    const tr = json(await t.req('GET', `/track/${s.no}`));
    expect(tr.state).toBe('transit');
    expect(JSON.stringify(tr)).not.toContain('wen@example.org');
    expect((await t.req('GET', `/track/RR000000000TW`)).statusCode).toBe(404);
  });

  it('最多摺 6 次', async () => {
    const id2 = await draft(t, me);
    await t.req('POST', `/letters/${id2}/trip`, me, { place: 'box', mode: 'walk', box: 'green' });
    t.advance(5 * MIN);
    await t.req('POST', `/letters/${id2}/trip/enter`, me);
    let pack = json(await t.req('GET', `/letters/${id2}/counter`, me)).pack;
    for (let i = 0; i < 6; i++) {
      const edge = i % 2 ? 'r' : 'b';
      const at = edge === 'b' ? (pack.y0 + pack.y1) / 2 : (pack.x0 + pack.x1) / 2;
      const r = await t.req('POST', `/letters/${id2}/counter/folds`, me, { edge, at });
      expect(r.statusCode).toBe(201);
      pack = json(r).pack;
    }
    const r = await t.req('POST', `/letters/${id2}/counter/folds`, me, { edge: 'b', at: (pack.y0 + pack.y1) / 2 });
    expect(r.statusCode).toBe(409);
    expect(json(r).error.code).toBe('TOO_MANY_FOLDS');
  });
});

describe('明信片', () => {
  it('不用信封、不用摺，地址與郵票好了就能寄', async () => {
    const r = await t.req('POST', '/letters', me, {
      kind: 'postcard',
      env: { fromEmail: 'zhe@example.com', toEmail: 'wen@example.org' },
    });
    const id = json(r).id;
    await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '風景很好。' });
    await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'walk', box: 'red' });
    t.advance(5 * MIN);
    const c = json(await t.req('POST', `/letters/${id}/trip/enter`, me)).counter;
    expect(c.env).toBe('card');
    expect(c.missing).toEqual(['ADDRESS', 'STAMP']);
    expect(json(await t.req('POST', `/letters/${id}/counter/folds`, me, { edge: 'b', at: 0.5 })).error.code).toBe('INVALID_OP');
    expect(json(await t.req('PATCH', `/letters/${id}/counter`, me, { env: 'post' })).error.code).toBe('INVALID_OP');
    await t.req('POST', `/letters/${id}/counter/confirm-address`, me);
    await t.req('POST', `/letters/${id}/counter/stamp`, me, { x: 0.9, y: 0.1, r: 0 });
    const s = json(await t.req('POST', `/letters/${id}/post`, me));
    expect(s.box).toBe('red');

  });
});
