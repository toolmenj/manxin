/**
 * 廢紙的物理感（移植自原型）：揉成團的紙球、隨手對摺、平放；攤開時留下皺痕與摺面。
 * 角度、皺褶都由信紙 id 決定，同一張紙每次看起來都一樣。
 */
import type { DiscardState } from '@manxin/shared';
import { anim, INOUT } from './motion.ts';
import { mountSheet, type ViewSheet } from './paper.ts';
import { $, $$, el, hash, rng, uid } from './util.ts';

export interface TombView {
  sheet: ViewSheet;
  state: DiscardState;
}

const CRUMPLE_CACHE: Record<string, { shade: HTMLCanvasElement; disp: string }> = {};

/** 揉過再攤平的紙：三層大小不同的折面，每塊折面朝向不同，交界處就是摺痕 */
function crumpleMaps(seed: string, W: number, H: number) {
  const key = seed + '|' + W + '|' + H;
  if (CRUMPLE_CACHE[key]) return CRUMPLE_CACHE[key];
  const r = rng(seed + 'cm'),
    U = W / 560,
    LX = -0.62,
    LY = -0.78;
  const sh = document.createElement('canvas'),
    dp = document.createElement('canvas');
  sh.width = dp.width = W;
  sh.height = dp.height = H;
  const c = sh.getContext('2d'),
    d = dp.getContext('2d');
  if (!c || !d) return (CRUMPLE_CACHE[key] = { shade: sh, disp: '' });
  d.fillStyle = 'rgb(128,128,128)';
  d.fillRect(0, 0, W, H);
  const segs: [number, number, number, number, number, boolean, boolean][] = [];
  const chain = (n0: number, n1: number, l0: number, l1: number, turn: number, m: number) => {
    let x = r() * W * 1.1 - W * 0.05,
      y = r() * H * 1.1 - H * 0.05,
      a = r() * Math.PI * 2;
    const n = n0 + Math.floor(r() * (n1 - n0 + 1));
    for (let i = 0; i < n; i++) {
      const L = (l0 + r() * (l1 - l0)) * U;
      a += (r() - 0.5) * turn;
      const x2 = x + Math.cos(a) * L,
        y2 = y + Math.sin(a) * L;
      segs.push([x, y, x2, y2, m, i === 0, i === n - 1]);
      if (m === 1 && r() < 0.35) {
        const b = a + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.9),
          L2 = (40 + r() * 90) * U;
        segs.push([x2, y2, x2 + Math.cos(b) * L2, y2 + Math.sin(b) * L2, 2, false, true]);
      }
      x = x2;
      y = y2;
    }
  };
  for (let k = 0; k < 26; k++) chain(2, 5, 70, 210, 1.0, 1);
  for (let k = 0; k < 150; k++) chain(1, 3, 14, 60, 1.3, 3);
  for (let k = 0; k < 260; k++) chain(1, 1, 4, 16, 0, 4);
  const quad = (x1: number, y1: number, x2: number, y2: number, px: number, py: number, D: number) => {
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.lineTo(x2 + px * D, y2 + py * D);
    c.lineTo(x1 + px * D, y1 + py * D);
    c.closePath();
  };
  // 折面：每條摺線一側受光、一側背光，向外漸淡，疊起來就是一塊塊的折面
  for (const [x1, y1, x2, y2, m] of segs) {
    if (m === 4) continue;
    const dx = x2 - x1,
      dy = y2 - y1,
      len = Math.hypot(dx, dy) || 1,
      s = r() < 0.5 ? 1 : -1,
      px = (-dy / len) * s,
      py = (dx / len) * s;
    const D = (m === 1 ? 60 + r() * 150 : m === 2 ? 30 + r() * 60 : 10 + r() * 26) * U,
      lit = px * LX + py * LY,
      al = (m === 1 ? 0.2 : m === 2 ? 0.14 : 0.09) * (0.45 + r() * 0.55);
    const mx = (x1 + x2) / 2,
      my = (y1 + y2) / 2,
      g = c.createLinearGradient(mx, my, mx + px * D, my + py * D),
      col = lit > 0 ? '255,248,228' : '82,52,18',
      A = lit > 0 ? al * 1.2 : al;
    g.addColorStop(0, `rgba(${col},${A.toFixed(3)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    quad(x1, y1, x2, y2, px, py, D);
    c.fill();
    d.fillStyle = `rgba(${Math.round(128 + px * 90)},${Math.round(128 + py * 90)},128,${m === 1 ? 0.45 : 0.3})`;
    d.beginPath();
    d.moveTo(x1, y1);
    d.lineTo(x2, y2);
    d.lineTo(x2 + px * D * 0.6, y2 + py * D * 0.6);
    d.lineTo(x1 + px * D * 0.6, y1 + py * D * 0.6);
    d.closePath();
    d.fill();
  }
  // 摺痕本身：一條暗線，受光那側貼一條亮線；短摺痕兩端漸淡
  c.lineCap = 'round';
  for (const [x1, y1, x2, y2, m, st, en] of segs) {
    const dx = x2 - x1,
      dy = y2 - y1,
      len = Math.hypot(dx, dy) || 1,
      nx = -dy / len,
      ny = dx / len,
      ls = nx * LX + ny * LY > 0 ? 1 : -1,
      o = m === 1 ? 1.1 : 0.8;
    const dark = m === 1 ? 0.5 : m === 2 ? 0.4 : m === 3 ? 0.3 : 0.2,
      light = m === 1 ? 0.7 : m === 2 ? 0.55 : m === 3 ? 0.42 : 0.3,
      wd = m === 1 ? 1.2 : m === 4 ? 0.6 : 0.85;
    const grad = (rgb: string, al: number) => {
      const g = c.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, `rgba(${rgb},${st ? 0 : al})`);
      g.addColorStop(0.18, `rgba(${rgb},${al})`);
      g.addColorStop(0.82, `rgba(${rgb},${al})`);
      g.addColorStop(1, `rgba(${rgb},${en ? 0 : al})`);
      return g;
    };
    const k = 0.6 + r() * 0.4;
    c.strokeStyle = grad('66,40,12', dark * k);
    c.lineWidth = wd;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.strokeStyle = grad('255,251,238', light * k);
    c.lineWidth = wd * 0.9;
    c.beginPath();
    c.moveTo(x1 + nx * ls * o, y1 + ny * ls * o);
    c.lineTo(x2 + nx * ls * o, y2 + ny * ls * o);
    c.stroke();
  }
  return (CRUMPLE_CACHE[key] = { shade: sh, disp: dp.toDataURL('image/png') });
}

function applyCrumple(host: HTMLElement, it: TombView): void {
  const W = Math.round(host.clientWidth || parseFloat(host.style.width)),
    H = Math.round(host.clientHeight || parseFloat(host.style.height));
  if (!W || !H) return;
  const M = crumpleMaps(it.sheet.id, W, H),
    cv = document.createElement('canvas');
  cv.className = 'mk mk-crease';
  cv.width = W;
  cv.height = H;
  cv.getContext('2d')?.drawImage(M.shade, 0, 0);
  host.append(cv);
  const pw = host.querySelector<HTMLElement>('.pw'),
    pp = host.querySelector<HTMLElement>('.paper');
  if (!pw || !pp || !M.disp) return;
  const pwW = 620,
    pwH = pp.offsetHeight,
    id = 'cm' + uid();
  host.insertAdjacentHTML(
    'beforeend',
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${pwW}" height="${pwH}" color-interpolation-filters="sRGB"><feImage href="${M.disp}" x="0" y="0" width="${pwW}" height="${pwH}" preserveAspectRatio="none" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="${((5 * pwW) / W).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`,
  );
  pw.style.filter = `url(#${id})`;
}

