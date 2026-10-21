/**
 * 長動畫場景（移植自原型 sendScene／openScene／trashScene 等）：
 * 寄出後郵差收信（→ 單號）、收信的落桌與封口掀起、丟垃圾桶（畚箕掃地）。
 * 都有「略過」，prefers-reduced-motion 時直接跳過動作。資料在呼叫前就已經寫進後端。
 *
 * 現在的流程：摺、裝、封、貼、投都在郵局櫃台親手做，拆信也在收信頁親手做，所以
 * - 寄出：櫃台把信封拖進郵筒 → slideIntoSlot（postbox.ts：滑進投信口、郵筒晃一下）→ postScene（信被收走 → 單號）。
 * - 收信：arriveLetter（信落到桌上，親手拆之前）、openMouth（拆開之後封口掀起來）。
 * - sendScene／openScene 是原型「按一個鍵全自動」時代的整段動畫，2026-10-21 起改成註解保留（見下方說明）。
 */
import type { MailboxColor } from '@manxin/shared';
import { binHTML, broomSVG, panSVG } from './art.ts';
import { anim, endScene, INOUT, makeScene, RM, sayIt, wait } from './motion.ts';
import { bagHTML, postboxHTML, shakeBox } from './postbox.ts';
import { mountSheet, type PaperEnv, type ViewSheet } from './paper.ts';
import type { Era } from './time.ts';
import { $, el, jit, spaced } from './util.ts';

/*
 * ===== 做過但未使用：全自動寄信場景 sendScene（2026-10-21 改成註解保留）=====
 * 曾經做過：從原型「按一個鍵全自動」時代移植的整段寄信動畫——
 *   信紙三摺（foldable／fold）→ 放進信封（envelopeEl）→ 封口闔上、蓋封緘 → 翻到正面（flipOver）
 *   → 投進郵筒（intoBox）→ 顯示單號；明信片則是翻面 → 投郵筒。
 * 為何沒接上：流程改為親手做——摺信、裝信、封口、貼郵票、投郵筒都在郵局櫃台（pages/Counter.tsx）由使用者親手完成，
 *   這段自動動畫會取代親手的步驟，所以沒有接上。使用者 2026-10-21 決定不刪、改成註解保留，方便之後報告。
 * 現在接上的是：櫃台拖信封進郵筒 → postbox.ts 的 slideIntoSlot → 下面的 postScene。
 * 若要恢復：去掉每行開頭的 `// `，並把 art.ts 的 stampSVG、util.ts 的 esc 加回 import，
 *   以及 styles/prototype.css 裡 .envl／.e-*／.fold3／.fp 與 styles/app.css 的 .pb-solo（同樣註解保留）。
 * （foldable、FOLD、fold、envelopeEl、flipOver 也是下面 openScene 用的共用小工具。）
 */
