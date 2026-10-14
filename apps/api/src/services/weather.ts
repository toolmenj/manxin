/**
 * 天氣來源。引擎只吃同步的 WeatherFn，所以 provider 要在算計畫之前先把需要的日子準備好。
 */
import { mockWeatherOf, type WeatherFn } from '@manxin/engine';

export interface WeatherProvider {
  readonly name: string;
  /** 準備 [from, to] 期間、place 的天氣，回傳給引擎用的查詢函式 */
  prepare(place: string, from: number, to: number): Promise<WeatherFn>;
}

/** 原型的決定性隨機天氣 */
export class MockWeather implements WeatherProvider {
  readonly name = 'mock';
  async prepare(): Promise<WeatherFn> {
    return mockWeatherOf;
  }
}

/**
 * TODO：中央氣象署開放資料（https://opendata.cwa.gov.tw）。
 * - 鄉鎮天氣預報（F-D0047-091 一週預報）取降雨機率與天氣現象；颱風警報（W-C0034-005）判斷 typhoon。
 * - 預報只有一週，超過的日子退回 MockWeather 或視為 clear（需要使用者決定）。
 * - 結果建議快取在資料表（place, date, kind），同一天同一地只問一次。
 */
export class CwaWeather implements WeatherProvider {
  readonly name = 'cwa';
  constructor(private readonly apiKey: string | undefined) {}
  async prepare(): Promise<WeatherFn> {
    void this.apiKey;
    throw new Error('CwaWeather 尚未實作（TODO）。請用 WEATHER_PROVIDER=mock。');
  }
}
