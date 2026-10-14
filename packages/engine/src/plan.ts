/**
 * 送達計畫（移植自原型 plan()）。
 * 送達時間 = 寄出後最近的發車時間 + 基礎天數 + 48 小時內隨機延遲 + 天氣延遲，再推到營業時間內。
 */
import { DEFAULT_CALENDAR, nextDeparture, toBusiness, type Calendar } from './calendar.ts';
import { CENTER, domain, parsePlace, type MailboxColor, type Place } from './places.ts';
import { rng, type Rng } from './rng.ts';
import { at, D, H, hourOf, nextDay } from './time.ts';
import { mockWeatherOf, type WeatherFn } from './weather.ts';

export interface ShipmentEnv {
  fromName?: string;
  fromEmail: string;
  fromAddr?: string;
  toName?: string;
  toEmail: string;
  toAddr?: string;
}

export interface PlanInput {
  /** 單號，同時是隨機種子 */
  no: string;
  sentAt: number;
  /** 寄出的郵局／郵筒名稱 */
  office: string;
  box: MailboxColor;
  env: ShipmentEnv;
}

export type EventKind = 'ok' | 'warn' | 'bad';

export interface PlanEvent {
  t: number;
  tx: string;
  pl: string;
  k?: EventKind;
}

export interface Plan {
  stops: string[];
  base: number;
  baseWhy: string;
  start: number;
  randDelay: number;
  wDelay: number;
  raw: number;
  deliver: number;
  events: PlanEvent[];
  dest: string;
}

export interface CourierContext {
  A: Place | null;
  B: Place | null;
  fromEmail: string;
  toEmail: string;
  /** 決定性隨機，呼叫順序會影響後面的延遲，請只在需要時呼叫 */
  r: Rng;
}

/** 基礎天數來源（D-007 暫用縣市距離表） */
export type CourierFn = (ctx: CourierContext) => { base: number; why: string };

/** 原型的縣市距離表 */
export const countyTableCourier: CourierFn = ({ A, B, r }) => {
  if (A && B) {
    const isl = A.region === '島' || B.region === '島';
    const east = A.region === '東' || B.region === '東';
    const out = A.region === '外' || B.region === '外';
    if (out) return { base: 5 + Math.floor(r() * 10), why: '地址不在臺灣縣市表內，暫以 5～14 天隨機' };
    if (A.city === B.city && A.region === B.region) return { base: 1, why: '同縣市' };
    if (isl) return { base: 5, why: '往返離島' };
    if (east) return { base: 4, why: '往返東部' };
    if (A.region === B.region) return { base: 2, why: '同區域' };
    return { base: 3, why: '跨區域' };
  }
  return { base: 3 + Math.floor(r() * 12), why: '沒有兩端實體地址，3～14 天隨機' };
};

export interface PlanDeps {
  calendar?: Calendar;
  weather?: WeatherFn;
  courier?: CourierFn;
}

export function plan(ship: PlanInput, deps: PlanDeps = {}): Plan {
  const cal = deps.calendar ?? DEFAULT_CALENDAR;
  const weatherOf = deps.weather ?? mockWeatherOf;
  const courier = deps.courier ?? countyTableCourier;

  const r = rng(ship.no);
  const A = parsePlace(ship.env.fromAddr);
  const B = parsePlace(ship.env.toAddr);
  let stops: string[];
  let dest: string;
  if (A && B) {
    stops = [`${A.city}${A.dist} ${ship.office}`, CENTER[A.region]];
    if (A.region !== B.region) stops.push(CENTER[B.region]);
    stops.push(`${B.city}${B.dist}郵局 投遞股`);
    dest = `${B.city}${B.dist}`;
  } else {
    const fd = domain(ship.env.fromEmail);
    const td = domain(ship.env.toEmail);
    stops = [ship.office, `${fd} 轉運中心`];
    if (td !== fd) stops.push(`${td} 轉運中心`);
    stops.push(`${td} 投遞所`);
    dest = td;
  }
  let { base, why: baseWhy } = courier({ A, B, fromEmail: ship.env.fromEmail, toEmail: ship.env.toEmail, r });
  if (ship.box === 'red') {
    base = Math.max(1, base - 1);
    baseWhy += '，紅色限時郵筒少 1 天';
  }

  const start = nextDeparture(ship.sentAt, cal);
  const randDelay = Math.round(r() * 48 * H);
  let wDelay = 0;
  const wev: PlanEvent[] = [];
  const wPlace = B ? B.city : dest;
  for (let d = at(start, 0); d <= start + base * D; d = nextDay(d)) {
    const w = weatherOf(d, wPlace);
    if (w === 'typhoon') {
      wDelay += D;
      wev.push({ t: at(d, 10), tx: '颱風警報，車班停駛，延誤約 1 天', pl: wPlace, k: 'warn' });
    } else if (w !== 'clear') {
      const add = Math.round((2 + r() * 4) * H);
      wDelay += add;
      wev.push({
        t: at(d, 8) + Math.round(r() * 8) * H,
        tx: `${w === 'rain' ? '降雨' : '降雪'}，路況延誤約 ${Math.round(add / H)} 小時`,
        pl: wPlace,
        k: 'warn',
      });
    }
  }
  const raw = start + base * D + randDelay + wDelay;
  const deliver = toBusiness(raw, cal);

  const ev: PlanEvent[] = [
    { t: ship.sentAt, tx: `已交寄（${ship.box === 'red' ? '紅色郵筒・限時' : '綠色郵筒・普通'}）`, pl: stops[0]! },
    { t: start, tx: `搭 ${hourOf(start)}:00 班次發車`, pl: stops[1]! },
  ];
  const mid = stops.slice(2, -1);
  mid.forEach((s, i) =>
    ev.push({ t: start + Math.round(((raw - start) * (i + 1)) / (mid.length + 1)), tx: '抵達，分揀中', pl: s }),
  );
  ev.push({
    t: Math.max(ev[ev.length - 1]!.t + H, deliver - Math.round((1 + r() * 2) * H)),
    tx: '交由投遞人員',
    pl: stops[stops.length - 1]!,
  });
  ev.push({ t: deliver, tx: '已投遞至收件人電子信箱', pl: ship.env.toEmail, k: 'ok' });
  wev.forEach((w) => {
    if (w.t > start && w.t < deliver) ev.push(w);
  });
  ev.sort((a, b) => a.t - b.t);
  return { stops, base, baseWhy, start, randDelay, wDelay, raw, deliver, events: ev, dest };
}