// interface Foldable {
//   root: HTMLDivElement;
//   panels: HTMLDivElement[];
//   h: number;
//   Ht: number;
// }
// 
// function foldable(parent: HTMLElement, sheet: ViewSheet, env: PaperEnv, W: number): Foldable {
//   const root = el('div', 'fold3');
//   root.style.width = W + 'px';
//   parent.append(root);
//   const probe = el('div');
//   probe.style.cssText = 'position:absolute;left:-9999px;top:0';
//   document.body.append(probe);
//   mountSheet(probe, sheet, W, env);
//   const Ht = parseFloat(probe.style.height);
//   probe.remove();
//   const h = Ht / 3;
//   root.style.height = Ht + 'px';
//   const panels = [0, 1, 2].map((i) => {
//     const p = el('div', 'fp');
//     p.style.cssText = `top:${i * h}px;width:${W}px;height:${h + 0.5}px;transform-origin:50% ${i === 0 ? '100%' : '0%'};z-index:${[3, 1, 2][i]}`;
//     const f = el('div', 'face'),
//       b = el('div', 'face back'),
//       inner = el('div');
//     f.append(inner);
//     p.append(f, b);
//     root.append(p);
//     mountSheet(inner, sheet, W, env);
//     inner.style.position = 'absolute';
//     inner.style.left = '0';
//     inner.style.top = -i * h + 'px';
//     return p;
//   });
//   return { root, panels, h, Ht };
// }
// 
// const FOLD = ['rotateX(-176deg)', 'none', 'rotateX(178deg)'];
// 
// async function fold(F: Foldable, open: boolean): Promise<void> {
//   const [p0, , p2] = F.panels;
//   if (!open) {
//     await anim(p2, [{ transform: 'none' }, { transform: FOLD[2]! }], { d: 1050, e: INOUT });
//     await wait(160);
//     await anim(p0, [{ transform: 'none' }, { transform: FOLD[0]! }], { d: 1050, e: INOUT });
//   } else {
//     await anim(p0, [{ transform: FOLD[0]! }, { transform: 'none' }], { d: 1000, e: INOUT });
//     await wait(140);
//     await anim(p2, [{ transform: FOLD[2]! }, { transform: 'none' }], { d: 1000, e: INOUT });
//   }
// }
// 
// interface EnvEls {
//   e: HTMLDivElement;
//   H: number;
//   back: HTMLElement;
//   flap: HTMLElement;
//   slot: HTMLElement;
//   pocket: HTMLElement;
//   seal: HTMLElement;
//   face: HTMLElement;
// }
// 
// function envelopeEl(env: PaperEnv & { toEmail?: string }, W: number, box: MailboxColor, era: Era): EnvEls {
//   const H = Math.round(W * 0.62),
//     mg = era === 'minguo',
//     e = el('div', 'envl');
//   e.style.cssText = `width:${W}px;height:${H}px;margin:${-H / 2}px 0 0 ${-W / 2}px;perspective:900px`;
//   const nm = esc(env.toName || env.toEmail);
//   e.innerHTML = `<div class="e-back"></div><div class="e-flap"></div><div class="e-slot"></div><div class="e-pocket"></div><div class="e-seal">${mg ? '緘' : '封'}</div>
//   <div class="e-face" hidden><div style="position:absolute;top:10px;right:12px">${stampSVG(box)}</div>${mg ? `<div style="writing-mode:vertical-rl;border:2px solid #B03A2E;outline:1px solid #B03A2E;outline-offset:3px;padding:12px 6px;font:22px var(--display);letter-spacing:.3em;color:var(--kraft-ink)">${nm} 台啟</div>` : `<div style="text-align:center;color:var(--kraft-ink);font:26px var(--hand);letter-spacing:.12em">${nm} 收<div style="font:12px var(--ui);opacity:.7;letter-spacing:0">${esc(env.toEmail)}</div></div>`}</div>`;
//   const q = (s: string) => $<HTMLElement>(s, e)!;
//   return { e, H, back: q('.e-back'), flap: q('.e-flap'), slot: q('.e-slot'), pocket: q('.e-pocket'), seal: q('.e-seal'), face: q('.e-face') };
// }
// 
// async function flipOver(e: HTMLElement, toFace: boolean, E: EnvEls): Promise<void> {
//   await anim(e, [{ transform: 'none' }, { transform: `translateY(-14px) scaleX(0) rotate(${jit(3)}deg)` }], { d: 460, e: 'cubic-bezier(.5,0,.9,.5)' });
//   [E.back, E.flap, E.slot, E.pocket, E.seal].forEach((x) => (x.style.visibility = toFace ? 'hidden' : 'visible'));
//   E.face.hidden = !toFace;
//   await anim(e, [{ transform: 'translateY(-14px) scaleX(0)' }, { transform: `scaleX(1) rotate(${jit(1.2)}deg)` }], { d: 560, e: 'cubic-bezier(.1,.5,.3,1)' });
// }
// 
// async function intoBox(sc: HTMLElement, e: HTMLElement, box: MailboxColor, era: Era): Promise<void> {
//   const pb = el('div', 'pb-stage pb-solo', postboxHTML(box, era));
//   sc.append(pb);
//   const pbx = $('.pbx', pb)!;
//   await anim(pb, [{ transform: 'translateY(230px)' }, { transform: 'none' }], { d: 1000 });
//   const r = $('.slit', pbx)!.getBoundingClientRect(),
//     dy = r.top + 6 - innerHeight / 2;
//   await anim(
//     e,
//     [
//       { opacity: 1, transform: 'none' },
//       { opacity: 1, transform: `translateY(${dy - 70}px) perspective(600px) rotateX(48deg) scale(.5)`, offset: 0.7 },
//       { opacity: 0, transform: `translateY(${dy}px) perspective(600px) rotateX(82deg) scale(.4)` },
//     ],
//     { d: 1500, e: INOUT },
//   );
//   await shakeBox(pbx, era);
// }
// 
// export interface SendSceneInput {
//   sheet: ViewSheet;
//   env: PaperEnv & { toEmail?: string };
//   front: string | null;
//   box: MailboxColor;
//   no: string;
//   era: Era;
// }
// 
// /** （目前沒有接上：摺、裝、封、翻面都在櫃台親手做）寄信：摺信（三摺）→ 放進信封 → 封口闔上、蓋封緘 → 翻到正面 → 投進郵筒 → 顯示單號 */
// export async function sendScene({ sheet, env, front, box, no, era }: SendSceneInput): Promise<void> {
//   const { sc, say } = makeScene(),
//     W = Math.min(340, innerWidth - 48);
//   if (sheet.kind === 'postcard') {
//     const c = el('div', 'envl');
//     const Wc = W,
//       Hc = Math.round((W * 2) / 3);
//     c.style.cssText = `width:${Wc}px;height:${Hc}px;margin:${-Hc / 2}px 0 0 ${-Wc / 2}px`;
//     sc.append(c);
//     const b = el('div');
//     c.append(b);
//     mountSheet(b, sheet, Wc, env);
//     b.style.boxShadow = '0 14px 30px rgba(0,0,0,.35)';
//     const f = el('div');
//     f.style.cssText = `position:absolute;inset:0;background:${front ? `url(${front}) center/cover` : 'var(--surface-2)'};box-shadow:0 14px 30px rgba(0,0,0,.35)`;
//     f.hidden = true;
//     c.append(f);
//     await anim(c, [{ opacity: 0, transform: 'translateY(30px) rotate(-3deg)' }, { opacity: 1, transform: 'rotate(-1deg)' }], { d: 900 });
//     await sayIt(say, '翻過來看看正面');
//     await wait(300);
//     await anim(c, [{ transform: 'rotate(-1deg)' }, { transform: 'translateY(-14px) scaleX(0)' }], { d: 460, e: 'cubic-bezier(.5,0,.9,.5)' });
//     b.style.visibility = 'hidden';
//     f.hidden = false;
//     await anim(c, [{ transform: 'translateY(-14px) scaleX(0)' }, { transform: `scaleX(1) rotate(${jit(1.5)}deg)` }], { d: 560, e: 'cubic-bezier(.1,.5,.3,1)' });
//     await wait(500);
//     await sayIt(say, '投進郵筒');
//     await intoBox(sc, c, box, era);
//   } else {
//     const E = envelopeEl(env, W, box, era);
//     sc.append(E.e);
//     const H = E.H;
//     [E.back, E.pocket, E.flap].forEach((x) => (x.style.opacity = '0'));
//     E.flap.style.transform = 'rotateX(180deg)';
//     const F = foldable(E.slot, sheet, env, W * 0.86);
//     const y0 = H / 2 - F.Ht / 2,
//       yHover = -2 * F.h - 34,
//       yIn = H * 0.12 - F.h;
//     await anim(
//       F.root,
//       [
//         { opacity: 0, transform: `translateY(${y0 + 34}px) rotate(-2.5deg)` },
//         { opacity: 1, transform: `translateY(${y0}px) rotate(${jit(0.8)}deg)` },
//       ],
//       { d: 1000 },
//     );
//     await sayIt(say, '把信摺好');
//     await wait(250);
//     await fold(F, false);
//     await wait(200);
//     anim(say, [{ opacity: 1 }, { opacity: 0 }], { d: 400 });
//     await anim(F.root, [{ transform: `translateY(${y0}px)` }, { transform: `translateY(${yHover}px) rotate(${jit(2.5)}deg)` }], { d: 1000, e: INOUT });
//     anim(E.back, [{ opacity: 0, transform: 'translateY(70px)' }, { opacity: 1, transform: 'none' }], { d: 900 });
//     anim(E.pocket, [{ opacity: 0, transform: 'translateY(70px)' }, { opacity: 1, transform: 'none' }], { d: 900, delay: 40 });
//     await anim(E.flap, [{ opacity: 0, transform: 'translateY(70px) rotateX(180deg)' }, { opacity: 1, transform: 'rotateX(180deg)' }], { d: 900, delay: 80 });
//     await sayIt(say, '放進信封');
//     await anim(
//       F.root,
//       [
//         { transform: `translateY(${yHover}px) rotate(${jit(2)}deg)` },
//         { transform: `translateY(${yIn - 8}px) rotate(.4deg)`, offset: 0.85 },
//         { transform: `translateY(${yIn}px)` },
//       ],
//       { d: 1300, e: 'cubic-bezier(.5,0,.3,1)' },
//     );
//     await wait(250);
//     E.flap.style.zIndex = '3';
//     await anim(E.flap, [{ transform: 'rotateX(180deg)' }, { transform: 'rotateX(0deg)' }], { d: 1000, e: INOUT });
//     anim(E.e, [{ transform: 'none' }, { transform: 'scale(.985)' }, { transform: 'none' }], { d: 320 });
//     await anim(E.seal, [{ opacity: 0, transform: 'scale(1.9) rotate(-14deg)' }, { opacity: 1, transform: `rotate(${jit(10)}deg)` }], {
//       d: 480,
//       e: 'cubic-bezier(.3,1.4,.5,1)',
//     });
//     await sayIt(say, era === 'minguo' ? '封緘' : '封好了');
//     await wait(400);
//     await flipOver(E.e, true, E);
//     await sayIt(say, `寄給 ${esc(env.toName || env.toEmail)}`);
//     await wait(600);
//     await intoBox(sc, E.e, box, era);
//   }
//   await sayIt(say, `寄出了。<small>${spaced(no)}</small>`);
//   await wait(1600);
//   await endScene(sc);
// }

