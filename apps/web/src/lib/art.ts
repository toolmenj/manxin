/**
 * 信封、郵票、郵戳、櫃台小物的畫法（移植自原型 stampArt／pmArt／postmark／envFrontHTML／envBackHTML…）。
 * 回傳 HTML 字串（內容都經過 esc），由元件 innerHTML 掛上去，跟原型一模一樣。
 */
import type { EnvelopeKind, EnvelopeText, Fold, Pack, Pos, PostmarkId, ReturnPostmark, StampId, Stroke } from '@manxin/shared';
import { fontCSS, PENS } from './paper.ts';
import { roc } from './time.ts';
import { $, $$, esc, rng, uid } from './util.ts';
import type { Era } from './time.ts';

export const ENVS: Record<EnvelopeKind, { label: string; sub: string; w: number; h: number; cl: 'strip' | 'glue' | 'wax' | 'none'; ar: number }> = {
  post: { label: '郵政信封', sub: '易撕帶封口', w: 1.05, h: 0.52, cl: 'strip', ar: 2.02 },
  kraft: { label: '牛皮紙信封', sub: '膠貼封口', w: 1.05, h: 0.52, cl: 'glue', ar: 2.02 },
  chinese: { label: '中式直式信封', sub: '膠貼・紅框', w: 0.45, h: 0.86, cl: 'glue', ar: 0.52 },
  wax: { label: '米白方信封', sub: '火漆蠟封', w: 0.75, h: 0.55, cl: 'wax', ar: 1.36 },
  custom: { label: '自己上傳', sub: '膠貼封口', w: 1.05, h: 0.52, cl: 'glue', ar: 2.02 },
  card: { label: '明信片', sub: '不用信封', w: 9, h: 9, cl: 'none', ar: 1.5 },
};
export const STAMPS: Record<StampId, string> = { plum: '梅花', junk: '帆船', bird: '藍鵲', tear: '淚滴' };
export const PMS: Record<PostmarkId, string> = { date: '圓形日戳', wave: '波浪機戳' };

/** 畫面用的信封（櫃台狀態或寄出時的快照），圖片已換成網址 */
export interface ViewPkg {
  env: EnvelopeKind;
  stamp: StampId;
  stampSrc: string | null;
  pm: PostmarkId;
  pmSrc: string | null;
  skin: string | null;
  stampPos: Pos | null;
  pmPos: Pos | null;
  pmAt: number | null;
  etxt: { from: EnvelopeText; to: EnvelopeText };
  efont?: string;
  folds: Fold[];
  pack: Pack | null;
  rot: boolean;
}

export function stampArt(id: StampId | string, src?: string | null): string {
  const frame = (inner: string) =>
    `<svg viewBox="0 0 64 76" class="stp" aria-hidden="true"><rect x="2" y="2" width="60" height="72" fill="#FBFAF4"/><rect x="2" y="2" width="60" height="72" fill="none" stroke="#FBFAF4" stroke-width="5" stroke-dasharray="0 6" stroke-linecap="round"/>${inner}</svg>`;
  if (src) return frame(`<image href="${esc(src)}" x="8" y="8" width="48" height="60" preserveAspectRatio="xMidYMid slice"/>`);
  const A: Record<string, string> = {
    plum: `<rect x="8" y="8" width="48" height="60" fill="#F3E3C8"/><path d="M14 66 Q22 52 30 44 Q36 38 44 30" stroke="#5A3A1E" stroke-width="2.4" fill="none"/>${[0, 1, 2, 3, 4]
      .map((i) => {
        const a = i * 1.2566 - 1.57;
        return `<circle cx="${(34 + Math.cos(a) * 6).toFixed(1)}" cy="${(38 + Math.sin(a) * 6).toFixed(1)}" r="5" fill="#C8423A"/>`;
      })
      .join('')}<circle cx="34" cy="38" r="2.6" fill="#E9C25A"/>`,
    junk: `<rect x="8" y="8" width="48" height="60" fill="#CFE0E6"/><path d="M8 56 Q16 52 24 56 T40 56 T56 56 V68 H8Z" fill="#3E6E8E"/><path d="M18 54 H48 L44 60 H22Z" fill="#6B3E1E"/><path d="M32 22 V54" stroke="#6B3E1E" stroke-width="1.6"/><path d="M33 24 L46 50 H33Z" fill="#C9763A" stroke="#6B3E1E"/><path d="M31 28 L20 50 H31Z" fill="#D88A4A" stroke="#6B3E1E"/>`,
    bird: `<rect x="8" y="8" width="48" height="60" fill="#EAF0E2"/><path d="M14 58 Q30 54 50 60" stroke="#6B5A3A" stroke-width="2" fill="none"/><path d="M24 44 Q32 32 44 38 Q48 42 42 48 Q34 52 24 44Z" fill="#2A5DA8"/><circle cx="42" cy="38" r="5" fill="#1A1A1A"/><path d="M46 38 L52 37 L46 40Z" fill="#C8423A"/><path d="M26 46 Q16 56 10 62 M28 46 Q20 58 16 66" stroke="#2A5DA8" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    tear: `<rect x="8" y="8" width="48" height="60" fill="#E8D7B4" stroke="#1A120C" stroke-width="2"/><path d="M32 20 Q44 40 42 50 Q40 60 32 60 Q24 60 22 50 Q20 40 32 20Z" fill="#9BC3D9" stroke="#1A120C" stroke-width="2.4" stroke-linejoin="round"/><path d="M28 46 Q28 54 33 55" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  };
  return frame(
    (A[id] || A.plum) +
      `<text x="11" y="18" font-size="8" fill="#3B2F1C" font-family="LXGW WenKai TC, serif" font-weight="700">慢信</text><text x="53" y="66" font-size="9" text-anchor="end" fill="#3B2F1C" font-family="IBM Plex Mono, monospace">8</text>`,
  );
}

