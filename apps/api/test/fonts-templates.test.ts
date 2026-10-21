/** D-027 自訂字型存在後端、信紙圖樣範本庫、D-028 信封字型跟信紙一致 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shipments } from '../src/db/schema.ts';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';

let t: TestApp;
let me: string;
let other: string;
beforeAll(async () => {
  t = await makeApp('2026-10-14T10:00');
  me = await t.login('zhe@example.com');
  other = await t.login('someone@example.net');
});
afterAll(() => t.close());

/** 假字型：只有檔頭對，後面補零（伺服器只看 magic bytes） */
const fakeFont = (magic: string | number[], size = 64) => {
  const b = Buffer.alloc(size);
  (typeof magic === 'string' ? Buffer.from(magic, 'latin1') : Buffer.from(magic)).copy(b);
  return b;
};
const TTF = [0x00, 0x01, 0x00, 0x00];

function multipart(filename: string, data: Buffer, mime = 'application/octet-stream') {
  const boundary = '----manxinfont';
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function uploadFont(app: TestApp, cookie: string | undefined, filename: string, data: Buffer) {
  const m = multipart(filename, data);
  return app.app.inject({ method: 'POST', url: '/fonts', headers: { ...(cookie ? { cookie } : {}), ...m.headers }, payload: m.payload });
}

async function uploadBg(cookie: string, letterId: string) {
  const m = multipart('bg.png', Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png');
  return t.app.inject({ method: 'POST', url: `/letters/${letterId}/attachments?purpose=bg`, headers: { cookie, ...m.headers }, payload: m.payload });
}

/** 快轉到送達，回傳收件人的開信 token */
async function deliver(no: string): Promise<string> {
  const s = (await t.h.db.select().from(shipments).where(eq(shipments.no, no)))[0]!;
  if (t.clock.now() < s.deliverAt.getTime()) t.setNow(s.deliverAt.getTime());
  await t.run();
  const m = (await t.outbox('wen@example.org')).find((x) => (x.meta as { no: string }).no === no)!;
  return (m.meta as { token: string }).token;
}

describe('自訂字型（D-027）', () => {
  it('上傳 → 列出 → 讀檔；只有上傳者讀得到', async () => {
    expect((await uploadFont(t, undefined, 'a.ttf', fakeFont(TTF))).statusCode).toBe(401);
    const data = fakeFont(TTF, 200);
    const r = await uploadFont(t, me, '我的手寫體.ttf', data);
    expect(r.statusCode).toBe(201);
    const f = json(r);
    expect(f).toMatchObject({ name: '我的手寫體', format: 'ttf', size: 200, font: `f:${f.id}`, url: `/fonts/${f.id}` });

    const list = json(await t.req('GET', '/fonts', me)).fonts;
    expect(list.map((x: { id: string }) => x.id)).toContain(f.id);
    expect(json(await t.req('GET', '/fonts', other)).fonts).toHaveLength(0);

    const g = await t.req('GET', `/fonts/${f.id}`, me);
    expect(g.statusCode).toBe(200);
    expect(g.headers['content-type']).toBe('font/ttf');
    expect(g.rawPayload.equals(data)).toBe(true);
    expect((await t.req('GET', `/fonts/${f.id}`, other)).statusCode).toBe(404);
    expect((await t.req('GET', `/fonts/${f.id}`)).statusCode).toBe(401);
  });

  it.each([
    ['otf（CFF）', 'a.otf', 'OTTO', 'otf'],
    ['otf（TrueType 外框）', 'b.OTF', TTF, 'ttf'],
    ['woff', 'c.woff', 'wOFF', 'woff'],
    ['woff2', 'd.woff2', 'wOF2', 'woff2'],
    ['Mac 的 true', 'e.ttf', 'true', 'ttf'],
  ] as const)('接受 %s', async (_l, name, magic, fmt) => {
    const r = await uploadFont(t, me, name, fakeFont(magic as string));
    expect(r.statusCode).toBe(201);
    expect(json(r).format).toBe(fmt);
  });

  it.each([
    ['副檔名不對', 'a.txt', fakeFont(TTF), 'BAD_EXT'],
    ['沒有副檔名', 'font', fakeFont(TTF), 'BAD_EXT'],
    ['圖片改名成 ttf', 'a.ttf', Buffer.from('89504e470d0a1a0a0000000000000000', 'hex'), 'BAD_FONT'],
    ['副檔名和檔頭不合', 'a.woff2', fakeFont('wOFF'), 'BAD_FONT'],
    ['太短', 'a.ttf', Buffer.from(TTF), 'BAD_FONT'],
  ])('拒絕：%s（422）', async (_l, name, data, reason) => {
    const r = await uploadFont(t, me, name, data);
    expect(r.statusCode).toBe(422);
    expect(json(r).error.details.reason).toBe(reason);
  });

  it('大小上限另外設：比圖片上限大的字型收得下，超過 FONT_MAX_BYTES 回 413', async () => {
    const t2 = await makeApp('2026-10-14T10:00', { uploadMaxBytes: 1024, fontMaxBytes: 3 * 1024 * 1024 });
    try {
      const c = await t2.login('zhe@example.com');
      // 比 bodyLimit（2MB）與圖片上限都大
      const ok = await uploadFont(t2, c, 'big.ttf', fakeFont(TTF, 2.5 * 1024 * 1024));
      expect(ok.statusCode).toBe(201);
      const big = await uploadFont(t2, c, 'huge.ttf', fakeFont(TTF, 3 * 1024 * 1024 + 10));
      expect(big.statusCode).toBe(413);
      expect(json(await t2.req('GET', '/fonts', c)).fonts).toHaveLength(1);
    } finally {
      await t2.close();
    }
  });

  it('信紙選用自訂字型：存在信件資料裡，重新讀信還在；別人的字型不能用', async () => {
    const f = json(await uploadFont(t, me, 'hand.woff2', fakeFont('wOF2')));
    const id = await draft(t, me, '換個字型');
    const sh = json(await t.req('PATCH', `/letters/${id}/sheet`, me, { font: f.font }));
    expect(sh.font).toBe(f.font);
    expect(sh.fontUrl).toBe(`/fonts/${f.id}`);
    const L = json(await t.req('GET', `/letters/${id}`, me));
    expect(L.sheet.font).toBe(f.font);
    expect(L.sheet.fontUrl).toBe(`/fonts/${f.id}`);
    // 換回內建字型：fontUrl 是 null
    expect(json(await t.req('PATCH', `/letters/${id}/sheet`, me, { font: 'kai' })).fontUrl).toBeNull();

    const theirs = json(await uploadFont(t, other, 'x.ttf', fakeFont(TTF)));
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: theirs.font })).statusCode).toBe(422);
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: 'f:00000000-0000-4000-8000-000000000000' })).statusCode).toBe(422);
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: 'f:nope' })).statusCode).toBe(422);
    expect((await t.req('POST', '/letters', me, { font: theirs.font })).statusCode).toBe(422);
    const L2 = json(await t.req('POST', '/letters', me, { font: f.font }));
    expect(L2.sheet.fontUrl).toBe(`/fonts/${f.id}`);
  });
});

