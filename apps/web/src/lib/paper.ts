/**
 * 信紙的畫法（移植自原型 buildPaper／renderType／drawX／strokeDraw／drawInk／mountSheet）。
 * 純畫面：輸入一張信紙的內容，畫成 DOM。React 元件用 ref 呼叫這些函式。
 */
import type { CharCell, SheetDTO, Stroke } from '@manxin/shared';
import { el, esc, hash } from './util.ts';

export const FONTS: Record<string, { label: string; css: string }> = {
  typewriter: { label: '老式打字機', css: "'Special Elite','Noto Serif TC',serif" },
  lead: { label: '華文打字機（鉛字）', css: "'Cactus Classical Serif','Noto Serif TC',serif" },
  ming: { label: '鉛字明體', css: "'Noto Serif TC',serif" },
  kai: { label: '文楷', css: "'LXGW WenKai TC',serif" },
  song: { label: '鉛字宋體（簡）', css: "'Noto Serif SC','Noto Serif TC',serif" },
};
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
  chars: CharCell[];
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
    chars: sh.chars,
    strokes: sh.strokes,
    bg: sh.bgAttachmentId ? fileOf(sh.bgAttachmentId) : null,
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

export const fontCSS = (f: string): string => (FONTS[f] || FONTS.typewriter!).css;

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

export function renderType(tl: HTMLElement, sh: Pick<ViewSheet, 'chars' | 'font' | 'style' | 'kind'>, caret: boolean, newFrom = Infinity): void {
  const f = document.createDocumentFragment(),
    tw = sh.font === 'typewriter' || sh.font === 'lead';
  const v = sh.style === 'bahang' && sh.kind === 'letter',
    lg = (s: string) => `linear-gradient(${v ? '90deg,' : ''}${s})`;
  sh.chars.forEach((o, i) => {
    if (o.c === '\n') {
      f.append(document.createElement('br'));
      return;
    }
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
    f.append(s);
  });
  if (caret) {
    const c = el('span', 'caret');
    c.id = 'caret';
    f.append(c);
  }
  tl.replaceChildren(f);
  if (tl.isConnected) drawX(tl, sh);
}

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
}
