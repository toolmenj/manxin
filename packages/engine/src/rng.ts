/** 決定性隨機（與原型相同：FNV-1a 雜湊 + mulberry32），同一個種子永遠得到同一串數字。 */

export function hash(s: unknown): number {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Rng = () => number;

export function rng(seed: unknown): Rng {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
