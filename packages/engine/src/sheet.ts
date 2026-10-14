/**
 * 信紙內容：只有「追加」。內容 = 依序套用所有追加操作的結果，沒有修改、沒有刪除（落子無悔）。
 */

export type SheetKind = 'letter' | 'postcard';
export type SheetStyle = 'lined' | 'bahang' | 'grid' | 'plain' | 'custom';
export type WriteMode = 'type' | 'hand';
export type MarkTool = 's1' | 's2' | 'x' | 'blk' | 'tape';
export type Pen = 'fountain' | 'ball' | 'pencil';

export const MARK_TOOLS: readonly MarkTool[] = ['s1', 's2', 'x', 'blk', 'tape'];
export const PENS: readonly Pen[] = ['fountain', 'ball', 'pencil'];
export const SHEET_STYLES: readonly SheetStyle[] = ['lined', 'bahang', 'grid', 'plain', 'custom'];
export const FONTS = ['typewriter', 'lead', 'ming', 'kai'] as const;

export interface MarkRef {
  t: MarkTool;
  /** 同一次塗改的群組 id */
  g: string;
}

export interface CharCell {
  c: string;
  m: MarkRef[];
}

/** pts：[x, y, 壓力]，x、y 以紙寬為 1 正規化 */
export interface Stroke {
  pen: Pen;
  color: string;
  pts: [number, number, number][];
}

export type SheetOp =
  | { kind: 'chars'; text: string }
  | { kind: 'mark'; from: number; to: number; tool: MarkTool; g: string }
  | { kind: 'stroke'; stroke: Stroke }
  | { kind: 'scan'; attachmentId: string };

export interface SheetContent {
  chars: CharCell[];
  strokes: Stroke[];
  scan: string | null;
}

export const MAX_APPEND_CHARS = 2000;
export const MAX_SHEET_CHARS = 20000;
export const MAX_STROKE_POINTS = 5000;
export const MAX_SHEET_STROKES = 5000;

export const emptyContent = (): SheetContent => ({ chars: [], strokes: [], scan: null });

export const hasContent = (c: SheetContent): boolean => c.chars.length > 0 || c.strokes.length > 0 || !!c.scan;

/** 換行統一成 \n，並依「字」（code point）切開 */
export const splitChars = (text: string): string[] => [...text.replace(/\r\n?/g, '\n')];

export function applyOp(c: SheetContent, op: SheetOp): SheetContent {
  switch (op.kind) {
    case 'chars':
      return { ...c, chars: [...c.chars, ...splitChars(op.text).map((ch) => ({ c: ch, m: [] }))] };
    case 'mark': {
      const chars = c.chars.map((x, i) =>
        i >= op.from && i <= op.to && x.c !== '\n' ? { c: x.c, m: [...x.m, { t: op.tool, g: op.g }] } : x,
      );
      return { ...c, chars };
    }
    case 'stroke':
      return { ...c, strokes: [...c.strokes, op.stroke] };
    case 'scan':
      return { ...c, scan: op.attachmentId };
  }
}

export const applyOps = (ops: readonly SheetOp[]): SheetContent => ops.reduce(applyOp, emptyContent());

export type OpError =
  | 'WRONG_MODE'
  | 'EMPTY_TEXT'
  | 'TEXT_TOO_LONG'
  | 'SHEET_FULL'
  | 'MARK_OUT_OF_RANGE'
  | 'MARK_NOTHING'
  | 'BAD_TOOL'
  | 'BAD_STROKE'
  | 'SHEET_NOT_EMPTY';

/** 檢查一個追加操作能不能套在目前內容上 */
export function checkOp(c: SheetContent, mode: WriteMode, op: SheetOp): OpError | null {
  switch (op.kind) {
    case 'chars': {
      if (mode !== 'type') return 'WRONG_MODE';
      const n = splitChars(op.text).length;
      if (n === 0) return 'EMPTY_TEXT';
      if (n > MAX_APPEND_CHARS) return 'TEXT_TOO_LONG';
      if (c.chars.length + n > MAX_SHEET_CHARS) return 'SHEET_FULL';
      return null;
    }
    case 'mark': {
      if (mode !== 'type') return 'WRONG_MODE';
      if (!MARK_TOOLS.includes(op.tool)) return 'BAD_TOOL';
      const { from, to } = op;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= c.chars.length) {
        return 'MARK_OUT_OF_RANGE';
      }
      for (let i = from; i <= to; i++) if (c.chars[i]!.c !== '\n') return null;
      return 'MARK_NOTHING';
    }
    case 'stroke': {
      if (mode !== 'hand') return 'WRONG_MODE';
      const s = op.stroke;
      if (!PENS.includes(s.pen) || !/^#[0-9A-Fa-f]{6}$/.test(s.color)) return 'BAD_STROKE';
      if (!Array.isArray(s.pts) || s.pts.length < 1 || s.pts.length > MAX_STROKE_POINTS) return 'BAD_STROKE';
      for (const p of s.pts) {
        if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => Number.isFinite(v))) return 'BAD_STROKE';
        if (p[0] < -0.1 || p[0] > 1.1 || p[1] < -0.1 || p[1] > 2 || p[2] < 0 || p[2] > 1) return 'BAD_STROKE';
      }
      if (c.strokes.length >= MAX_SHEET_STROKES) return 'SHEET_FULL';
      return null;
    }
    case 'scan':
      return hasContent(c) ? 'SHEET_NOT_EMPTY' : null;
  }
}
