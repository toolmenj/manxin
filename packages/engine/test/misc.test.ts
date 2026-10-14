import { describe, expect, it } from 'vitest';
import {
  applyOps,
  checkOp,
  collect,
  emptyContent,
  enter,
  initialRecv,
  isValidTrackNo,
  movePieces,
  openEnvelope,
  parsePlace,
  pour,
  pryStamp,
  pryWax,
  returnPostmark,
  s10CheckDigit,
  spaced,
  tearApart,
  trackNo,
  tripMin,
  unfold,
  PLACES,
  type RecvState,
} from '../src/index.ts';

describe('單號（UPU S10）', () => {
  it('UPU 範例 47312482 的檢查碼是 9', () => {
    expect(s10CheckDigit('47312482')).toBe(9);
  });
  it('格式、檢查碼、決定性', () => {
    for (let i = 0; i < 300; i++) {
      const no = trackNo(`letter-${i}`);
      expect(no).toMatch(/^RR\d{9}TW$/);
      expect(isValidTrackNo(no)).toBe(true);
      expect(trackNo(`letter-${i}`)).toBe(no);
    }
  });
  it('改一碼就驗不過', () => {
    const no = trackNo('a');
    const bad = no.slice(0, 2) + ((Number(no[2]) + 1) % 10) + no.slice(3);
    expect(isValidTrackNo(bad)).toBe(false);
  });
  it('顯示格式', () => {
    expect(spaced('RR473124829TW')).toBe('RR 4731 2482 9 TW');
  });
});

describe('地址解析', () => {
  it.each([
    ['臺北市大安區和平東路', { city: '臺北', region: '北', dist: '大安區' }],
    ['台南市東區', { city: '臺南', region: '南', dist: '東區' }],
    ['花蓮縣 吉安鄉', { city: '花蓮', region: '東', dist: '吉安鄉' }],
    ['Tokyo', { city: 'Tokyo', region: '外', dist: '' }],
  ] as const)('%s', (a, want) => {
    expect(parsePlace(a)).toEqual(want);
  });
  it('空白回傳 null', () => {
    expect(parsePlace('  ')).toBeNull();
  });
});

describe('前往郵局所需時間', () => {
  it.each([
    ['box', 'walk', 5],
    ['po', 'walk', 17],
    ['main', 'car', 16],
    ['main', 'bike', 18],
  ] as const)('%s %s = %i 分', (id, mode, min) => {
    expect(tripMin(PLACES.find((p) => p.id === id)!, mode)).toBe(min);
  });
});

describe('退件郵戳參數：依目的地決定、同地同樣式', () => {
  it('決定性', () => {
    const a = returnPostmark('臺南東區', Date.UTC(2026, 10, 20));
    expect(returnPostmark('臺南東區', Date.UTC(2026, 10, 20))).toEqual(a);
    expect(a.date).toBe('115.11.20');
    expect(a.shape).toBeGreaterThanOrEqual(0);
    expect(a.shape).toBeLessThan(4);
  });
});