export interface PostSceneInput {
  no: string;
  box: MailboxColor;
  era: Era;
}

/**
 * 郵差收信過場的時間分配（毫秒）。2026-10-21 由約 9 秒以上縮到約 5 秒：
 * 拿掉「信在郵筒裡等著」那句、信從三封減成兩封、郵筒的出場和郵差走來同時進行，
 * 但每個動作都還是慢慢做完（門先卡一下才開、郵袋接到信會往下沉、提起來才走），不做成快轉。
 */
export const POST_SCENE = {
  /** 郵筒在燈下淡入（同時打出「郵差來收信」） */
  stageIn: 450,
  /** 郵差提著郵袋走來（從 bagDelay 開始） */
  bagDelay: 120,
  bagIn: 850,
  /** 取信門：沉，先卡一下才打開 */
  doorOpen: 600,
  /** 信滑進郵袋：一封別人的，再一封剛投的（間隔 mailGap） */
  mail: 560,
  mailOurs: 600,
  mailGap: 160,
  /** 關門（郵筒輕輕晃，晃的同時郵袋被提走） */
  doorClose: 360,
  /** 郵袋提起來、帶走 */
  bagOut: 800,
  /** 郵袋提起來走了 bagOut - noLead 之後，開始打出單號 */
  noLead: 600,
  /** 單號打出來之後停著讓人看（sayIt 依字數停 min(900, 字數×65)，單號一定是 900），再整個淡出（endScene） */
  noRead: 900,
  fadeOut: 900,
} as const;

