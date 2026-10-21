/**
 * 郵筒：依年代畫出來（八〇年代綠／紅郵筒、民國初年的信筒、手繪塗鴉），
 * 以及信從投信口滑進去、郵筒晃一下的手感（PRD 第 6 章：慢、有重量、角度帶一點隨機）。
 * 未知的年代（例如之後的 'map'）一律用八〇年代的郵筒。
 */
import type { MailboxColor } from '@manxin/shared';
import { anim, INOUT, wait } from './motion.ts';
import type { Era } from './time.ts';
import { $, jit } from './util.ts';

type BoxLook = '80s' | 'minguo' | 'doodle';

/** 郵筒長相：八〇年代、民國、手繪；其他年代（含之後的 'map'）用八〇年代 */
export function boxLook(era: Era | string): BoxLook {
  switch (era) {
    case 'minguo':
      return 'minguo';
    case 'doodle':
      return 'doodle';
    default:
      return '80s';
  }
}

const COLORS: Record<BoxLook, Record<MailboxColor, string>> = {
  '80s': { green: '#1E6A4A', red: '#B3372B' },
  minguo: { green: '#2E4E3B', red: '#8B2E24' },
  doodle: { green: '#3F7A55', red: '#C04A38' },
};

export const boxLabel = (box: MailboxColor): string => (box === 'red' ? '限時' : '郵政');

/** 郵筒的 HTML：投信口（.slit）、字、下方的取信門（.pb-door）、底座 */
export function postboxHTML(box: MailboxColor, era: Era | string): string {
  const k = boxLook(era),
    c = COLORS[k][box === 'red' ? 'red' : 'green'];
  const sub = k === '80s' ? `<div class="pb-sub">${box === 'red' ? '專送' : '平信'}</div>` : '';
  return `<div class="pbx pb-${k}" data-box="${box === 'red' ? 'red' : 'green'}" style="--pb:${c}">${k === 'minguo' ? '<div class="pb-cap"></div>' : ''}<div class="slit"><i class="pb-lip"></i></div><div class="t">${boxLabel(box)}</div>${sub}<div class="pb-door"><i></i></div><div class="pb-foot"></div></div>`;
}

export interface Shake {
  kf: Keyframe[];
  d: number;
}

/**
 * 郵筒晃一下：以底部為軸，一下比一下小，最後停回原位。
 * 八〇年代鐵皮郵筒晃兩三下；民國的鑄鐵信筒更沉，幅度小、時間長；手繪的會先被壓扁一點再晃。
 * k：力道（1 = 信投進去；收信關門時小一點）
 */
export function shakeFrames(era: Era | string, k = 1): Shake {
  const a = k * (1 + jit(0.15)),
    look = boxLook(era),
    f = (n: number) => +(n * a).toFixed(2);
  const io = 'ease-in-out';
  if (look === 'minguo')
    return {
      d: 1500,
      kf: [
        { transform: 'none', easing: io },
        { transform: `translateY(${f(1.6)}px) rotate(${f(-1.3)}deg)`, easing: io },
        { transform: `rotate(${f(0.9)}deg)`, easing: io },
        { transform: `rotate(${f(-0.5)}deg)`, easing: io },
        { transform: `rotate(${f(0.2)}deg)`, easing: io },
        { transform: 'none' },
      ],
    };
  if (look === 'doodle')
    return {
      d: 1300,
      kf: [
        { transform: 'none', easing: io },
        { transform: `translateY(${f(3)}px) scale(1.04,.95) rotate(0deg)`, offset: 0.14, easing: io },
        { transform: `scale(.98,1.03) rotate(${f(-3.2)}deg)`, offset: 0.32, easing: io },
        { transform: `rotate(${f(2.2)}deg)`, offset: 0.52, easing: io },
        { transform: `rotate(${f(-1.1)}deg)`, offset: 0.72, easing: io },
        { transform: `rotate(${f(0.4)}deg)`, offset: 0.88, easing: io },
        { transform: 'none' },
      ],
    };
  return {
    d: 1150,
    kf: [
      { transform: 'none', easing: io },
      { transform: `translateY(${f(2.2)}px) rotate(${f(-2.4)}deg)`, easing: io },
      { transform: `rotate(${f(1.7)}deg)`, easing: io },
      { transform: `rotate(${f(-1)}deg)`, easing: io },
      { transform: `rotate(${f(0.45)}deg)`, easing: io },
      { transform: 'none' },
    ],
  };
}

