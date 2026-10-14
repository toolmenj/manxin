/**
 * 時間顯示（只負責「怎麼寫出來」，不計算任何物流時間）。
 * 一律以 Asia/Taipei 顯示、民國紀年。臺灣自 1979 年起沒有日光節約時間，固定 UTC+8。
 */
import { p2 } from './util.ts';

export const H = 3600e3;
export const D = 24 * H;
const TPE = 8 * H;

export interface TpeParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** 0=週日 */
  wd: number;
}

export function tpe(t: number): TpeParts {
  const d = new Date(t + TPE);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
}

const WK = '日一二三四五六';

/** 原型 fmt()：115/10/14（三） 21:05 */
export function fmt(t: number, o: { wk?: boolean; time?: boolean } = {}): string {
  const d = tpe(t);
  let s = `${d.y - 1911}/${p2(d.mo)}/${p2(d.d)}`;
  if (o.wk !== false) s += `（${WK[d.wd]}）`;
  if (o.time !== false) s += ` ${p2(d.h)}:${p2(d.mi)}`;
  return s;
}

/** 115.10.14 */
export function roc(t: number): string {
  const d = tpe(t);
  return `${d.y - 1911}.${p2(d.mo)}.${p2(d.d)}`;
}

/** 倒數：1:02:03 或 02:03 */
export function dur(ms: number): string {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / H),
    m = Math.floor((ms % H) / 6e4),
    s = Math.floor((ms % 6e4) / 1e3);
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

export function hrs(ms: number): string {
  const h = Math.round(ms / H);
  return h >= 24 ? `${Math.floor(h / 24)} 天 ${h % 24} 小時` : `${h} 小時`;
}

/** 國字數字（民國風格的時鐘） */
export function cn(n: number): string {
  const d = '〇一二三四五六七八九';
  if (n < 10) return d[n]!;
  if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
  if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
  const h = Math.floor(n / 100),
    r = n % 100;
  return d[h] + '百' + (r === 0 ? '' : r < 10 ? '零' + d[r] : cn(r));
}

export type Era = '80s' | 'minguo' | 'doodle';

/** 頁首的模擬時間，三種年代各自的寫法 */
export function clockTxt(t: number, era: Era): string {
  const d = tpe(t);
  if (era === 'doodle') return `${d.y - 1911}年${d.mo}月${d.d}日 ${p2(d.h)}:${p2(d.mi)}`;
  if (era === 'minguo') return `民國${cn(d.y - 1911)}年${cn(d.mo)}月${cn(d.d)}日　${cn(d.h)}時${cn(d.mi)}分`;
  return `${d.y - 1911}.${p2(d.mo)}.${p2(d.d)}　${p2(d.h)}:${p2(d.mi)}`;
}
