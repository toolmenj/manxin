/**
 * 收信狀態（移植自原型 bindOpen／tearApart／pryStamp／pryWax／pourOut）。
 * 機率由呼叫端擲骰後以 roll（0–1）傳入，引擎保持純函式。
 *
 * D-013（暫定）：撕毀判定由前端依軌跡判斷後回報位置，後端只驗證狀態轉移。
 * D-014（暫定）：撬郵票／火漆帶下紙纖維的機率固定 40%。
 */
import { ENVS, type EnvelopeKind } from './packing.ts';

export const ROUGH_EDGE_CHANCE = 0.5;
export const FIBER_CHANCE = 0.4;

export type OpenMethod = 'knife' | 'tear';

export interface Piece {
  /** eL／eR：信封左右半；lL／lR：信紙左右半 */
  k: 'eL' | 'eR' | 'lL' | 'lR';
  x: number;
  y: number;
  rot: number;
}

export interface RecvState {
  entered: boolean;
  opened: boolean;
  /** knife／tear／rip（撕毀） */
  method: OpenMethod | 'rip' | null;
  /** 膠貼信封手撕時撕下半層紙的毛邊 */
  rough: boolean;
  /** 開信軌跡（SVG path，0–100 座標），只做顯示 */
  cutPath: string;
  torn: { x: number; seed: string } | null;
  pieces: Piece[] | null;
  poured: boolean;
  unfolded: boolean;
  collected: boolean;
  stampTaken: boolean;
  stampFiber: boolean;
  waxTaken: boolean;
  waxFiber: boolean;
}

export const initialRecv = (): RecvState => ({
  entered: false,
  opened: false,
  method: null,
  rough: false,
  cutPath: '',
  torn: null,
  pieces: null,
  poured: false,
  unfolded: false,
  collected: false,
  stampTaken: false,
  stampFiber: false,
  waxTaken: false,
  waxFiber: false,
});

export type RecvError =
  | 'ALREADY_OPENED'
  | 'NOT_OPENED'
  | 'NOT_POURED'
  | 'ALREADY_POURED'
  | 'NOT_UNFOLDED'
  | 'ALREADY_UNFOLDED'
  | 'ALREADY_COLLECTED'
  | 'NO_STAMP'
  | 'ALREADY_TAKEN'
  | 'NO_WAX'
  | 'NOT_TORN'
  | 'NOT_ENTERED'
  | 'INVALID_PIECES';

export type RecvResult = { ok: true; state: RecvState; signs: boolean } | { ok: false; code: RecvError };

const ok = (state: RecvState, signs = false): RecvResult => ({ ok: true, state, signs });
const err = (code: RecvError): RecvResult => ({ ok: false, code });

/** 點開連結。明信片沒有信封，一進來就算打開（也就是簽收） */
export function enter(s: RecvState, env: EnvelopeKind): RecvResult {
  const n = { ...s, entered: true };
  if (env === 'card' && !s.opened) {
    n.opened = n.poured = n.unfolded = true;
    return ok(n, true);
  }
  return ok(n);
}

/** 開信（開信即簽收） */
export function openEnvelope(s: RecvState, env: EnvelopeKind, method: OpenMethod, roll: number, cutPath = ''): RecvResult {
  if (!s.entered) return err('NOT_ENTERED');
  if (s.opened) return err('ALREADY_OPENED');
  const E = ENVS[env];
  return ok(
    {
      ...s,
      opened: true,
      method,
      cutPath: cutPath.slice(0, 4000),
      rough: E.cl === 'glue' && method === 'tear' && roll < ROUGH_EDGE_CHANCE,
    },
    true,
  );
}

export const defaultPieces = (): Piece[] => [
  { k: 'eL', x: -30, y: -200, rot: -5 },
  { k: 'eR', x: 34, y: -188, rot: 6 },
  { k: 'lL', x: -56, y: 120, rot: -7 },
  { k: 'lR', x: 62, y: 136, rot: 8 },
];

/** 撕毀：從 x（0–1）把信封和信紙撕成兩半（撕壞也算簽收） */
export function tearApart(s: RecvState, x: number, seed: string): RecvResult {
  if (!s.entered) return err('NOT_ENTERED');
  if (s.opened) return err('ALREADY_OPENED');
  const cx = Math.min(0.8, Math.max(0.2, Number.isFinite(x) ? x : 0.5));
  return ok(
    { ...s, opened: true, poured: true, unfolded: true, method: 'rip', torn: { x: cx, seed }, pieces: defaultPieces() },
    true,
  );
}

export function pour(s: RecvState): RecvResult {
  if (!s.opened) return err('NOT_OPENED');
  if (s.poured) return err('ALREADY_POURED');
  return ok({ ...s, poured: true });
}

export function unfold(s: RecvState): RecvResult {
  if (!s.poured) return err('NOT_POURED');
  if (s.unfolded) return err('ALREADY_UNFOLDED');
  return ok({ ...s, unfolded: true });
}

export function collect(s: RecvState): RecvResult {
  if (!s.unfolded) return err('NOT_UNFOLDED');
  if (s.collected) return err('ALREADY_COLLECTED');
  return ok({ ...s, collected: true });
}

/** 撬郵票：需要信封上有郵票 */
export function pryStamp(s: RecvState, hasStamp: boolean, roll: number): RecvResult {
  if (!s.entered) return err('NOT_ENTERED');
  if (!hasStamp) return err('NO_STAMP');
  if (s.stampTaken) return err('ALREADY_TAKEN');
  return ok({ ...s, stampTaken: true, stampFiber: roll < FIBER_CHANCE });
}

/** 撬火漆：只有火漆信封，而且要在開信前（原型規則） */
export function pryWax(s: RecvState, env: EnvelopeKind, roll: number): RecvResult {
  if (!s.entered) return err('NOT_ENTERED');
  if (ENVS[env].cl !== 'wax') return err('NO_WAX');
  if (s.waxTaken) return err('ALREADY_TAKEN');
  if (s.opened) return err('ALREADY_OPENED');
  return ok({ ...s, waxTaken: true, waxFiber: roll < FIBER_CHANCE });
}

/** 碎片位置更新（只有撕毀後才有碎片） */
export function movePieces(s: RecvState, pieces: Piece[]): RecvResult {
  if (!s.torn || !s.pieces) return err('NOT_TORN');
  const keys = new Set(s.pieces.map((p) => p.k));
  const next = s.pieces.map((p) => ({ ...p }));
  for (const p of pieces) {
    if (!keys.has(p.k) || ![p.x, p.y, p.rot].every((v) => Number.isFinite(v) && Math.abs(v) < 100000)) {
      return err('INVALID_PIECES');
    }
    const i = next.findIndex((q) => q.k === p.k);
    next[i] = { k: p.k, x: p.x, y: p.y, rot: p.rot };
  }
  return ok({ ...s, pieces: next });
}
