/**
 * 防騷擾（上限、封鎖、檢舉、停權）、刪除帳號、偏好跟著帳號（D-034）、刪字型（D-036）、
 * 容量配額（M13）、櫃台防重送與其他審查低優先項目。
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shipments, users } from '../src/db/schema.ts';
import { cleanName } from '../src/services/mails.ts';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';

/** 寄一封信給 to，快轉到送達並跑排程；回傳單號與（沒被封鎖時的）開信 token */
async function deliver(t: TestApp, cookie: string, to = 'wen@example.org', text = '你好') {
  const id = await draft(t, cookie, text);
  if (to !== 'wen@example.org') expect((await t.req('PATCH', `/letters/${id}`, cookie, { env: { toEmail: to } })).statusCode).toBe(200);
  const no = await sendLetter(t, cookie, id);
  const s = (await t.h.db.select().from(shipments).where(eq(shipments.no, no)))[0]!;
  if (t.clock.now() < s.deliverAt.getTime()) t.setNow(s.deliverAt.getTime());
  await t.run();
  const m = (await t.outbox(to)).find((x) => (x.meta as { no?: string }).no === no);
  return { no, id, token: m ? (m.meta as { token: string }).token : null };
}

describe('寄信上限', () => {
  it('每人 24 小時最多 5 封、同一個收件人 1 封；過了 24 小時又可以寄', async () => {
    const t = await makeApp('2026-10-14T10:00', { sendLimit: { perDay: 5, perRecipient: 1 } });
    try {
      const me = await t.login('zhe@example.com');
      await sendLetter(t, me, await draft(t, me, '第一封'));
      // 同一個收件人第二封：擋
      const id2 = await draft(t, me, '第二封');
      const e = await sendLetter(t, me, id2).catch((x: Error) => x.message);
      expect(e).toMatch(/SAME_RECIPIENT/);
      // 換不同收件人可以，寄到第 5 封為止
      for (let i = 2; i <= 5; i++) {
        const id = await draft(t, me, `第${i}封`);
        await t.req('PATCH', `/letters/${id}`, me, { env: { toEmail: `r${i}@example.org` } });
        await sendLetter(t, me, id);
      }
      const id6 = await draft(t, me, '第六封');
      await t.req('PATCH', `/letters/${id6}`, me, { env: { toEmail: 'r6@example.org' } });
      expect(await sendLetter(t, me, id6).catch((x: Error) => x.message)).toMatch(/DAILY_LIMIT/);
      t.advance(25 * 3600_000);
      // 第六封的行程已經結束（投不出去還在郵局裡），重新走一次
      const id7 = await draft(t, me, '隔天');
      await t.req('PATCH', `/letters/${id7}`, me, { env: { toEmail: 'r7@example.org' } });
      expect(await sendLetter(t, me, id7)).toMatch(/^RR/);
    } finally {
      await t.close();
    }
  });
});

