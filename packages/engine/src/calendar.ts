/**
 * 工作日、發車班次、營業時間。
 * 規則（CLAUDE.md、PRD 4.3）：發車 12:00／15:00／18:00；上班 9:00–18:00；週休二日、國定假日休息；18:00 整算下班。
 */
import holidaysData from './data/holidays-tw.json' with { type: 'json' };
import { at, hourOf, nextDay, tp, weekday0, ymd } from './time.ts';

export interface Calendar {
  /** YYYY-MM-DD（臺北）放假日 */
  holidays: ReadonlySet<string>;
  /** YYYY-MM-DD 週末補班日（目前沒有，保留欄位） */
  makeupWorkdays?: ReadonlySet<string>;
}

export interface HolidayEntry {
  date: string;
  name: string;
  estimated?: boolean;
}

export const HOLIDAY_ENTRIES: readonly HolidayEntry[] = holidaysData.holidays;

/** 預設行事曆（2026–2027，資料需以人事行政總處公告為準） */
export const DEFAULT_CALENDAR: Calendar = {
  holidays: new Set(holidaysData.holidays.map((h) => h.date)),
  makeupWorkdays: new Set<string>(holidaysData.makeupWorkdays as string[]),
};

export const DEPARTURE_HOURS = [12, 15, 18] as const;
export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 18;

/** 搜尋上限（天）。原型同樣用 90 天，避免資料錯誤時無窮迴圈 */
const SEARCH_DAYS = 90;

export function isWork(t: number, cal: Calendar = DEFAULT_CALENDAR): boolean {
  const day = ymd(t);
  if (cal.makeupWorkdays?.has(day)) return true;
  const w = weekday0(t);
  return w !== 0 && w !== 6 && !cal.holidays.has(day);
}

/** 寄出後最近的發車時間（含剛好等於發車時間） */
export function nextDeparture(t: number, cal: Calendar = DEFAULT_CALENDAR): number {
  let day = at(t, 0);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    if (isWork(day, cal)) {
      for (const h of DEPARTURE_HOURS) {
        const c = at(day, h);
        if (c >= t) return c;
      }
    }
    day = nextDay(day);
  }
  return t;
}

/** 把時間點推到營業時間內：下班（含 18:00 整）或假日就順延到下一個工作天 9:00 */
export function toBusiness(t: number, cal: Calendar = DEFAULT_CALENDAR): number {
  for (let i = 0; i < SEARCH_DAYS; i++) {
    if (!isWork(t, cal)) {
      t = at(nextDay(t), OPEN_HOUR);
      continue;
    }
    const h = hourOf(t);
    if (h < OPEN_HOUR) return at(t, OPEN_HOUR);
    if (h >= CLOSE_HOUR) {
      t = at(nextDay(t), OPEN_HOUR);
      continue;
    }
    return t;
  }
  return t;
}

/** 方便除錯：顯示臺北時間 */
export const fmtTaipei = (t: number): string => tp(t).toFormat("yyyy-MM-dd HH:mm (ccc)");
