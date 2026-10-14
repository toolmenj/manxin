/** 排程：送達、24h／48h 提醒、改信箱、30 天退信、未寄出的信每 30 天詢問；重跑不重寄 */
import { D, H } from '@manxin/engine';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { scheduledJobs, shipments } from '../src/db/schema.ts';
import { enqueue } from '../src/services/jobs.ts';
import { draft, json, makeApp, sendLetter, type TestApp } from './helpers.ts';

let t: TestApp;
afterEach(() => t?.close());

const shipmentRow = async (no: string) => (await t.h.db.select().from(shipments).where(eq(shipments.no, no)))[0]!;
const tokenOf = (m: { meta: unknown }) => (m.meta as { token: string }).token;

async function setup() {
  t = await makeApp('2026-10-14T10:00');
  const me = await t.login('zhe@example.com');
  const id = await draft(t, me);
  const no = await sendLetter(t, me, id);
  const s = await shipmentRow(no);
  return { me, no, deliver: s.deliverAt.getTime(), sid: s.id };
}

describe('送達與冪等', () => {
  it('送達前不寄；送達時寄開信連結；重跑、重排、強制重跑都不會重寄', async () => {
    const { no, deliver, sid } = await setup();
    expect(await t.run()).toEqual([]);
    t.advance(deliver - t.clock.now() - 1);
    expect(await t.run()).toEqual([]);
    expect(await t.outbox('wen@example.org')).toHaveLength(0);

    t.advance(1);
    const r = await t.run();
    expect(r.map((x) => [x.kind, x.result])).toEqual([['deliver', 'sent']]);
    const mails = await t.outbox('wen@example.org');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe('【慢信】有人給你寄了一封信');
    expect(mails[0]!.text).toContain(`/r/${tokenOf(mails[0]!)}`);

    // 1. 再跑一次：沒有到期的工作
    expect(await t.run()).toEqual([]);
    // 2. 同一個 unique_key 再排一次：不會新增
    expect(await enqueue(t.h.db, { kind: 'deliver', uniqueKey: `deliver:${sid}:0`, refId: sid, runAt: deliver, payload: { seq: 0 }, now: t.clock.now() })).toBe(false);
    // 3. 硬把工作改回 pending 再跑（模擬 worker 當掉重來）：idempotency key 擋下，不重寄
    await t.h.db.update(scheduledJobs).set({ status: 'pending' }).where(eq(scheduledJobs.uniqueKey, `deliver:${sid}:0`));
    const again = await t.run();
    expect(again.map((x) => x.result)).toEqual(['skipped:already-sent']);
    expect(await t.outbox('wen@example.org')).toHaveLength(1);
    // 連結相同（決定性 token），仍然可以開
    expect((await t.req('GET', `/r/${tokenOf(mails[0]!)}`)).statusCode).toBe(200);
    expect(json(await t.req('GET', `/track/${no}`)).state).toBe('waiting');
  });
});

describe('24h／48h 提醒、改收件信箱、30 天退信', () => {
  it('完整走一遍', async () => {
    const { me, no, deliver, sid } = await setup();
    t.advance(deliver - t.clock.now());
    await t.run();
    const firstToken = tokenOf((await t.outbox('wen@example.org'))[0]!);

    // 未滿 24h 不能改
    let e = await t.req('POST', `/shipments/${no}/recipient-email`, me, { email: 'wen.new@example.org' });
    expect(json(e).error.code).toBe('NO_EDITS_LEFT');

    t.advance(D);
    let r = await t.run();
    expect(r.map((x) => [x.kind, x.result])).toEqual([['remind24', 'sent']]);
    const zhe = () => t.outbox('zhe@example.com');
    expect((await zhe()).at(-1)!.subject).toBe('24小時未簽收，請確認電子信箱是否正確');
    let s = json(await t.req('GET', `/shipments/${no}`, me));
    expect(s.editsLeft).toBe(1);

    // 改一次：舊連結立刻失效，改寄中
    e = await t.req('POST', `/shipments/${no}/recipient-email`, me, { email: 'wen.new@example.org' });
    expect(e.statusCode).toBe(200);
    expect(json(e).state).toBe('rerouting');
    expect(json(e).editsLeft).toBe(0);
    expect((await t.req('GET', `/r/${firstToken}`)).statusCode).toBe(404);
    expect(json(await t.req('POST', `/shipments/${no}/recipient-email`, me, { email: 'x@example.org' })).error.code).toBe('NO_EDITS_LEFT');

    // 重新投遞（時間由伺服器算：一小時後，推到上班時間）
    const reDeliver = json(e).curDeliver;
    expect(reDeliver).toBeGreaterThanOrEqual(t.clock.now() + H);
    t.setNow(reDeliver);
    r = await t.run();
    // 遇到週末，重新投遞可能晚於 48h，這時 48h 提醒會在同一輪一起跑
    expect(r.filter((x) => x.kind === 'deliver').map((x) => x.result)).toEqual(['sent']);
    const newMail = (await t.outbox('wen.new@example.org'))[0]!;
    expect((await t.req('GET', `/r/${tokenOf(newMail)}`)).statusCode).toBe(200);

    // 48h：第二次提醒，最後一次可改（D-005 暫定：從第一次送達起算）
    t.setNow(Math.max(deliver + 2 * D, t.clock.now()));
    await t.run();
    const j48 = (await t.h.db.select().from(scheduledJobs).where(eq(scheduledJobs.uniqueKey, `remind48:${sid}`)))[0]!;
    expect([j48.status, j48.result]).toEqual(['done', 'sent']);
    s = json(await t.req('GET', `/shipments/${no}`, me));
    expect(s.editsLeft).toBe(1);
    expect(s.events.some((x: { tx: string }) => x.tx.includes('48 小時'))).toBe(true);

    // 重跑不重寄
    expect(await t.run()).toEqual([]);
    expect((await zhe()).filter((m) => m.subject.includes('小時未簽收'))).toHaveLength(2);

    // 30 天：退信，附退件郵戳參數；連結失效（410 或 404）
    t.setNow(deliver + 30 * D);
    r = await t.run();
    expect(r.map((x) => [x.kind, x.result])).toEqual([['return30', 'sent']]);
    const ret = (await zhe()).at(-1)!;
    expect(ret.subject).toBe('你的信被退回了');
    const pm = (ret.meta as { postmark: { place: string; shape: number; color: string; date: string } }).postmark;
    expect(pm.place).toBe('臺南東區');
    expect(pm.date).toMatch(/^115\.\d\d\.\d\d$/);
    s = json(await t.req('GET', `/shipments/${no}`, me));
    expect(s.state).toBe('returned');
    expect(s.returnPostmark).toEqual(pm);
    expect((await t.req('GET', `/r/${tokenOf(newMail)}`)).statusCode).toBe(404);
    expect(json(await t.req('POST', `/shipments/${no}/recipient-email`, me, { email: 'y@example.org' })).error.code).toBe('RETURNED');
    expect(await t.run()).toEqual([]);
  });

  it('已簽收：不再提醒、不退信', async () => {
    const { no, deliver } = await setup();
    t.advance(deliver - t.clock.now());
    await t.run();
    const token = tokenOf((await t.outbox('wen@example.org'))[0]!);
    t.advance(3 * H);
    await t.req('POST', `/r/${token}/enter`);
    expect((await t.req('POST', `/r/${token}/open`, undefined, { method: 'knife' })).statusCode).toBe(200);

    t.advance(31 * D);
    const r = await t.run();
    expect(r.map((x) => [x.kind, x.result])).toEqual([
      ['remind24', 'skipped:signed'],
      ['remind48', 'skipped:signed'],
      ['return30', 'skipped:signed'],
    ]);
    expect(await t.outbox('zhe@example.com').then((m) => m.filter((x) => !x.subject.includes('登入')))).toHaveLength(0);
    expect(json(await t.req('GET', `/track/${no}`)).state).toBe('signed');
  });
});

