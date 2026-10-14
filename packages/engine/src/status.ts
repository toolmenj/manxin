/**
 * 寄件狀態（移植自原型 status()）。
 * D-005（暫定）：24h／48h 提醒與 30 天退信，一律從「第一次送達」起算，改信箱不重新起算。
 */
import { DEFAULT_CALENDAR, toBusiness, type Calendar } from './calendar.ts';
import type { Plan } from './plan.ts';
import { D, H } from './time.ts';

export type ShipState = 'transit' | 'rerouting' | 'waiting' | 'signed' | 'returned';

export interface EmailEdit {
  /** 修改的時間 */
  t: number;
  email: string;
  /** 重新投遞的時間 */
  deliverAt: number;
}

export interface StatusInput {
  plan: Pick<Plan, 'deliver' | 'events' | 'stops'>;
  toEmail: string;
  signedAt: number | null;
  edits: readonly EmailEdit[];
}

export interface ShipStatus {
  state: ShipState;
  /** 24 小時提醒已觸發 */
  rem1: boolean;
  /** 48 小時提醒已觸發 */
  rem2: boolean;
  r1: number;
  r2: number;
  /** 退信時間 */
  ret: number;
  curEmail: string;
  curDeliver: number;
  /** 目前還能改幾次收件信箱 */
  editsLeft: number;
  /** 走到第幾個據點 */
  reached: number;
  first: number;
}

export const REMIND1_AFTER = D;
export const REMIND2_AFTER = 2 * D;
export const RETURN_AFTER = 30 * D;
export const MAX_EMAIL_EDITS = 2;

export function status(ship: StatusInput, now: number): ShipStatus {
  const t = now;
  const P = ship.plan;
  const first = P.deliver;
  const r1 = first + REMIND1_AFTER;
  const r2 = first + REMIND2_AFTER;
  const ret = first + RETURN_AFTER;
  const signedBefore = (x: number) => ship.signedAt != null && ship.signedAt <= x;
  const rem1 = t >= r1 && !signedBefore(r1);
  const rem2 = t >= r2 && !signedBefore(r2);
  const lastEdit = ship.edits[ship.edits.length - 1];
  const curEmail = lastEdit ? lastEdit.email : ship.toEmail;
  const curDeliver = lastEdit ? lastEdit.deliverAt : first;
  let state: ShipState;
  if (t < first) state = 'transit';
  else if (ship.signedAt != null && ship.signedAt <= t) state = 'signed';
  else if (t >= ret) state = 'returned';
  else if (t < curDeliver) state = 'rerouting';
  else state = 'waiting';
  const open = state === 'waiting' || state === 'rerouting';
  const editsLeft = open ? Math.max(0, (rem1 ? 1 : 0) + (rem2 ? 1 : 0) - ship.edits.length) : 0;
  const route = P.stops.length;
  let reached = 0;
  P.events.forEach((e) => {
    if (e.t <= t && !e.k) {
      const i = P.stops.indexOf(e.pl);
      if (i >= 0) reached = Math.max(reached, i);
    }
  });
  if (t >= first) reached = route;
  return { state, rem1, rem2, r1, r2, ret, curEmail, curDeliver, editsLeft, reached, first };
}

/** 改信箱後的重新投遞時間：一小時後，推到營業時間內（原型規則） */
export function rerouteDeliverAt(now: number, cal: Calendar = DEFAULT_CALENDAR): number {
  return toBusiness(now + H, cal);
}

export type EditCheck =
  | { ok: true }
  | { ok: false; code: 'NOT_DELIVERED' | 'SIGNED' | 'RETURNED' | 'NO_EDITS_LEFT' | 'SAME_EMAIL' };

/** 能不能改收件信箱 */
export function canEditEmail(ship: StatusInput, newEmail: string, now: number): EditCheck {
  const st = status(ship, now);
  if (st.state === 'transit') return { ok: false, code: 'NOT_DELIVERED' };
  if (st.state === 'signed') return { ok: false, code: 'SIGNED' };
  if (st.state === 'returned') return { ok: false, code: 'RETURNED' };
  if (st.editsLeft <= 0) return { ok: false, code: 'NO_EDITS_LEFT' };
  if (newEmail.trim().toLowerCase() === st.curEmail.trim().toLowerCase()) return { ok: false, code: 'SAME_EMAIL' };
  return { ok: true };
}

/** 退件郵戳的樣式參數（依目的地決定，與原型 postmark() 相同） */
export interface ReturnPostmark {
  place: string;
  /** 0 雙圓、1 三圓、2 橢圓、3 六角 */
  shape: number;
  color: string;
  /** 民國日期 115.10.14 */
  date: string;
}
