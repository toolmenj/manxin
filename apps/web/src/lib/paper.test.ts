/** 自訂字型（D-027）的載入與信紙範本的網址 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sheetOf } from '../test/fakeApi.tsx';
import { buildPaper, cellFromPoint, customFamily, fontCSS, fontLoaded, FONTS, inHandArea, loadFont, registerFont, renderType, viewSheet } from './paper.ts';

const FID = (n: number) => `f:0000000${n}-0000-4000-8000-000000000000`;

let loads: { family: string; src: string; ok: boolean }[];
let added: unknown[];
let failNext: boolean;

beforeEach(() => {
  loads = [];
  added = [];
  failNext = false;
  class FakeFontFace {
    constructor(
      public family: string,
      public src: string,
    ) {}
    load() {
      const ok = !failNext;
      failNext = false;
      loads.push({ family: this.family, src: this.src, ok });
      return ok ? Promise.resolve(this) : Promise.reject(new Error('bad font'));
    }
  }
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: (f: unknown) => added.push(f), delete: (f: unknown) => (added = added.filter((x) => x !== f)), ready: Promise.resolve() },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('字型', () => {
  it('fontCSS：內建字型照表；自訂字型 f:<id> 不用先註冊也有 font-family（收件人那邊沒有字型清單）', () => {
    expect(fontCSS('kai')).toBe(FONTS.kai!.css);
    expect(fontCSS('沒這個')).toBe(FONTS.typewriter!.css);
    expect(fontCSS(FID(1))).toBe(`'${customFamily(FID(1))}','Noto Serif TC',serif`);
  });

  it('loadFont：同一個字型只載一次，網址補上 /api；內建字型不動作', async () => {
    expect(loadFont('kai', '/fonts/x')).toBe('kai');
    expect(loadFont(FID(2), null)).toBe(FID(2));
    expect(loads).toHaveLength(0);
    loadFont(FID(2), '/r/tok/fonts/abc');
    loadFont(FID(2), '/r/tok/fonts/abc');
    expect(loads).toHaveLength(1);
    expect(loads[0]!.family).toBe(customFamily(FID(2)));
    expect(loads[0]!.src).toBe('url("/api/r/tok/fonts/abc")');
    expect(added).toHaveLength(1);
    expect(await fontLoaded(FID(2))).toBe(true);
    expect(await fontLoaded('kai')).toBe(true);
  });

  it('載不到：從 document.fonts 拿掉，之後可以再試', async () => {
    failNext = true;
    loadFont(FID(3), '/fonts/3');
    expect(await fontLoaded(FID(3))).toBe(false);
    expect(added).toHaveLength(0);
    loadFont(FID(3), '/fonts/3');
    expect(loads).toHaveLength(2);
    expect(await fontLoaded(FID(3))).toBe(true);
  });

  it('registerFont：加進字型選單（自訂：名字）並開始載入', () => {
    registerFont({ font: FID(4), name: '阿哲的字', url: '/fonts/4' });
    expect(FONTS[FID(4)]!.label).toBe('自訂：阿哲的字');
    expect(loads.at(-1)!.src).toBe('url("/api/fonts/4")');
  });

  it('buildPaper：信紙用自訂字型時順手載入', () => {
    const vs = viewSheet(sheetOf('字', { font: FID(5), fontUrl: '/fonts/5' }), (id) => '/att/' + id);
    const { tl } = buildPaper(vs);
    expect(tl.dataset.font).toBe(FID(5));
    expect(tl.style.fontFamily).toContain(customFamily(FID(5)));
    expect(loads.at(-1)!.src).toBe('url("/api/fonts/5")');
  });
});

describe('信紙範本', () => {
  it('viewSheet：範本換成 SVG 網址；上傳的圖樣優先', () => {
    expect(viewSheet(sheetOf('', { style: 'custom', bgTemplate: 'huajian' }), (id) => '/att/' + id).bg).toBe('/api/paper-templates/huajian.svg');
    expect(viewSheet(sheetOf('', { style: 'custom', bgAttachmentId: 'A1', bgTemplate: null }), (id) => '/att/' + id).bg).toBe('/att/A1');
    expect(viewSheet(sheetOf(''), (id) => '/att/' + id).bg).toBeNull();
  });

  it('buildPaper：style 是 custom 才鋪範本', () => {
    const on = buildPaper(viewSheet(sheetOf('', { style: 'custom', bgTemplate: 'plum' }), () => ''));
    expect(on.p.classList.contains('has-bg')).toBe(true);
    expect(on.p.style.backgroundImage).toContain('/api/paper-templates/plum.svg');
    const off = buildPaper(viewSheet(sheetOf('', { style: 'lined', bgTemplate: 'plum' }), () => ''));
    expect(off.p.classList.contains('has-bg')).toBe(false);
  });
});

describe('格位排版（移動過打字頭的信紙）', () => {
  it('順排（舊信紙）：跟以前一樣是一串字加 <br>，沒有 .gl', () => {
    const vs = viewSheet(sheetOf('ab\ncd'), () => '');
    const { tl } = buildPaper(vs);
    renderType(tl, vs, true);
    expect(tl.classList.contains('gridded')).toBe(false);
    expect(tl.querySelectorAll('.gl')).toHaveLength(0);
    expect(tl.querySelectorAll('br')).toHaveLength(1);
    expect([...tl.querySelectorAll('.c')].map((x) => x.textContent).join('')).toBe('abcd');
    expect(tl.lastElementChild?.id).toBe('caret');
  });

  it('格位：每一行一個 .gl，字前面用空格補到它的位置，打字頭在它那一格', () => {
    const sh = sheetOf('', {
      chars: [
        { c: '你', m: [], p: [0, 0] },
        { c: '\n', m: [] },
        { c: '好', m: [{ t: 's1', g: 'g' }], p: [2, 6] },
      ],
      cursor: [2, 8],
    });
    const vs = viewSheet(sh, () => '');
    const { tl } = buildPaper(vs);
    renderType(tl, vs, true);
    expect(tl.classList.contains('gridded')).toBe(true);
    const rows = tl.querySelectorAll<HTMLElement>('.gl');
    expect(rows).toHaveLength(3);
    const r2 = [...rows[2]!.children] as HTMLElement[];
    expect(r2.map((e) => e.className.split(' ')[0])).toEqual(['gs', 'c', 'caret']);
    expect(r2[0]!.style.getPropertyValue('--w')).toBe('6');
    expect(r2[1]!.dataset.i).toBe('2');
    expect(r2[1]!.style.backgroundImage).toContain('linear-gradient');
    expect(rows[2]!.querySelector('#caret')).not.toBeNull();
    // 縮圖（不顯示打字頭）也照格位畫
    renderType(tl, vs, false);
    expect(tl.querySelector('#caret')).toBeNull();
    expect(tl.querySelectorAll('.gl')).toHaveLength(3);
  });

  const mount = (kind: 'letter' | 'postcard', style: 'lined' | 'bahang' = 'lined') => {
    const pw = document.createElement('div');
    pw.className = 'pw';
    Object.defineProperty(pw, 'clientWidth', { value: 600 });
    const tl = document.createElement('div');
    pw.append(tl);
    document.body.append(pw);
    // 信紙內文左上角在 (54, 48)；明信片在 (30, 30)
    const left = kind === 'postcard' ? 30 : 54,
      top = kind === 'postcard' ? 30 : 48;
    const w = kind === 'postcard' ? 0.468 * 600 : style === 'bahang' ? 0.88 * 600 : 0.84 * 600;
    tl.getBoundingClientRect = () => ({ left, top, right: left + w, bottom: top + 700, width: w, height: 700, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    return { tl, sh: { kind, style } as const };
  };

  it('cellFromPoint：點在第幾行第幾格（橫書）', () => {
    const { tl, sh } = mount('letter');
    // 一行 0.056×600 = 33.6px 高；一格（兩個半格）84%×600/27 = 18.67px 寬
    expect(cellFromPoint(tl, sh, 54 + 5, 48 + 5)).toEqual([0, 0]);
    expect(cellFromPoint(tl, sh, 54 + 18.67 * 3 + 2, 48 + 33.6 * 4 + 2)).toEqual([4, 6]);
    // 點到紙外：夾回紙內
    expect(cellFromPoint(tl, sh, 0, 0)).toEqual([0, 0]);
    expect(cellFromPoint(tl, sh, 2000, 5000)).toEqual([21, 52]);
  });

  it('cellFromPoint：明信片右半邊是地址與郵票，回傳 blocked', () => {
    const { tl, sh } = mount('postcard');
    expect(cellFromPoint(tl, sh, 30 + 10, 40)).toEqual([0, 0]);
    expect(cellFromPoint(tl, sh, 30 + 0.6 * 600, 40)).toBe('blocked');
    // 正文區和分隔線之間的空隙：夾到最後一格
    expect(cellFromPoint(tl, sh, 30 + 0.49 * 600, 40)).toEqual([0, 34]);
  });

  it('cellFromPoint：八行箋直書，行由右往左數', () => {
    const { tl, sh } = mount('letter', 'bahang');
    const right = 54 + 0.88 * 600;
    expect(cellFromPoint(tl, sh, right - 5, 48 + 5)).toEqual([0, 0]);
    expect(cellFromPoint(tl, sh, right - 0.11 * 600 * 2 - 5, 48 + 5)).toEqual([2, 0]);
  });

  it('inHandArea：明信片右半邊不能手寫正文，信紙整張可以', () => {
    expect(inHandArea({ kind: 'postcard', style: 'lined' }, 0.3, 0.3)).toBe(true);
    expect(inHandArea({ kind: 'postcard', style: 'lined' }, 0.7, 0.3)).toBe(false);
    expect(inHandArea({ kind: 'letter', style: 'lined' }, 0.9, 1.2)).toBe(true);
  });
});
