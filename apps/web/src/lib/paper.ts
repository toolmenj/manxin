/**
 * 信紙的畫法（移植自原型 buildPaper／renderType／drawX／strokeDraw／drawInk／mountSheet）。
 * 純畫面：輸入一張信紙的內容，畫成 DOM。React 元件用 ref 呼叫這些函式。
 */
import { cellKey, charWidth, handArea, inkOf, normCursor, occupancy, paperGrid, type Cell, type CharCell, type FontDTO, type PaperRef, type SheetDTO, type Stroke } from '@manxin/shared';
import { fileUrl, paperTemplateUrl } from '../api/client.ts';
import { el, esc, hash } from './util.ts';

export const FONTS: Record<string, { label: string; css: string }> = {
  typewriter: { label: '老式打字機', css: "'Special Elite','Noto Serif TC',serif" },
  lead: { label: '華文打字機（鉛字）', css: "'Cactus Classical Serif','Noto Serif TC',serif" },
  ming: { label: '鉛字明體', css: "'Noto Serif TC',serif" },
  kai: { label: '文楷', css: "'LXGW WenKai TC',serif" },
  song: { label: '鉛字宋體（簡）', css: "'Noto Serif SC','Noto Serif TC',serif" },
};
/* ---------- 自訂字型（D-027：檔案在後端，font = 'f:<id>'） ---------- */

export const isCustomFont = (f: string | null | undefined): f is string => !!f && f.startsWith('f:');
/** 自訂字型在瀏覽器裡的 font-family 名稱 */
export const customFamily = (f: string): string => 'mxf-' + f.slice(2).replace(/[^0-9a-zA-Z-]/g, '');

const fontLoads = new Map<string, Promise<boolean>>();

/**
 * 把自訂字型掛進 document.fonts（同一個字型只載一次）。內建字型或沒有網址就什麼都不做。
 * url 是後端給的路徑（/fonts/:id 或 /r/:token/fonts/:id），會自動加上 /api。回傳 font 本身，方便直接放進物件裡。
 */
export function loadFont(font: string, url: string | null | undefined): string {
  if (!isCustomFont(font) || !url || fontLoads.has(font)) return font;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return font;
  const ff = new FontFace(customFamily(font), `url("${fileUrl(url)}")`);
  document.fonts.add(ff);
  fontLoads.set(
    font,
    ff.load().then(
      () => true,
      () => {
        // 載不到（網路斷了、檔案壞了）：下次再試，先退回後備字型
        document.fonts.delete(ff);
        fontLoads.delete(font);
        return false;
      },
    ),
  );
  return font;
}

/** 等某個自訂字型載完（畫打叉、量高度之前用）；內建字型立即完成 */
export const fontLoaded = (font: string): Promise<boolean> => fontLoads.get(font) ?? Promise.resolve(!isCustomFont(font));

/** 自己上傳的字型：加進字型選單並開始載入 */
export function registerFont(f: Pick<FontDTO, 'font' | 'name' | 'url'>): void {
  FONTS[f.font] = { label: '自訂：' + f.name, css: fontCSS(f.font) };
  loadFont(f.font, f.url);
}

export const PENS: Record<string, { label: string; w: number; a: number; pr: boolean }> = {
  fountain: { label: '鋼筆', w: 2.4, a: 1, pr: true },
  ball: { label: '原子筆', w: 1.5, a: 1, pr: false },
  pencil: { label: '鉛筆', w: 1.8, a: 0.6, pr: true },
};
export const INKS: [string, string][] = [
  ['#1F2F4F', '藍黑'],
  ['#1A1A1A', '黑'],
  ['#8E2A22', '深紅'],
];

/** 畫面用的信紙：圖片已經換成可以直接顯示的網址 */
export interface ViewSheet {
  id: string;
  kind: SheetDTO['kind'];
  style: SheetDTO['style'];
  mode: SheetDTO['mode'];
  font: string;
  /** 自訂字型的檔案網址（後端路徑）；內建字型沒有 */
  fontUrl?: string | null;
  chars: CharCell[];
  /** 打字頭；null＝順排（舊信紙），字照以前的方式排 */
  cursor: Cell | null;
  strokes: Stroke[];
  bg: string | null;
  scan: string | null;
  createdAt: number;
}