describe('封鎖、檢舉、停權', () => {
  let t: TestApp;
  let zhe: string;
  let boss: string;
  beforeAll(async () => {
    t = await makeApp('2026-10-14T10:00', { adminEmails: ['boss@example.com'] });
    zhe = await t.login('zhe@example.com');
    boss = await t.login('boss@example.com');
  });
  afterAll(() => t.close());

  it('收件人封鎖後，同一個人再寄來的信不會送到（不寄通知、不進收件匣），寄件人那邊看不出來', async () => {
    const first = await deliver(t, zhe);
    const r0 = await t.req('POST', `/r/${first.token}/enter`);
    expect(r0.statusCode).toBe(200);
    expect((await t.req('POST', `/r/${first.token}/block`)).statusCode).toBe(200);
    const wen = await t.login('wen@example.org');
    const bl = json(await t.req('GET', '/blocks', wen)).blocks;
    expect(bl).toHaveLength(1);
    expect(bl[0].senderName).toBe('阿哲');

    t.advance(2 * 86400_000);
    const second = await deliver(t, zhe, 'wen@example.org', '又是我');
    expect(second.token).toBeNull();
    const box = json(await t.req('GET', '/inbox', wen)).letters.map((l: { no: string }) => l.no);
    expect(box).toContain(first.no);
    expect(box).not.toContain(second.no);
    // 寄件人看到的跟一般未簽收一樣
    const mine = json(await t.req('GET', `/shipments/${second.no}`, zhe));
    expect(['transit', 'waiting']).toContain(mine.state);

    // 解除封鎖之後，新的信又會送到
    expect((await t.req('DELETE', `/blocks/${bl[0].id}`, wen)).statusCode).toBe(200);
    t.advance(2 * 86400_000);
    const third = await deliver(t, zhe, 'wen@example.org', '第三封');
    expect(third.token).not.toBeNull();
  });

  it('不是收件人本人不能封鎖或檢舉', async () => {
    const d = await deliver(t, zhe, 'mei@example.org');
    await t.req('POST', `/r/${d.token}/enter`);
    const other = await t.app.inject({ method: 'POST', url: `/r/${d.token}/block`, headers: { cookie: 'mx_rb=another-browser-00000000000000' } });
    expect(other.statusCode).toBe(403);
  });

  it('檢舉 → 管理員只看到理由與遮掉的信箱 → 停權後不能再寄；解除停權又可以', async () => {
    const d = await deliver(t, zhe, 'lin@example.org', '這是秘密的內容');
    await t.req('POST', `/r/${d.token}/enter`);
    expect((await t.req('POST', `/r/${d.token}/report`, undefined, { reason: 'harass', note: '一直寄來', block: true })).statusCode).toBe(200);
    const list = json(await t.req('GET', '/admin/reports', boss)).reports;
    const rep = list.find((r: { no: string }) => r.no === d.no);
    expect(rep).toMatchObject({ reason: 'harass', note: '一直寄來', status: 'open' });
    expect(rep.sender.email).toBe('z***@example.com');
    expect(JSON.stringify(list)).not.toContain('秘密');
    expect((await t.req('GET', '/admin/reports', zhe)).statusCode).toBe(404);

    expect((await t.req('POST', `/admin/users/${rep.sender.id}/suspend`, boss)).statusCode).toBe(200);
    expect(json(await t.req('GET', '/admin/reports', boss)).reports.find((r: { no: string }) => r.no === d.no).status).toBe('suspended');
    expect(json(await t.req('GET', '/admin/stats', boss)).users.suspended).toBe(1);
    t.advance(2 * 86400_000);
    const id = await draft(t, zhe, '停權中');
    await t.req('PATCH', `/letters/${id}`, zhe, { env: { toEmail: 'x@example.org' } });
    expect(await sendLetter(t, zhe, id).catch((x: Error) => x.message)).toMatch(/SUSPENDED/);
    expect((await t.req('POST', `/admin/users/${rep.sender.id}/unsuspend`, boss)).statusCode).toBe(200);
  });
});

describe('刪除帳號（寄出的信留給收件人）', () => {
  it('草稿、字型、偏好、登入都刪掉；寄出的信收件人還打得開，但寄件人信箱拿掉；同一個信箱可以重新註冊', async () => {
    const t = await makeApp('2026-10-14T10:00');
    try {
      const me = await t.login('zhe@example.com');
      const sent = await deliver(t, me);
      const draftId = await draft(t, me, '還沒寄的');
      await t.req('PUT', '/me/prefs', me, { prefs: { era: 'minguo' } });
      // 確認信箱打錯不會刪
      expect((await t.req('DELETE', '/me', me, { confirmEmail: 'wrong@example.com' })).statusCode).toBe(422);
      expect((await t.req('DELETE', '/me', me, { confirmEmail: 'ZHE@example.com' })).statusCode).toBe(204);
      expect((await t.req('GET', '/me', me)).statusCode).toBe(401);
      // 收件人照樣打得開
      expect((await t.req('GET', `/r/${sent.token}`)).statusCode).toBe(200);
      expect(((await t.h.db.select().from(shipments).where(eq(shipments.no, sent.no)))[0]!.env as { fromEmail: string }).fromEmail).toBe('');
      const u = (await t.h.db.select().from(users).where(eq(users.email, 'zhe@example.com')))[0];
      expect(u).toBeUndefined();
      // 重新註冊是新帳號，看不到舊草稿
      const again = await t.login('zhe@example.com');
      expect((await t.req('GET', `/letters/${draftId}`, again)).statusCode).toBe(404);
      expect(json(await t.req('GET', '/me/prefs', again)).prefs).toBeNull();
      // 30 天後退信不會寄到空信箱
      t.advance(40 * 86400_000);
      const res = await t.run();
      expect(res.every((r) => !r.result.startsWith('error'))).toBe(true);
    } finally {
      await t.close();
    }
  });
});