export function pmArt(id: PostmarkId | string, src: string | null | undefined, office: string, t: number): string {
  if (src) return `<img class="pmi" src="${esc(src)}" alt="">`;
  const C = 'rgba(30,30,48,.72)',
    tx = esc(String(office || '').slice(0, 8));
  if (id === 'wave')
    return `<svg viewBox="0 0 200 80" class="pmi" aria-hidden="true"><g fill="none" stroke="${C}" stroke-width="2.6">${[18, 30, 42, 54, 66].map((y) => `<path d="M80 ${y} q15 -8 30 0 t30 0 t30 0 t30 0"/>`).join('')}<circle cx="38" cy="40" r="32"/></g><text x="38" y="36" text-anchor="middle" font-size="10" fill="${C}" font-family="Noto Sans TC" font-weight="700">${tx}</text><text x="38" y="52" text-anchor="middle" font-size="10" fill="${C}" font-family="IBM Plex Mono">${roc(t)}</text></svg>`;
  return `<svg viewBox="0 0 90 90" class="pmi" aria-hidden="true"><g fill="none" stroke="${C}" stroke-width="2.6"><circle cx="45" cy="45" r="40"/><circle cx="45" cy="45" r="27"/><line x1="18" y1="38" x2="72" y2="38"/><line x1="18" y1="54" x2="72" y2="54"/></g><text x="45" y="20" text-anchor="middle" font-size="10" fill="${C}" font-family="Noto Sans TC" font-weight="700">${tx}</text><text x="45" y="50" text-anchor="middle" font-size="11" fill="${C}" font-family="IBM Plex Mono">${roc(t)}</text><text x="45" y="78" text-anchor="middle" font-size="9" fill="${C}" font-family="Noto Sans TC">慢信</text></svg>`;
}

/** 退件郵戳：形狀、墨色、日期都由後端依目的地決定（ReturnPostmark），這裡只畫 */
export function returnPostmarkSVG(pm: ReturnPostmark, seed: string): string {
  const r = rng(seed),
    shape = pm.shape,
    col = pm.color;
  const rot = (r() * 30 - 15).toFixed(1),
    id = 'pm' + uid(),
    place = pm.place,
    name = place.length > 12 ? place.slice(0, 12) : place;
  let frame: string;
  if (shape === 0) frame = `<circle cx="80" cy="80" r="62"/><circle cx="80" cy="80" r="46"/>`;
  else if (shape === 1) frame = `<circle cx="80" cy="80" r="62"/><circle cx="80" cy="80" r="58"/><circle cx="80" cy="80" r="44"/>`;
  else if (shape === 2) frame = `<ellipse cx="80" cy="80" rx="72" ry="58"/><ellipse cx="80" cy="80" rx="56" ry="42"/>`;
  else frame = `<polygon points="80,16 138,48 138,112 80,144 22,112 22,48"/><circle cx="80" cy="80" r="44"/>`;
  return `<svg viewBox="0 0 160 160" class="pmark" role="img" aria-label="退件郵戳：${esc(place)} ${esc(pm.date)}" style="transform:rotate(${rot}deg);opacity:.86;filter:url(#inky)">
  <defs><path id="${id}a" d="M28,80 a52,52 0 0,1 104,0"/><path id="${id}b" d="M30,86 a50,50 0 0,0 100,0"/></defs>
  <g fill="none" stroke="${esc(col)}" stroke-width="2.6">${frame}<line x1="38" y1="66" x2="122" y2="66"/><line x1="38" y1="96" x2="122" y2="96"/></g>
  <g fill="${esc(col)}" font-family="Noto Sans TC, sans-serif" font-weight="700">
   <text font-size="12.5" letter-spacing="1"><textPath href="#${id}a" startOffset="50%" text-anchor="middle">${esc(name)}</textPath></text>
   <text font-size="11" letter-spacing="2"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">退件 RETOUR</textPath></text>
   <text x="80" y="87" font-size="16" text-anchor="middle" font-family="IBM Plex Mono, monospace">${esc(pm.date)}</text>
  </g></svg>`;
}

