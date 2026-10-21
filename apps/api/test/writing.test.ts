/** 落子無悔：書寫只接受追加，伺服器端與資料庫端都要成立 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';

let t: TestApp;
let me: string;
let other: string;

beforeAll(async () => {
  t = await makeApp();
  me = await t.login('zhe@example.com');
  other = await t.login('someone@example.net');
});
afterAll(() => t.close());

/** drizzle 會把資料庫錯誤包一層，真正的訊息在 cause */
async function dbError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return String((e as { cause?: Error }).cause?.message ?? (e as Error).message);
  }
  return 'no error';
}

const text = (L: { sheet: { chars: { c: string }[] } }) => L.sheet.chars.map((c) => c.c).join('');

describe('書寫端點只有追加', () => {
  it('追加字、追加塗改、內容一路累積', async () => {
    const id = await draft(t, me, '那年');
    let r = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '我只是不敢' });
    expect(r.statusCode).toBe(201);
    r = await t.req('POST', `/letters/${id}/sheet/marks`, me, { from: 2, to: 6, tool: 's1' });
    expect(r.statusCode).toBe(201);
    const L = json(await t.req('GET', `/letters/${id}`, me));
    expect(text(L)).toBe('那年我只是不敢');
    expect(L.sheet.chars[2].m[0].t).toBe('s1');
    expect(L.sheet.seq).toBe(3);
  });

  it.each([
    ['PUT', '/sheet/chars'],
    ['PATCH', '/sheet/chars'],
    ['DELETE', '/sheet/chars'],
    ['DELETE', '/sheet/chars/0'],
    ['DELETE', '/sheet/marks/0'],
    ['DELETE', '/sheet/strokes/0'],
    ['PUT', '/sheet'],
    ['DELETE', '/sheet'],
    ['DELETE', ''],
    ['POST', '/sheet/undo'],
    ['POST', '/sheet/erase'],
    ['POST', '/sheet/paste'],
    ['DELETE', '/sheet/moves'],
    ['PUT', '/sheet/moves'],
    ['POST', '/sheet/overstrike'],
  ])('%s /letters/:id%s 不存在（404），內容不變', async (method, suffix) => {
    const id = await draft(t, me, '落子無悔');
    const r = await t.req(method, `/letters/${id}${suffix}`, me, method === 'DELETE' ? undefined : { text: 'x', chars: [] });
    expect(r.statusCode).toBe(404);
    expect(text(json(await t.req('GET', `/letters/${id}`, me)))).toBe('落子無悔');
  });

  it('信紙設定端點不能夾帶內容（多餘欄位 400）', async () => {
    const id = await draft(t, me, '原文');
    for (const body of [{ chars: [] }, { font: 'kai', chars: [{ c: 'x', m: [] }] }, { strokes: [] }, { text: '' }]) {
      const r = await t.req('PATCH', `/letters/${id}/sheet`, me, body);
      expect(r.statusCode).toBe(400);
    }
    const r = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: 'x', replace: true });
    expect(r.statusCode).toBe(400);
    expect(text(json(await t.req('GET', `/letters/${id}`, me)))).toBe('原文');
  });

  it('塗改超出範圍、只塗到換行、打字模式畫筆畫都拒絕', async () => {
    const id = await draft(t, me, 'a\nb');
    expect((await t.req('POST', `/letters/${id}/sheet/marks`, me, { from: 0, to: 9, tool: 'x' })).statusCode).toBe(422);
    expect((await t.req('POST', `/letters/${id}/sheet/marks`, me, { from: 1, to: 1, tool: 'x' })).statusCode).toBe(422);
    expect((await t.req('POST', `/letters/${id}/sheet/marks`, me, { from: 0, to: 0, tool: 'eraser' })).statusCode).toBe(400);
    const s = await t.req('POST', `/letters/${id}/sheet/strokes`, me, { stroke: { pen: 'ball', color: '#000000', pts: [[0.1, 0.1, 0.5]] } });
    expect(s.statusCode).toBe(422);
    expect(json(s).error.details.reason).toBe('WRONG_MODE');
  });

  it('手寫模式追加筆畫', async () => {
    const id = await draft(t, me, '先打字');
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { mode: 'hand' })).statusCode).toBe(200);
    const r = await t.req('POST', `/letters/${id}/sheet/strokes`, me, { stroke: { pen: 'fountain', color: '#1F2F4F', pts: [[0.1, 0.1, 0.5], [0.2, 0.15, 0.6]] } });
    expect(r.statusCode).toBe(201);
    expect(json(r).strokes).toHaveLength(1);
    expect(json(r).chars).toHaveLength(3);
  });

  it('已落筆的紙不能換紙種或樣式', async () => {
    const id = await draft(t, me, '寫了');
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { style: 'grid' })).statusCode).toBe(409);
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { kind: 'postcard' })).statusCode).toBe(409);
  });

  it('seq 樂觀鎖：重送不會重複追加', async () => {
    const id = await draft(t, me, '一');
    const r1 = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '二', seq: 1 });
    expect(r1.statusCode).toBe(201);
    const r2 = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '二', seq: 1 });
    expect(r2.statusCode).toBe(409);
    expect(json(r2).error.code).toBe('SEQ_CONFLICT');
    expect(text(json(await t.req('GET', `/letters/${id}`, me)))).toBe('一二');
  });

  it('別人的信看不到也寫不進去', async () => {
    const id = await draft(t, me, '私信');
    expect((await t.req('GET', `/letters/${id}`, other)).statusCode).toBe(404);
    expect((await t.req('POST', `/letters/${id}/sheet/chars`, other, { text: 'x' })).statusCode).toBe(404);
    expect((await t.req('GET', `/letters/${id}`)).statusCode).toBe(401);
  });
});

