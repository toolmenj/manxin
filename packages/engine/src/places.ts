/** 地址解析、物流中心、郵局與前往方式（移植自原型）。 */

export type Region = '北' | '中' | '南' | '東' | '島' | '外';

export const CITIES: ReadonlyArray<readonly [string, Region]> = [
  ['臺北', '北'], ['台北', '北'], ['新北', '北'], ['基隆', '北'], ['桃園', '北'], ['新竹', '北'], ['宜蘭', '北'],
  ['苗栗', '中'], ['臺中', '中'], ['台中', '中'], ['彰化', '中'], ['南投', '中'], ['雲林', '中'],
  ['嘉義', '南'], ['臺南', '南'], ['台南', '南'], ['高雄', '南'], ['屏東', '南'],
  ['花蓮', '東'], ['臺東', '東'], ['台東', '東'],
  ['澎湖', '島'], ['金門', '島'], ['連江', '島'], ['馬祖', '島'],
];

export const CENTER: Readonly<Record<Region, string>> = {
  北: '臺北郵件處理中心',
  中: '臺中郵件處理中心',
  南: '高雄郵件處理中心',
  東: '花蓮郵件轉運站',
  島: '離島航運轉運站',
  外: '國際郵件處理中心',
};

export interface Place {
  city: string;
  region: Region;
  dist: string;
}

/** 實體地址不要求精確：找得到縣市就好，找不到當作「外」 */
export function parsePlace(a: string | null | undefined): Place | null {
  if (!a || !a.trim()) return null;
  a = a.replace(/\s/g, '');
  for (const [c, r] of CITIES) {
    const i = a.indexOf(c);
    if (i >= 0) {
      const rest = a.slice(i + c.length).replace(/^[市縣]/, '');
      const m = rest.match(/^(.{1,3}?[區鄉鎮市])/);
      return { city: c.replace('台', '臺'), region: r, dist: m ? m[1]! : '' };
    }
  }
  return { city: a.slice(0, 6), region: '外', dist: '' };
}

/** 電子信箱的網域（沒有實體地址時拿來當地名） */
export const domain = (e: string | null | undefined): string =>
  (String(e || '').split('@')[1] || '未知網域').toLowerCase();

/* ---------- 前往郵局 ---------- */

export type PlaceId = 'box' | 'po' | 'main';
export type TravelMode = 'walk' | 'bike' | 'car';
export type MailboxColor = 'green' | 'red';

export interface PostPlace {
  id: PlaceId;
  name: string;
  kind: string;
  /** 距離（公尺） */
  m: number;
}

/** 原型的三個範例地點（正式版改接地圖 API，見 docs/api.md） */
export const PLACES: readonly PostPlace[] = [
  { id: 'box', name: '巷口郵筒', kind: '郵筒，綠紅一對', m: 350 },
  { id: 'po', name: '社區郵局', kind: '郵局，櫃台旁有郵筒', m: 1300 },
  { id: 'main', name: '總局夜間投遞口', kind: '郵局，24 小時投遞', m: 3800 },
];

/** mpm：每分鐘公尺數；extra：額外分鐘（找車位、牽車） */
export const MODES: Readonly<Record<TravelMode, { label: string; mpm: number; extra: number }>> = {
  walk: { label: '步行', mpm: 80, extra: 0 },
  bike: { label: '騎車', mpm: 250, extra: 2 },
  car: { label: '開車', mpm: 420, extra: 6 },
};

export const placeById = (id: string): PostPlace | undefined => PLACES.find((p) => p.id === id);

/** 前往所需分鐘數 */
export const tripMin = (pl: Pick<PostPlace, 'm'>, md: TravelMode): number =>
  Math.ceil(pl.m / MODES[md].mpm + MODES[md].extra);
