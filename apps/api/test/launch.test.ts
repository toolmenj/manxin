/**
 * 上線前的安全底線與正式環境功能：
 * 設定檢查（H4、H5）、上傳檔頭判斷（H3）、頻率限制（H9）、跨站請求、log 遮連結（M12）、
 * 收件匣（D-024、D-025、H6）、開信連結綁瀏覽器（D-029）、outbox 寄信（H7）、檔案存資料庫（H8）。
 */
import { eq } from 'drizzle-orm';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, redactUrl } from '../src/app.ts';
import { ConfigError, loadConfig } from '../src/config.ts';
import { connectPglite } from '../src/db/client.ts';
import { blobs, emailOutbox, shipments } from '../src/db/schema.ts';
import { OutboxMailer, type MailTransport } from '../src/services/mailer.ts';
import { DbStorage, sniffImage } from '../src/services/storage.ts';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';
import { applyOp, applyOps } from '@manxin/engine';
import { asc } from 'drizzle-orm';
import { sheetOps, sheets as sheetsTable } from '../src/db/schema.ts';

const PROD_ENV = {
  NODE_ENV: 'production',
  APP_SECRET: 'a'.repeat(40) + 'b'.repeat(24),
  APP_URL: 'https://manxin.example.tw',
  DATABASE_URL: 'postgres://u:p@db:5432/manxin',
  SMTP_USER: 'manxin@gmail.com',
  SMTP_PASS: 'app-password',
  CONTACT_EMAIL: 'hello@manxin.example.tw',
} as NodeJS.ProcessEnv;

describe('設定檢查（H4、H5）', () => {
  it('NODE_ENV 沒設或拼錯一律當正式環境，缺必填就拒絕啟動', () => {
    for (const NODE_ENV of [undefined, 'staging', 'prod']) {
      expect(() => loadConfig({ NODE_ENV } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    }
    try {
      loadConfig({} as NodeJS.ProcessEnv);
    } catch (e) {
      const p = (e as ConfigError).problems.join('\n');
      expect(p).toMatch(/APP_SECRET/);
      expect(p).toMatch(/APP_URL/);
      expect(p).toMatch(/DATABASE_URL/);
      expect(p).toMatch(/SMTP_USER/);
    }
  });

  it('完整的正式設定可以啟動：開發路由關閉、預設 /api 前綴、資料庫存檔、worker 獨立', () => {
    const c = loadConfig(PROD_ENV);
    expect(c.isProd).toBe(true);
    expect(c.enableDevRoutes).toBe(false);
    expect(c.apiPrefix).toBe('/api');
    expect(c.storage).toBe('db');
    expect(c.mailer).toBe('smtp');
    expect(c.workerInline).toBe(false);
    expect(c.host).toBe('0.0.0.0');
    expect(c.devClockOffsetMs).toBe(0);
  });

  it('正式環境拒絕：範例密鑰、http 網址、開發路由、console 寄信、pglite、格式錯的數字', () => {
    const bad: [Partial<NodeJS.ProcessEnv>, RegExp][] = [
      [{ APP_SECRET: 'dev-only-secret-do-not-use-in-production' }, /範例值/],
      [{ APP_SECRET: 'short' }, /32/],
      [{ APP_URL: 'http://manxin.example.tw' }, /https/],
      [{ ENABLE_DEV_ROUTES: 'true' }, /ENABLE_DEV_ROUTES/],
      [{ MAILER: 'console' }, /console/],
      [{ DB_DRIVER: 'pglite' }, /pglite/],
      [{ PORT: 'abc' }, /PORT/],
      [{ STORAGE: 'disk' }, /STORAGE/],
    ];
    for (const [over, re] of bad) {
      expect(() => loadConfig({ ...PROD_ENV, ...over } as NodeJS.ProcessEnv), JSON.stringify(over)).toThrow(re);
    }
  });

  it('正式環境的 app：開發路由不存在、/api 底下才是 API', async () => {
    const h = await connectPglite();
    await h.migrate();
    const app = await buildApp({ cfg: loadConfig(PROD_ENV), db: h.db, logger: false, startWorker: false });
    for (const u of ['/api/dev/outbox', '/dev/outbox', '/api/dev/clock']) expect((await app.inject({ url: u })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/dev/clock', headers: { origin: 'https://manxin.example.tw' }, payload: { advanceMs: 1 } })).statusCode).toBe(404);
    expect(json(await app.inject({ url: '/api/time' })).offsetMs).toBeUndefined();
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200);
    const r = await app.inject({ url: '/api/me' });
    expect(r.statusCode).toBe(401);
    expect(r.headers['strict-transport-security']).toMatch(/max-age/);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
    await h.close();
  });

  it('正式環境由同一個程序提供網頁：前端網址回 index.html（含 CSP），API 404 還是 JSON', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'manxin-web-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>慢信</title>');
    const h = await connectPglite();
    await h.migrate();
    const app = await buildApp({ cfg: { ...loadConfig(PROD_ENV), webDir: dir }, db: h.db, logger: false, startWorker: false });
    for (const u of ['/', '/desk', '/r/abcdefghijklmnopqrstuvwxyz', '/track/RR123456785TW']) {
      const r = await app.inject({ url: u });
      expect(r.statusCode, u).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/html/);
      expect(r.headers['content-security-policy']).toMatch(/default-src 'self'/);
    }
    const nf = await app.inject({ url: '/api/nope' });
    expect(nf.statusCode).toBe(404);
    expect(json(nf).error.code).toBe('NOT_FOUND');
    expect((await app.inject({ url: '/missing.js' })).statusCode).toBe(404);
    await app.close();
    await h.close();
  });
});

