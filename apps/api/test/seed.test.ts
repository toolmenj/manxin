/** 開發用範例資料可以建立，且重跑不重複 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed } from '../src/db/seed.ts';
import { makeApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

it('建立範例資料，送達信與「想寄出了嗎」都會寄出；第二次略過', async () => {
  const r = await seed(t.h.db, t.app.ctx.cfg);
  expect(r.created).toBe(true);
  const subjects = (await t.outbox()).map((m) => m.subject);
  expect(subjects).toContain('【慢信】有人給你寄了一封信');
  expect(subjects).toContain('之前寫的那封信現在想寄出了嗎？');
  expect((await seed(t.h.db, t.app.ctx.cfg)).created).toBe(false);
});