describe('帳號：偏好、登出所有裝置', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp('2026-10-14T10:00');
  });
  afterAll(() => t.close());

  it('偏好存在帳號上，換裝置（新的登入）也拿得到；太大的拒絕', async () => {
    const a = await t.login('p@example.com');
    expect(json(await t.req('GET', '/me/prefs', a)).prefs).toBeNull();
    await t.req('PUT', '/me/prefs', a, { prefs: { era: 'map', desk: 'school' } });
    const b = await t.login('p@example.com');
    expect(json(await t.req('GET', '/me/prefs', b)).prefs).toEqual({ era: 'map', desk: 'school' });
    expect((await t.req('PUT', '/me/prefs', a, { prefs: { x: 'y'.repeat(5000) } })).statusCode).toBe(413);
  });

  it('登出所有裝置：每一個登入都失效', async () => {
    const a = await t.login('q@example.com');
    const b = await t.login('q@example.com');
    expect((await t.req('POST', '/auth/logout-all', a)).statusCode).toBe(204);
    expect((await t.req('GET', '/me', a)).statusCode).toBe(401);
    expect((await t.req('GET', '/me', b)).statusCode).toBe(401);
  });

  it('公開設定給聯絡信箱', async () => {
    const t2 = await makeApp('2026-10-14T10:00', { contactEmail: 'hi@manxin.tw' });
    expect(json(await t2.req('GET', '/public/config')).contactEmail).toBe('hi@manxin.tw');
    await t2.close();
  });
});

describe('字型、上傳、櫃台與其他', () => {
  let t: TestApp;
  let me: string;
  beforeAll(async () => {
    t = await makeApp('2026-10-14T10:00');
    me = await t.login('zhe@example.com');
  });
  afterAll(() => t.close());

  const multipart = (name: string, data: Buffer, type: string) => {
    const boundary = '----manxin';
    return {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    };
  };
  const font = () => Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(60)]);

  it('內建字型只收清單裡的', async () => {
    const id = await draft(t, me, '字型');
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: 'comic-sans' })).statusCode).toBe(422);
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: 'ming' })).statusCode).toBe(200);
  });

  it('D-036：沒用到的字型可以刪；有信紙用到就不能刪', async () => {
    const up = async () => {
      const m = multipart('a.ttf', font(), 'font/ttf');
      return json(await t.app.inject({ method: 'POST', url: '/fonts', headers: { cookie: me, ...m.headers }, payload: m.payload }));
    };
    const unused = await up();
    const used = await up();
    const id = await draft(t, me, '用字型');
    expect((await t.req('PATCH', `/letters/${id}/sheet`, me, { font: used.font })).statusCode).toBe(200);
    expect((await t.req('DELETE', `/fonts/${used.id}`, me)).statusCode).toBe(409);
    expect((await t.req('DELETE', `/fonts/${unused.id}`, me)).statusCode).toBe(200);
    expect(json(await t.req('GET', '/fonts', me)).fonts.map((f: { id: string }) => f.id)).not.toContain(unused.id);
  });

  it('M13：一封信最多 20 個附件', async () => {
    const id = await draft(t, me, '很多附件');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    for (let i = 0; i < 20; i++) {
      const m = multipart(`${i}.png`, png, 'image/png');
      expect((await t.app.inject({ method: 'POST', url: `/letters/${id}/attachments`, headers: { cookie: me, ...m.headers }, payload: m.payload })).statusCode).toBe(201);
    }
    const m = multipart('x.png', png, 'image/png');
    const r = await t.app.inject({ method: 'POST', url: `/letters/${id}/attachments`, headers: { cookie: me, ...m.headers }, payload: m.payload });
    expect(r.statusCode).toBe(409);
    expect(json(r).error.details.reason).toBe('TOO_MANY_FILES');
  });

  it('櫃台防重送：同一個 opId 寫信封、摺信都只算一次', async () => {
    const id = await draft(t, me, '摺一次就好');
    await t.req('POST', `/letters/${id}/trip`, me, { place: 'box', mode: 'walk', box: 'green' });
    t.advance(10 * 60_000);
    await t.req('POST', `/letters/${id}/trip/enter`, me);
    const opId = crypto.randomUUID();
    const f1 = json(await t.req('POST', `/letters/${id}/counter/folds`, me, { edge: 'b', at: (1.414 * 2) / 3, opId }));
    const f2 = json(await t.req('POST', `/letters/${id}/counter/folds`, me, { edge: 'b', at: (1.414 * 2) / 3, opId }));
    expect(f1.folds).toHaveLength(1);
    expect(f2.folds).toHaveLength(1);
    const e = crypto.randomUUID();
    await t.req('POST', `/letters/${id}/counter/envelope-text`, me, { zone: 'to', text: '小雯', opId: e });
    const again = json(await t.req('POST', `/letters/${id}/counter/envelope-text`, me, { zone: 'to', text: '小雯', opId: e }));
    expect(JSON.stringify(again)).not.toContain('小雯小雯');
  });

  it('通知信裡的寄件人名稱：拿掉網址、換行與尖括號，限制長度', () => {
    expect(cleanName('阿哲\n請點 https://evil.example/x 領獎')).toBe('阿哲 請點 領獎');
    expect(cleanName('<b>www.evil.tw</b>')).toBe('b');
    expect(cleanName('長'.repeat(50))).toHaveLength(30);
  });
});