export function stampSVG(box: 'green' | 'red'): string {
  const c = box === 'red' ? '#B3372B' : '#1E6A4A';
  return `<svg viewBox="0 0 64 76" width="64" height="76" aria-label="郵票"><rect x="2" y="2" width="60" height="72" fill="#FBFAF4"/><rect x="2" y="2" width="60" height="72" fill="none" stroke="#FBFAF4" stroke-width="5" stroke-dasharray="0 6" stroke-linecap="round"/><rect x="8" y="8" width="48" height="60" fill="${c}"/><path d="M8 52 L22 36 L30 44 L40 30 L56 50 L56 68 L8 68Z" fill="rgba(255,255,255,.22)"/><circle cx="44" cy="20" r="5" fill="rgba(255,255,255,.5)"/><text x="14" y="24" font-size="11" fill="#FBFAF4" font-family="LXGW WenKai TC, serif" font-weight="700">慢信</text><text x="50" y="64" font-size="10" fill="#FBFAF4" text-anchor="end" font-family="IBM Plex Mono, monospace">${box === 'red' ? '限時' : 'NT$8'}</text></svg>`;
}

export function rubberSVG(): string {
  return `<svg viewBox="0 0 60 80" aria-hidden="true"><rect x="22" y="2" width="16" height="34" rx="8" fill="#8A5A2E"/><ellipse cx="30" cy="6" rx="10" ry="6" fill="#A8723D"/><rect x="8" y="36" width="44" height="14" rx="3" fill="#6B4423"/><rect x="6" y="50" width="48" height="10" rx="2" fill="#2A2A35"/></svg>`;
}

const ZONES: Record<'h' | 'chinese' | 'card', Record<'from' | 'to', [number, number, number, number]>> = {
  h: { from: [5, 8, 44, 28], to: [28, 48, 64, 42] },
  chinese: { from: [7, 46, 16, 48], to: [37, 14, 26, 68] },
  card: { from: [56, 82, 40, 13], to: [56, 30, 40, 46] },
};
const zonesOf = (env: EnvelopeKind) => (env === 'chinese' ? ZONES.chinese : env === 'card' ? ZONES.card : ZONES.h);

export interface FrontOpts {
  live?: boolean;
  active?: 'from' | 'to' | null;
  office?: string;
  t?: number;
  stampTaken?: boolean;
  stampFiber?: boolean;
}

export function envFrontHTML(pk: ViewPkg, o: FrontOpts = {}): string {
  const E = ENVS[pk.env] || ENVS.kraft,
    Z = zonesOf(pk.env),
    vert = pk.env === 'chinese',
    ff = fontCSS(pk.efont || 'kai');
  let deco = '';
  if (pk.env === 'post') deco = '<span class="ev-band"></span><span class="ev-zip"><i></i><i></i><i></i><i></i><i></i></span>';
  else if (pk.env === 'kraft') deco = '<span class="ev-zip"><i></i><i></i><i></i></span>';
  else if (pk.env === 'chinese') deco = '<span class="ev-frame"></span>';
  const zone = (k: 'from' | 'to') => {
    const [x, y, w, h] = Z[k];
    return `<div class="ez ez-${k}${vert ? ' vert' : ''}${o.active === k ? ' on' : ''}" data-z="${k}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"><span class="ez-t" style="font-family:${ff}"></span><canvas class="ez-c"></canvas>${o.live ? `<span class="ez-lbl">${k === 'to' ? '收件人' : '寄件人'}</span>` : ''}</div>`;
  };
  const st = pk.stampPos
    ? `<div class="ev-stamp" style="left:${pk.stampPos.x * 100}%;top:${pk.stampPos.y * 100}%;transform:translate(-50%,-50%) rotate(${pk.stampPos.r}deg)">${o.stampTaken ? `<span class="ghost-stp${o.stampFiber ? ' fib' : ''}"></span>` : stampArt(pk.stamp, pk.stampSrc)}</div>`
    : '';
  const pm = pk.pmPos
    ? `<div class="ev-pm" style="left:${pk.pmPos.x * 100}%;top:${pk.pmPos.y * 100}%;transform:translate(-50%,-50%) rotate(${pk.pmPos.r}deg)">${pmArt(pk.pm, pk.pmSrc, o.office || '', pk.pmAt || o.t || Date.now())}</div>`
    : '';
  const skin = pk.env === 'custom' && pk.skin ? `background-image:url(${esc(pk.skin)})` : '';
  return `<div class="envf ev-${pk.env}" style="aspect-ratio:${E.ar};${skin}">${pk.env === 'card' ? '<div class="ev-card"></div>' : ''}${deco}${zone('from')}${zone('to')}${st}${pm}</div>`;
}