describe('資料庫層也擋：sheet_ops 只能 INSERT', () => {
  it('UPDATE、單獨 DELETE 都會被觸發器擋下', async () => {
    const id = await draft(t, me, '刻在紙上');
    const db = t.h.db;
    expect(await dbError(db.execute(sql`UPDATE sheet_ops SET op = '{"kind":"chars","text":"改"}' WHERE seq = 0`))).toMatch(/append-only/);
    expect(await dbError(db.execute(sql`DELETE FROM sheet_ops`))).toMatch(/append-only/);
    await expect(db.execute(sql`UPDATE envelope_ops SET zone = 'to'`)).resolves.toBeDefined(); // 沒有列時不觸發
    expect(text(json(await t.req('GET', `/letters/${id}`, me)))).toBe('刻在紙上');
  });
});

describe('謄抄與舊信紙', () => {
  it('謄抄：舊紙移到桌邊，新紙同設定、空白；舊紙處理完才能出門', async () => {
    const id = await draft(t, me, '第一版');
    let L = json(await t.req('POST', `/letters/${id}/transcribe`, me));
    expect(L.refs).toHaveLength(1);
    expect(L.sheet.chars).toHaveLength(0);
    expect(L.sheet.font).toBe(L.refs[0].font);
    // 空白不用謄
    expect((await t.req('POST', `/letters/${id}/transcribe`, me)).statusCode).toBe(409);
    await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '第二版' });
    L = json(await t.req('POST', `/letters/${id}/transcribe`, me));
    expect(L.refs).toHaveLength(2);
    const trip = await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'walk', box: 'green' });
    expect(trip.statusCode).toBe(409);
    expect(json(trip).error.code).toBe('REFS_PENDING');

    // 一張揉成團送字紙冢，一張丟垃圾桶
    const [a, b] = L.refs;
    L = json(await t.req('POST', `/letters/${id}/refs/${a.id}/discard`, me, { state: 'crumple', to: 'tomb' }));
    L = json(await t.req('POST', `/letters/${id}/refs/${b.id}/discard`, me, { state: 'fold', to: 'trash' }));
    expect(L.refs).toHaveLength(0);
    const tomb = json(await t.req('GET', '/tomb', me));
    const kept = tomb.sheets.find((x: { sheet: { id: string } }) => x.sheet.id === a.id);
    expect(kept.state).toBe('crumple');
    expect(kept.sheet.chars.map((c: { c: string }) => c.c).join('')).toBe('第一版');
    // 垃圾桶是真的刪除（連同內容）
    const left = await t.h.db.execute(sql`SELECT count(*)::int AS n FROM sheet_ops WHERE sheet_id = ${b.id}`);
    expect((left as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(0);
    expect(tomb.sheets.some((x: { sheet: { id: string } }) => x.sheet.id === b.id)).toBe(false);
  });

  it('先放著：進抽屜後不能寫，拿出來才能繼續', async () => {
    const id = await draft(t, me, '想說的話');
    expect((await t.req('POST', `/letters/${id}/shelve`, me)).statusCode).toBe(200);
    expect((await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: 'x' })).statusCode).toBe(409);
    const tomb = json(await t.req('GET', '/tomb', me));
    expect(tomb.unsent.some((l: { id: string }) => l.id === id)).toBe(true);
    expect((await t.req('POST', `/letters/${id}/unshelve`, me)).statusCode).toBe(200);
    expect((await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '。' })).statusCode).toBe(201);
  });
});

describe('寄出後內容唯讀', () => {
  it('API 回 409，資料庫觸發器也擋', async () => {
    const id = await draft(t, me, '寄出去就收不回');
    await sendLetter(t, me, id);
    const r = await t.req('POST', `/letters/${id}/sheet/chars`, me, { text: '補一句' });
    expect(r.statusCode).toBe(409);
    expect(json(r).error.code).toBe('LETTER_LOCKED');
    const L = json(await t.req('GET', `/letters/${id}`, me));
    expect(
      await dbError(t.h.db.execute(sql`INSERT INTO sheet_ops (sheet_id, seq, op, created_at) VALUES (${L.sheet.id}, 99, '{"kind":"chars","text":"x"}', now())`)),
    ).toMatch(/already sent/);
  });
});

describe('附件（本機磁碟）', () => {
  it('上傳圖片、讀回、拿出來', async () => {
    const id = await draft(t, me, '附上一張照片');
    const boundary = '----manxin';
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await t.app.inject({
      method: 'POST',
      url: `/letters/${id}/attachments`,
      headers: { cookie: me, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(up.statusCode).toBe(201);
    const att = json(up);
    const get = await t.req('GET', `/attachments/${att.id}`, me);
    expect(get.statusCode).toBe(200);
    expect(get.rawPayload.equals(png)).toBe(true);
    expect((await t.req('GET', `/attachments/${att.id}`, other)).statusCode).toBe(404);
    let L = json(await t.req('GET', `/letters/${id}`, me));
    expect(L.attachments).toHaveLength(1);
    L = json(await t.req('POST', `/letters/${id}/attachments/${att.id}/take-out`, me));
    expect(L.attachments).toHaveLength(0);
  });
});
