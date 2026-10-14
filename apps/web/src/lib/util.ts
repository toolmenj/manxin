/**
 * 小工具：DOM 捷徑、跳脫、決定性亂數（只拿來做畫面上的隨機角度，跟物流時間無關）。
 * 移植自原型 index.html 開頭的工具函式。
 */
export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T | null => r.querySelector<T>(s);
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T[] => [...r.querySelectorAll<T>(s)];

export function el<K extends keyof HTMLElementTagNameMap>(t: K, c?: string, h?: string | null): HTMLElementTagNameMap[K] {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (h != null) e.innerHTML = h;
  return e;
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export function hash(s: unknown): number {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: unknown): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const p2 = (n: number): string => String(n).padStart(2, '0');

export const jit = (a: number): number => (Math.random() * 2 - 1) * a;

export const okMail = (s: string | null | undefined): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s || '');

/** UPU S10 單號加空白，方便閱讀：RR 1234 5678 9 TW */
export const spaced = (no: string): string => `${no.slice(0, 2)} ${no.slice(2, 6)} ${no.slice(6, 10)} ${no.slice(10, 11)} ${no.slice(11)}`;
