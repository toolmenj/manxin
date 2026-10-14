import { describe, expect, it } from 'vitest';
import { clockTxt, cn, dur, fmt, hrs, roc } from './time.ts';

// 2026-10-14 21:05 臺北時間 = 13:05 UTC
const T = Date.UTC(2026, 9, 14, 13, 5);

describe('時間顯示：一律臺北時間、民國紀年（不管瀏覽器在哪個時區）', () => {
  it('fmt', () => {
    expect(fmt(T)).toBe('115/10/14（三） 21:05');
    expect(fmt(T, { wk: false })).toBe('115/10/14 21:05');
    expect(fmt(T, { time: false })).toBe('115/10/14（三）');
  });
  it('跨日：UTC 16:30 已經是臺北隔天 00:30', () => {
    expect(fmt(Date.UTC(2026, 9, 14, 16, 30), { wk: false })).toBe('115/10/15 00:30');
  });
  it('roc', () => expect(roc(T)).toBe('115.10.14'));
  it('三種年代的時鐘', () => {
    expect(clockTxt(T, '80s')).toBe('115.10.14　21:05');
    expect(clockTxt(T, 'doodle')).toBe('115年10月14日 21:05');
    expect(clockTxt(T, 'minguo')).toBe('民國一百十五年十月十四日　二十一時五分');
  });
  it('國字數字', () => {
    expect(cn(0)).toBe('〇');
    expect(cn(10)).toBe('十');
    expect(cn(15)).toBe('十五');
    expect(cn(105)).toBe('一百零五');
    expect(cn(115)).toBe('一百十五');
  });
  it('倒數與時數', () => {
    expect(dur(65_000)).toBe('01:05');
    expect(dur(3_725_000)).toBe('1:02:05');
    expect(dur(-5)).toBe('00:00');
    expect(hrs(26 * 3600e3)).toBe('1 天 2 小時');
    expect(hrs(5 * 3600e3)).toBe('5 小時');
  });
});
