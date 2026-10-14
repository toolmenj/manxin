import { describe, expect, it } from 'vitest';
import {
  ENVS,
  MAX_FOLDS,
  SHEET_H,
  applyFold,
  envLocked,
  fits,
  initialPack,
  missing,
  packDims,
  type EnvelopeKind,
  type FoldEdge,
  type Pack,
} from '../src/index.ts';

const close = (p: Pack, want: Pack) => {
  for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(p[k]).toBeCloseTo(want[k], 6);
};

describe('摺信外框（摺線落在邊緣和手指的中點，摺過去的部分會留在外框裡）', () => {
  const cases: [string, FoldEdge, number, Pack][] = [
    ['從下往上對摺', 'b', SHEET_H / 2, { x0: 0, y0: 0, x1: 1, y1: SHEET_H / 2 }],
    ['從下往上摺過頭：外框往上延伸', 'b', 0.3, { x0: 0, y0: 0.6 - SHEET_H, x1: 1, y1: 0.3 }],
    ['從上往下摺一小段', 't', 0.5, { x0: 0, y0: 0.5, x1: 1, y1: SHEET_H }],
    ['從上往下摺過頭：外框往下延伸', 't', 1.0, { x0: 0, y0: 1.0, x1: 1, y1: 2.0 }],
    ['從右往左對摺', 'r', 0.5, { x0: 0, y0: 0, x1: 0.5, y1: SHEET_H }],
    ['從左往右摺一小段', 'l', 0.3, { x0: 0.3, y0: 0, x1: 1, y1: SHEET_H }],
  ];
  it.each(cases)('%s', (_l, edge, at, want) => {
    const r = applyFold(initialPack(), 0, edge, at);
    expect(r.ok).toBe(true);
    if (r.ok) {
      close(r.pack, want);
      expect(r.fold).toEqual({ a: edge === 'b' || edge === 't' ? 'h' : 'v', at });
    }
  });

  it('三摺：兩次由下往上，高度剩三分之一', () => {
    let p = initialPack();
    for (const at of [(SHEET_H * 2) / 3, SHEET_H / 3]) {
      const r = applyFold(p, 0, 'b', at);
      if (!r.ok) throw new Error(r.code);
      p = r.pack;
    }
    close(p, { x0: 0, y0: 0, x1: 1, y1: SHEET_H / 3 });
  });

  it.each([
    ['摺線在外框上緣', 'b', 0],
    ['摺線在外框下緣', 'b', SHEET_H],
    ['摺線超出外框', 'r', 1.2],
    ['摺線不是數字', 'l', Number.NaN],
  ] as const)('拒絕：%s', (_l, edge, at) => {
    expect(applyFold(initialPack(), 0, edge, at)).toEqual({ ok: false, code: 'FOLD_OUT_OF_RANGE' });
  });

  it(`最多 ${MAX_FOLDS} 次`, () => {
    expect(applyFold(initialPack(), MAX_FOLDS - 1, 'b', 1).ok).toBe(true);
    expect(applyFold(initialPack(), MAX_FOLDS, 'b', 1)).toEqual({ ok: false, code: 'TOO_MANY_FOLDS' });
  });
});

describe('裝信判斷（信封內徑，容差 0.004）', () => {
  const p = (w: number, h: number): Pack => ({ x0: 0, y0: 0, x1: w, y1: h });
  const cases: [string, EnvelopeKind, Pack, boolean, 'ok' | 'TOO_WIDE' | 'TOO_LONG'][] = [
    ['沒摺的信紙放郵政信封：太長', 'post', initialPack(), false, 'TOO_LONG'],
    ['沒摺的信紙轉方向：太寬', 'post', initialPack(), true, 'TOO_WIDE'],
    ['三摺放郵政信封', 'post', p(1, SHEET_H / 3), false, 'ok'],
    ['三摺放牛皮紙信封', 'kraft', p(1, SHEET_H / 3), false, 'ok'],
    ['剛好在容差內', 'post', p(1, 0.52 + 0.004), false, 'ok'],
    ['超過容差一點點', 'post', p(1, 0.5241), false, 'TOO_LONG'],
    ['中式直式信封：三摺仍太寬', 'chinese', p(1, SHEET_H / 3), false, 'TOO_WIDE'],
    ['中式直式信封：直摺一次、橫摺一次', 'chinese', p(0.45, 0.707), false, 'ok'],
    ['中式直式信封：寬度過了但太長', 'chinese', p(0.45, 0.9), false, 'TOO_LONG'],
    ['米白方信封：四摺', 'wax', p(0.5, 0.5), false, 'ok'],
    ['米白方信封：三摺太寬', 'wax', p(1, SHEET_H / 3), false, 'TOO_WIDE'],
    ['轉方向後放得進去', 'wax', p(0.54, 0.7), true, 'ok'],
  ];
  it.each(cases)('%s', (_l, env, pack, rot, want) => {
    const r = fits(env, pack, rot);
    expect(r.ok ? 'ok' : r.code).toBe(want);
  });

  it('packDims 轉方向會對調', () => {
    expect(packDims(p(0.3, 0.8), true)).toEqual([0.8, 0.3]);
  });

  it('四種信封內徑與原型一致', () => {
    expect([ENVS.post.w, ENVS.post.h, ENVS.chinese.w, ENVS.chinese.h, ENVS.wax.w, ENVS.wax.h]).toEqual([
      1.05, 0.52, 0.45, 0.86, 0.75, 0.55,
    ]);
  });
});

describe('寄出前條件與信封鎖定', () => {
  const base = { env: 'post' as EnvelopeKind, inserted: false, sealed: false, addrOk: false, stampPos: null, envelopeWritten: false };
  it.each([
    ['什麼都還沒做', {}, ['ADDRESS', 'INSERT', 'STAMP']],
    ['放進去但沒封口', { addrOk: true, inserted: true }, ['SEAL', 'STAMP']],
    ['都好了（郵戳可以不蓋）', { addrOk: true, inserted: true, sealed: true, stampPos: { x: 0.8, y: 0.2, r: 2 } }, []],
    ['明信片：不用信封', { env: 'card' as EnvelopeKind, inserted: true, sealed: true, addrOk: true }, ['STAMP']],
  ] as const)('%s', (_l, over, want) => {
    expect(missing({ ...base, ...over })).toEqual(want);
  });

  it.each([
    ['全新', {}, false],
    ['信放進去了', { inserted: true }, true],
    ['貼了郵票', { stampPos: { x: 0.5, y: 0.5, r: 0 } }, true],
    ['信封上寫了字', { envelopeWritten: true }, true],
    ['明信片的 inserted 不算', { env: 'card' as EnvelopeKind, inserted: true }, false],
  ] as const)('envLocked：%s', (_l, over, want) => {
    expect(envLocked({ ...base, ...over })).toBe(want);
  });
});
