/** 信紙的格位排版：移動打字頭、不能疊打、可寫區域（前後端共用的規則） */
import { describe, expect, it } from 'vitest';
import {
  applyOp,
  applyOps,
  canMoveTo,
  checkOp,
  emptyContent,
  fitText,
  gridCursor,
  layoutFlow,
  nextFreeInRow,
  paperGrid,
  type PaperRef,
  type SheetOp,
} from '../src/sheet.ts';

const LINED: PaperRef = { kind: 'letter', style: 'lined' };
const BAHANG: PaperRef = { kind: 'letter', style: 'bahang' };
const POSTCARD: PaperRef = { kind: 'postcard', style: 'lined' };
const text = (c: { chars: { c: string }[] }) => c.chars.map((x) => x.c).join('');
const pos = (c: { chars: { c: string; p?: [number, number] }[] }) => c.chars.filter((x) => x.p).map((x) => `${x.c}@${x.p![0]},${x.p![1]}`);

describe('順排（沒有移動過打字頭）：跟以前完全一樣', () => {
  it('字沒有格位、打字頭是 null', () => {
    const c = applyOps([{ kind: 'chars', text: '小雯：\n好久不見' }], LINED);
    expect(c.cursor).toBeNull();
    expect(c.chars.every((x) => x.p === undefined)).toBe(true);
    expect(text(c)).toBe('小雯：\n好久不見');
    // 舊的呼叫方式（不帶紙）也照舊
    expect(applyOps([{ kind: 'chars', text: 'ab' }])).toEqual({ chars: [{ c: 'a', m: [] }, { c: 'b', m: [] }], strokes: [], scan: null, cursor: null });
  });

  it('applyOp 與 applyOps 結果一樣', () => {
    const ops: SheetOp[] = [
      { kind: 'chars', text: '那年' },
      { kind: 'mark', from: 0, to: 1, tool: 's1', g: 'g1' },
      { kind: 'move', at: [3, 4] },
      { kind: 'chars', text: '我' },
      { kind: 'mark', at: [2], tool: 'x', g: 'g2' },
    ];
    const one = ops.reduce((c, op) => applyOp(c, op, LINED), emptyContent());
    expect(applyOps(ops, LINED)).toEqual(one);
  });
});

describe('移動打字頭', () => {
  it('第一次移動：之前的字從第一格重排，之後的字打在打字頭的位置', () => {
    const c = applyOps(
      [
        { kind: 'chars', text: '你好\nab' },
        { kind: 'move', at: [5, 10] },
        { kind: 'chars', text: '在這' },
      ],
      LINED,
    );
    expect(pos(c)).toEqual(['你@0,0', '好@0,2', 'a@1,0', 'b@1,1', '在@5,10', '這@5,12']);
    expect(c.cursor).toEqual([5, 14]);
    expect(text(c)).toBe('你好\nab在這');
  });

  it('不能疊打：落到有字的格子就往後跳到下一個空格', () => {
    const c = applyOps(
      [
        { kind: 'move', at: [0, 4] },
        { kind: 'chars', text: '甲乙' }, // 0,4  0,6
        { kind: 'move', at: [0, 2] },
        { kind: 'chars', text: '丙丁戊' }, // 0,2 → 丁 跳過甲乙 → 0,8 → 戊 0,10
      ],
      LINED,
    );
    expect(pos(c)).toEqual(['甲@0,4', '乙@0,6', '丙@0,2', '丁@0,8', '戊@0,10']);
  });

  it('半形字佔半格；放不下的全形字換到下一行開頭；換行回到下一行開頭', () => {
    const g = paperGrid(LINED);
    const c = applyOps([{ kind: 'move', at: [0, g.units - 1] }, { kind: 'chars', text: 'a字\nb' }], LINED);
    expect(pos(c)).toEqual([`a@0,${g.units - 1}`, '字@1,0', 'b@2,0']);
  });

  it('空白只推打字頭、不佔格子，之後可以在那裡打字', () => {
    let c = applyOps([{ kind: 'move', at: [0, 0] }, { kind: 'chars', text: '　x' }], LINED);
    expect(pos(c)).toEqual(['　@0,0', 'x@0,2']);
    expect(canMoveTo(c, LINED, [0, 0])).toBeNull();
    c = applyOp(c, { kind: 'move', at: [0, 0] }, LINED);
    c = applyOp(c, { kind: 'chars', text: '我' }, LINED);
    expect(pos(c).at(-1)).toBe('我@0,0');
  });

  it('打字頭不能停在有字的格子、也不能出紙', () => {
    const c = applyOps([{ kind: 'move', at: [2, 0] }, { kind: 'chars', text: '字' }], LINED);
    expect(canMoveTo(c, LINED, [2, 0])).toBe('MOVE_OCCUPIED');
    expect(canMoveTo(c, LINED, [2, 1])).toBe('MOVE_OCCUPIED');
    expect(canMoveTo(c, LINED, [2, 2])).toBeNull();
    expect(canMoveTo(c, LINED, [22, 0])).toBe('MOVE_OUT_OF_AREA');
    expect(canMoveTo(c, LINED, [0, 54])).toBe('MOVE_OUT_OF_AREA');
    expect(canMoveTo(c, LINED, [-1, 0])).toBe('MOVE_OUT_OF_AREA');
    expect(canMoveTo(c, LINED, [0.5, 0] as never)).toBe('MOVE_OUT_OF_AREA');
    expect(checkOp(c, 'hand', { kind: 'move', at: [0, 0] }, LINED)).toBe('WRONG_MODE');
    // 順排的信紙：照第一次移動時的重排來判斷
    const flow = applyOps([{ kind: 'chars', text: '你好' }], LINED);
    expect(canMoveTo(flow, LINED, [0, 2])).toBe('MOVE_OCCUPIED');
    expect(canMoveTo(flow, LINED, [0, 4])).toBeNull();
    expect(gridCursor(flow, LINED)).toEqual([0, 4]);
    expect(nextFreeInRow(c, LINED, [2, 0])).toEqual([2, 2]);
  });

  it('紙寫滿了：最後一行之後寫不下（SHEET_FULL），放得下的部分可以先送', () => {
    const g = paperGrid(LINED);
    const c = applyOps([{ kind: 'move', at: [g.maxRows - 1, g.units - 4] }], LINED);
    expect(fitText(c, LINED, '一二三')).toBe(2);
    expect(checkOp(c, 'type', { kind: 'chars', text: '一二' }, LINED)).toBeNull();
    expect(checkOp(c, 'type', { kind: 'chars', text: '一二三' }, LINED)).toBe('SHEET_FULL');
    expect(checkOp(c, 'type', { kind: 'chars', text: '\n' }, LINED)).toBe('SHEET_FULL');
    // 順排不受行數限制（舊行為）
    expect(checkOp(emptyContent(), 'type', { kind: 'chars', text: '字'.repeat(1500) }, LINED)).toBeNull();
  });

  it('重放時超出紙的打字頭夾回紙內（空白紙換過樣式）', () => {
    const c = applyOps([{ kind: 'move', at: [30, 50] }], POSTCARD);
    const g = paperGrid(POSTCARD);
    expect(c.cursor).toEqual([g.maxRows - 1, g.units - 1]);
  });

  it('八行箋：直書，一字一格（英數也佔一格）', () => {
    const g = paperGrid(BAHANG);
    expect(g.vertical).toBe(true);
    expect(g.rows).toBe(8);
    const c = applyOps([{ kind: 'move', at: [3, 0] }, { kind: 'chars', text: 'a字' }], BAHANG);
    expect(pos(c)).toEqual(['a@3,0', '字@3,2']);
  });

  it('layoutFlow：舊的字依序排，不會重疊', () => {
    const l = layoutFlow([...'一二三'].map((c) => ({ c, m: [] })), paperGrid(LINED));
    expect(l.cursor).toEqual([0, 6]);
  });
});