export function viewSheet(sh: SheetDTO, fileOf: (attachmentId: string) => string): ViewSheet {
  return {
    id: sh.id,
    kind: sh.kind,
    style: sh.style,
    mode: sh.mode,
    font: sh.font,
    fontUrl: sh.fontUrl,
    chars: sh.chars,
    cursor: sh.cursor ?? null,
    strokes: sh.strokes,
    // 上傳的圖樣和內建範本二選一
    bg: sh.bgAttachmentId ? fileOf(sh.bgAttachmentId) : sh.bgTemplate ? paperTemplateUrl(sh.bgTemplate) : null,
    scan: sh.scan ? fileOf(sh.scan) : null,
    createdAt: sh.createdAt,
  };
}

export interface PaperEnv {
  toName?: string;
  toAddr?: string;
  toEmail?: string;
}

export const hasContent = (sh: { chars: unknown[]; strokes: unknown[]; scan: unknown }): boolean =>
  sh.chars.length > 0 || sh.strokes.length > 0 || !!sh.scan;

export const textOf = (sh: { chars: CharCell[] }): string => sh.chars.map((o) => o.c).join('');

export const fontCSS = (f: string): string =>
  isCustomFont(f) ? `'${customFamily(f)}','Noto Serif TC',serif` : (FONTS[f] || FONTS.typewriter!).css;

export interface Paper {
  p: HTMLDivElement;
  tl: HTMLDivElement;
  cv: HTMLCanvasElement;
}

export function buildPaper(sh: ViewSheet, env?: PaperEnv | null): Paper {
  const p = el('div', 'paper');
  p.dataset.kind = sh.kind;
  p.dataset.style = sh.kind === 'postcard' && (sh.style === 'grid' || sh.style === 'bahang') ? 'lined' : sh.style;
  if (sh.bg && sh.style === 'custom') {
    p.classList.add('has-bg');
    p.style.backgroundImage = `url(${sh.bg})`;
  }
  if (sh.scan) {
    const im = el('img', 'scan');
    im.src = sh.scan;
    im.alt = '';
    p.append(im);
  }
  const tl = el('div', 'type-layer');
  loadFont(sh.font, sh.fontUrl);
  tl.style.fontFamily = fontCSS(sh.font);
  tl.dataset.font = sh.font;
  p.append(tl);
  if (sh.kind === 'postcard') {
    const e = env || {};
    p.append(
      el(
        'div',
        'pc-side',
        `<div class="pc-stamp">貼郵票處</div><div class="pc-line">${esc(e.toName ? '給 ' + e.toName : '')}</div><div class="pc-line">${esc(e.toAddr || '')}</div><div class="pc-line">${esc(e.toEmail || '')}</div>`,
      ),
    );
  }
  const cv = el('canvas', 'ink-layer');
  p.append(cv);
  return { p, tl, cv };
}

const G = 'rgba(46,52,58,.9)';

