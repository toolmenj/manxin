/**
 * 自選書寫位置（移動打字頭）、可寫區域（明信片右半邊）、重送不重複（H1）、換紙偵測（M1）、
 * 資料庫觸發器補強（M2）。重現情境來自 2026-10-21 多人上線審查。
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';

let t: TestApp;
let me: string;

beforeAll(async () => {
  t = await makeApp();
  me = await t.login('zhe@example.com');
});
afterAll(() => t.close());

type Sheet = { id: string; seq: number; cursor?: [number, number] | null; chars: { c: string; p?: [number, number]; m: unknown[] }[] };
const text = (s: Sheet) => s.chars.map((c) => c.c).join('');
const getSheet = async (id: string): Promise<Sheet> => json(await t.req('GET', `/letters/${id}`, me)).sheet;

async function dbError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return String((e as { cause?: Error }).cause?.message ?? (e as Error).message);
  }
  return 'no error';
}

async function newLetter(body: Record<string, unknown> = {}) {
  const r = await t.req('POST', '/letters', me, body);
  expect(r.statusCode).toBe(201);
  return json(r).id as string;
}

describe('移動打字頭（POST /sheet/moves）', () => {
  it('舊信紙（沒有移動過）照舊：沒有格位、cursor 是 null', async () => {
    const id = await draft(t, me, '那年\n我只是不敢');
    const s = await getSheet(id);
    expect(s.cursor).toBeNull();
    expect(s.chars.every((c) => c.p === undefined)).toBe(true);
  });

  it('移到第 6 行第 5 格寫字；之前的字重排到第一行', async () => {
    const id = await draft(t, me, '你好');
    let r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [5, 8] });
    expect(r.statusCode).toBe(201);
    expect(json(r).cursor).toEqual([5, 8]);
    r = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '在這裡' });
    expect(r.statusCode).toBe(201);
    const s = json<Sheet>(r);
    expect(s.chars.map((c) => `${c.c}${c.p}`)).toEqual(['你0,0', '好0,2', '在5,8', '這5,10', '裡5,12']);
    expect(s.cursor).toEqual([5, 14]);
    expect(s.seq).toBe(3);
  });

  it('不能停在有字的格子；不能移出紙；手寫模式不能移', async () => {
    const id = await draft(t, me, '字');
    let r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [0, 0] });
    expect(r.statusCode).toBe(422);
    expect(json(r).error.details.reason).toBe('MOVE_OCCUPIED');
    r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [99, 0] });
    expect(json(r).error.details.reason).toBe('MOVE_OUT_OF_AREA');
    r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [0] });
    expect(r.statusCode).toBe(400);
    r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [0, 4], text: 'x' });
    expect(r.statusCode).toBe(400);
    await t.req('PATCH', `/letters/${id}/sheet`, me, { mode: 'hand' });
    r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [3, 0] });
    expect(json(r).error.details.reason).toBe('WRONG_MODE');
    expect(text(await getSheet(id))).toBe('字');
  });

  it('移到字中間寫：不會蓋掉已寫的字，自動跳到下一個空格', async () => {
    const id = await newLetter();
    await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [0, 4] });
    await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '甲乙' });
    await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [0, 2] });
    const s = json<Sheet>(await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '丙丁' }));
    expect(s.chars.map((c) => `${c.c}${c.p}`)).toEqual(['甲0,4', '乙0,6', '丙0,2', '丁0,8']);
  });

  it('寫到最後一行之後：422 SHEET_FULL，紙上的字不變', async () => {
    const id = await newLetter();
    await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [21, 50] });
    const r = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '一二三' });
    expect(json(r).error.details.reason).toBe('SHEET_FULL');
    expect((await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '一二' })).statusCode).toBe(201);
  });

  it('移動打字頭不算落筆：還能換紙', async () => {
    const id = await newLetter();
    await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [3, 0] });
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { style: 'grid' })).statusCode).toBe(200);
  });
});

describe('明信片的可寫區域', () => {
  it('打字：正文只在左半邊，右半邊（地址、郵票）移不過去，寫到行尾自動換行', async () => {
    const id = await newLetter({ kind: 'postcard' });
    let r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [0, 40] });
    expect(r.statusCode).toBe(422);
    expect(json(r).error.details.reason).toBe('MOVE_OUT_OF_AREA');
    r = await t.req('POST', `/letters/${id}/sheet/moves`, me, { at: [0, 34] });
    expect(r.statusCode).toBe(201);
    const s = json<Sheet>(await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '一二' }));
    expect(s.chars.map((c) => `${c.c}${c.p}`)).toEqual(['一0,34', '二1,0']);
  });

  it('手寫：右半邊的筆畫 422 STROKE_OUT_OF_AREA，左半邊可以', async () => {
    const id = await newLetter({ kind: 'postcard', mode: 'hand' });
    const st = (x: number) => ({ stroke: { pen: 'ball', color: '#1A1A1A', pts: [[0.1, 0.1, 0.5], [x, 0.2, 0.5]] } });
    let r = await t.req('POST', `/letters/${id}/sheet/strokes`, me, st(0.8));
    expect(r.statusCode).toBe(422);
    expect(json(r).error.details.reason).toBe('STROKE_OUT_OF_AREA');
    r = await t.req('POST', `/letters/${id}/sheet/strokes`, me, st(0.5));
    expect(r.statusCode).toBe(201);
  });
});

describe('塗改用字的位置清單（at）', () => {
  it('只劃指定的字；舊的 from–to 仍然可以；兩種一起送 400', async () => {
    const id = await draft(t, me, 'ABCD');
    let r = await t.req('POST', `/letters/${id}/sheet/marks`, me, { at: [0, 2], tool: 's1' });
    expect(r.statusCode).toBe(201);
    expect(json<Sheet>(r).chars.map((c) => c.m.length)).toEqual([1, 0, 1, 0]);
    r = await t.req('POST', `/letters/${id}/sheet/marks`, me, { from: 3, to: 3, tool: 'x' });
    expect(r.statusCode).toBe(201);
    expect((await t.req('POST', `/letters/${id}/sheet/marks`, me, { at: [1], from: 1, to: 1, tool: 'x' })).statusCode).toBe(400);
    expect((await t.req('POST', `/letters/${id}/sheet/marks`, me, { tool: 'x' })).statusCode).toBe(400);
    expect((await t.req('POST', `/letters/${id}/sheet/marks`, me, { at: [9], tool: 'x' })).statusCode).toBe(422);
  });
});

describe('H1：回應遺失後重送，不會重複寫入', () => {
  it('同一個 opId 送兩次：第二次回 200 與目前的信紙，字只有一份（就算 seq 已經過期）', async () => {
    const id = await newLetter();
    const s0 = await getSheet(id);
    const opId = randomUUID();
    const r1 = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '我喜歡你', seq: s0.seq, sheetId: s0.id, opId });
    expect(r1.statusCode).toBe(201);
    // 回應沒回來，前端用同樣的 seq 與 opId 重送
    const r2 = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '我喜歡你', seq: s0.seq, sheetId: s0.id, opId });
    expect(r2.statusCode).toBe(200);
    expect(text(json(r2))).toBe(text(json(r1)));
    expect(json(r2).seq).toBe(s0.seq + 1);
    expect(text(await getSheet(id)).match(/我喜歡你/g)).toHaveLength(1);
  });

  it('同一個 opId 同時送兩個請求：只寫一次', async () => {
    const id = await newLetter();
    const s0 = await getSheet(id);
    const opId = randomUUID();
    const rs = await Promise.all([0, 1].map(() => t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '同時', sheetId: s0.id, opId })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(text(await getSheet(id))).toBe('同時');
  });

  it('opId 格式不對 400', async () => {
    const id = await newLetter();
    expect((await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: 'x', opId: 'abc' })).statusCode).toBe(400);
  });
});

describe('M1：換過信紙（謄抄）之後，舊分頁的字不會寫到新紙', () => {
  it('sheetId 不是目前的信紙：409 SHEET_CHANGED，新紙還是空的', async () => {
    const id = await draft(t, me, '第一版');
    const old = await getSheet(id);
    const L = json(await t.req('POST', `/letters/${id}/transcribe`, me));
    const r = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '舊分頁的字', seq: 0, sheetId: old.id });
    expect(r.statusCode).toBe(409);
    expect(json(r).error.code).toBe('SHEET_CHANGED');
    expect(json(r).error.details.sheetId).toBe(L.sheet.id);
    expect((await getSheet(id)).chars).toHaveLength(0);
  });
});

describe('M2：資料庫觸發器補強', () => {
  it('已寄出的信：sheet_ops 不能刪、sheets 不能改不能刪、信不能退回、不能 TRUNCATE', async () => {
    const id = await draft(t, me, '寄出去的內容');
    await sendLetter(t, me, id);
    const db = t.h.db;
    expect(await dbError(db.execute(sql.raw(`DELETE FROM sheet_ops WHERE sheet_id IN (SELECT id FROM sheets WHERE letter_id='${id}')`)))).toMatch(/append-only/);
    expect(await dbError(db.execute(sql.raw(`UPDATE sheets SET mode='hand' WHERE letter_id='${id}'`)))).toMatch(/already sent/);
    expect(await dbError(db.execute(sql.raw(`DELETE FROM sheets WHERE letter_id='${id}'`)))).toMatch(/already sent/);
    expect(await dbError(db.execute(sql.raw(`UPDATE letters SET status='drafting' WHERE id='${id}'`)))).toMatch(/cannot go back/);
    expect(await dbError(db.execute(sql.raw(`DELETE FROM letters WHERE id='${id}'`)))).toMatch(/already sent/);
    expect(await dbError(db.execute(sql`TRUNCATE sheet_ops`))).toMatch(/TRUNCATE/);
    expect(await dbError(db.execute(sql`TRUNCATE sheets CASCADE`))).toMatch(/TRUNCATE/);
    expect(await dbError(db.execute(sql`TRUNCATE letters CASCADE`))).toMatch(/TRUNCATE/);
    const n = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM sheet_ops so JOIN sheets s ON s.id = so.sheet_id WHERE s.letter_id = '${id}'`));
    expect((n as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(1);
    const L = json(await t.req('GET', `/letters/${id}`, me));
    expect(L.status).toBe('sent');
    expect(text(L.sheet)).toBe('寄出去的內容');
  });

  it('還沒寄出的信照常：謄抄、舊信紙丟垃圾桶、改信紙設定', async () => {
    const id = await draft(t, me, '草稿');
    const L = json(await t.req('POST', `/letters/${id}/transcribe`, me));
    expect((await t.req('POST', `/letters/${id}/refs/${L.refs[0].id}/discard`, me, { state: 'crumple', to: 'trash' })).statusCode).toBe(200);
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: 'kai' })).statusCode).toBe(200);
  });

  it('明說要清空時（維運、測試）可以 TRUNCATE', async () => {
    await expect(
      t.h.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('manxin.allow_truncate', 'on', true)`);
        await tx.execute(sql`TRUNCATE sheet_ops`);
      }),
    ).resolves.toBeUndefined();
  });
});
