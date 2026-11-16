/**
 * 天氣來源。引擎只吃同步的 WeatherFn，所以 provider 要在算計畫之前先把需要的日子準備好。
 *
 * D-022（照建議）：一週內用中央氣象署的預報，更遠的日子用模擬天氣。
 */
import { mockWeatherOf, ymd, type WeatherFn, type WeatherKind } from '@manxin/engine';

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

/** F-D0047-091 的 LocationName 可選的縣市（中央氣象署 API 規格 /apidoc/v1，2026-11-12 讀取） */
export const CWA_COUNTIES = [
  '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣', '臺北市', '新北市', '桃園市', '臺中市', '臺南市',
  '高雄市', '基隆市', '新竹縣', '新竹市', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '嘉義市', '屏東縣',
] as const;

/** 地址或地名 → 縣市全名（台→臺；「臺南」也認得） */
export function toCounty(place: string | null | undefined): string | null {
  if (!place) return null;
  const p = place.replace(/台/g, '臺').trim();
  for (const c of CWA_COUNTIES) if (p.startsWith(c) || p.startsWith(c.slice(0, 2))) return c;
  return null;
}

/* ---------- 解析預報 ---------- */

type Json = unknown;
/** 不分大小寫取欄位：中央氣象署不同資料集、不同年份的欄位大小寫不一樣（Locations／locations、ElementName／elementName） */
function get(o: Json, ...names: string[]): Json {
  if (!o || typeof o !== 'object') return undefined;
  const keys = Object.keys(o as object);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
    if (k) return (o as Record<string, Json>)[k];
  }
  return undefined;
}
const arr = (v: Json): Json[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** 走遍整棵樹，找出有某個欄位的物件 */
function findAll(o: Json, pred: (x: Record<string, Json>) => boolean, out: Record<string, Json>[] = []): Record<string, Json>[] {
  if (Array.isArray(o)) for (const x of o) findAll(x, pred, out);
  else if (o && typeof o === 'object') {
    if (pred(o as Record<string, Json>)) out.push(o as Record<string, Json>);
    for (const v of Object.values(o as object)) findAll(v, pred, out);
  }
  return out;
}

const RANK: Record<WeatherKind, number> = { clear: 0, rain: 1, snow: 2, typhoon: 3 };

/** 天氣現象的文字 → 引擎的天氣種類（看字，不靠代碼表） */
export function kindOfText(text: string): WeatherKind {
  if (/颱風/.test(text)) return 'typhoon';
  if (/雪|冰/.test(text)) return 'snow';
  if (/雨|雷/.test(text)) return 'rain';
  return 'clear';
}

/**
 * 從一週預報找出某縣市每天的天氣（同一天有好幾個時段，取最壞的）。
 * 結構容錯：找名稱等於縣市的地點、裡面名稱是「天氣現象」（或 Wx）的預報因子、每個時段的開始時間與天氣文字。
 */
export function parseCwaWeek(json: Json, county: string): Record<string, WeatherKind> {
  const out: Record<string, WeatherKind> = {};
  const locs = findAll(json, (x) => get(x, 'LocationName', 'locationName') === county);
  for (const loc of locs) {
    const els = arr(get(loc, 'WeatherElement', 'weatherElement'));
    const wx = els.find((e) => ['天氣現象', 'Wx'].includes(String(get(e, 'ElementName', 'elementName'))));
    for (const tm of arr(get(wx, 'Time', 'time'))) {
      const start = String(get(tm, 'StartTime', 'startTime', 'DataTime', 'dataTime') ?? '');
      const t = Date.parse(start.length === 19 ? start + '+08:00' : start);
      if (!Number.isFinite(t)) continue;
      const texts: string[] = [];
      for (const v of arr(get(tm, 'ElementValue', 'elementValue', 'Parameter', 'parameter'))) {
        const w = get(v, 'Weather', 'weather', 'value', 'ParameterName', 'parameterName');
        if (typeof w === 'string') texts.push(w);
      }
      if (!texts.length) continue;
      const k = kindOfText(texts.join(' '));
      const d = ymd(t);
      if (!out[d] || RANK[k] > RANK[out[d]!]) out[d] = k;
    }
  }
  return out;
}

/**
 * 中央氣象署開放資料：F-D0047-091 鄉鎮天氣預報－臺灣未來 1 週天氣預報（依 /apidoc/v1 規格：
 * Authorization、LocationName（縣市）、ElementName（天氣現象）、format=JSON）。
 *
 * 注意：回傳的 JSON 欄位在規格裡沒有寫，parseCwaWeek 是容錯解析，還沒用真的授權碼驗證過。
 * 任何錯誤（沒有授權碼、逾時、格式不對、地址認不出縣市）都退回模擬天氣，不會讓寄信失敗。
 */
export class CwaWeather implements WeatherProvider {
  readonly name = 'cwa';
  private cache = new Map<string, { at: number; table: Record<string, WeatherKind> }>();
  constructor(
    private readonly apiKey: string | undefined,
    private readonly log?: { warn(o: object, msg: string): void },
    private readonly fetchFn: typeof fetch = fetch,
    private readonly ttlMs = 3 * 3600_000,
  ) {}

  async prepare(place: string): Promise<WeatherFn> {
    const county = toCounty(place);
    if (!this.apiKey || !county) return mockWeatherOf;
    let table: Record<string, WeatherKind>;
    try {
      table = await this.week(county);
    } catch (e) {
      this.log?.warn({ err: e, county }, 'CWA weather failed, using mock');
      return mockWeatherOf;
    }
    // 預報裡有的日子用預報，其他（超過一週）用模擬天氣（D-022）
    return (t, p) => table[ymd(t)] ?? mockWeatherOf(t, p);
  }

  private async week(county: string): Promise<Record<string, WeatherKind>> {
    const hit = this.cache.get(county);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.table;
    const u = new URL('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091');
    u.searchParams.set('Authorization', this.apiKey!);
    u.searchParams.set('format', 'JSON');
    u.searchParams.set('LocationName', county);
    u.searchParams.set('ElementName', '天氣現象');
    const r = await this.fetchFn(u, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`CWA HTTP ${r.status}`);
    const table = parseCwaWeek(await r.json(), county);
    if (!Object.keys(table).length) throw new Error('CWA response had no usable forecast');
    this.cache.set(county, { at: Date.now(), table });
    return table;
  }
}