export function wrinkleSVG(seed: number, o: { f?: number; s?: number; el?: number; op?: number } = {}): string {
  const id = 'wk' + uid(),
    f = o.f || 0.02,
    sc = o.s || 3,
    ev = o.el || 58;
  return `<svg class="wrk" style="opacity:${o.op || 0.75}" aria-hidden="true"><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${f}" numOctaves="4" seed="${seed % 997}"/><feDiffuseLighting surfaceScale="${sc}" lighting-color="#FFF3D8"><feDistantLight azimuth="225" elevation="${ev}"/></feDiffuseLighting></filter><rect width="100%" height="100%" filter="url(#${id})"/></svg>`;
}

/** 攤開後的紙上留下的痕跡：揉過的有皺褶，對摺的有一道摺痕 */
export function sheetMarks(host: HTMLElement, it: TombView): void {
  const sd = hash(it.sheet.id);
  if (it.state === 'crumple') {
    applyCrumple(host, it);
    host.insertAdjacentHTML('beforeend', wrinkleSVG(sd, { f: 0.035, s: 2.6, el: 58, op: 0.25 }));
  } else if (it.state === 'fold') host.insertAdjacentHTML('beforeend', `<span class="mk mk-fold"></span>${wrinkleSVG(sd, { f: 0.02, s: 2.6, op: 0.25 })}`);
}