describe('可寫區域', () => {
  it('明信片：正文只在左半邊，打字頭移不到右半邊', () => {
    const g = paperGrid(POSTCARD);
    expect(g.units).toBe(36);
    const c = applyOps([{ kind: 'move', at: [0, g.units - 2] }, { kind: 'chars', text: '一二' }], POSTCARD);
    // 第二個字自動換到下一行，不會跑到地址那邊
    expect(pos(c)).toEqual([`一@0,${g.units - 2}`, '二@1,0']);
    expect(canMoveTo(c, POSTCARD, [0, g.units])).toBe('MOVE_OUT_OF_AREA');
  });

  it('明信片：手寫筆畫不能畫在右半邊（地址與郵票）', () => {
    const ok: SheetOp = { kind: 'stroke', stroke: { pen: 'ball', color: '#000000', pts: [[0.1, 0.1, 0.5], [0.5, 0.2, 0.5]] } };
    const right: SheetOp = { kind: 'stroke', stroke: { pen: 'ball', color: '#000000', pts: [[0.4, 0.1, 0.5], [0.8, 0.2, 0.5]] } };
    expect(checkOp(emptyContent(), 'hand', ok, POSTCARD)).toBeNull();
    expect(checkOp(emptyContent(), 'hand', right, POSTCARD)).toBe('STROKE_OUT_OF_AREA');
    // 信紙整張都能寫
    expect(checkOp(emptyContent(), 'hand', right, LINED)).toBeNull();
  });
});

describe('塗改用字的位置清單', () => {
  it('at 清單：只標記指定的字，換行不加', () => {
    const c = applyOps(
      [
        { kind: 'chars', text: 'a\nbcd' },
        { kind: 'mark', at: [0, 1, 4], tool: 's1', g: 'g' },
      ],
      LINED,
    );
    expect(c.chars.map((x) => x.m.length)).toEqual([1, 0, 0, 0, 1]);
  });

  it('檢查：超出範圍、重複、只有換行都拒絕', () => {
    const c = applyOps([{ kind: 'chars', text: 'a\nb' }], LINED);
    const m = (at: number[]): SheetOp => ({ kind: 'mark', at, tool: 's1', g: 'g' });
    expect(checkOp(c, 'type', m([0, 2]), LINED)).toBeNull();
    expect(checkOp(c, 'type', m([3]), LINED)).toBe('MARK_OUT_OF_RANGE');
    expect(checkOp(c, 'type', m([0, 0]), LINED)).toBe('MARK_OUT_OF_RANGE');
    expect(checkOp(c, 'type', m([1]), LINED)).toBe('MARK_NOTHING');
    expect(checkOp(c, 'type', m([]), LINED)).toBe('MARK_OUT_OF_RANGE');
  });
});