/** 過場從開始到完全收掉大約多久（給測試和說明用） */
export function postSceneMs(t: typeof POST_SCENE = POST_SCENE): number {
  const sayIn = 320 + 250; // sayIt：舊字淡出 + 新字淡入
  const afterDoor = Math.max(t.bagOut, t.bagOut - t.noLead + sayIn + t.noRead);
  return t.bagDelay + t.bagIn + t.doorOpen + t.mailGap + t.mailOurs + t.doorClose + afterDoor + t.fadeOut;
}

/**
 * 櫃台把信封投進郵筒之後：郵筒在燈下，郵差提著郵袋來 → 打開下面的取信門 → 信滑進郵袋
 * → 關門（郵筒又晃一下）→ 郵袋提走 → 顯示單號。約 5 秒（POST_SCENE），可以略過、按 Esc。
 * 資料（POST /post）在這之前就已經寫進後端。
 */
export async function postScene({ no, box, era }: PostSceneInput): Promise<void> {
  const { sc, say } = makeScene(),
    T = POST_SCENE;
  try {
    const stage = el('div', 'pb-stage', postboxHTML(box, era)),
      bag = el('div', 'pb-bag', bagHTML(era));
    stage.append(bag);
    sc.append(stage);
    const pbx = $('.pbx', stage)!,
      door = $('.pb-door', pbx)!;
    /* 郵筒淡入的同時，郵差已經提著郵袋走過來（走到定點會微微晃一下才站穩） */
    void anim(stage, [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }], { d: T.stageIn });
    void sayIt(say, '郵差來收信');
    await anim(
      bag,
      [
        { opacity: 0, transform: 'translateX(220px) rotate(7deg)' },
        { opacity: 1, transform: `translateX(-6px) rotate(${jit(2).toFixed(1)}deg)`, offset: 0.78 },
        { opacity: 1, transform: 'none' },
      ],
      { d: T.bagIn, delay: T.bagDelay, e: 'cubic-bezier(.3,.6,.35,1)' },
    );
    /* 取信門：沉，先卡一下才打開 */
    await anim(
      door,
      [
        { transform: 'perspective(260px) rotateY(0deg)' },
        { transform: 'perspective(260px) rotateY(-14deg)', offset: 0.28 },
        { transform: 'perspective(260px) rotateY(-11deg)', offset: 0.4 },
        { transform: 'perspective(260px) rotateY(-105deg)' },
      ],
      { d: T.doorOpen, e: INOUT },
    );
    /* 信滑進郵袋：先一封別人的，最後那封是剛投的；郵袋接到一封就往下沉一下 */
    const dr = door.getBoundingClientRect(),
      st = stage.getBoundingClientRect(),
      br = bag.getBoundingClientRect();
    const dx = br.left + br.width * 0.5 - (dr.left + dr.width / 2),
      dy = br.top + 10 - (dr.top + dr.height / 2);
    const drops = [0, 1].map((i) => {
      const m = el('div', 'pb-mail' + (i === 1 ? ' ours' : ''));
      m.style.left = dr.left - st.left + dr.width / 2 - 23 + 'px';
      m.style.top = dr.top - st.top + dr.height / 2 - 14 + 'px';
      stage.append(m);
      const r = jit(10),
        d = i === 1 ? T.mailOurs : T.mail,
        delay = i * T.mailGap;
      return anim(
        m,
        [
          { opacity: 0, transform: 'translate(0,0) scale(.6)' },
          { opacity: 1, transform: `translate(${(dx * 0.35).toFixed(0)}px,${(dy - 36).toFixed(0)}px) rotate(${r.toFixed(1)}deg) scale(.9)`, offset: 0.45 },
          { opacity: 1, transform: `translate(${dx.toFixed(0)}px,${(dy - 8).toFixed(0)}px) rotate(${(r * 1.6).toFixed(1)}deg)`, offset: 0.8 },
          { opacity: 0, transform: `translate(${dx.toFixed(0)}px,${(dy + 22).toFixed(0)}px) rotate(${(r * 2).toFixed(1)}deg) scale(.95)` },
        ],
        { d, delay, e: INOUT },
      ).then(() => anim(bag, [{ transform: 'none' }, { transform: 'translateY(3px) scale(1.02,.98)' }, { transform: 'none' }], { d: 340, e: 'ease-out' }));
    });
    await Promise.race([Promise.all(drops), wait(T.mailGap + T.mailOurs)]);
    /* 關門：咚一聲，郵筒輕輕晃；晃的時候郵差已經提起郵袋要走了 */
    await anim(door, [{ transform: 'perspective(260px) rotateY(-105deg)' }, { transform: 'perspective(260px) rotateY(0deg)' }], { d: T.doorClose, e: 'cubic-bezier(.5,0,.9,.6)' });
    void shakeBox(pbx, era, 0.45);
    const leave = anim(
      bag,
      [
        { opacity: 1, transform: 'none' },
        { opacity: 1, transform: 'translate(10px,-18px) rotate(4deg)', offset: 0.28 },
        { opacity: 0, transform: 'translate(260px,-26px) rotate(7deg)' },
      ],
      { d: T.bagOut, e: 'cubic-bezier(.45,0,.75,.5)' },
    );
    await wait(T.bagOut - T.noLead);
    // sayIt 打完字之後會依字數停一下（單號夠長，停 noRead）
    await Promise.all([leave, sayIt(say, `寄出了。<small>${spaced(no)}</small>`)]);
  } finally {
    await endScene(sc);
  }
}