/** 一個字的 span：打字機的輕微跳動、塗改的痕跡（順排、格位排版共用） */
function charSpan(o: CharCell, i: number, tw: boolean, v: boolean, newFrom: number): HTMLSpanElement {
  const lg = (s: string) => `linear-gradient(${v ? '90deg,' : ''}${s})`;
  const s = el('span', 'c');
  s.dataset.i = String(i);
  s.textContent = o.c;
  if (i >= newFrom) s.classList.add('new');
  if (tw) {
    const h = hash(i + o.c);
    s.style.setProperty('--j', (((h % 7) - 3) * 0.012).toFixed(3) + 'em');
    s.style.setProperty('--o', (0.8 + ((h >> 4) % 20) / 100).toFixed(2));
  }
  if (o.m.length) {
    let L: string[] = [],
      hide = false,
      tape = false;
    for (const m of o.m) {
      if (m.t === 'tape') {
        L = ['linear-gradient(#F6F6F1,#F6F6F1)'];
        hide = true;
        tape = true;
      } else if (m.t === 'blk') {
        L = [`repeating-linear-gradient(-58deg,${G} 0 2px,rgba(46,52,58,.72) 2px 3px)`];
        hide = true;
        tape = false;
      } else if (m.t === 's1') L.unshift(lg(`transparent 46%,${G} 46% 54%,transparent 54%`));
      else if (m.t === 's2') L.unshift(lg(`transparent 36%,${G} 36% 42%,transparent 42% 58%,${G} 58% 64%,transparent 64%`));
    }
    if (L.length) s.style.backgroundImage = L.join(',');
    if (hide) {
      s.style.color = 'transparent';
      s.style.textShadow = 'none';
    }
    if (tape) s.classList.add('taped');
  }
  return s;
}

type TypeSheet = Pick<ViewSheet, 'chars' | 'font' | 'style' | 'kind'> & { cursor?: Cell | null };

export function renderType(tl: HTMLElement, sh: TypeSheet, caret: boolean, newFrom = Infinity): void {
  if (sh.cursor) {
    renderGrid(tl, sh as TypeSheet & { cursor: Cell }, caret, newFrom);
    return;
  }
  // 順排：跟以前完全一樣
  tl.classList.remove('gridded');
  const f = document.createDocumentFragment(),
    tw = sh.font === 'typewriter' || sh.font === 'lead';
  const v = sh.style === 'bahang' && sh.kind === 'letter';
  sh.chars.forEach((o, i) => {
    if (o.c === '\n') {
      f.append(document.createElement('br'));
      return;
    }
    f.append(charSpan(o, i, tw, v, newFrom));
  });
  if (caret) {
    const c = el('span', 'caret');
    c.id = 'caret';
    f.append(c);
  }
  tl.replaceChildren(f);
  if (tl.isConnected) drawX(tl, sh);
}

/* ---------- 格位排版（移動過打字頭的信紙） ---------- */

/**
 * 格位排版的版面（單位 cqw，.pw 的寬度＝100）。半格數、行數在 engine 的 paperGrid；
 * 這裡的寬度要等於 CSS 裡的內文寬（prototype.css 的 .paper／.type-layer），格子才會對齊橫線、稿紙格、八行箋的直線。
 * inl：一行的長度（直書是內文高）；lh：行距；fs：字級。
 */
const GRID_CSS = {
  letter: { inl: 84, lh: 5.6, fs: 3.1 },
  grid: { inl: 84, lh: 5.25, fs: 3.255 },
  bahang: { inl: 123.4, lh: 11, fs: 5.5 },
  postcard: { inl: 46.8, lh: 4.4, fs: 2.5 },
} as const;
/** 明信片：type-layer 左邊到中間分隔線的距離（cqw）；分隔線右邊是地址、郵票 */
const POSTCARD_DIVIDER = 50.8;

const gridCss = (p: PaperRef) => GRID_CSS[p.kind === 'postcard' ? 'postcard' : p.style === 'grid' ? 'grid' : p.style === 'bahang' ? 'bahang' : 'letter'];