function rayRect(a: number): [number, number] {
  const c = Math.cos(a),
    s = Math.sin(a),
    t = Math.min(50 / Math.max(1e-6, Math.abs(c)), 50 / Math.max(1e-6, Math.abs(s)));
  return [50 + c * t, 50 + s * t];
}
function rectClip(seed: string, k = 1): string {
  const r = rng(seed + 'c'),
    n = 17,
    p: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.22,
      R = 41 + r() * 8,
      b = [50 + Math.cos(a) * R, 50 + Math.sin(a) * R * 0.94] as const,
      q = rayRect(a);
    p.push(`${(b[0] + (q[0] - b[0]) * k).toFixed(1)}% ${(b[1] + (q[1] - b[1]) * k).toFixed(1)}%`);
  }
  return `polygon(${p.join(',')})`;
}
function dispTo(from: number, to: number, d: number): Promise<void> {
  const m = document.getElementById('unfoldMap');
  if (!m) return Promise.resolve();
  const t0 = performance.now();
  return new Promise((res) => {
    const st = (t: number) => {
      const k = Math.min(1, (t - t0) / d),
        e = 1 - Math.pow(1 - k, 3);
      m.setAttribute('scale', (from + (to - from) * e).toFixed(1));
      if (k < 1) requestAnimationFrame(st);
      else res();
    };
    requestAnimationFrame(st);
  });
}

