/**
 * 精簡回應（review M5）的前提：前端逐筆 applyOp 的結果，必須跟伺服器 applyOps 整張重放完全一樣。
 * 用決定性的亂數，對各種紙與各種操作的組合比對。
 */
import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, checkOp, emptyContent, paperGrid, type PaperRef, type SheetContent, type SheetOp } from '../src/sheet.ts';

/** 決定性亂數（mulberry32），失敗時可以用同一個種子重現 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAPERS: PaperRef[] = [
  { kind: 'letter', style: 'lined' },
  { kind: 'letter', style: 'grid' },
  { kind: 'letter', style: 'bahang' },
  { kind: 'postcard', style: 'lined' },
];
const PIECES = ['好', '久不見', 'ab', 'Slow mail.', '\n', '　', ' ', '小雯：\n', 'x\ny', '，。'];
const TOOLS = ['s1', 's2', 'x', 'blk', 'tape'] as const;

function randomOp(r: () => number, c: SheetContent, paper: PaperRef, n: number): SheetOp {
  const k = r();
  const g = paperGrid(paper);
  if (k < 0.45) return { kind: 'chars', text: PIECES[Math.floor(r() * PIECES.length)]! };
  if (k < 0.65) return { kind: 'move', at: [Math.floor(r() * (g.rows + 1)), Math.floor(r() * (g.units + 1))] };
  if (k < 0.85 && c.chars.length) {
    const at = [...new Set(Array.from({ length: 1 + Math.floor(r() * 3) }, () => Math.floor(r() * c.chars.length)))].sort((a, b) => a - b);
    return r() < 0.3
      ? { kind: 'mark', from: at[0]!, to: at.at(-1)!, tool: TOOLS[Math.floor(r() * TOOLS.length)]!, g: `g${n}` }
      : { kind: 'mark', at, tool: TOOLS[Math.floor(r() * TOOLS.length)]!, g: `g${n}` };
  }
  return { kind: 'stroke', stroke: { pen: 'ball', color: '#1A1A1A', pts: [[r() * 0.5, r() * 0.6, 0.5], [r() * 0.5, r() * 0.6, 0.7]] } };
}

describe('逐筆套用 = 整張重放', () => {
  it('300 組隨機操作序列（打字、移動打字頭、塗改、筆畫）在四種紙上結果完全一樣', () => {
    const kinds: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const paper = PAPERS[seed % PAPERS.length]!;
      let c = emptyContent();
      const ops: SheetOp[] = [];
      for (let i = 0; i < 40; i++) {
        const op = randomOp(r, c, paper, i);
        // 跟伺服器一樣：不合法的操作不會寫進去
        const mode = op.kind === 'stroke' ? 'hand' : 'type';
        if (op.kind !== 'stroke' && checkOp(c, mode, op, paper)) continue;
        if (op.kind === 'stroke' && checkOp(c, 'hand', op, paper)) continue;
        ops.push(op);
        c = applyOp(c, op, paper);
        expect(c, `seed ${seed} 第 ${ops.length} 筆`).toEqual(applyOps(ops, paper));
        kinds[op.kind] = (kinds[op.kind] ?? 0) + 1;
      }
    }
    // 確認每種操作都真的有測到（不是全被規則擋掉）
    for (const k of ['chars', 'move', 'mark', 'stroke']) expect(kinds[k] ?? 0, k).toBeGreaterThan(100);
  });
});

describe('一行剛好打滿再按換行', () => {
  const GRID: PaperRef = { kind: 'letter', style: 'grid' };
  // 稿紙一行 32 半格＝16 個全形字
  const full = '一二三四五六七八九十甲乙丙丁戊己';
  const start = (): SheetContent => applyOp(emptyContent(), { kind: 'move', at: [0, 0] }, GRID);

  it('換到下一行開頭，不會多空一行；跟字怎麼分批送無關', () => {
    const together = applyOp(start(), { kind: 'chars', text: full + '\n下' }, GRID);
    const split = [full, '\n', '下'].reduce((c, text) => applyOp(c, { kind: 'chars', text }, GRID), start());
    const replay = applyOps([{ kind: 'move', at: [0, 0] }, { kind: 'chars', text: full }, { kind: 'chars', text: '\n' }, { kind: 'chars', text: '下' }], GRID);
    for (const c of [together, split, replay]) {
      expect(c.chars.at(-1)).toMatchObject({ c: '下', p: [1, 0] });
      expect(c.cursor).toEqual([1, 2]);
    }
  });

  it('打滿之後直接打字，自動接到下一行開頭', () => {
    const c = [full, '下'].reduce((x, text) => applyOp(x, { kind: 'chars', text }, GRID), start());
    expect(c.chars.at(-1)).toMatchObject({ c: '下', p: [1, 0] });
  });
});