describe('未寄出的信：每 30 天詢問', () => {
  it('30 天問一次、重跑不重問、再過 30 天再問；拿出來就不問了', async () => {
    t = await makeApp('2026-10-14T21:00');
    const me = await t.login('zhe@example.com');
    const id = await draft(t, me, '爸：\n\n上次吵完架……');
    await t.req('POST', `/letters/${id}/shelve`, me);
    const asks = async () => (await t.outbox('zhe@example.com')).filter((m) => m.subject === '之前寫的那封信現在想寄出了嗎？');

    t.advance(30 * D - 1);
    expect(await t.run()).toEqual([]);
    expect(json(await t.req('GET', `/letters/${id}`, me)).askDue).toBe(false);
    t.advance(1);
    expect(json(await t.req('GET', `/letters/${id}`, me)).askDue).toBe(true);
    expect((await t.run()).map((x) => x.result)).toEqual(['sent']);
    expect(await asks()).toHaveLength(1);
    expect((await asks())[0]!.text).toContain('已經放了 30 天');
    expect(await t.run()).toEqual([]);
    // 寄了詢問信，書桌上的「現在想寄出了嗎？」還是要出現，直到使用者按「再放 30 天」或拿出來
    expect(json(await t.req('GET', `/letters/${id}`, me)).askDue).toBe(true);

    t.advance(30 * D);
    expect((await t.run()).map((x) => x.result)).toEqual(['sent']);
    expect(await asks()).toHaveLength(2);

    await t.req('POST', `/letters/${id}/unshelve`, me);
    t.advance(30 * D);
    expect((await t.run()).map((x) => x.result)).toEqual(['skipped:not-shelved']);
    expect(await asks()).toHaveLength(2);
  });

  it('畫面上按「再放 30 天」：信箱那次順延', async () => {
    t = await makeApp('2026-10-14T21:00');
    const me = await t.login('zhe@example.com');
    const id = await draft(t, me);
    await t.req('POST', `/letters/${id}/shelve`, me);
    t.advance(20 * D);
    await t.req('POST', `/letters/${id}/ask-later`, me);
    expect(json(await t.req('GET', `/letters/${id}`, me)).askDue).toBe(false);
    t.advance(10 * D);
    expect((await t.run()).map((x) => x.result)).toEqual(['skipped:snoozed']);
    t.advance(20 * D);
    expect((await t.run()).map((x) => x.result)).toEqual(['sent']);
  });
});

describe('時區：伺服器跑在 UTC', () => {
  it('寄件排程時間用臺北時間計算', async () => {
    expect(new Date(0).getTimezoneOffset()).toBe(0);
    const { deliver } = await setup();
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hourCycle: 'h23' }).format(deliver));
    expect(h).toBeGreaterThanOrEqual(9);
    expect(h).toBeLessThan(18);
    const jobs = await t.h.db.execute(sql`SELECT kind FROM scheduled_jobs ORDER BY run_at`);
    expect((jobs as unknown as { rows: { kind: string }[] }).rows.map((r) => r.kind)).toEqual(['deliver', 'remind24', 'remind48', 'return30']);
  });
});
