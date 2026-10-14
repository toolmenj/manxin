/**
 * 長動畫場景（移植自原型 sendScene／openScene／trashScene 等）：
 * 寄信（摺信 → 放進信封 → 封口 → 翻面 → 投郵筒 → 單號）、拆信、丟垃圾桶（畚箕掃地）。
 * 都有「略過」，prefers-reduced-motion 時直接跳過動作。資料在呼叫前就已經寫進後端。
 */
import { binHTML, broomSVG, panSVG, stampSVG } from './art.ts';
import { anim, endScene, INOUT, makeScene, RM, sayIt, wait } from './motion.ts';
import { mountSheet, type PaperEnv, type ViewSheet } from './paper.ts';
import type { Era } from './time.ts';
import { $, el, esc, jit, spaced } from './util.ts';

interface Foldable {
  root: HTMLDivElement;
  panels: HTMLDivElement[];
  h: number;
  Ht: number;
}

function foldable(parent: HTMLElement, sheet: ViewSheet, env: PaperEnv, W: number): Foldable {
  const root = el('div', 'fold3');
  root.style.width = W + 'px';
  parent.append(root);
  const probe = el('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.append(probe);
  mountSheet(probe, sheet, W, env);
  const Ht = parseFloat(probe.style.height);
  probe.remove();
  const h = Ht / 3;
  root.style.height = Ht + 'px';
  const panels = [0, 1, 2].map((i) => {
    const p = el('div', 'fp');
    p.style.cssText = `top:${i * h}px;width:${W}px;height:${h + 0.5}px;transform-origin:50% ${i === 0 ? '100%' : '0%'};z-index:${[3, 1, 2][i]}`;
    const f = el('div', 'face'),
      b = el('div', 'face back'),
      inner = el('div');
    f.append(inner);
    p.append(f, b);
    root.append(p);
    mountSheet(inner, sheet, W, env);
    inner.style.position = 'absolute';
    inner.style.left = '0';
    inner.style.top = -i * h + 'px';
    return p;
  });
  return { root, panels, h, Ht };
}

const FOLD = ['rotateX(-176deg)', 'none', 'rotateX(178deg)'];

async function fold(F: Foldable, open: boolean): Promise<void> {
  const [p0, , p2] = F.panels;
  if (!open) {
    await anim(p2, [{ transform: 'none' }, { transform: FOLD[2]! }], { d: 1050, e: INOUT });
    await wait(160);
    await anim(p0, [{ transform: 'none' }, { transform: FOLD[0]! }], { d: 1050, e: INOUT });
  } else {
    await anim(p0, [{ transform: FOLD[0]! }, { transform: 'none' }], { d: 1000, e: INOUT });
    await wait(140);
    await anim(p2, [{ transform: FOLD[2]! }, { transform: 'none' }], { d: 1000, e: INOUT });
  }
}

interface EnvEls {
  e: HTMLDivElement;
  H: number;
  back: HTMLElement;
  flap: HTMLElement;
  slot: HTMLElement;
  pocket: HTMLElement;
  seal: HTMLElement;
  face: HTMLElement;
}

function envelopeEl(env: PaperEnv & { toEmail?: string }, W: number, box: 'green' | 'red', era: Era): EnvEls {
  const H = Math.round(W * 0.62),
    mg = era === 'minguo',
    e = el('div', 'envl');
  e.style.cssText = `width:${W}px;height:${H}px;margin:${-H / 2}px 0 0 ${-W / 2}px;perspective:900px`;
  const nm = esc(env.toName || env.toEmail);
  e.innerHTML = `<div class="e-back"></div><div class="e-flap"></div><div class="e-slot"></div><div class="e-pocket"></div><div class="e-seal">${mg ? '緘' : '封'}</div>
  <div class="e-face" hidden><div style="position:absolute;top:10px;right:12px">${stampSVG(box)}</div>${mg ? `<div style="writing-mode:vertical-rl;border:2px solid #B03A2E;outline:1px solid #B03A2E;outline-offset:3px;padding:12px 6px;font:22px var(--display);letter-spacing:.3em;color:var(--kraft-ink)">${nm} 台啟</div>` : `<div style="text-align:center;color:var(--kraft-ink);font:26px var(--hand);letter-spacing:.12em">${nm} 收<div style="font:12px var(--ui);opacity:.7;letter-spacing:0">${esc(env.toEmail)}</div></div>`}</div>`;
  const q = (s: string) => $<HTMLElement>(s, e)!;
  return { e, H, back: q('.e-back'), flap: q('.e-flap'), slot: q('.e-slot'), pocket: q('.e-pocket'), seal: q('.e-seal'), face: q('.e-face') };
}

async function flipOver(e: HTMLElement, toFace: boolean, E: EnvEls): Promise<void> {
  await anim(e, [{ transform: 'none' }, { transform: `translateY(-14px) scaleX(0) rotate(${jit(3)}deg)` }], { d: 460, e: 'cubic-bezier(.5,0,.9,.5)' });
  [E.back, E.flap, E.slot, E.pocket, E.seal].forEach((x) => (x.style.visibility = toFace ? 'hidden' : 'visible'));
  E.face.hidden = !toFace;
  await anim(e, [{ transform: 'translateY(-14px) scaleX(0)' }, { transform: `scaleX(1) rotate(${jit(1.2)}deg)` }], { d: 560, e: 'cubic-bezier(.1,.5,.3,1)' });
}

async function intoBox(sc: HTMLElement, e: HTMLElement, box: 'green' | 'red'): Promise<void> {
  const pb = el('div', 'pbox');
  pb.style.background = box === 'red' ? '#B3372B' : '#1E6A4A';
  pb.innerHTML = `<div class="slit"></div><div class="t">${box === 'red' ? '限時' : '郵政'}</div>`;
  sc.append(pb);
  await anim(pb, [{ transform: 'translateY(230px)' }, { transform: 'none' }], { d: 1000 });
  const r = $('.slit', pb)!.getBoundingClientRect(),
    dy = r.top + 6 - innerHeight / 2;
  await anim(
    e,
    [
      { opacity: 1, transform: 'none' },
      { opacity: 1, transform: `translateY(${dy - 70}px) perspective(600px) rotateX(48deg) scale(.5)`, offset: 0.7 },
      { opacity: 0, transform: `translateY(${dy}px) perspective(600px) rotateX(82deg) scale(.4)` },
    ],
    { d: 1500, e: INOUT },
  );
  anim(pb, [{ transform: 'none' }, { transform: 'translateY(4px) rotate(-1deg)' }, { transform: 'translateY(-1px) rotate(.6deg)' }, { transform: 'none' }], {
    d: 480,
    e: 'ease-out',
  });
  await wait(480);
}

export interface SendSceneInput {
  sheet: ViewSheet;
  env: PaperEnv & { toEmail?: string };
  front: string | null;
  box: 'green' | 'red';
  no: string;
  era: Era;
}

/** 寄信：摺信（三摺）→ 放進信封 → 封口闔上、蓋封緘 → 翻到正面 → 投進郵筒 → 顯示單號 */
export async function sendScene({ sheet, env, front, box, no, era }: SendSceneInput): Promise<void> {
  const { sc, say } = makeScene(),
    W = Math.min(340, innerWidth - 48);
  if (sheet.kind === 'postcard') {
    const c = el('div', 'envl');
    const Wc = W,
      Hc = Math.round((W * 2) / 3);
    c.style.cssText = `width:${Wc}px;height:${Hc}px;margin:${-Hc / 2}px 0 0 ${-Wc / 2}px`;
    sc.append(c);
    const b = el('div');
    c.append(b);
    mountSheet(b, sheet, Wc, env);
    b.style.boxShadow = '0 14px 30px rgba(0,0,0,.35)';
    const f = el('div');
    f.style.cssText = `position:absolute;inset:0;background:${front ? `url(${front}) center/cover` : 'var(--surface-2)'};box-shadow:0 14px 30px rgba(0,0,0,.35)`;
    f.hidden = true;
    c.append(f);
    await anim(c, [{ opacity: 0, transform: 'translateY(30px) rotate(-3deg)' }, { opacity: 1, transform: 'rotate(-1deg)' }], { d: 900 });
    await sayIt(say, '翻過來看看正面');
    await wait(300);
    await anim(c, [{ transform: 'rotate(-1deg)' }, { transform: 'translateY(-14px) scaleX(0)' }], { d: 460, e: 'cubic-bezier(.5,0,.9,.5)' });
    b.style.visibility = 'hidden';
    f.hidden = false;
    await anim(c, [{ transform: 'translateY(-14px) scaleX(0)' }, { transform: `scaleX(1) rotate(${jit(1.5)}deg)` }], { d: 560, e: 'cubic-bezier(.1,.5,.3,1)' });
    await wait(500);
    await sayIt(say, '投進郵筒');
    await intoBox(sc, c, box);
  } else {
    const E = envelopeEl(env, W, box, era);
    sc.append(E.e);
    const H = E.H;
    [E.back, E.pocket, E.flap].forEach((x) => (x.style.opacity = '0'));
    E.flap.style.transform = 'rotateX(180deg)';
    const F = foldable(E.slot, sheet, env, W * 0.86);
    const y0 = H / 2 - F.Ht / 2,
      yHover = -2 * F.h - 34,
      yIn = H * 0.12 - F.h;
    await anim(
      F.root,
      [
        { opacity: 0, transform: `translateY(${y0 + 34}px) rotate(-2.5deg)` },
        { opacity: 1, transform: `translateY(${y0}px) rotate(${jit(0.8)}deg)` },
      ],
      { d: 1000 },
    );
    await sayIt(say, '把信摺好');
    await wait(250);
    await fold(F, false);
    await wait(200);
    anim(say, [{ opacity: 1 }, { opacity: 0 }], { d: 400 });
    await anim(F.root, [{ transform: `translateY(${y0}px)` }, { transform: `translateY(${yHover}px) rotate(${jit(2.5)}deg)` }], { d: 1000, e: INOUT });
    anim(E.back, [{ opacity: 0, transform: 'translateY(70px)' }, { opacity: 1, transform: 'none' }], { d: 900 });
    anim(E.pocket, [{ opacity: 0, transform: 'translateY(70px)' }, { opacity: 1, transform: 'none' }], { d: 900, delay: 40 });
    await anim(E.flap, [{ opacity: 0, transform: 'translateY(70px) rotateX(180deg)' }, { opacity: 1, transform: 'rotateX(180deg)' }], { d: 900, delay: 80 });
    await sayIt(say, '放進信封');
    await anim(
      F.root,
      [
        { transform: `translateY(${yHover}px) rotate(${jit(2)}deg)` },
        { transform: `translateY(${yIn - 8}px) rotate(.4deg)`, offset: 0.85 },
        { transform: `translateY(${yIn}px)` },
      ],
      { d: 1300, e: 'cubic-bezier(.5,0,.3,1)' },
    );
    await wait(250);
    E.flap.style.zIndex = '3';
    await anim(E.flap, [{ transform: 'rotateX(180deg)' }, { transform: 'rotateX(0deg)' }], { d: 1000, e: INOUT });
    anim(E.e, [{ transform: 'none' }, { transform: 'scale(.985)' }, { transform: 'none' }], { d: 320 });
    await anim(E.seal, [{ opacity: 0, transform: 'scale(1.9) rotate(-14deg)' }, { opacity: 1, transform: `rotate(${jit(10)}deg)` }], {
      d: 480,
      e: 'cubic-bezier(.3,1.4,.5,1)',
    });
    await sayIt(say, era === 'minguo' ? '封緘' : '封好了');
    await wait(400);
    await flipOver(E.e, true, E);
    await sayIt(say, `寄給 ${esc(env.toName || env.toEmail)}`);
    await wait(600);
    await intoBox(sc, E.e, box);
  }
  await sayIt(say, `寄出了。<small>${spaced(no)}</small>`);
  await wait(1600);
  await endScene(sc);
}

/** 櫃台把信封拖進郵筒後，只剩下顯示單號 */
export async function postedScene(no: string): Promise<void> {
  const { sc, say } = makeScene();
  await sayIt(say, `寄出了。<small>${spaced(no)}</small>`);
  await wait(1400);
  await endScene(sc);
}

export interface OpenSceneInput {
  sheet: ViewSheet;
  env: PaperEnv & { toEmail?: string };
  front: string | null;
  box: 'green' | 'red';
  era: Era;
}

/** 收件人拆信：信封翻面 → 封緘掉落 → 封口掀開 → 抽出信 → 攤開 */
export async function openScene({ sheet, env, front, box, era }: OpenSceneInput): Promise<void> {
  const { sc, say } = makeScene(),
    W = Math.min(340, innerWidth - 48);
  if (sheet.kind === 'postcard') {
    const c = el('div', 'envl');
    const Hc = Math.round((W * 2) / 3);
    c.style.cssText = `width:${W}px;height:${Hc}px;margin:${-Hc / 2}px 0 0 ${-W / 2}px`;
    sc.append(c);
    const f = el('div');
    f.style.cssText = `position:absolute;inset:0;background:${front ? `url(${front}) center/cover` : 'var(--surface-2)'};box-shadow:0 14px 30px rgba(0,0,0,.35)`;
    const b = el('div');
    b.style.visibility = 'hidden';
    c.append(b, f);
    mountSheet(b, sheet, W, env);
    await anim(c, [{ opacity: 0, transform: 'translateY(40px) rotate(-4deg)' }, { opacity: 1, transform: 'rotate(-1deg)' }], { d: 1000 });
    await sayIt(say, '一張明信片');
    await wait(500);
    await anim(c, [{ transform: 'rotate(-1deg)' }, { transform: 'translateY(-14px) scaleX(0)' }], { d: 460, e: 'cubic-bezier(.5,0,.9,.5)' });
    f.hidden = true;
    b.style.visibility = 'visible';
    await anim(c, [{ transform: 'translateY(-14px) scaleX(0)' }, { transform: 'scaleX(1)' }], { d: 600, e: 'cubic-bezier(.1,.5,.3,1)' });
    await wait(1200);
    await endScene(sc);
    return;
  }
  const E = envelopeEl(env, W, box, era);
  sc.append(E.e);
  const H = E.H;
  [E.back, E.flap, E.slot, E.pocket, E.seal].forEach((x) => (x.style.visibility = 'hidden'));
  E.face.hidden = false;
  E.flap.style.zIndex = '3';
  E.seal.style.opacity = '1';
  const F = foldable(E.slot, sheet, env, W * 0.86);
  F.panels.forEach((p, i) => (p.style.transform = FOLD[i]!));
  const yIn = H * 0.12 - F.h,
    yOut = -2 * F.h - 40,
    y0 = H / 2 - F.Ht / 2;
  F.root.style.transform = `translateY(${yIn}px)`;
  await anim(E.e, [{ opacity: 0, transform: 'translateY(50px) rotate(-4deg)' }, { opacity: 1, transform: 'rotate(-1deg)' }], { d: 1000 });
  await sayIt(say, `${esc(env.toName || '你')}，有你的信`);
  await wait(700);
  await flipOver(E.e, false, E);
  await wait(300);
  await sayIt(say, '拆開');
  await anim(E.seal, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(14px) rotate(28deg) scale(.8)' }], { d: 600 });
  await anim(E.flap, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(180deg)' }], { d: 1100, e: INOUT });
  E.flap.style.zIndex = '0';
  anim(say, [{ opacity: 1 }, { opacity: 0 }], { d: 400 });
  await anim(
    F.root,
    [
      { transform: `translateY(${yIn}px)` },
      { transform: `translateY(${yIn + 6}px)`, offset: 0.15 },
      { transform: `translateY(${yOut}px) rotate(${jit(2.5)}deg)` },
    ],
    { d: 1400, e: 'cubic-bezier(.4,0,.2,1)' },
  );
  [E.back, E.pocket, E.flap].forEach((x, i) =>
    anim(
      x,
      [
        { opacity: 1, transform: x === E.flap ? 'rotateX(180deg)' : 'none' },
        { opacity: 0, transform: (x === E.flap ? 'rotateX(180deg) ' : '') + 'translateY(90px)' },
      ],
      { d: 800, delay: i * 50 },
    ),
  );
  await anim(F.root, [{ transform: `translateY(${yOut}px)` }, { transform: `translateY(${y0}px)` }], { d: 1000, e: INOUT });
  await fold(F, true);
  await wait(900);
  await endScene(sc);
}

/** 丟垃圾桶：紙掉到地上 → 畚箕和掃把出場，掃三下 → 端起畚箕倒進垃圾桶 */
export async function trashScene(sh: ViewSheet, state: 'crumple' | 'fold' | 'keep', env: PaperEnv, era: Era): Promise<void> {
  const { sc, say } = makeScene(),
    mg = era === 'minguo',
    k = Math.min(1, (innerWidth - 24) / 440);
  const stg = el('div', 'tr-stage');
  stg.style.top = Math.min(innerHeight * 0.8, innerHeight - 40) - 300 + 'px';
  stg.style.transform = `scale(${k})`;
  sc.append(stg);
  const pp = el('div', 'tr-paper'),
    th = el('div'),
    pan = el('div', 'tr-pan', panSVG(era)),
    bin = el('div', 'tr-bin', binHTML(era)),
    broom = el('div', 'tr-broom', broomSVG(era));
  pp.append(th);
  stg.append(el('div', 'tr-floor'), pp, pan, bin, broom); /* 疊放順序：紙 < 畚箕 < 垃圾桶 < 掃把 */
  mountSheet(th, sh, 160, env);
  const h0 = parseFloat(th.style.height),
    lid = $('.tr-lid', bin);
  const cr = state === 'crumple',
    fo = state === 'fold',
    visH = cr ? 160 * 0.42 : h0 * (fo ? 0.1 : 0.16),
    landX = 250,
    landCy = 260 - visH / 2;
  pp.style.cssText = `left:${landX - 80}px;top:${landCy - h0 / 2}px;width:160px;height:${h0}px`;
  const y0 = 70 - landCy,
    sfx = cr ? 'rotate(170deg) scale(.55)' : fo ? 'scale(1,.5)' : 'rotate(1deg)';
  const land = (x: number) => (cr ? `rotate(${(410 - x * 1.6).toFixed(0)}deg) scale(.42)` : fo ? 'rotate(-6deg) scale(.42,.1)' : 'rotate(-3deg) scale(.42,.16)');
  [pan, broom, bin].forEach((x) => (x.style.opacity = '0'));
  await anim(pp, [{ opacity: 0, transform: `translate(-30px,${y0 + 24}px) rotate(-3deg)` }, { opacity: 1, transform: `translate(-30px,${y0}px) rotate(1deg)` }], { d: 800 });
  await sayIt(say, '這張不要了');
  if (cr) {
    const c = (h0 - 160) / 2;
    pp.style.filter = 'url(#crumple)';
    await anim(
      pp,
      [
        { transform: `translate(-30px,${y0}px) rotate(1deg)`, clipPath: 'inset(0px 0px 0px 0px round 0px)' },
        { transform: `translate(-30px,${y0}px) rotate(80deg) scale(.8)`, clipPath: `inset(${c * 0.6}px 0px ${c * 0.6}px 0px round 40px)`, offset: 0.45 },
        { transform: `translate(-30px,${y0}px) ${sfx}`, clipPath: `inset(${c}px 0px ${c}px 0px round 80px)` },
      ],
      { d: 1250, e: INOUT },
    );
  } else if (fo)
    await anim(
      pp,
      [
        { transform: `translate(-30px,${y0}px) rotate(1deg)` },
        { transform: `translate(-30px,${y0}px) perspective(700px) rotateX(62deg) scaleY(.75)`, offset: 0.6 },
        { transform: `translate(-30px,${y0}px) ${sfx}` },
      ],
      { d: 1000, e: INOUT },
    );
  anim(say, [{ opacity: 1 }, { opacity: 0 }], { d: 400 });
  /* 落地：紙團直直掉下來彈兩下；一張紙會左右飄 */
  if (cr)
    await anim(
      pp,
      [
        { transform: `translate(-30px,${y0}px) ${sfx}` },
        { transform: `translate(-10px,0px) rotate(330deg) scale(.42)`, offset: 0.58, easing: 'cubic-bezier(.5,0,1,1)' },
        { transform: `translate(-2px,-34px) rotate(380deg) scale(.42)`, offset: 0.76, easing: 'cubic-bezier(0,0,.5,1)' },
        { transform: `translate(4px,0px) rotate(405deg) scale(.42)`, offset: 0.9, easing: 'cubic-bezier(.5,0,1,1)' },
        { transform: `translate(0px,0px) ${land(0)}` },
      ],
      { d: 1500, e: 'linear' },
    );
  else
    await anim(
      pp,
      [
        { transform: `translate(-30px,${y0}px) ${sfx}` },
        { transform: `translate(34px,${y0 * 0.66}px) rotate(14deg) scale(.7,${fo ? 0.4 : 0.55})`, offset: 0.3 },
        { transform: `translate(-40px,${y0 * 0.33}px) rotate(-16deg) scale(.55,${fo ? 0.25 : 0.35})`, offset: 0.62 },
        { transform: `translate(14px,${y0 * 0.08}px) rotate(8deg) scale(.46,${fo ? 0.14 : 0.22})`, offset: 0.85 },
        { transform: `translate(0px,0px) ${land(0)}` },
      ],
      { d: 2300, e: 'ease-in-out' },
    );
  await wait(300);
  await sayIt(say, mg ? '拿竹畚箕和掃把來' : '拿畚箕和掃把來');
  anim(bin, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { d: 900, delay: 200 });
  await anim(
    pan,
    [
      { opacity: 1, transform: 'translateX(-290px) rotate(-4deg)' },
      { opacity: 1, transform: 'translateX(7px) rotate(1deg)', offset: 0.8 },
      { opacity: 1, transform: 'none' },
    ],
    { d: 1150 },
  );
  await anim(broom, [{ opacity: 1, transform: 'translateX(240px) rotate(-10deg)' }, { opacity: 1, transform: 'translateX(0px) rotate(-4deg)' }], { d: 1000 });
  anim(say, [{ opacity: 1 }, { opacity: 0 }], { d: 400 });
  /* 掃三下，一下比一下靠近畚箕 */
  let bx = 0,
    px = 0;
  for (const push of [-34, -38, -58]) {
    await Promise.all([
      anim(
        broom,
        [
          { transform: `translateX(${bx}px) rotate(-4deg)` },
          { transform: `translateX(${bx - 46}px) rotate(13deg)`, offset: 0.55 },
          { transform: `translateX(${bx - 30}px) rotate(2deg)` },
        ],
        { d: 680, e: INOUT },
      ),
      anim(
        pp,
        [{ transform: `translate(${px}px,0px) ${land(px)}` }, { transform: `translate(${px + push}px,${push < -50 ? -4 : 0}px) ${land(px + push)}` }],
        { d: 520, delay: 160, e: 'cubic-bezier(.3,0,.3,1)' },
      ),
    ]);
    bx -= 30;
    px += push;
    await wait(140 + Math.random() * 120);
  }
  anim(broom, [{ transform: `translateX(${bx}px) rotate(2deg)` }, { transform: 'translateX(300px) rotate(-12deg)' }], { d: 900, e: 'ease-in' });
  /* 紙進了畚箕，跟著畚箕一起走 */
  const base = land(px),
    cp = cr ? getComputedStyle(pp).clipPath : '';
  pp.getAnimations().forEach((a) => a.cancel());
  if (cp) pp.style.clipPath = cp;
  pp.style.left = landX + px - 80 - 30 + 'px';
  pp.style.top = landCy - 4 - h0 / 2 - 148 + 'px';
  pp.style.transform = base;
  pan.prepend(pp);
  await wait(300);
  if (lid) anim(lid, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-78deg)' }], { d: 600, e: 'ease-out' });
  pan.style.transformOrigin = '95% 92%';
  await anim(pan, [{ transform: 'none' }, { transform: 'translate(18px,-40px) rotate(-6deg)', offset: 0.35 }, { transform: 'translate(150px,-112px) rotate(-4deg)' }], {
    d: 1400,
    e: INOUT,
  });
  await anim(pan, [{ transform: 'translate(150px,-112px) rotate(-4deg)' }, { transform: 'translate(150px,-112px) rotate(36deg)' }], { d: 850, e: INOUT });
  anim(bin, [{ transform: 'none' }, { transform: 'translateY(2px) rotate(-1.2deg)' }, { transform: 'rotate(.6deg)' }, { transform: 'none' }], { d: 420, delay: 520 });
  await anim(
    pp,
    [
      { transform: base, opacity: 1 },
      { transform: `translate(70px,8px) ${base}`, opacity: 1, offset: 0.4 },
      { transform: `translate(115px,95px) ${base}`, opacity: 0 },
    ],
    { d: 950, e: 'cubic-bezier(.5,0,.8,.6)' },
  );
  if (lid) anim(lid, [{ transform: 'rotate(-78deg)' }, { transform: 'rotate(5deg)', offset: 0.7 }, { transform: 'rotate(0deg)' }], { d: 650, e: 'ease-in' });
  anim(pan, [{ transform: 'translate(150px,-112px) rotate(36deg)' }, { transform: 'translate(70px,-60px) rotate(-4deg)', offset: 0.4 }, { transform: 'translateX(-320px) rotate(-6deg)' }], {
    d: 1400,
    e: INOUT,
  });
  await wait(500);
  await sayIt(say, '丟掉了。');
  await wait(900);
  await endScene(sc);
}

export { RM };