/** 晃一下（投信口的鐵片也跟著喀啦一下） */
export async function shakeBox(pbx: HTMLElement, era: Era | string, k = 1): Promise<void> {
  const s = shakeFrames(era, k);
  const lip = $('.pb-lip', pbx);
  if (lip) void anim(lip, [{ transform: 'none' }, { transform: 'translateY(2px) rotateX(35deg)', offset: 0.2 }, { transform: 'translateY(-1px)', offset: 0.45 }, { transform: 'none' }], { d: 520, e: 'ease-out' });
  await anim(pbx, s.kf, { d: s.d, e: 'linear' });
}

/**
 * 拖到郵筒上放開之後：信封對準投信口、輕輕卡一下、慢慢滑進去（露在外面的部分越來越少）、郵筒晃一下。
 * g 是 dragPiece 的影子（position:fixed）。回傳一個「退回來」的函式：寄不出去時把信從投信口抽回來。
 */
export async function slideIntoSlot(g: HTMLElement, pbx: HTMLElement, era: Era | string): Promise<() => Promise<void>> {
  const slit = ($('.slit', pbx) ?? pbx).getBoundingClientRect();
  const w0 = g.offsetWidth || g.getBoundingClientRect().width || 1,
    h0 = g.offsetHeight || g.getBoundingClientRect().height || 1,
    L0 = parseFloat(g.style.left) || 0,
    T0 = parseFloat(g.style.top) || 0;
  const t0 = g.style.transform || 'none';
  const s = Math.min(1, (slit.width * 1.04) / w0),
    cx = slit.left + slit.width / 2,
    line = slit.top + slit.height / 2,
    tx = cx - (L0 + w0 / 2),
    tyHover = line - 16 - (T0 + h0),
    tyTouch = line - (T0 + h0),
    tyIn = tyTouch + s * h0 + 2;
  const T = (y: number, r = 0) => `translate(${tx.toFixed(1)}px,${y.toFixed(1)}px) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
  const clip = (frac: number) => `inset(0px 0px ${(h0 * frac).toFixed(1)}px 0px)`;
  g.style.transformOrigin = '50% 100%';
  const r1 = jit(1.6);
  // 1. 拿到投信口上方，對準
  await anim(
    g,
    [
      { transform: t0 },
      { transform: `translate(${tx.toFixed(1)}px,${(tyHover - 12).toFixed(1)}px) rotate(-5deg) scale(${(s * 1.05).toFixed(4)})`, offset: 0.6 },
      { transform: T(tyHover, r1) },
    ],
    { d: 760, e: INOUT },
  );
  await wait(140);
  // 2. 放正、碰到投信口
  await anim(g, [{ transform: T(tyHover, r1) }, { transform: T(tyTouch) }], { d: 360, e: 'cubic-bezier(.5,0,.8,.6)' });
  // 3. 一開始卡一下，然後被自己的重量拉下去
  const ys = [0, 0.16, 0.22, 1].map((p) => tyTouch + (tyIn - tyTouch) * p);
  await anim(
    g,
    [
      { transform: T(ys[0]!), clipPath: clip(0) },
      { transform: T(ys[1]!), clipPath: clip(0.16), offset: 0.38 },
      { transform: T(ys[2]!), clipPath: clip(0.22), offset: 0.52 },
      { transform: T(ys[3]!), clipPath: clip(1.02) },
    ],
    { d: 1050, e: 'cubic-bezier(.55,0,.8,.45)' },
  );
  g.style.opacity = '0';
  // 4. 落到底，郵筒晃一下
  await shakeBox(pbx, era);
  return async () => {
    g.style.opacity = '1';
    await anim(
      g,
      [
        { transform: T(ys[3]!), clipPath: clip(1.02) },
        { transform: T(tyHover), clipPath: clip(0), offset: 0.55 },
        { transform: t0, clipPath: clip(0) },
      ],
      { d: 900, e: INOUT },
    );
  };
}

/** 郵袋（收信的時候用） */
export function bagHTML(era: Era | string): string {
  const k = boxLook(era);
  return `<div class="pb-bag-in pb-bag-${k}"><span>${k === 'minguo' ? '郵' : '郵袋'}</span></div>`;
}