describe('信紙圖樣範本庫', () => {
  it('範本清單與 SVG 公開（不用登入），不引用外部資源', async () => {
    const list = json(await t.req('GET', '/paper-templates')).templates;
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list.length).toBeLessThanOrEqual(12);
    expect(new Set(list.map((x: { id: string }) => x.id)).size).toBe(list.length);
    for (const tp of list) {
      expect(tp.url).toBe(`/paper-templates/${tp.id}.svg`);
      expect(['80s', 'minguo']).toContain(tp.era);
      const r = await t.req('GET', tp.url);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/^image\/svg\+xml/);
      expect(r.body.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(r.body.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:|<script|<image|href=/i);
    }
    expect((await t.req('GET', '/paper-templates/nope.svg')).statusCode).toBe(404);
    expect((await t.req('GET', '/paper-templates/..%2Fx.svg')).statusCode).toBe(400);
  });

  it('信件指定範本：樣式變成 custom、和上傳的圖樣二選一、謄抄沿用', async () => {
    const L = json(await t.req('POST', '/letters', me, {}));
    let sh = json(await t.req('PATCH', `/letters/${L.id}/sheet`, me, { bgTemplate: 'huajian' }));
    expect(sh).toMatchObject({ style: 'custom', bgTemplate: 'huajian', bgAttachmentId: null });
    expect((await t.req('PATCH', `/letters/${L.id}/sheet`, me, { bgTemplate: 'nope' })).statusCode).toBe(422);
    expect((await t.req('PATCH', `/letters/${L.id}/sheet`, me, { bgTemplate: 'Bad Id' })).statusCode).toBe(400);

    // 改用上傳的圖樣 → 範本清掉
    const bg = json(await uploadBg(me, L.id));
    sh = json(await t.req('PATCH', `/letters/${L.id}/sheet`, me, { bgAttachmentId: bg.id }));
    expect(sh).toMatchObject({ style: 'custom', bgTemplate: null, bgAttachmentId: bg.id });
    expect((await t.req('PATCH', `/letters/${L.id}/sheet`, me, { bgAttachmentId: bg.id, bgTemplate: 'plum' })).statusCode).toBe(422);
    // 再換回範本 → 上傳的圖樣清掉
    sh = json(await t.req('PATCH', `/letters/${L.id}/sheet`, me, { bgTemplate: 'plum' }));
    expect(sh).toMatchObject({ style: 'custom', bgTemplate: 'plum', bgAttachmentId: null });

    await t.req('POST', `/letters/${L.id}/sheet/chars`, me, { text: '落筆' });
    const T = json(await t.req('POST', `/letters/${L.id}/transcribe`, me));
    expect(T.sheet).toMatchObject({ style: 'custom', bgTemplate: 'plum', chars: [] });
    expect(T.refs[0].bgTemplate).toBe('plum');
  });

  it('已落筆後鎖紙：範本也不能換、不能清掉（409 SHEET_NOT_EMPTY）；字型照樣可換', async () => {
    const id = await draft(t, me, '已經落筆');
    for (const b of [{ bgTemplate: 'waves' }, { bgTemplate: null }]) {
      const r = await t.req('PATCH', `/letters/${id}/sheet`, me, b);
      expect(r.statusCode).toBe(409);
      expect(json(r).error.code).toBe('SHEET_NOT_EMPTY');
    }
    expect(json(await t.req('GET', `/letters/${id}`, me)).sheet.bgTemplate).toBeNull();
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: 'ming' })).statusCode).toBe(200);
  });
});

