import { taipei } from '@manxin/engine';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.ts';
import { Clock } from '../src/clock.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { connectPg, connectPglite, type DbHandle } from '../src/db/client.ts';
import { devOutbox } from '../src/db/schema.ts';
import { runDueJobs } from '../src/services/jobs.ts';

export interface TestApp {
  app: FastifyInstance;
  h: DbHandle;
  clock: Clock;
  /** 測試用時鐘的基準（臺北時間），之後用 advance 往前走 */
  advance(ms: number): void;
  setNow(at: string | number): void;
  run(): ReturnType<typeof runDueJobs>;
  login(email: string): Promise<string>;
  req(method: string, url: string, cookie?: string, body?: unknown): Promise<LightMyRequestResponse>;
  outbox(to?: string): Promise<(typeof devOutbox.$inferSelect)[]>;
  close(): Promise<void>;
}

/** 在同一台 PostgreSQL 上建一個暫時資料庫（名字隨機），回傳連線網址與刪除方法 */
async function createTempDb(url: string): Promise<{ url: string; drop(): Promise<void> }> {
  const pg = (await import('pg')).default;
  const name = `manxin_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(url);
  u.pathname = '/' + name;
  return {
    url: u.toString(),
    async drop() {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export async function makeApp(startIso = '2026-10-14T10:00', over: Partial<Config> = {}): Promise<TestApp> {
  const url = process.env.TEST_DATABASE_URL;
  // 真的 PostgreSQL：每個測試 App 建自己的暫時資料庫，用完刪掉。
  // 以前是共用一個資料庫、開頭清表，同一個檔案裡再建第二個 App 就會把第一個 App 的資料（含登入）清光。
  const tmp = url ? await createTempDb(url) : null;
  const h = tmp ? await connectPg(tmp.url) : await connectPglite();
  await h.migrate();
  let base = taipei(startIso);
  const clock = new Clock(true, 0, () => base);
  const cfg = loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret' } as NodeJS.ProcessEnv, {
    uploadDir: mkdtempSync(path.join(tmpdir(), 'manxin-up-')),
    ...over,
  });
  const app = await buildApp({ cfg, db: h.db, clock, startWorker: false, logger: false });
  await app.ready();

  const t: TestApp = {
    app,
    h,
    clock,
    advance: (ms) => clock.advance(ms),
    setNow: (at) => {
      base = typeof at === 'number' ? at : taipei(at);
      clock.setOffset(0);
    },
    run: () => runDueJobs(app.ctx),
    async req(method, url, cookie, body) {
      return app.inject({
        method: method as never,
        url,
        // 收信動作會綁定第一次動手的瀏覽器（D-029）；測試預設都是同一台瀏覽器
        headers: { cookie: [cookie, 'mx_rb=test-browser-0000000000000000'].filter(Boolean).join('; ') },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
    },
    async outbox(to) {
      const rows = await h.db.select().from(devOutbox).orderBy(devOutbox.id);
      return to ? rows.filter((r) => r.toEmail === to) : rows;
    },
    async login(email) {
      const r = await t.req('POST', '/auth/magic-link', undefined, { email });
      if (r.statusCode !== 202) throw new Error(r.body);
      const mails = await t.outbox(email);
      const token = (mails.at(-1)!.meta as { token: string }).token;
      const v = await t.req('POST', '/auth/verify', undefined, { token });
      if (v.statusCode !== 200) throw new Error(v.body);
      const c = v.cookies.find((x) => x.name === 'mx_session')!;
      return `mx_session=${c.value}`;
    },
    async close() {
      await app.close();
      await h.close();
      await tmp?.drop();
    },
  };
  return t;
}

export const json = <T = any>(r: LightMyRequestResponse): T => r.json() as T;

/** 建立一封有內容的信，寄件人與收件人地址都填好 */
export async function draft(t: TestApp, cookie: string, text = '小雯：\n\n好久不見。') {
  const r = await t.req('POST', '/letters', cookie, {
    env: { fromName: '阿哲', fromEmail: 'zhe@example.com', fromAddr: '臺北市大安區', toName: '小雯', toEmail: 'wen@example.org', toAddr: '臺南市東區' },
  });
  if (r.statusCode !== 201) throw new Error(r.body);
  const L = json(r);
  const c = await t.req('POST', `/letters/${L.id}/sheet/chars`, cookie, { text });
  if (c.statusCode !== 201) throw new Error(c.body);
  return L.id as string;
}

/** 從書桌一路走到投郵筒，回傳單號 */
export async function sendLetter(t: TestApp, cookie: string, letterId: string): Promise<string> {
  const steps: [string, string, unknown?][] = [
    ['POST', `/letters/${letterId}/trip`, { place: 'box', mode: 'walk', box: 'green' }],
  ];
  for (const [m, u, b] of steps) {
    const r = await t.req(m, u, cookie, b);
    if (r.statusCode >= 300) throw new Error(`${u} ${r.body}`);
  }
  t.advance(10 * 60_000);
  const seq: [string, string, unknown?][] = [
    ['POST', `/letters/${letterId}/trip/enter`],
    ['POST', `/letters/${letterId}/counter/confirm-address`],
    ['POST', `/letters/${letterId}/counter/folds`, { edge: 'b', at: (1.414 * 2) / 3 }],
    ['POST', `/letters/${letterId}/counter/folds`, { edge: 'b', at: 1.414 / 3 }],
    ['POST', `/letters/${letterId}/counter/insert`],
    ['POST', `/letters/${letterId}/counter/seal`],
    ['POST', `/letters/${letterId}/counter/stamp`, { x: 0.87, y: 0.24, r: 3 }],
  ];
  for (const [m, u, b] of seq) {
    const r = await t.req(m, u, cookie, b);
    if (r.statusCode >= 300) throw new Error(`${u} ${r.body}`);
  }
  const p = await t.req('POST', `/letters/${letterId}/post`, cookie);
  if (p.statusCode !== 201) throw new Error(p.body);
  return json(p).no;
}