/** 攤開廢紙：從紙團／對摺／平放的樣子，變回一整張帶著皺褶的信紙 */
export async function unfoldFrom(it: TombView, r0: DOMRect, tv: HTMLElement, box: HTMLElement, W: number): Promise<void> {
  const r1 = tv.getBoundingClientRect(),
    g = el('div', 'ghost');
  g.style.cssText = `position:fixed;left:${r1.left}px;top:${r1.top}px;width:${r1.width}px;height:${r1.height}px;z-index:80;pointer-events:none`;
  document.body.append(g);
  const cx = r0.left + r0.width / 2,
    cy = r0.top + r0.height / 2,
    X = r1.left + r1.width / 2;
  anim(box, [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { d: 1200, e: 'ease' });
  if (it.state === 'crumple') {
    const h = el('div', 'g-in');
    g.append(h);
    mountSheet(h, it.sheet, W);
    sheetMarks(h, it);
    const dx = cx - X,
      dy = cy - (r1.top + r1.height / 2),
      sx = r0.width / r1.width,
      sy = r0.height / r1.height;
    g.style.filter = 'url(#unfold) drop-shadow(0 14px 18px rgba(30,15,0,.45))';
    await Promise.all([
      anim(
        g,
        [
          { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(-150deg)` },
          { transform: `translate(${dx * 0.2}px,${dy * 0.2 - 24}px) scale(.58) rotate(-20deg)`, offset: 0.5 },
          { transform: `translateY(-6px) scale(1.02) rotate(2deg)`, offset: 0.85 },
          { transform: 'none' },
        ],
        { d: 2000, e: INOUT },
      ),
      anim(h, [{ clipPath: rectClip(it.sheet.id, 0) }, { clipPath: rectClip(it.sheet.id, 0.45), offset: 0.5 }, { clipPath: rectClip(it.sheet.id, 1) }], { d: 2000, e: INOUT }),
      dispTo(60, 0, 2000),
    ]);
  } else if (it.state === 'fold') {
    g.innerHTML = '<div class="g-bot"></div><div class="g-top"><div class="g-front"></div><div class="g-back"></div></div>';
    const bot = $('.g-bot', g)!,
      top = $('.g-top', g)!,
      fr = $('.g-front', g)!;
    mountSheet(bot, it.sheet, W);
    sheetMarks(bot, it);
    mountSheet(fr, it.sheet, W);
    sheetMarks(fr, it);
    const dx = cx - X,
      dy = cy - (r1.top + r1.height * 0.75),
      sx = r0.width / r1.width,
      sy = r0.height / (r1.height / 2);
    g.style.transformOrigin = '50% 75%';
    top.style.transform = 'rotateX(-150deg)';
    g.style.filter = 'drop-shadow(0 12px 16px rgba(30,15,0,.4))';
    await anim(g, [{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transform: 'translateY(-10px) scale(1.02)' }], { d: 900, e: INOUT });
    await Promise.all([
      anim(top, [{ transform: 'rotateX(-150deg)' }, { transform: 'rotateX(-70deg)', offset: 0.45 }, { transform: 'rotateX(9deg)', offset: 0.8 }, { transform: 'rotateX(0deg)' }], {
        d: 1250,
        e: INOUT,
      }),
      anim(g, [{ transform: 'translateY(-10px) scale(1.02)' }, { transform: 'none' }], { d: 1250, delay: 200, e: INOUT }),
    ]);
  } else {
    const h = el('div');
    g.append(h);
    mountSheet(h, it.sheet, W);
    sheetMarks(h, it);
    const dx = cx - X,
      dy = cy - (r1.top + r1.height / 2),
      s0 = r0.width / r1.width;
    await anim(
      g,
      [
        { transform: `translate(${dx}px,${dy}px) scale(${s0}) rotate(-4deg)`, filter: 'drop-shadow(0 4px 4px rgba(30,15,0,.3))' },
        { transform: `translate(${dx * 0.3}px,${dy * 0.3 - 30}px) scale(${(s0 + 1) / 2}) rotate(3deg)`, filter: 'drop-shadow(0 26px 24px rgba(30,15,0,.35))', offset: 0.55 },
        { transform: 'none', filter: 'drop-shadow(0 10px 14px rgba(30,15,0,.3))' },
      ],
      { d: 1100, e: INOUT },
    );
  }
  if (tv.isConnected) tv.style.visibility = 'visible';
  await anim(g, [{ opacity: 1 }, { opacity: 0 }], { d: 160 });
  g.remove();
}

function ballClip(seed: string): string {
  const r = rng(seed + 'c'),
    n = 17,
    p: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.22,
      R = 41 + r() * 8;
    p.push(`${(50 + Math.cos(a) * R).toFixed(1)}% ${(50 + Math.sin(a) * R * 0.94).toFixed(1)}%`);
  }
  return `polygon(${p.join(',')})`;
}

function facets(seed: string): string {
  const r = rng(seed + 'f'),
    N = 7,
    P: [number, number][] = [];
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) P.push([(x * 100) / N + (x % N ? r() * 10 - 5 : 0), (y * 100) / N + (y % N ? r() * 10 - 5 : 0)]);
  let h = '';
  const lx = -0.6,
    ly = -0.75;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const q = (i: number) => P[i]!,
        A = q(y * (N + 1) + x),
        B = q(y * (N + 1) + x + 1),
        C = q((y + 1) * (N + 1) + x),
        Dp = q((y + 1) * (N + 1) + x + 1);
      (r() < 0.5
        ? [
            [A, B, Dp],
            [A, Dp, C],
          ]
        : [
            [A, B, C],
            [B, Dp, C],
          ]
      ).forEach((t) => {
        const nx = r() * 2 - 1,
          ny = r() * 2 - 1,
          cx = (t[0]![0] + t[1]![0] + t[2]![0]) / 3 - 50,
          cy = (t[0]![1] + t[1]![1] + t[2]![1]) / 3 - 50;
        const lit = (nx * lx + ny * ly) * 0.6 - ((cx * 0.35 + cy * 0.45) / 50) * 0.5;
        const fill = lit > 0 ? `rgba(255,248,226,${Math.min(0.55, lit * 0.7).toFixed(2)})` : `rgba(96,62,22,${Math.min(0.32, -lit * 0.4 + 0.03).toFixed(2)})`;
        h += `<polygon points="${t.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="${fill}"/>`;
        if (r() < 0.35)
          h += `<path d="M${t[0]![0].toFixed(1)} ${t[0]![1].toFixed(1)}L${t[1]![0].toFixed(1)} ${t[1]![1].toFixed(1)}" stroke="rgba(255,250,232,.7)" stroke-width=".7"/><path d="M${(t[0]![0] + 0.6).toFixed(1)} ${(t[0]![1] + 0.6).toFixed(1)}L${(t[1]![0] + 0.6).toFixed(1)} ${(t[1]![1] + 0.6).toFixed(1)}" stroke="rgba(60,38,12,.45)" stroke-width=".6"/>`;
      });
    }
  return `<svg class="facets" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${h}</svg>`;
}

/** 字紙冢裡的一張廢紙：紙球、對摺、平放 */
export function paperObj(it: TombView, w: HTMLElement): HTMLElement {
  const sd = hash(it.sheet.id);
  if (it.state === 'crumple') {
    const o = el('div', 'ball2');
    const c = el('div', 'ballc');
    c.style.clipPath = ballClip(it.sheet.id);
    const th = el('div', 'bth');
    c.append(th);
    c.insertAdjacentHTML('beforeend', facets(it.sheet.id) + wrinkleSVG(sd, { f: 0.045, s: 3.2, el: 56, op: 0.3 }) + '<span class="shade"></span>');
    o.append(c);
    w.append(o);
    mountSheet(th, it.sheet, 220);
    return o;
  }
  if (it.state === 'fold') {
    const W = 150,
      H = Math.round(W * 1.414),
      h = H / 2,
      o = el('div', 'fold2');
    o.style.width = W + 'px';
    o.style.height = h + 'px';
    o.innerHTML = `<div class="fl3"><div class="fl-bot"><div class="th"></div>${wrinkleSVG(sd, { f: 0.025, s: 2.5, op: 0.3 })}<span class="pinch"></span></div><div class="fl-top" style="height:${h}px;top:${-h}px;transform:rotateX(${-126 - (sd % 10)}deg)"><div class="face front"><div class="th"></div></div><div class="face back"><div class="bleed"><div class="th"></div></div>${wrinkleSVG(sd + 7, { f: 0.025, s: 2.5, op: 0.35 })}<span class="crease-hi"></span></div></div></div>`;
    w.append(o);
    const ths = $$('.th', o);
    mountSheet(ths[0]!, it.sheet, W);
    ths[0]!.style.marginTop = -h + 'px';
    mountSheet(ths[1]!, it.sheet, W);
    mountSheet(ths[2]!, it.sheet, W);
    return o;
  }
  const o = el('div', 'flat2');
  const th = el('div');
  o.append(th);
  w.append(o);
  mountSheet(th, it.sheet, 140);
  o.insertAdjacentHTML('beforeend', '<span class="curl"></span>');
  return o;
}

/** 舊信紙送去字紙冢時的動作：揉、摺、或輕輕拿起來 */
export async function discardMotion(big: HTMLElement, state: DiscardState, angle: number): Promise<void> {
  const a = angle;
  if (state === 'crumple') {
    big.style.filter = 'url(#crumple)';
    await anim(
      big,
      [
        { transform: 'none', borderRadius: '0' },
        { transform: 'scale(.7) rotate(35deg)', borderRadius: '22%', offset: 0.4 },
        { transform: 'scale(.42) rotate(120deg)', borderRadius: '46%', offset: 0.75 },
        { transform: 'scale(.3) rotate(170deg)', borderRadius: '50%' },
      ],
      { d: 1300, e: INOUT },
    );
  } else if (state === 'fold') {
    big.style.transformOrigin = '50% 50%';
    await anim(
      big,
      [
        { transform: 'perspective(900px) rotateX(0deg)' },
        { transform: `perspective(900px) rotate(${a / 3}deg) rotateX(62deg) scaleY(.75)`, offset: 0.6 },
        { transform: `perspective(900px) rotate(${a / 2}deg) rotateX(84deg) scaleY(.55)` },
      ],
      { d: 1150, e: INOUT },
    );
  } else await anim(big, [{ transform: 'none' }, { transform: 'translateY(-10px) rotate(1deg)', offset: 0.3 }, { transform: 'translateY(-4px) rotate(2deg) scale(.92)' }], { d: 800 });
  await anim(big, [{ opacity: 1 }, { opacity: 0, transform: getComputedStyle(big).transform + ' translate(160px,40px)' }], { d: 650, e: 'ease-in' });
}