function renderGrid(tl: HTMLElement, sh: TypeSheet & { cursor: Cell }, caret: boolean, newFrom: number): void {
  const g = paperGrid(sh);
  const k = gridCss(sh);
  tl.classList.add('gridded');
  tl.style.setProperty('--uw', `${k.inl / g.units}cqw`);
  tl.style.setProperty('--lh', `${k.lh}cqw`);
  tl.style.setProperty('--gfs', `${k.fs}cqw`);
  const tw = sh.font === 'typewriter' || sh.font === 'lead';
  const v = g.vertical;
  const rows = new Map<number, { u: number; w: number; s: HTMLSpanElement }[]>();
  // 空白不佔格子（之後可以在那裡打字）：只有沒被字蓋到、也沒跟別的空白重疊時才畫出來（空白也是一個字，塗改時看得到）
  const used = occupancy(sh.chars, g);
  sh.chars.forEach((o, i) => {
    if (!o.p || o.c === '\n') return;
    const w = charWidth(o.c, g);
    if (!inkOf(o)) {
      const ks = Array.from({ length: w }, (_, k) => cellKey(g, o.p![0], o.p![1] + k));
      if (ks.some((k) => used.has(k)) || o.p[1] + w > g.units) return;
      ks.forEach((k) => used.add(k));
    }
    const s = charSpan(o, i, tw, v, newFrom);
    s.style.setProperty('--w', String(w));
    const r = rows.get(o.p[0]) ?? [];
    r.push({ u: o.p[1], w, s });
    rows.set(o.p[0], r);
  });
  const cur = caret ? normCursor(sh.cursor, g) : null;
  const maxR = Math.max(0, cur ? cur[0] : 0, ...rows.keys());
  const f = document.createDocumentFragment();
  for (let r = 0; r <= maxR; r++) {
    const line = el('div', 'gl');
    line.dataset.r = String(r);
    let u = 0;
    const gap = (n: number) => {
      if (n <= 0) return;
      const sp = el('span', 'gs');
      sp.style.setProperty('--w', String(n));
      line.append(sp);
    };
    let caretPending = !!cur && cur[0] === r;
    const putCaret = () => {
      gap(cur![1] - u);
      u = Math.max(u, cur![1]);
      const c = el('span', 'caret gcaret');
      c.id = 'caret';
      c.style.setProperty('--cu', String(cur![1]));
      line.append(c);
      caretPending = false;
    };
    for (const it of (rows.get(r) ?? []).sort((a, b) => a.u - b.u)) {
      if (caretPending && cur![1] <= it.u) putCaret();
      gap(it.u - u);
      line.append(it.s);
      u = Math.max(u, it.u + it.w);
    }
    if (caretPending) putCaret();
    f.append(line);
  }
  tl.replaceChildren(f);
  if (tl.isConnected) drawX(tl, sh);
}

/**
 * 點在紙上的哪一格（給「把打字頭移過去」用）。用跟 CSS 同一組尺寸換算，順排的信紙也算得出來。
 * 回傳 'blocked'＝點在不能寫正文的地方（明信片右半邊）。
 */
export function cellFromPoint(tl: HTMLElement, sh: PaperRef, x: number, y: number): Cell | 'blocked' {
  const pw = (tl.closest('.pw') as HTMLElement | null) ?? tl;
  const cq = pw.clientWidth / 100;
  const g = paperGrid(sh);
  const k = gridCss(sh);
  const uw = (k.inl * cq) / g.units,
    lh = k.lh * cq;
  const r = tl.getBoundingClientRect();
  let along: number, across: number;
  if (!g.vertical) {
    along = x - r.left + tl.scrollLeft;
    across = y - r.top + tl.scrollTop;
    if (sh.kind === 'postcard' && along > POSTCARD_DIVIDER * cq) return 'blocked';
  } else {
    // 直書由右往左；捲動時 scrollLeft 是負的
    along = y - r.top + tl.scrollTop;
    across = r.right - x - tl.scrollLeft;
  }
  const fin = (v: number) => (Number.isFinite(v) ? v : 0);
  const row = Math.min(g.maxRows - 1, Math.max(0, fin(Math.floor(across / lh))));
  const u = Math.min(g.units - 2, Math.max(0, fin(2 * Math.floor(along / (2 * uw)))));
  return [row, u];
}

/** 手寫：這一點（以紙寬為 1）在不在可寫區域裡 */
export const inHandArea = (sh: PaperRef, x: number, y: number): boolean => {
  const a = handArea(sh);
  return x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1;
};

