/** 虛擬快遞單號（UPU S10 格式，含檢查碼）與退件郵戳參數。 */
import { hash, rng } from './rng.ts';
import { roc } from './time.ts';
import type { ReturnPostmark } from './status.ts';

export const S10W = [8, 6, 4, 2, 3, 5, 9, 7] as const;

export function s10CheckDigit(serial8: string): number {
  let s = 0;
  for (let i = 0; i < 8; i++) s += Number(serial8[i]) * S10W[i]!;
  let c = 11 - (s % 11);
  if (c === 10) c = 0;
  if (c === 11) c = 5;
  return c;
}

/** RR + 8 碼序號 + 1 碼檢查碼 + TW */
export function trackNo(seed: string): string {
  const r = rng(seed);
  let n = '';
  for (let i = 0; i < 8; i++) n += Math.floor(r() * 10);
  return `RR${n}${s10CheckDigit(n)}TW`;
}

export function isValidTrackNo(no: string): boolean {
  const m = /^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/.exec(no);
  if (!m) return false;
  return s10CheckDigit(m[2]!) === Number(m[3]);
}

/** 顯示用：RR 1234 5678 9 TW */
export const spaced = (no: string): string =>
  `${no.slice(0, 2)} ${no.slice(2, 6)} ${no.slice(6, 10)} ${no.slice(10, 11)} ${no.slice(11)}`;

const PM_COLORS = ['#9B2D24', '#2B3F73', '#5B3A7A', '#1F5C45'] as const;

export function returnPostmark(place: string, t: number): ReturnPostmark {
  return {
    place: place.length > 12 ? place.slice(0, 12) : place,
    shape: hash(place) % 4,
    color: PM_COLORS[hash(place + 'c') % 4]!,
    date: roc(t),
  };
}
