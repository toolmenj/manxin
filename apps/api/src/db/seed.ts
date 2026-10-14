/**
 * 開發用範例資料（npm run db:seed）。內容取自原型的範例信。
 * 已經有資料就不重複建立。
 */
import { D, initialRecv, plan, trackNo, type SheetOp } from '@manxin/engine';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { Clock } from '../clock.ts';
import { loadConfig, type Config } from '../config.ts';
import type { Ctx } from '../context.ts';
import { CountyTableCourier } from '../services/courier.ts';
import { enqueue, recipientToken, runDueJobs } from '../services/jobs.ts';
import { ConsoleMailer } from '../services/mailer.ts';
import { LocalDiskStorage } from '../services/storage.ts';
import { MockWeather } from '../services/weather.ts';
import { DEFAULT_CALENDAR } from '@manxin/engine';
import type { Db } from './client.ts';
import { letters, sheetOps, sheets, shipments, users } from './schema.ts';

const chars = (parts: [string, string[]?][]): SheetOp[] => {
  const ops: SheetOp[] = [];
  let n = 0;
  for (const [txt, marks] of parts) {
    ops.push({ kind: 'chars', text: txt });
    const len = [...txt].length;
    for (const t of marks ?? []) ops.push({ kind: 'mark', from: n, to: n + len - 1, tool: t as never, g: `seed-${n}` });
    n += len;
  }
  return ops;
};