/** 打叉：同一次塗改、同一行的字，畫一個大叉 */
export function drawX(tl: HTMLElement, sh: Pick<ViewSheet, 'chars'>): void {
  tl.querySelectorAll('.x-over').forEach((x) => x.remove());
  const groups: Record<string, number[]> = {};
  sh.chars.forEach((o, i) =>
    o.m.forEach((m) => {
      if (m.t === 'x') (groups[m.g] = groups[m.g] || []).push(i);
    }),
  );
  if (!Object.keys(groups).length) return;
  const vert = getComputedStyle(tl).writingMode.startsWith('vertical');
  for (const g in groups) {
    const lines: Record<number, { l: number; r: number; t: number; b: number }> = {};
    groups[g]!.forEach((i) => {
      const s = tl.querySelector<HTMLElement>(`.c[data-i="${i}"]`);
      if (!s) return;
      const k = Math.round((vert ? s.offsetLeft : s.offsetTop) / 4);
      const L = lines[k] || (lines[k] = { l: 1e9, r: -1e9, t: 1e9, b: -1e9 });
      L.l = Math.min(L.l, s.offsetLeft);
      L.r = Math.max(L.r, s.offsetLeft + s.offsetWidth);
      L.t = Math.min(L.t, s.offsetTop);
      L.b = Math.max(L.b, s.offsetTop + s.offsetHeight);
    });
    Object.values(lines).forEach((L) => {
      const w = L.r - L.l,
        h = L.b - L.t;
      const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sv.setAttribute('class', 'x-over');
      sv.setAttribute('width', String(w));
      sv.setAttribute('height', String(h));
      sv.style.left = L.l + 'px';
      sv.style.top = L.t + 'px';
      sv.innerHTML = `<path d="M2 3 L${w - 2} ${h - 3} M3 ${h - 2} L${w - 3} 3" stroke="${G}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`;
      tl.append(sv);
    });
  }
}

export function strokeDraw(c: CanvasRenderingContext2D, s: Stroke, w: number): void {
  const P = PENS[s.pen] || PENS.ball!;
  c.strokeStyle = s.pen === 'pencil' ? '#4A4F55' : s.color;
  c.globalAlpha = P.a;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const pts = s.pts;
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0]![0] * w, pts[0]![1] * w, (P.w * w) / 1240, 0, 7);
    c.fillStyle = c.strokeStyle;
    c.fill();
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!;
    c.lineWidth = ((P.w * w) / 620) * (P.pr ? 0.45 + b[2] : 1);
    c.beginPath();
    c.moveTo(a[0] * w, a[1] * w);
    c.lineTo(b[0] * w, b[1] * w);
    c.stroke();
  }
  c.globalAlpha = 1;
}

export function drawInk(cv: HTMLCanvasElement, sh: Pick<ViewSheet, 'strokes'>): void {
  const p = cv.parentElement;
  if (!p) return;
  const w = p.clientWidth,
    h = p.clientHeight,
    dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const c = cv.getContext('2d');
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  sh.strokes.forEach((s) => strokeDraw(c, s, w));
}

/** 縮圖：照 620px 寬排版後整張縮放 */
export function mountSheet(host: HTMLElement, sh: ViewSheet, width: number, env?: PaperEnv | null): void {
  host.classList.add('thumb');
  host.style.width = width + 'px';
  const pw = el('div', 'pw fixed');
  const { p, tl, cv } = buildPaper(sh, env);
  pw.append(p);
  host.replaceChildren(pw);
  const s = width / 620;
  pw.style.transform = `scale(${s})`;
  renderType(tl, sh, false);
  host.style.height = Math.ceil(p.offsetHeight * s) + 'px';
  drawInk(cv, sh);
  // 自訂字型晚一點才載完：字形換了，高度與打叉的位置要重算
  if (isCustomFont(sh.font))
    void fontLoaded(sh.font).then((ok) => {
      if (!ok || !host.isConnected) return;
      host.style.height = Math.ceil(p.offsetHeight * s) + 'px';
      drawX(tl, sh);
    });
}
