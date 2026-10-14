import { describe, expect, it } from 'vitest';
import {
  D,
  H,
  canEditEmail,
  rerouteDeliverAt,
  status,
  taipei,
  unsentAskDue,
  nextUnsentAsk,
  type EmailEdit,
  type StatusInput,
} from '../src/index.ts';

const first = taipei('2026-10-20T10:00'); // 週二上午送達
const mk = (o: Partial<StatusInput> = {}): StatusInput => ({
  plan: { deliver: first, events: [], stops: ['A', 'B', 'C'] },
  toEmail: 'wen@example.org',
  signedAt: null,
  edits: [],
  ...o,
});
const edit = (t: number, email: string): EmailEdit => ({ t, email, deliverAt: rerouteDeliverAt(t) });

describe('status：狀態與提醒（表格）', () => {
  const cases: [string, number, Partial<StatusInput>, { state: string; rem1: boolean; rem2: boolean; editsLeft: number }][] = [
    ['送達前：運送中', first - 1, {}, { state: 'transit', rem1: false, rem2: false, editsLeft: 0 }],
    ['剛送達：等待簽收、還不能改', first, {}, { state: 'waiting', rem1: false, rem2: false, editsLeft: 0 }],
    ['23:59:59 還沒到 24h', first + D - 1000, {}, { state: 'waiting', rem1: false, rem2: false, editsLeft: 0 }],
    ['24h：第一次提醒，可改 1 次', first + D, {}, { state: 'waiting', rem1: true, rem2: false, editsLeft: 1 }],
    ['48h：第二次提醒，沒改過可改 2 次', first + 2 * D, {}, { state: 'waiting', rem1: true, rem2: true, editsLeft: 2 }],
    ['30 天前一刻仍在等', first + 30 * D - 1, {}, { state: 'waiting', rem1: true, rem2: true, editsLeft: 2 }],
    ['30 天：退回', first + 30 * D, {}, { state: 'returned', rem1: true, rem2: true, editsLeft: 0 }],
    ['10 小時後簽收：不再提醒', first + 2 * D, { signedAt: first + 10 * H }, { state: 'signed', rem1: false, rem2: false, editsLeft: 0 }],
    ['30 小時後簽收：24h 提醒已寄，48h 不寄', first + 3 * D, { signedAt: first + 30 * H }, { state: 'signed', rem1: true, rem2: false, editsLeft: 0 }],
    ['已簽收就不會退回', first + 40 * D, { signedAt: first + 29 * D }, { state: 'signed', rem1: true, rem2: true, editsLeft: 0 }],
  ];
  it.each(cases)('%s', (_l, now, over, want) => {
    const s = status(mk(over), now);
    expect({ state: s.state, rem1: s.rem1, rem2: s.rem2, editsLeft: s.editsLeft }).toEqual(want);
  });
});

describe('status：改收件信箱', () => {
  it('24h 後改一次 → 改寄中 → 重新投遞後等待；48h 再給一次，之後就沒了', () => {
    const t1 = first + D + H; // 週三 11:00
    const e1 = edit(t1, 'wen2@example.org');
    expect(e1.deliverAt).toBe(t1 + H);
    let s = status(mk({ edits: [e1] }), t1 + 1);
    expect(s.state).toBe('rerouting');
    expect(s.curEmail).toBe('wen2@example.org');
    expect(s.editsLeft).toBe(0);
    expect(canEditEmail(mk({ edits: [e1] }), 'x@y.z', t1 + 1)).toEqual({ ok: false, code: 'NO_EDITS_LEFT' });

    s = status(mk({ edits: [e1] }), e1.deliverAt);
    expect(s.state).toBe('waiting');

    const t2 = first + 2 * D + 2 * H;
    s = status(mk({ edits: [e1] }), t2);
    expect(s.editsLeft).toBe(1);
    const e2 = edit(t2, 'wen3@example.org');
    s = status(mk({ edits: [e1, e2] }), t2 + 10 * H);
    expect(s.editsLeft).toBe(0);
    expect(s.curEmail).toBe('wen3@example.org');
    // D-005（暫定）：退信仍從第一次送達起算
    expect(status(mk({ edits: [e1, e2] }), first + 30 * D).state).toBe('returned');
  });

  it('下班前一小時內改信箱：重新投遞順延到隔天 9:00', () => {
    const t = taipei('2026-10-21T17:30');
    expect(rerouteDeliverAt(t)).toBe(taipei('2026-10-22T09:00'));
  });

  const checks: [string, number, Partial<StatusInput>, string, string | true][] = [
    ['還在路上不能改', first - 1, {}, 'a@b.c', 'NOT_DELIVERED'],
    ['未滿 24h 不能改', first + H, {}, 'a@b.c', 'NO_EDITS_LEFT'],
    ['24h 後可改', first + D, {}, 'a@b.c', true],
    ['同一個信箱不算', first + D, {}, 'WEN@example.org', 'SAME_EMAIL'],
    ['簽收後不能改', first + D, { signedAt: first + H }, 'a@b.c', 'SIGNED'],
    ['退回後不能改', first + 31 * D, {}, 'a@b.c', 'RETURNED'],
  ];
  it.each(checks)('%s', (_l, now, over, email, want) => {
    const r = canEditEmail(mk(over), email, now);
    if (want === true) expect(r.ok).toBe(true);
    else expect(r).toEqual({ ok: false, code: want });
  });
});

describe('未寄出的信：每 30 天詢問', () => {
  const shelved = taipei('2026-10-14T21:00');
  it.each([
    ['29 天還不問', shelved + 29 * D, null, false],
    ['30 天要問', shelved + 30 * D, null, true],
    ['問過之後再等 30 天', shelved + 40 * D, shelved + 30 * D, false],
    ['問過 30 天後再問', shelved + 60 * D, shelved + 30 * D, true],
  ] as const)('%s', (_l, now, asked, want) => {
    expect(unsentAskDue(shelved, asked, now)).toBe(want);
  });
  it('下次詢問時間', () => {
    expect(nextUnsentAsk(shelved, null)).toBe(shelved + 30 * D);
  });
});
