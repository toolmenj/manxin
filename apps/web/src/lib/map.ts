/**
 * 郵局示意地圖（移植自原型 mapSVG／initMap／placeWalker）。
 * 地點、距離、路程分鐘數都以後端 GET /places 為準；這裡只有畫圖用的座標與彎曲的巷弄。
 */
import { anim, INOUT } from './motion.ts';

export const MAP_POS: Record<string, { x: number; y: number; ly: number }> = {
  box: { x: 268, y: 96, ly: -15 },
  po: { x: 70, y: 58, ly: 25 },
  main: { x: 372, y: 212, ly: -17 },
};
const HOME = { x: 188, y: 158 };
/* 巷弄是彎的：每條路線沿著老街拐來拐去 */
const ROUTES: Record<string, string> = {
  box: 'M188 158 C197 141 213 148 222 131 S236 108 249 113 S263 103 268 96',
  po: 'M188 158 C168 151 160 129 140 124 S111 119 106 100 S84 73 70 58',
  main: 'M188 158 C214 170 232 160 252 177 S283 207 312 197 S349 194 372 212',
};
const ALLEYS = [
  'M-10 172 C40 160 92 178 130 163 S172 150 188 158',
  'M188 158 C230 151 281 147 330 133 S400 118 430 125',
  'M140 124 C152 96 171 72 167 42 S173 8 178 -10',
  'M249 113 C281 82 301 62 341 55 S401 41 430 45',
  'M312 197 C320 228 300 252 297 282',
  'M106 100 C80 117 50 121 20 140 S-6 157 -10 161',
  'M222 131 C241 151 270 151 300 141',
  'M70 58 C52 42 30 36 -10 30',
  'M167 42 C200 30 228 40 262 22 S300 4 310 -10',
  'M252 177 C238 200 222 214 206 232 S186 250 180 282',
];
const TREES = [
  [34, 92],
  [44, 100],
  [120, 190],
  [131, 196],
  [160, 92],
  [300, 96],
  [312, 90],
  [395, 160],
  [404, 170],
  [214, 58],
  [60, 200],
  [345, 170],
  [24, 250],
  [402, 90],
];
const LAMPS = [
  [213, 147],
  [141, 122],
  [253, 175],
  [330, 131],
  [105, 99],
  [300, 195],
  [167, 44],
];

export interface MapPlace {
  id: string;
  name: string;
}

