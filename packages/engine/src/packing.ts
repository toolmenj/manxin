/**
 * 摺信、裝信、寄出前條件（移植自原型 bindFold／insertLetter／missing／envLocked）。
 *
 * 座標：信紙寬 = 1，高 = SHEET_H（A4 比例 1.414）。
 * pack 是摺完後的外框（x0,y0,x1,y1），只記外框與摺痕位置（D-016 暫用）。
 */

export const SHEET_H = 1.414;
export const MAX_FOLDS = 6;
/** 裝信的容差（與原型相同） */
export const FIT_TOLERANCE = 0.004;

export type EnvelopeKind = 'post' | 'kraft' | 'chinese' | 'wax' | 'custom' | 'card';
export type ClosureKind = 'strip' | 'glue' | 'wax' | 'none';

export interface EnvelopeSpec {
  label: string;
  sub: string;
  /** 內徑寬（信紙寬 = 1） */
  w: number;
  /** 內徑高 */
  h: number;
  cl: ClosureKind;
  /** 外觀長寬比（畫面用） */
  ar: number;
}

export const ENVS: Readonly<Record<EnvelopeKind, EnvelopeSpec>> = {
  post: { label: '郵政信封', sub: '易撕帶封口', w: 1.05, h: 0.52, cl: 'strip', ar: 2.02 },
  kraft: { label: '牛皮紙信封', sub: '膠貼封口', w: 1.05, h: 0.52, cl: 'glue', ar: 2.02 },
  chinese: { label: '中式直式信封', sub: '膠貼・紅框', w: 0.45, h: 0.86, cl: 'glue', ar: 0.52 },
  wax: { label: '米白方信封', sub: '火漆蠟封', w: 0.75, h: 0.55, cl: 'wax', ar: 1.36 },
  custom: { label: '自己上傳', sub: '膠貼封口', w: 1.05, h: 0.52, cl: 'glue', ar: 2.02 },
  card: { label: '明信片', sub: '不用信封', w: 9, h: 9, cl: 'none', ar: 1.5 },
};

export const STAMPS = { plum: '梅花', junk: '帆船', bird: '藍鵲', tear: '淚滴' } as const;
export type StampId = keyof typeof STAMPS;
export const POSTMARKS = { date: '圓形日戳', wave: '波浪機戳' } as const;
export type PostmarkId = keyof typeof POSTMARKS;

export interface Pack {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** a：h＝橫摺痕（y 座標）、v＝直摺痕（x 座標）；at：摺線位置（信紙座標） */
export interface Fold {
  a: 'h' | 'v';
  at: number;
}

export type FoldEdge = 't' | 'b' | 'l' | 'r';

export const initialPack = (): Pack => ({ x0: 0, y0: 0, x1: 1, y1: SHEET_H });

export type FoldResult =
  | { ok: true; pack: Pack; fold: Fold }
  | { ok: false; code: 'TOO_MANY_FOLDS' | 'FOLD_OUT_OF_RANGE' };

/**
 * 從某個邊緣往內摺，摺線落在 at（信紙座標）。摺線必須在目前外框之內。
 * 摺過去的那一半如果比剩下的長，外框會往另一邊延伸（與原型相同）。
 */
export function applyFold(pack: Pack, foldsSoFar: number, edge: FoldEdge, at: number): FoldResult {
  if (foldsSoFar >= MAX_FOLDS) return { ok: false, code: 'TOO_MANY_FOLDS' };
  if (!Number.isFinite(at)) return { ok: false, code: 'FOLD_OUT_OF_RANGE' };
  const P = { ...pack };
  const EPS = 1e-4;
  if (edge === 'b' || edge === 't') {
    if (!(at > P.y0 + EPS && at < P.y1 - EPS)) return { ok: false, code: 'FOLD_OUT_OF_RANGE' };
    if (edge === 'b') {
      const y1 = P.y1;
      P.y1 = at;
      P.y0 = Math.min(P.y0, 2 * at - y1);
    } else {
      const y0 = P.y0;
      P.y0 = at;
      P.y1 = Math.max(P.y1, 2 * at - y0);
    }
    return { ok: true, pack: P, fold: { a: 'h', at } };
  }
  if (!(at > P.x0 + EPS && at < P.x1 - EPS)) return { ok: false, code: 'FOLD_OUT_OF_RANGE' };
  if (edge === 'r') {
    const x1 = P.x1;
    P.x1 = at;
    P.x0 = Math.min(P.x0, 2 * at - x1);
  } else {
    const x0 = P.x0;
    P.x0 = at;
    P.x1 = Math.max(P.x1, 2 * at - x0);
  }
  return { ok: true, pack: P, fold: { a: 'v', at } };
}

/** 摺完的寬高；rot＝轉 90 度放 */
export function packDims(pack: Pack, rot: boolean): [number, number] {
  const w = pack.x1 - pack.x0;
  const h = pack.y1 - pack.y0;
  return rot ? [h, w] : [w, h];
}

export type FitResult = { ok: true } | { ok: false; code: 'TOO_WIDE' | 'TOO_LONG'; w: number; h: number; envW: number; envH: number };

/** 裝不裝得下：先看寬，再看長（與原型提示順序相同） */
export function fits(env: EnvelopeKind, pack: Pack, rot: boolean): FitResult {
  const E = ENVS[env];
  const [w, h] = packDims(pack, rot);
  if (w > E.w + FIT_TOLERANCE) return { ok: false, code: 'TOO_WIDE', w, h, envW: E.w, envH: E.h };
  if (h > E.h + FIT_TOLERANCE) return { ok: false, code: 'TOO_LONG', w, h, envW: E.w, envH: E.h };
  return { ok: true };
}

/* ---------- 櫃台狀態 ---------- */

export interface Pos {
  /** 0–1，相對信封寬 */
  x: number;
  /** 0–1，相對信封高 */
  y: number;
  /** 角度 */
  r: number;
}

export interface CounterLike {
  env: EnvelopeKind;
  inserted: boolean;
  sealed: boolean;
  addrOk: boolean;
  stampPos: Pos | null;
  /** 信封上寫過字（寄件人或收件人區） */
  envelopeWritten: boolean;
}

export type MissingCode = 'ADDRESS' | 'INSERT' | 'SEAL' | 'STAMP';

export const MISSING_LABEL: Readonly<Record<MissingCode, string>> = {
  ADDRESS: '確認地址',
  INSERT: '把信放進信封',
  SEAL: '封口',
  STAMP: '貼郵票',
};

/** 寄出前還缺什麼（郵戳可以不蓋） */
export function missing(c: CounterLike): MissingCode[] {
  const m: MissingCode[] = [];
  if (!c.addrOk) m.push('ADDRESS');
  if (!c.inserted) m.push('INSERT');
  else if (!c.sealed) m.push('SEAL');
  if (!c.stampPos) m.push('STAMP');
  return m;
}

/** 信封鎖定：信放進去、貼了郵票、或信封上寫了字，就不能換信封 */
export function envLocked(c: Pick<CounterLike, 'env' | 'inserted' | 'stampPos' | 'envelopeWritten'>): boolean {
  return (c.inserted && c.env !== 'card') || !!c.stampPos || c.envelopeWritten;
}
