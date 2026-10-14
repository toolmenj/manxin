/** 天氣。引擎只吃「某天某地是什麼天氣」的查詢函式，資料從哪來由呼叫端決定。 */
import { rng } from './rng.ts';
import { month0, ymd } from './time.ts';

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'typhoon';

/** dayStart：該日（臺北）0 點；place：城市名或網域 */
export type WeatherFn = (dayStart: number, place: string) => WeatherKind;

/**
 * 原型的決定性隨機天氣：7–10 月 5% 颱風；28% 降水，12–2 月其中 6% 是雪。
 * 同一天同一地永遠得到同樣結果。
 */
export const mockWeatherOf: WeatherFn = (t, place) => {
  const r = rng(ymd(t) + place)();
  const m = month0(t);
  if (m >= 6 && m <= 9 && r < 0.05) return 'typhoon';
  if (r < 0.28) return (m === 11 || m <= 1) && r < 0.06 ? 'snow' : 'rain';
  return 'clear';
};

/** 由 { 'YYYY-MM-DD': kind } 的表建立查詢函式；表裡沒有的日子回傳 fallback */
export function weatherFromTable(
  table: Readonly<Record<string, WeatherKind>>,
  fallback: WeatherKind = 'clear',
): WeatherFn {
  return (t) => table[ymd(t)] ?? fallback;
}
