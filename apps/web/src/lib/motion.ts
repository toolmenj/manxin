/**
 * 動作：慢、帶一點不規則，像手在做（PRD 第 6 章）。移植自原型的 anim／wait／makeScene／sayIt／endScene。
 * - prefers-reduced-motion 時一律省略（duration 1ms）。
 * - 長動畫的場景有「略過」，按下去 FAST=true，剩下的動畫立刻跑完。
 * - 動畫只是表現：呼叫端要先送出資料，再播動畫，不能讓動畫卡住寫入。
 */
import { el } from './util.ts';

export const RM: boolean = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const EASE = 'cubic-bezier(.25,.8,.3,1)';
export const INOUT = 'cubic-bezier(.45,.05,.3,1)';

let FAST = false;
export const isFast = (): boolean => RM || FAST;

export interface AnimOpts {
  d?: number;
  delay?: number;
  e?: string;
}

export function anim(e: Element | null | undefined, kf: Keyframe[] | PropertyIndexedKeyframes, o: AnimOpts = {}): Promise<void> {
  if (!e || typeof (e as HTMLElement).animate !== 'function') return Promise.resolve();
  const q = RM || FAST;
  const a = e.animate(kf, { duration: q ? 1 : o.d || 800, delay: q ? 0 : o.delay || 0, easing: o.e || EASE, fill: 'both' });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, RM || FAST ? 0 : ms));

export interface Scene {
  sc: HTMLElement;
  say: HTMLElement;
}

/** 場景收掉時要一起拆掉的東西（鍵盤監聽） */
const cleanups = new WeakMap<HTMLElement, () => void>();

/** 剩下的動畫立刻跑完（「略過」、Esc） */
function skipScene(root: HTMLElement): void {
  FAST = true;
  root.classList.add('fast');
  root.getAnimations({ subtree: true }).forEach((a) => {
    if (a.effect && a.effect.getTiming().iterations === Infinity) return;
    try {
      a.finish();
    } catch {
      /* 有些動畫還沒開始 */
    }
  });
}

/** 全螢幕場景（寄信、拆信、丟垃圾桶），右下角有「略過」，也可以按 Esc */
export function makeScene(): Scene {
  FAST = false;
  const root = el('div', 'scene'),
    cam = el('div', 'cam'),
    beam = el('div', 'beam');
  const sk = el('button', 'btn small skip', '略過');
  sk.type = 'button';
  sk.onclick = () => skipScene(root);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') skipScene(root);
  };
  document.addEventListener('keydown', onKey);
  cleanups.set(root, () => document.removeEventListener('keydown', onKey));
  const say = el('div', 'say');
  root.append(beam);
  if (!RM)
    for (let i = 0; i < 14; i++) {
      const m = el('span', 'mote');
      m.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;--t:${(9 + Math.random() * 10).toFixed(1)}s;--d:-${(Math.random() * 12).toFixed(1)}s;--dx:${(Math.random() * 80 - 40).toFixed(0)}px;transform:scale(${(0.5 + Math.random()).toFixed(2)})`;
      root.append(m);
    }
  root.append(cam, say, sk);
  document.body.append(root);
  return { sc: cam, say };
}

/**
 * 換頁（元件卸載）時把還在播的場景收掉：畫面立刻拿掉、不留殘影，
 * 還在 await 的場景程式會以「略過」的速度跑完（endScene 再把 FAST 還原）。資料早就送出了，不受影響。
 */
export function abortScenes(): void {
  const roots = [...document.querySelectorAll<HTMLElement>('.scene')];
  if (!roots.length) return;
  roots.forEach((r) => {
    skipScene(r);
    cleanups.get(r)?.();
    cleanups.delete(r);
    r.remove();
  });
}

/** 字一個一個像墨水暈開 */
export function inkify(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  let i = 0;
  const walk = (n: Node) =>
    [...n.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const f = document.createDocumentFragment();
        for (const ch of c.textContent ?? '') {
          const s = document.createElement('span');
          s.className = 'ch';
          s.textContent = ch;
          s.style.setProperty('--i', String(i++));
          f.append(s);
        }
        (c as ChildNode).replaceWith(f);
      } else walk(c);
    });
  walk(d);
  return d.innerHTML;
}

export async function sayIt(say: HTMLElement, html: string): Promise<void> {
  await anim(say, [{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(4px)' }], { d: 320, e: 'ease-in' });
  say.innerHTML = RM || FAST ? html : inkify(html);
  await anim(say, [{ opacity: 0 }, { opacity: 1, filter: 'none' }], { d: 250 });
  await wait(Math.min(900, (say.textContent ?? '').length * 65));
}

export async function endScene(sc: HTMLElement): Promise<void> {
  const root = (sc.closest('.scene') as HTMLElement) || sc;
  if (root.isConnected) await anim(root, [{ opacity: 1 }, { opacity: 0.4, offset: 0.3 }, { opacity: 0.75, offset: 0.4 }, { opacity: 0 }], { d: 900, e: 'ease' });
  cleanups.get(root)?.();
  cleanups.delete(root);
  root.remove();
  FAST = false;
}