/** 收到的信落到桌上（親手拆之前的開場；原型 openScene 的第一段） */
export async function arriveLetter(host: HTMLElement): Promise<void> {
  if (RM) return;
  await anim(
    host,
    [
      { opacity: 0, transform: `translateY(-80px) rotate(${(-6 + jit(2)).toFixed(1)}deg)` },
      { opacity: 1, transform: `translateY(7px) rotate(${(1.4 + jit(0.6)).toFixed(1)}deg)`, offset: 0.68 },
      { opacity: 1, transform: 'translateY(-2px) rotate(-.4deg)', offset: 0.84 },
      { opacity: 1, transform: 'none' },
    ],
    { d: 1300, e: 'cubic-bezier(.3,.6,.35,1)' },
  );
}

/** 拆開之後：易撕帶整條掀起來掉走／封口掀起來再落下（親手拆之後的收尾；原型 openScene 的「封口掀開」） */
export async function openMouth(envb: HTMLElement): Promise<void> {
  const strip = $('.eb-strip', envb),
    flap = $('.eb-flap', envb);
  const jobs = [anim(envb, [{ translate: '0 0' }, { translate: '0 -5px', offset: 0.4 }, { translate: '0 1px', offset: 0.75 }, { translate: '0 0' }], { d: 900, e: INOUT })];
  if (strip)
    jobs.push(
      anim(
        strip,
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0.95, transform: 'translate(4px,-9px) rotate(-2.5deg)', offset: 0.45 },
          { opacity: 0, transform: `translate(28px,-34px) rotate(${(-6 + jit(2)).toFixed(1)}deg)` },
        ],
        { d: 1050, e: 'cubic-bezier(.4,0,.6,1)' },
      ),
    );
  if (flap)
    jobs.push(
      anim(
        flap,
        [
          { opacity: 1, transform: 'perspective(520px) rotateX(0deg)' },
          { opacity: 0.85, transform: 'perspective(520px) rotateX(58deg)', offset: 0.55 },
          { opacity: 0.35, transform: 'perspective(520px) rotateX(0deg)' },
        ],
        { d: 1100, e: INOUT },
      ),
    );
  await Promise.all(jobs);
}

