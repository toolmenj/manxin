/**
 * 時間工具。所有運算一律以 Asia/Taipei 為準，與伺服器時區無關。
 * 時間點一律用 epoch 毫秒（number）傳遞。
 */
import { DateTime } from 'luxon';

export const TZ = 'Asia/Taipei';
export const MINUTE = 60_000;
export const H = 60 * MINUTE;
export const D = 24 * H;

export const tp = (t: number): DateTime => DateTime.fromMillis(t, { zone: TZ });

/** 當天（臺北）h 點整 */
export const at = (t: number, h: number): number =>
  tp(t).set({ hour: h, minute: 0, second: 0, millisecond: 0 }).toMillis();

/** 隔天（臺北）0 點 */
export const nextDay = (t: number): number => tp(t).startOf('day').plus({ days: 1 }).toMillis();

/** YYYY-MM-DD（臺北） */
export const ymd = (t: number): string => tp(t).toFormat('yyyy-MM-dd');

/** 臺北的小時（0–23） */
export const hourOf = (t: number): number => tp(t).hour;

/** 臺北的月份，0 起算（與原型 Date#getMonth 相同） */
export const month0 = (t: number): number => tp(t).month - 1;

/** 星期，0=週日（與原型 Date#getDay 相同） */
export const weekday0 = (t: number): number => tp(t).weekday % 7;

/** 民國紀年 115.10.14 */
export const roc = (t: number): string => {
  const d = tp(t);
  return `${d.year - 1911}.${String(d.month).padStart(2, '0')}.${String(d.day).padStart(2, '0')}`;
};

/** 由臺北當地時間建立 epoch 毫秒，測試與種子資料用 */
export const taipei = (iso: string): number => {
  const d = DateTime.fromISO(iso, { zone: TZ });
  if (!d.isValid) throw new Error(`invalid datetime: ${iso}`);
  return d.toMillis();
};