export interface BackOpts {
  opened?: boolean;
  waxTaken?: boolean;
  waxFiber?: boolean;
  rough?: boolean;
  cutPath?: string;
  method?: string | null;
}

export function envBackHTML(pk: ViewPkg, r: BackOpts, era: Era): string {
  const E = ENVS[pk.env] || ENVS.kraft;
  const fl =
    E.cl === 'strip'
      ? `<div class="eb-strip${r.opened ? ' gone' : ''}">${r.opened ? '' : '<span class="eb-tab">易撕</span>'}</div>`
      : `<div class="eb-flap${r.opened ? ' open' : ''}"></div>`;
  const wax =
    E.cl !== 'wax'
      ? ''
      : r.waxTaken
        ? `<div class="eb-waxmark${r.waxFiber ? ' fib' : ''}"></div>`
        : `<div class="eb-wax" title="按住不放可以撬下來">${era === 'minguo' ? '緘' : '慢'}</div>`;
  const skin = pk.env === 'custom' && pk.skin ? `background-image:url(${esc(pk.skin)})` : '';
  return `<div class="envb ev-${pk.env}" style="aspect-ratio:${E.ar};${skin}"><div class="eb-sides"></div>${fl}${wax}${r.rough ? '<div class="eb-rough"></div>' : ''}<svg class="eb-trace" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${esc(r.cutPath || '')}" fill="none" stroke="rgba(50,32,14,.75)" stroke-width="${r.method === 'tear' ? 1.6 : 0.9}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg></div>`;
}

export function zDraw(c: CanvasRenderingContext2D, s: Stroke, w: number): void {
  const P = PENS[s.pen] || PENS.ball!;
  c.strokeStyle = s.pen === 'pencil' ? '#4A4F55' : s.color;
  c.globalAlpha = P.a;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const p = s.pts;
  for (let i = 1; i < p.length; i++) {
    c.lineWidth = P.w * 0.8 * (P.pr ? 0.5 + p[i]![2] : 1);
    c.beginPath();
    c.moveTo(p[i - 1]![0] * w, p[i - 1]![1] * w);
    c.lineTo(p[i]![0] * w, p[i]![1] * w);
    c.stroke();
  }
  c.globalAlpha = 1;
}

/** 信封上寫的字（打字與手寫） */
export function paintZones(root: ParentNode | null, pk: Pick<ViewPkg, 'etxt'>): void {
  if (!root) return;
  $$<HTMLElement>('.ez', root).forEach((z) => {
    const d = pk.etxt[z.dataset.z as 'from' | 'to'];
    if (!d) return;
    const t = $('.ez-t', z);
    if (t) t.textContent = d.c.join('');
    const cv = $<HTMLCanvasElement>('.ez-c', z),
      w = z.clientWidth,
      h = z.clientHeight;
    if (!w || !cv) return;
    const dpr = devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    const c = cv.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    d.s.forEach((s) => zDraw(c, s, w));
  });
}