/*
 * ===== 做過但未使用：全自動拆信場景 openScene（2026-10-21 改成註解保留）=====
 * 曾經做過：從原型移植的整段拆信動畫——信封落下 → 翻面 → 封緘掉落、封口掀開（劃開）→ 抽出信（倒出）→ 攤開三摺；
 *   明信片則是翻到背面。
 * 為何沒接上：流程改為親手做——翻面、劃開、倒出、攤開都在收信頁（pages/Receive.tsx）由收件人親手完成。
 *   其中只取用了兩段：開頭「信落到桌上」→ 上面的 arriveLetter；「封口掀開」→ 上面的 openMouth。
 *   使用者 2026-10-21 決定不刪、改成註解保留，方便之後報告。
 * 若要恢復：同上面 sendScene 的說明（共用 foldable／fold／envelopeEl／flipOver 也要一起還原）。
 */
// export interface OpenSceneInput {
//   sheet: ViewSheet;
//   env: PaperEnv & { toEmail?: string };
//   front: string | null;
//   box: MailboxColor;
//   era: Era;
// }
// 
// /** （目前沒有接上：翻面、劃開、倒出、攤開都在收信頁親手做）收件人拆信：信封翻面 → 封緘掉落 → 封口掀開 → 抽出信 → 攤開 */
// export async function openScene({ sheet, env, front, box, era }: OpenSceneInput): Promise<void> {
//   const { sc, say } = makeScene(),
//     W = Math.min(340, innerWidth - 48);
//   if (sheet.kind === 'postcard') {
//     const c = el('div', 'envl');
//     const Hc = Math.round((W * 2) / 3);
//     c.style.cssText = `width:${W}px;height:${Hc}px;margin:${-Hc / 2}px 0 0 ${-W / 2}px`;
//     sc.append(c);
//     const f = el('div');
//     f.style.cssText = `position:absolute;inset:0;background:${front ? `url(${front}) center/cover` : 'var(--surface-2)'};box-shadow:0 14px 30px rgba(0,0,0,.35)`;
//     const b = el('div');
//     b.style.visibility = 'hidden';
//     c.append(b, f);
//     mountSheet(b, sheet, W, env);
//     await anim(c, [{ opacity: 0, transform: 'translateY(40px) rotate(-4deg)' }, { opacity: 1, transform: 'rotate(-1deg)' }], { d: 1000 });
//     await sayIt(say, '一張明信片');
//     await wait(500);
//     await anim(c, [{ transform: 'rotate(-1deg)' }, { transform: 'translateY(-14px) scaleX(0)' }], { d: 460, e: 'cubic-bezier(.5,0,.9,.5)' });
//     f.hidden = true;
//     b.style.visibility = 'visible';
//     await anim(c, [{ transform: 'translateY(-14px) scaleX(0)' }, { transform: 'scaleX(1)' }], { d: 600, e: 'cubic-bezier(.1,.5,.3,1)' });
//     await wait(1200);
//     await endScene(sc);
//     return;
//   }
//   const E = envelopeEl(env, W, box, era);
//   sc.append(E.e);
//   const H = E.H;
//   [E.back, E.flap, E.slot, E.pocket, E.seal].forEach((x) => (x.style.visibility = 'hidden'));
//   E.face.hidden = false;
//   E.flap.style.zIndex = '3';
//   E.seal.style.opacity = '1';
//   const F = foldable(E.slot, sheet, env, W * 0.86);
//   F.panels.forEach((p, i) => (p.style.transform = FOLD[i]!));
//   const yIn = H * 0.12 - F.h,
//     yOut = -2 * F.h - 40,
//     y0 = H / 2 - F.Ht / 2;
//   F.root.style.transform = `translateY(${yIn}px)`;
//   await anim(E.e, [{ opacity: 0, transform: 'translateY(50px) rotate(-4deg)' }, { opacity: 1, transform: 'rotate(-1deg)' }], { d: 1000 });
//   await sayIt(say, `${esc(env.toName || '你')}，有你的信`);
//   await wait(700);
//   await flipOver(E.e, false, E);
//   await wait(300);
//   await sayIt(say, '拆開');
//   await anim(E.seal, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(14px) rotate(28deg) scale(.8)' }], { d: 600 });
//   await anim(E.flap, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(180deg)' }], { d: 1100, e: INOUT });
//   E.flap.style.zIndex = '0';
//   anim(say, [{ opacity: 1 }, { opacity: 0 }], { d: 400 });
//   await anim(
//     F.root,
//     [
//       { transform: `translateY(${yIn}px)` },
//       { transform: `translateY(${yIn + 6}px)`, offset: 0.15 },
//       { transform: `translateY(${yOut}px) rotate(${jit(2.5)}deg)` },
//     ],
//     { d: 1400, e: 'cubic-bezier(.4,0,.2,1)' },
//   );
//   [E.back, E.pocket, E.flap].forEach((x, i) =>
//     anim(
//       x,
//       [
//         { opacity: 1, transform: x === E.flap ? 'rotateX(180deg)' : 'none' },
//         { opacity: 0, transform: (x === E.flap ? 'rotateX(180deg) ' : '') + 'translateY(90px)' },
//       ],
//       { d: 800, delay: i * 50 },
//     ),
//   );
//   await anim(F.root, [{ transform: `translateY(${yOut}px)` }, { transform: `translateY(${y0}px)` }], { d: 1000, e: INOUT });
//   await fold(F, true);
//   await wait(900);
//   await endScene(sc);
// }

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
