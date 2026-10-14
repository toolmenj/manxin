/** 未寄出的信：每 30 天問一次「之前寫的那封信現在想寄出了嗎？」（PRD 2.7） */
import { D } from './time.ts';

export const UNSENT_ASK_EVERY = 30 * D;

/** 下一次該問的時間：從放進抽屜（或上次問過）起算 30 天 */
export const nextUnsentAsk = (shelvedAt: number, askedAt: number | null): number =>
  (askedAt ?? shelvedAt) + UNSENT_ASK_EVERY;

export const unsentAskDue = (shelvedAt: number, askedAt: number | null, now: number): boolean =>
  now >= nextUnsentAsk(shelvedAt, askedAt);