/* ---------- 畚箕、掃把、垃圾桶：八〇年代是塑膠和鐵皮，民國初年是竹編 ---------- */
export function panSVG(era: Era): string {
  const mg = era === 'minguo',
    id = 'bw' + uid(),
    body = mg ? `url(#${id})` : '#C8423A',
    edge = mg ? '#7A5A26' : '#9E2F28';
  return `<svg viewBox="0 0 180 112" aria-hidden="true">${mg ? `<defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)"><rect width="8" height="8" fill="#C9A15A"/><path d="M0 4H8" stroke="#8A6A2E" stroke-width="1.6"/><path d="M4 0V4M0 4V8M8 4V8" stroke="#A9843F" stroke-width="1"/></pattern></defs>` : ''}
  <ellipse cx="100" cy="110" rx="80" ry="4" fill="rgba(0,0,0,.35)"/>
  <path d="M34 34 L6 2" stroke="${mg ? '#B88B45' : edge}" stroke-width="${mg ? 7 : 9}" stroke-linecap="round"/>${mg ? '<path d="M22 19l5-4M14 9l5-4" stroke="#7A5A26" stroke-width="2"/>' : ''}
  <path d="M24 24 Q22 100 30 106 L176 110 L176 104 Q100 70 30 24Z" fill="${body}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M30 24 Q100 70 176 104" stroke="${mg ? '#E9CF8E' : 'rgba(255,255,255,.4)'}" stroke-width="${mg ? 3 : 2}" fill="none"/>
  ${mg ? '' : '<path d="M60 54v38M90 70v28M120 84v18M150 96v10" stroke="rgba(0,0,0,.16)" stroke-width="2"/>'}</svg>`;
}

export function broomSVG(era: Era): string {
  if (era === 'minguo') {
    let tw = '';
    for (let i = 0; i < 22; i++) {
      const x = 6 + i * 4.1;
      tw += `<path d="M50 152 Q${(50 + (x - 50) * 0.45).toFixed(0)} 200 ${x.toFixed(0)} 258" stroke="${i % 3 ? '#8C6A36' : '#B08A4C'}" stroke-width="1.6" fill="none"/>`;
    }
    return `<svg viewBox="0 0 100 260" aria-hidden="true"><rect x="47" y="0" width="6" height="160" rx="3" fill="#C49A55"/><path d="M47 40h6M47 85h6M47 128h6" stroke="#8A6A2E" stroke-width="1.5"/>${tw}<rect x="42" y="146" width="16" height="10" rx="2" fill="#7A2E22"/></svg>`;
  }
  let br = '';
  for (let i = 0; i < 14; i++) br += `<path d="M${(32 + i * 2.8).toFixed(1)} 186 L${(13 + i * 5.6).toFixed(1)} 258" stroke="#B8862A" stroke-width="1"/>`;
  return `<svg viewBox="0 0 100 260" aria-hidden="true"><rect x="47" y="0" width="6" height="174" rx="3" fill="#3A6E9E"/><rect x="45" y="0" width="10" height="14" rx="3" fill="#C8423A"/><path d="M30 186 L10 258 L90 258 L70 186Z" fill="#E2B13C"/>${br}<rect x="28" y="170" width="44" height="18" rx="4" fill="#C8423A"/></svg>`;
}

export function binHTML(era: Era): string {
  const id = 'bb' + uid();
  if (era === 'minguo')
    return `<svg viewBox="0 0 104 132" aria-hidden="true"><defs><pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#B8904C"/><path d="M0 5H10" stroke="#7A5A26" stroke-width="2"/><path d="M5 0V5M0 5V10M10 5V10" stroke="#9C7838" stroke-width="1.2"/></pattern></defs><ellipse cx="52" cy="130" rx="46" ry="4" fill="rgba(0,0,0,.35)"/><path d="M8 14 L96 14 L88 128 Q52 134 16 128Z" fill="url(#${id})" stroke="#6A4A1C" stroke-width="2"/><rect x="5" y="8" width="94" height="10" rx="4" fill="#8A6A2E"/><rect x="34" y="62" width="36" height="24" fill="#EAD9AE" stroke="#6A4A1C"/><text x="52" y="79" text-anchor="middle" font-size="13" fill="#4A2E10" style="font-family:var(--display)">字紙</text></svg>`;
  return `<svg viewBox="0 0 104 132" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#7E8784"/><stop offset=".35" stop-color="#D6DBD8"/><stop offset=".7" stop-color="#9AA3A0"/><stop offset="1" stop-color="#6A726F"/></linearGradient></defs><ellipse cx="52" cy="130" rx="46" ry="4" fill="rgba(0,0,0,.35)"/><path d="M10 14 L94 14 L88 126 Q52 132 16 126Z" fill="url(#${id})"/><path d="M12 40H92M14 90H90" stroke="rgba(0,0,0,.18)" stroke-width="2"/><rect x="40" y="120" width="24" height="8" rx="2" fill="#3C4240"/></svg><div class="tr-lid"><svg viewBox="0 0 112 18" aria-hidden="true"><path d="M2 16 Q4 4 56 3 Q108 4 110 16Z" fill="#B9C0BD" stroke="#5E6663"/><rect x="48" y="0" width="16" height="5" rx="2" fill="#3C4240"/></svg></div>`;
}