export async function seed(db: Db, cfg: Config): Promise<{ created: boolean; openLink?: string }> {
  const log = pino({ level: cfg.env === 'test' ? 'silent' : 'info' });
  const exists = await db.select().from(users).where(eq(users.email, 'zhe@example.com'));
  if (exists.length) return { created: false };
  const clock = new Clock(!cfg.isProd, cfg.devClockOffsetMs);
  const now = clock.now();
  const at = (t: number) => new Date(t);

  const [zhe] = await db.insert(users).values({ email: 'zhe@example.com', createdAt: at(now) }).returning();
  await db.insert(users).values({ email: 'wen@example.org', createdAt: at(now) });
  const env = { fromName: '阿哲', fromEmail: 'zhe@example.com', fromAddr: '臺北市大安區', toName: '小雯', toEmail: 'wen@example.org', toAddr: '臺南市東區' };

  const addLetter = async (status: string, e: object, ops: SheetOp[], extra: Partial<typeof letters.$inferInsert> = {}, font = 'typewriter') => {
    // 先以 drafting 建立再改狀態：資料庫觸發器不允許對已寄出的信追加內容
    const [L] = await db.insert(letters).values({ userId: zhe!.id, status: 'drafting', env: e, createdAt: at(now - 2 * D), ...extra }).returning();
    const [sh] = await db
      .insert(sheets)
      .values({ userId: zhe!.id, letterId: L!.id, role: 'current', kind: 'letter', style: 'lined', mode: 'type', font, createdAt: at(now - 2 * D) })
      .returning();
    for (const [i, op] of ops.entries()) await db.insert(sheetOps).values({ sheetId: sh!.id, seq: i, op, createdAt: at(now - 2 * D) });
    if (status !== 'drafting') await db.update(letters).set({ status }).where(eq(letters.id, L!.id));
    return { ...L!, status };
  };

  // 書桌上的信
  await addLetter(
    'drafting',
    env,
    chars([
      ['小雯：\n\n那年畢業典禮結束，妳在公車站等我，我傳訊息說臨時有事。其實沒有事，'],
      ['我只是不敢', ['s1']],
      ['我只是不知道要怎麼說再見。\n\n這封信晚了'],
      ['六', ['blk']],
      ['七年。妳現在還好嗎？\n'],
    ]),
  );

  // 先放著的信（31 天前放進抽屜，會出現「現在想寄出了嗎？」）
  const shelvedAt = now - 31 * D;
  const shelved = await addLetter(
    'shelved',
    { ...env, toName: '爸', toEmail: '', toAddr: '' },
    chars([['爸：\n\n上次吵完架，我們就沒再講過話。我想了很久，覺得那天我也有不對的地方。']]),
    { shelvedAt: at(shelvedAt) },
    'kai',
  );
  await enqueue(db, { kind: 'unsent_ask', uniqueKey: `unsent_ask:${shelved.id}:${shelvedAt}:1`, refId: shelved.id, runAt: shelvedAt + 30 * D, payload: { shelvedAt, n: 1 }, now });

  // 字紙冢
  for (const [state, txt, days] of [
    ['crumple', '小雯：\n\n好久不見。', 36],
    ['fold', '小雯：\n\n妳還記得', 2],
  ] as const) {
    const [sh] = await db
      .insert(sheets)
      .values({
        userId: zhe!.id,
        letterId: null,
        role: 'tomb',
        kind: 'letter',
        style: 'lined',
        mode: 'type',
        font: 'typewriter',
        createdAt: at(now - days * D),
        discardState: state,
        discardAngle: state === 'fold' ? 28 : 0,
        discardedAt: at(now - days * D),
      })
      .returning();
    await db.insert(sheetOps).values({ sheetId: sh!.id, seq: 0, op: { kind: 'chars', text: txt }, createdAt: at(now - days * D) });
  }

  // 一封已經送達、還沒簽收的信（讓收件流程可以直接試）
  const sentAt = now - 10 * D;
  const L = await addLetter('sent', env, chars([['小雯：\n\n這是一封範例信。慢慢拆。\n\n阿哲']]), { sentAt: at(sentAt) });
  const no = trackNo(`seed-${L.id}`);
  const P = plan({ no, sentAt, office: '巷口郵筒', box: 'green', env }, { calendar: DEFAULT_CALENDAR });
  const pkg = {
    env: 'kraft',
    stamp: 'plum',
    stampAttachmentId: null,
    pm: 'date',
    pmAttachmentId: null,
    skinAttachmentId: null,
    stampPos: { x: 0.87, y: 0.24, r: 3 },
    pmPos: { x: 0.77, y: 0.3, r: -10 },
    pmAt: sentAt,
    folds: [
      { a: 'h', at: 0.9427 },
      { a: 'h', at: 0.4713 },
    ],
    pack: { x0: 0, y0: 0, x1: 1, y1: 0.4713 },
    rot: false,
    inserted: true,
    sealed: true,
    etxt: { from: { c: [], s: [] }, to: { c: [...'小雯 收'], s: [] } },
    efont: 'kai',
  };
  const [s] = await db
    .insert(shipments)
    .values({
      no,
      letterId: L.id,
      userId: zhe!.id,
      sentAt: at(sentAt),
      office: '巷口郵筒',
      box: 'green',
      env,
      pkg,
      plan: P,
      deliverAt: at(P.deliver),
      recv: initialRecv(),
      createdAt: at(sentAt),
    })
    .returning();
  for (const [kind, key, runAt, payload] of [
    ['deliver', `deliver:${s!.id}:0`, P.deliver, { seq: 0 }],
    ['remind24', `remind24:${s!.id}`, P.deliver + D, {}],
    ['remind48', `remind48:${s!.id}`, P.deliver + 2 * D, {}],
    ['return30', `return30:${s!.id}`, P.deliver + 30 * D, {}],
  ] as const) {
    await enqueue(db, { kind, uniqueKey: key, refId: s!.id, runAt, payload, now });
  }
  const ctx: Ctx = {
    cfg,
    db,
    clock,
    mailer: new ConsoleMailer(log, cfg.mailFrom),
    weather: new MockWeather(),
    courier: new CountyTableCourier(),
    storage: new LocalDiskStorage(cfg.uploadDir),
    calendar: DEFAULT_CALENDAR,
    log,
  };
  await runDueJobs(ctx);
  const token = recipientToken(cfg.appSecret, s!.id, 0);
  return { created: true, openLink: `${cfg.appUrl}/r/${token}（API：GET /r/${token}）` };
}

// 直接執行：npm run db:seed
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seed.ts')) {
  const { connect } = await import('./client.ts');
  const cfg = loadConfig();
  if (cfg.dbDriver === 'pglite') {
    console.log('DB_DRIVER=pglite 啟動 API 時會自動放入範例資料，不需要另外執行。');
    process.exit(0);
  }
  const h = await connect(cfg.dbDriver, cfg.databaseUrl);
  try {
    const r = await seed(h.db, cfg);
    console.log(r.created ? `範例資料建立完成。\n登入信箱：zhe@example.com（寄件人）、wen@example.org（收件人）\n範例開信連結：${r.openLink}` : '已經有範例資料，略過。');
  } finally {
    await h.close();
  }
}