describe('log 不留連結（M12）', () => {
  it('遮掉開信連結與登入 token', () => {
    expect(redactUrl('/r/abcDEF123_-xyz/open')).toBe('/r/***/open');
    expect(redactUrl('/api/r/abcDEF123_-xyz')).toBe('/api/r/***');
    expect(redactUrl('/login?token=secret&x=1')).toBe('/login?token=***&x=1');
  });
});

describe('上傳只收真的圖片（H3）', () => {
  it('依檔頭判斷，不相信副檔名；SVG 不收', () => {
    expect(sniffImage(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe('image/png');
    expect(sniffImage(Buffer.from('ffd8ffe000104a46', 'hex'))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });
});

describe('API 行為', () => {
  let t: TestApp;
  let me: string;
  beforeAll(async () => {
    t = await makeApp('2026-10-14T10:00');
    me = await t.login('zhe@example.com');
  });
  afterAll(() => t.close());

  const upload = (letterId: string, data: Buffer, mime: string, name: string) => {
    const boundary = '----manxin';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return t.app.inject({
      method: 'POST',
      url: `/letters/${letterId}/attachments`,
      headers: { cookie: me, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  };

  it('假裝成圖片的 SVG／HTML 上傳被拒；真的 PNG 存下來時用檔頭判斷的類型，讀取帶 nosniff 與 sandbox', async () => {
    const id = await draft(t, me, '附照片');
    const svg = await upload(id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png', 'a.png');
    expect(svg.statusCode).toBe(422);
    const html = await upload(id, Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg', 'a.jpg');
    expect(html.statusCode).toBe(422);
    const ok = await upload(id, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'image/svg+xml', 'a.svg');
    expect(ok.statusCode).toBe(201);
    expect(json(ok).mime).toBe('image/png');
    const r = await t.req('GET', `/attachments/${json(ok).id}`, me);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toMatch(/sandbox/);
  });

  it('跨站送來的狀態變更被擋（Origin、Sec-Fetch-Site），文字表單格式不收', async () => {
    const evil = await t.app.inject({ method: 'POST', url: '/letters', headers: { cookie: me, origin: 'https://evil.example' }, payload: {} });
    expect(evil.statusCode).toBe(403);
    const site = await t.app.inject({ method: 'POST', url: '/letters', headers: { cookie: me, 'sec-fetch-site': 'cross-site' }, payload: {} });
    expect(site.statusCode).toBe(403);
    const same = await t.app.inject({ method: 'POST', url: '/letters', headers: { cookie: me, origin: 'http://localhost:5173' }, payload: {} });
    expect(same.statusCode).toBe(201);
    const form = await t.app.inject({ method: 'POST', url: '/auth/magic-link', headers: { 'content-type': 'text/plain' }, payload: 'email=a@b.c' });
    expect(form.statusCode).toBe(415);
  });

  it('頻率限制：同一個信箱一小時最多 5 封登入信，第 6 封回 429 並帶 Retry-After', async () => {
    const t2 = await makeApp('2026-10-14T10:00', { rateLimit: true });
    try {
      const send = () => t2.req('POST', '/auth/magic-link', undefined, { email: 'flood@example.com' });
      for (let i = 0; i < 5; i++) expect((await send()).statusCode).toBe(202);
      const r = await send();
      expect(r.statusCode).toBe(429);
      expect(json(r).error.code).toBe('RATE_LIMITED');
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      // 別的信箱不受影響
      expect((await t2.req('POST', '/auth/magic-link', undefined, { email: 'other@example.com' })).statusCode).toBe(202);
      expect((await t2.outbox('flood@example.com')).length).toBe(5);
    } finally {
      await t2.close();
    }
  });

  /** 寄一封信並快轉到送達 */
  async function delivered(to = 'wen@example.org') {
    const id = await draft(t, me, '小雯：慢慢拆。');
    if (to !== 'wen@example.org') {
      await t.req('PATCH', `/letters/${id}`, me, { env: { toEmail: to } });
    }
    const no = await sendLetter(t, me, id);
    const s = (await t.h.db.select().from(shipments).where(eq(shipments.no, no)))[0]!;
    if (t.clock.now() < s.deliverAt.getTime()) t.setNow(s.deliverAt.getTime());
    await t.run();
    const m = (await t.outbox(to)).find((x) => (x.meta as { no: string }).no === no)!;
    return { no, token: (m.meta as { token: string }).token };
  }

  it('收件匣（D-024）：收件人登入就看得到已送達的信與開信連結；寄件人自己的收件匣沒有', async () => {
    const { no, token } = await delivered();
    const wen = await t.login('wen@example.org');
    const box = json(await t.req('GET', '/inbox', wen));
    const item = box.letters.find((l: { no: string }) => l.no === no);
    expect(item).toMatchObject({ no, fromName: '阿哲', signed: false, opened: false, link: `/r/${token}` });
    expect(box.unopened).toBeGreaterThanOrEqual(1);
    expect(json(await t.req('GET', '/inbox', me)).letters.find((l: { no: string }) => l.no === no)).toBeUndefined();
    expect((await t.req('GET', '/inbox')).statusCode).toBe(401);
  });

  it('開信連結綁第一台動手的瀏覽器（D-029）：轉寄出去的人只能看不能拆；收件人本人登入可以', async () => {
    const { token } = await delivered();
    const as = (browser: string, extra = '') =>
      ({ cookie: [`mx_rb=${browser}-000000000000000000000`, extra].filter(Boolean).join('; ') }) as Record<string, string>;
    expect((await t.app.inject({ method: 'POST', url: `/r/${token}/enter`, headers: as('first') })).statusCode).toBe(200);
    // 別台瀏覽器：看得到、動不了
    expect((await t.app.inject({ url: `/r/${token}`, headers: as('other') })).statusCode).toBe(200);
    const no = await t.app.inject({ method: 'POST', url: `/r/${token}/open`, headers: as('other'), payload: { method: 'knife' } });
    expect(no.statusCode).toBe(403);
    expect(json(no).error.details.reason).toBe('OTHER_BROWSER');
    // 收件人本人登入，在別台也可以
    const wen = await t.login('wen@example.org');
    const yes = await t.app.inject({ method: 'POST', url: `/r/${token}/open`, headers: as('other', wen), payload: { method: 'knife' } });
    expect(yes.statusCode).toBe(200);
    // 寄件人登入不算
    const zhe = await t.app.inject({ method: 'POST', url: `/r/${token}/pour`, headers: as('third', me) });
    expect(zhe.statusCode).toBe(403);
  });

  it('公開追蹤只顯示狀態（D-031）：沒有地區、郵局、信箱、簽收時間', async () => {
    const { no, token } = await delivered();
    await t.req('POST', `/r/${token}/enter`);
    await t.req('POST', `/r/${token}/open`, undefined, { method: 'knife' });
    const tr = json(await t.req('GET', `/track/${no}`));
    expect(tr.state).toBe('signed');
    expect(tr.office).toBe('');
    expect(tr.stops).toEqual([]);
    expect(tr.events.every((e: { pl: string }) => e.pl === '')).toBe(true);
    const s = JSON.stringify(tr);
    expect(s).not.toMatch(/臺北|臺南|@|已簽收/);
    // 寄件人登入看得到完整明細
    expect(json(await t.req('GET', `/shipments/${no}`, me)).stops.length).toBeGreaterThan(0);
  });

  it('管理頁：只有 ADMIN_EMAILS 看得到（別人一律 404），只有數字與狀態、看不到信件內容', async () => {
    const t3 = await makeApp('2026-10-14T10:00', { adminEmails: ['boss@example.com'] });
    try {
      const boss = await t3.login('boss@example.com');
      const zhe = await t3.login('zhe@example.com');
      expect(json(await t3.req('GET', '/me', boss)).admin).toBe(true);
      expect(json(await t3.req('GET', '/me', zhe)).admin).toBe(false);
      expect((await t3.req('GET', '/admin/stats', zhe)).statusCode).toBe(404);
      expect((await t3.req('GET', '/admin/stats')).statusCode).toBe(401);
      const id = await draft(t3, zhe, '這是秘密的內容');
      await sendLetter(t3, zhe, id);
      const st = json(await t3.req('GET', '/admin/stats', boss));
      expect(st.users.total).toBe(2);
      expect(st.shipments.total).toBe(1);
      expect(st.shipments.inTransit).toBe(1);
      expect(JSON.stringify(st)).not.toContain('秘密');
      const f = json(await t3.req('GET', '/admin/failures', boss));
      expect(f).toEqual({ jobs: [], mails: [] });
      expect((await t3.req('POST', '/admin/jobs/999/retry', boss)).statusCode).toBe(404);
    } finally {
      await t3.close();
    }
  });

  it('精簡回應（M5）：?delta=1 只回這一筆操作；前端逐筆套上去的結果跟伺服器整張讀回來一樣；重送回整張', async () => {
    const id = await draft(t, me, '開頭');
    let sh = json(await t.req('GET', `/letters/${id}`, me)).sheet;
    const paper = { kind: sh.kind, style: sh.style };
    const ops: [string, object][] = [
      ['chars', { text: '好久不見' }],
      ['moves', { at: [5, 0] }],
      ['chars', { text: '從第六行寫起' }],
      ['marks', { at: [0, 1], tool: 'x' }],
    ];
    let local = { chars: sh.chars, strokes: sh.strokes, scan: sh.scan, cursor: sh.cursor };
    let seq = sh.seq;
    let lastBody = 0;
    for (const [kind, body] of ops) {
      const r = await t.req('POST', `/letters/${id}/sheet/${kind}?delta=1`, me, { ...body, seq, sheetId: sh.id, opId: crypto.randomUUID() });
      expect(r.statusCode, r.body).toBe(201);
      const d = json(r);
      expect(d.delta).toBe(true);
      expect(d.seq).toBe(seq + 1);
      expect(d.chars).toBeUndefined();
      lastBody = r.body.length;
      local = applyOp(local, d.op, paper);
      seq = d.seq;
    }
    expect(lastBody).toBeLessThan(300);
    sh = json(await t.req('GET', `/letters/${id}`, me)).sheet;
    expect(sh.seq).toBe(seq);
    expect({ chars: sh.chars, strokes: sh.strokes, scan: sh.scan, cursor: sh.cursor }).toEqual(local);
    // 同一個 opId 重送：不會寫兩次，回 200 與整張信紙
    const opId = crypto.randomUUID();
    await t.req('POST', `/letters/${id}/sheet/chars?delta=1`, me, { text: '再', seq, sheetId: sh.id, opId });
    const again = await t.req('POST', `/letters/${id}/sheet/chars?delta=1`, me, { text: '再', seq, sheetId: sh.id, opId });
    expect(again.statusCode).toBe(200);
    expect(json(again).chars.length).toBe(sh.chars.length + 1);
  });

  it('信紙快照（M5）：寫 120 筆之後，有快照讀出來的內容＝從頭重放', async () => {
    const id = await draft(t, me, '開頭');
    let sh = json(await t.req('GET', `/letters/${id}`, me)).sheet;
    for (let i = 0; i < 120; i++) {
      const r = await t.req('POST', `/letters/${id}/sheet/chars?delta=1`, me, { text: i % 17 === 16 ? '\n' : '字', seq: sh.seq, sheetId: sh.id });
      expect(r.statusCode, r.body).toBe(201);
      sh = { ...sh, seq: json(r).seq };
    }
    const row = (await t.h.db.select().from(sheetsTable).where(eq(sheetsTable.id, sh.id)))[0]!;
    expect(row.snapshotSeq).toBeGreaterThanOrEqual(100);
    const ops = await t.h.db.select().from(sheetOps).where(eq(sheetOps.sheetId, sh.id)).orderBy(asc(sheetOps.seq));
    const full = applyOps(ops.map((o) => o.op as never), { kind: row.kind as never, style: row.style as never });
    const got = json(await t.req('GET', `/letters/${id}`, me)).sheet;
    expect(got.seq).toBe(ops.length);
    expect({ chars: got.chars, strokes: got.strokes, scan: got.scan, cursor: got.cursor }).toEqual(full);
  });

  it('收藏重看（D-025）：收進收藏的信登入就拿得到開信連結；別人拿不到', async () => {
    const { no, token } = await delivered();
    for (const a of ['enter', 'open', 'pour', 'unfold', 'collect']) {
      const r = await t.req('POST', `/r/${token}/${a}`, undefined, a === 'open' ? { method: 'knife' } : undefined);
      expect(r.statusCode, a).toBe(200);
    }
    const wen = await t.login('wen@example.org');
    expect(json(await t.req('GET', `/collection/${no}`, wen)).link).toBe(`/r/${token}`);
    expect((await t.req('GET', `/collection/${no}`, me)).statusCode).toBe(404);
  });
});

describe('寄信 outbox（H7）', () => {
  it('交易裡只排入；flush 才寄出，寄出後清掉內文；同一個 key 不重排；失敗退避重試', async () => {
    const h = await connectPglite();
    await h.migrate();
    const sent: string[] = [];
    let failNext = false;
    const transport: MailTransport = {
      async deliver(m) {
        if (failNext) {
          failNext = false;
          throw new Error('smtp down');
        }
        sent.push(`${m.to}|${m.subject}`);
      },
    };
    const log = { info() {}, warn() {}, error() {} };
    const mailer = new OutboxMailer(transport, log);
    const now = Date.parse('2026-10-14T02:00:00Z');
    expect(await mailer.send({ to: 'a@x.tw', subject: 's1', text: 'link /r/secret', idempotencyKey: 'k1' }, h.db, now)).toBe(true);
    expect(await mailer.send({ to: 'a@x.tw', subject: 's1', text: 'link /r/secret', idempotencyKey: 'k1' }, h.db, now)).toBe(false);
    expect(sent).toHaveLength(0);
    expect(await mailer.flush(h.db, now)).toBe(1);
    expect(sent).toEqual(['a@x.tw|s1']);
    const row = (await h.db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, 'k1')))[0]!;
    expect(row.status).toBe('sent');
    expect(row.text).toBeNull();
    // 再 flush 不會重寄
    expect(await mailer.flush(h.db, now + 1000)).toBe(0);

    await mailer.send({ to: 'b@x.tw', subject: 's2', text: 't', idempotencyKey: 'k2' }, h.db, now);
    failNext = true;
    expect(await mailer.flush(h.db, now)).toBe(0);
    const r2 = (await h.db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, 'k2')))[0]!;
    expect(r2.status).toBe('pending');
    expect(r2.attempts).toBe(1);
    expect(r2.lastError).toMatch(/smtp down/);
    // 退避時間還沒到不會重試；到了就寄出
    expect(await mailer.flush(h.db, now + 30_000)).toBe(0);
    expect(await mailer.flush(h.db, now + 3 * 60_000)).toBe(1);
    expect(sent).toContain('b@x.tw|s2');
    expect(await mailer.stats(h.db)).toEqual({});
    await h.close();
  });
});

describe('檔案存資料庫（H8）', () => {
  it('和資料同一個交易：交易失敗就不會留下檔案；讀不到回 null', async () => {
    const h = await connectPglite();
    await h.migrate();
    const st = new DbStorage();
    const key = await st.put('abc', Buffer.from('hello'), h.db, Date.now());
    expect((await st.read(key, h.db))!.toString()).toBe('hello');
    await expect(
      h.db.transaction(async (tx) => {
        await st.put('rollback', Buffer.from('x'), tx, Date.now());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await h.db.select().from(blobs).where(eq(blobs.key, 'db:rollback'))).toHaveLength(0);
    expect(await st.read('db:nope', h.db)).toBeNull();
    await h.close();
  });
});