describe('收信狀態', () => {
  const entered = (): RecvState => ({ ...initialRecv(), entered: true });
  const must = (r: ReturnType<typeof pour>) => {
    if (!r.ok) throw new Error(r.code);
    return r;
  };

  it('沒點連結不能開', () => {
    expect(openEnvelope(initialRecv(), 'kraft', 'knife', 0)).toEqual({ ok: false, code: 'NOT_ENTERED' });
  });
  it.each([
    ['膠貼手撕、骰到 0.49：毛邊', 'kraft', 'tear', 0.49, true],
    ['膠貼手撕、骰到 0.5：沒毛邊', 'kraft', 'tear', 0.5, false],
    ['膠貼開信刀：沒毛邊', 'kraft', 'knife', 0, false],
    ['易撕帶：沒毛邊', 'post', 'tear', 0, false],
    ['火漆信封手撕：沒毛邊', 'wax', 'tear', 0, false],
  ] as const)('%s', (_l, env, method, roll, rough) => {
    const r = must(openEnvelope(entered(), env, method, roll));
    expect(r.state.rough).toBe(rough);
    expect(r.signs).toBe(true);
  });
  it('開信 → 倒出來 → 攤開 → 收藏，順序不能跳', () => {
    let s = entered();
    expect(pour(s)).toEqual({ ok: false, code: 'NOT_OPENED' });
    s = must(openEnvelope(s, 'post', 'knife', 0)).state;
    expect(openEnvelope(s, 'post', 'knife', 0)).toEqual({ ok: false, code: 'ALREADY_OPENED' });
    expect(unfold(s)).toEqual({ ok: false, code: 'NOT_POURED' });
    s = must(pour(s)).state;
    expect(collect(s)).toEqual({ ok: false, code: 'NOT_UNFOLDED' });
    s = must(unfold(s)).state;
    s = must(collect(s)).state;
    expect(collect(s)).toEqual({ ok: false, code: 'ALREADY_COLLECTED' });
  });
  it('撕毀：位置夾在 0.2–0.8，四片碎片，算簽收', () => {
    const r = must(tearApart(entered(), 0.95, 'seed'));
    expect(r.state.torn).toEqual({ x: 0.8, seed: 'seed' });
    expect(r.state.pieces).toHaveLength(4);
    expect(r.state.unfolded).toBe(true);
    expect(r.signs).toBe(true);
    expect(tearApart(r.state, 0.5, 's')).toEqual({ ok: false, code: 'ALREADY_OPENED' });
  });
  it('碎片位置：只能動已有的碎片', () => {
    const s = must(tearApart(entered(), 0.5, 's')).state;
    const m = must(movePieces(s, [{ k: 'lL', x: 1, y: 2, rot: 3 }]));
    expect(m.state.pieces!.find((p) => p.k === 'lL')).toEqual({ k: 'lL', x: 1, y: 2, rot: 3 });
    expect(movePieces(entered(), [])).toEqual({ ok: false, code: 'NOT_TORN' });
  });
  it.each([
    [0.39, true],
    [0.4, false],
  ])('撬郵票：骰到 %d → 紙纖維 %s（40%）', (roll, fiber) => {
    const r = must(pryStamp(entered(), true, roll));
    expect(r.state.stampFiber).toBe(fiber);
    expect(pryStamp(r.state, true, 0)).toEqual({ ok: false, code: 'ALREADY_TAKEN' });
  });
  it('沒有郵票不能撬', () => {
    expect(pryStamp(entered(), false, 0)).toEqual({ ok: false, code: 'NO_STAMP' });
  });
  it('火漆：只有火漆信封、開信前才能撬', () => {
    expect(pryWax(entered(), 'kraft', 0)).toEqual({ ok: false, code: 'NO_WAX' });
    expect(must(pryWax(entered(), 'wax', 0.1)).state.waxFiber).toBe(true);
    const opened = must(openEnvelope(entered(), 'wax', 'knife', 0)).state;
    expect(pryWax(opened, 'wax', 0)).toEqual({ ok: false, code: 'ALREADY_OPENED' });
  });
  it('明信片點開就算簽收', () => {
    const r = must(enter(initialRecv(), 'card'));
    expect(r.signs).toBe(true);
    expect(r.state.unfolded).toBe(true);
    expect(must(enter(initialRecv(), 'post')).signs).toBe(false);
  });
});

describe('信紙：只有追加', () => {
  it('追加字、塗改標記不碰換行、筆畫', () => {
    const c = applyOps([
      { kind: 'chars', text: 'ab\r\n𠮷' },
      { kind: 'mark', from: 1, to: 2, tool: 's1', g: 'g1' },
      { kind: 'mark', from: 1, to: 1, tool: 'tape', g: 'g2' },
    ]);
    expect(c.chars.map((x) => x.c)).toEqual(['a', 'b', '\n', '𠮷']);
    expect(c.chars[1]!.m).toEqual([
      { t: 's1', g: 'g1' },
      { t: 'tape', g: 'g2' },
    ]);
    expect(c.chars[2]!.m).toEqual([]);
  });
  it.each([
    ['打字模式不能畫', 'type', { kind: 'stroke', stroke: { pen: 'ball', color: '#000000', pts: [[0, 0, 0.5]] } }, 'WRONG_MODE'],
    ['手寫模式不能打字', 'hand', { kind: 'chars', text: 'a' }, 'WRONG_MODE'],
    ['空字串', 'type', { kind: 'chars', text: '' }, 'EMPTY_TEXT'],
    ['塗改超出範圍', 'type', { kind: 'mark', from: 0, to: 5, tool: 's1', g: 'g' }, 'MARK_OUT_OF_RANGE'],
    ['只塗到換行', 'type', { kind: 'mark', from: 1, to: 1, tool: 's1', g: 'g' }, 'MARK_NOTHING'],
    ['不存在的塗改工具', 'type', { kind: 'mark', from: 0, to: 0, tool: 'eraser', g: 'g' }, 'BAD_TOOL'],
    ['已落筆不能匯入紙本', 'type', { kind: 'scan', attachmentId: 'x' }, 'SHEET_NOT_EMPTY'],
  ] as const)('拒絕：%s', (_l, mode, op, code) => {
    const c = applyOps([{ kind: 'chars', text: 'a\nb' }]);
    expect(checkOp(c, mode, op as never)).toBe(code);
  });
  it('空白信紙可以匯入紙本', () => {
    expect(checkOp(emptyContent(), 'hand', { kind: 'scan', attachmentId: 'x' })).toBeNull();
  });
});