export function mapSVG(places: MapPlace[], sel: string, walking: boolean): string {
  const pl = places.find((p) => p.id === sel),
    ink = 'var(--ink)';
  const roads = [...ALLEYS, ...Object.values(ROUTES)];
  return `<svg viewBox="0 0 420 270" role="img" aria-label="附近郵局示意圖：從家沿巷弄走到${pl ? pl.name : '郵局'}">
  <defs>
    <filter id="mpWob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="5"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter>
    <filter id="mpPaper"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 .35 0 0 0 0 .27 0 0 0 0 .15 0 0 0 .22 0"/></filter>
    <pattern id="mpPaddy" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)"><path d="M0 3.5 H7" stroke="var(--post)" stroke-width=".9" opacity=".45"/></pattern>
    <radialGradient id="mpVig" cx="50%" cy="50%" r="70%"><stop offset=".55" stop-color="#2A1C0C" stop-opacity="0"/><stop offset="1" stop-color="#2A1C0C" stop-opacity=".32"/></radialGradient>
    <radialGradient id="mpFogG" gradientUnits="userSpaceOnUse" cx="${HOME.x}" cy="${HOME.y}" r="125"><stop offset="0" stop-color="#140E06" stop-opacity="0"/><stop offset=".32" stop-color="#140E06" stop-opacity="0"/><stop offset="1" stop-color="#140E06" stop-opacity=".58"/></radialGradient>
    <radialGradient id="mpLampG"><stop offset="0" stop-color="#FFE3A0" stop-opacity=".85"/><stop offset="1" stop-color="#FFE3A0" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="420" height="270" fill="var(--surface-2)"/>
  <g opacity=".9"><path d="M14 190 Q60 180 100 195 L92 231 Q50 238 12 224Z" fill="url(#mpPaddy)" stroke="var(--line)"/><path d="M330 58 Q380 50 412 64 L405 100 Q360 106 334 95Z" fill="url(#mpPaddy)" stroke="var(--line)"/><path d="M200 196 Q232 188 248 200 L238 222 Q214 226 198 216Z" fill="url(#mpPaddy)" stroke="var(--line)"/></g>
  <g class="mp-river"><path d="M-10 252 C50 236 100 268 160 250 S262 232 320 252 S400 262 430 244" stroke="#8FB6CE" stroke-width="17" fill="none" opacity=".6" stroke-linecap="round"/><path class="flow" d="M-10 252 C50 236 100 268 160 250 S262 232 320 252 S400 262 430 244" stroke="#E8F1F5" stroke-width="1.2" fill="none" stroke-dasharray="10 16" opacity=".8"/></g>
  <g filter="url(#mpWob)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="var(--line)" stroke-width="12">${roads.map((d) => `<path d="${d}"/>`).join('')}</g>
    <g stroke="var(--surface)" stroke-width="9.5">${roads.map((d) => `<path d="${d}"/>`).join('')}</g>
    <path d="M287 243 Q300 232 313 243 M287 249 Q300 238 313 249" stroke="${ink}" stroke-width="1.4"/>
  </g>
  <g fill="var(--post)" opacity=".42">${TREES.map(([x, y], i) => `<g class="sway" style="animation-delay:-${(i * 0.7).toFixed(1)}s;transform-origin:${x}px ${y! + 6}px"><circle cx="${x}" cy="${y}" r="5.5"/><circle cx="${x! + 4}" cy="${y! + 3}" r="4"/><circle cx="${x! - 4}" cy="${y! + 3}" r="4"/></g>`).join('')}</g>
  <g transform="translate(222 213)"><path d="M-13 -1 Q-7 -4 0 -10 Q7 -4 13 -1" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="-8" y="-1" width="16" height="9" fill="var(--seal)" opacity=".75"/><text y="20" text-anchor="middle" font-size="9" fill="var(--muted)" style="font-family:var(--hand)">土地公廟</text></g>
  ${LAMPS.map(([x, y], i) => `<g class="lamp" style="animation-delay:-${(i * 1.37).toFixed(2)}s"><circle cx="${x}" cy="${y}" r="10" fill="url(#mpLampG)"/><circle cx="${x}" cy="${y}" r="1.8" fill="#C98A1E"/></g>`).join('')}
  ${pl && ROUTES[pl.id] ? `<path class="route-ghost" d="${ROUTES[pl.id]}" fill="none" stroke="var(--post)" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7" opacity=".55"/><path id="routeP" d="${ROUTES[pl.id]}" fill="none" stroke="var(--post)" stroke-width="3.4" stroke-linecap="round" ${walking ? '' : 'class="march"'}/>` : ''}
  <g id="steps" fill="${ink}"></g>
  ${places
    .map((p) => {
      const on = p.id === sel,
        m = MAP_POS[p.id];
      if (!m) return '';
      return `<g transform="translate(${m.x} ${m.y})">${on ? `<circle class="pulse" r="15" fill="none" stroke="var(--post)" stroke-width="1.6"/>` : ''}${p.id === 'box' ? `<rect x="-9" y="-11" width="8" height="15" rx="2.5" fill="#1E6A4A"/><rect x="1" y="-11" width="8" height="15" rx="2.5" fill="#B3372B"/>` : `<circle r="11" fill="#1E6A4A"/><text y="4.5" text-anchor="middle" font-size="12" fill="#fff" font-family="Noto Sans TC" font-weight="700">郵</text>`}<text class="mp-lbl" y="${m.ly}" text-anchor="middle" font-size="12" fill="var(--ink)" style="font-family:var(--hand)" ${on ? 'font-weight="700"' : ''}>${p.name}</text></g>`;
    })
    .join('')}
  <g transform="translate(${HOME.x} ${HOME.y})"><path d="M-10 1 L0 -9 L10 1 V9 H-10Z" fill="${ink}"/><rect x="-2.5" y="3" width="5" height="6" fill="var(--mustard)" class="lamp"/><text class="mp-lbl" y="23" text-anchor="middle" font-size="11" fill="var(--ink)" style="font-family:var(--hand)">家</text></g>
  ${walking ? `<rect width="420" height="270" fill="url(#mpFogG)" pointer-events="none"/><g id="me" transform="translate(${HOME.x} ${HOME.y})"><g class="bob"><circle r="19" fill="url(#mpLampG)" opacity=".75"/><circle r="6.5" fill="var(--seal)" stroke="#fff" stroke-width="2"/></g></g>` : ''}
  <rect width="420" height="270" filter="url(#mpPaper)" pointer-events="none"/>
  <rect width="420" height="270" fill="url(#mpVig)" pointer-events="none"/>
  <g transform="translate(22 24)" opacity=".7"><path d="M0 9 L0 -9 M-4 -4 L0 -9 L4 -4" stroke="${ink}" stroke-width="1.4" fill="none" stroke-linecap="round"/><text y="20" text-anchor="middle" font-size="9" fill="var(--ink)" style="font-family:var(--hand)">北</text></g>
  <text x="410" y="264" text-anchor="end" font-size="10" fill="var(--muted)" style="font-family:var(--hand)">示意圖・郵局為範例</text></svg>`;
}

/** 路線一筆一筆畫出來 */
export function drawRoute(root: ParentNode): void {
  const p = root.querySelector<SVGPathElement>('#routeP');
  if (!p || typeof p.getTotalLength !== 'function') return;
  const L = p.getTotalLength();
  p.classList.remove('march');
  p.style.strokeDasharray = `${L} ${L}`;
  void anim(p, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { d: 1500, e: INOUT }).then(() => {
    if (!p.isConnected) return;
    p.getAnimations().forEach((a) => a.cancel());
    p.style.strokeDasharray = '';
    p.classList.add('march');
  });
  const pu = root.querySelector('.pulse');
  if (pu) void anim(pu, [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { d: 1500 });
}

/** 出發後：腳印跟著走，燈光只照亮身邊 */
export function placeWalker(root: ParentNode, prog: number): void {
  const path = root.querySelector<SVGPathElement>('#routeP'),
    me = root.querySelector('#me');
  if (!path || !me || typeof path.getTotalLength !== 'function') return;
  const L = path.getTotalLength(),
    d = L * prog,
    p = path.getPointAtLength(d);
  me.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
  path.style.strokeDasharray = `${d.toFixed(1)} ${L}`;
  const fg = root.querySelector('#mpFogG');
  if (fg) {
    fg.setAttribute('cx', p.x.toFixed(1));
    fg.setAttribute('cy', p.y.toFixed(1));
  }
  const st = root.querySelector<SVGGElement>('#steps'),
    n = Math.floor(d / 9);
  if (st && String(n) !== st.dataset.n) {
    st.dataset.n = String(n);
    let h = '';
    for (let i = 0; i < n; i++) {
      const a = path.getPointAtLength(i * 9 + 3),
        b = path.getPointAtLength(i * 9 + 4.5),
        ang = Math.atan2(b.y - a.y, b.x - a.x),
        o = i % 2 ? 2.3 : -2.3,
        x = a.x - Math.sin(ang) * o,
        y = a.y + Math.cos(ang) * o;
      h += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="1.9" ry="1.05" opacity="${(0.12 + (0.5 * (i + 1)) / n).toFixed(2)}" transform="rotate(${((ang * 180) / Math.PI).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
    st.innerHTML = h;
  }
}