describe('收信：字型與範本（D-028 信封字型跟信紙一致）', () => {
  it('自訂字型：信封 efont、信紙 fontUrl 都用開信連結讀得到，不用登入', async () => {
    const data = fakeFont('wOF2', 128);
    const f = json(await uploadFont(t, me, '鋼筆字.woff2', data));
    const id = await draft(t, me, '小雯：\n\n用我的字寫給你。');
    await t.req('PATCH', `/letters/${id}/sheet`, me, { font: f.font });
    const no = await sendLetter(t, me, id);
    const token = await deliver(no);

    const g = json(await t.req('GET', `/r/${token}`));
    expect(g.pkg.efont).toBe(f.font);
    expect(g.pkg.efontUrl).toBe(`/r/${token}/fonts/${f.id}`);
    // 信封還沒拆，信封上的字型就要載得到
    const ff = await t.req('GET', g.pkg.efontUrl);
    expect(ff.statusCode).toBe(200);
    expect(ff.headers['content-type']).toBe('font/woff2');
    expect(ff.rawPayload.equals(data)).toBe(true);

    await t.req('POST', `/r/${token}/enter`);
    await t.req('POST', `/r/${token}/open`, undefined, { method: 'knife' });
    await t.req('POST', `/r/${token}/pour`);
    const u = json(await t.req('POST', `/r/${token}/unfold`));
    expect(u.letter.sheet.font).toBe(f.font);
    expect(u.letter.sheet.fontUrl).toBe(`/r/${token}/fonts/${f.id}`);

    // 這封信沒用到的字型、別人的字型、亂打的 id：404
    const unused = json(await uploadFont(t, me, 'unused.ttf', fakeFont(TTF)));
    expect((await t.req('GET', `/r/${token}/fonts/${unused.id}`)).statusCode).toBe(404);
    expect((await t.req('GET', `/r/${token}/fonts/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(404);
    expect((await t.req('GET', `/r/${'x'.repeat(30)}/fonts/${f.id}`)).statusCode).toBe(404);
  });

  it('內建字型：efont 是信紙的字型，efontUrl 是 null；範本圖樣跟著信紙到收件人', async () => {
    const L = json(await t.req('POST', '/letters', me, {
      font: 'ming',
      env: { fromName: '阿哲', fromEmail: 'zhe@example.com', fromAddr: '臺北市大安區', toName: '小雯', toEmail: 'wen@example.org', toAddr: '臺南市東區' },
    }));
    await t.req('PATCH', `/letters/${L.id}/sheet`, me, { bgTemplate: 'bamboo' });
    await t.req('POST', `/letters/${L.id}/sheet/chars`, me, { text: '竹報平安' });
    const token = await deliver(await sendLetter(t, me, L.id));
    const g = json(await t.req('GET', `/r/${token}`));
    expect(g.pkg.efont).toBe('ming');
    expect(g.pkg.efontUrl).toBeNull();
    await t.req('POST', `/r/${token}/enter`);
    await t.req('POST', `/r/${token}/open`, undefined, { method: 'knife' });
    await t.req('POST', `/r/${token}/pour`);
    const u = json(await t.req('POST', `/r/${token}/unfold`));
    expect(u.letter.sheet).toMatchObject({ style: 'custom', bgTemplate: 'bamboo', fontUrl: null });
  });
});
