/**
 * 信紙內容：只有「追加」。內容 = 依序套用所有追加操作的結果，沒有修改、沒有刪除（落子無悔）。
 *
 * 兩種排版（2026-10-21）：
 * - 順排（flow）：舊的寫法。字一路往後接，換行與折行交給瀏覽器排。沒有任何 move 操作的信紙都是順排，畫法跟以前完全一樣。
 * - 格位（grid）：第一次「移動打字頭」（move）之後，整張紙改用格子定位。之前打的字依格位規則從第一行第一格重排一次，
 *   之後的字從打字頭所在的格子往後打。格子是「半格」單位（u）：中文等全形字佔 2 個 u，英數半形字佔 1 個 u
 *   （稿紙與八行箋一律一字一格）。
 *
 * 格位規則（前後端共用，結果必須一樣）：
 * - 打字頭只能停在「可寫區域」裡的空格（paperGrid）；明信片右半邊（地址、郵票）不在可寫區域裡。
 * - 不能疊打：要落字的格子已經有字，就往後跳到下一個空格；一行放不下就換到下一行開頭。
 * - 空白（半形、全形空白、Tab）只推打字頭，不佔格子。換行回到下一行開頭。
 * - 字落到最後一行之後＝紙寫滿了（SHEET_FULL）。
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

/** 格位：[第幾行, 行內第幾個半格]。直書（八行箋）的「行」是直行，由右往左數；半格由上往下數 */
export type Cell = [number, number];

export interface CharCell {
  c: string;
  m: MarkRef[];
  /** 格位排版時才有：這個字落在哪一格（換行字元沒有） */
  p?: Cell;
}

/** pts：[x, y, 壓力]，x、y 以紙寬為 1 正規化 */
export interface Stroke {
  pen: Pen;
  color: string;
  pts: [number, number, number][];
}

export type SheetOp =
  | { kind: 'chars'; text: string }
  /** 塗改：舊資料是 from–to 的範圍（含頭尾）；新資料是 at，一串字的位置（第幾個字，從 0 起） */
  | { kind: 'mark'; from?: number; to?: number; at?: number[]; tool: MarkTool; g: string }
  /** 移動打字頭（捲紙、移滑架）：不寫字，也不蓋掉任何字 */
  | { kind: 'move'; at: Cell }
  | { kind: 'stroke'; stroke: Stroke }
  | { kind: 'scan'; attachmentId: string };

export interface SheetContent {
  chars: CharCell[];
  strokes: Stroke[];
  scan: string | null;
  /** 打字頭的位置；null＝順排（沒有移動過打字頭的信紙） */
  cursor: Cell | null;
}

export const MAX_APPEND_CHARS = 2000;
export const MAX_SHEET_CHARS = 20000;
export const MAX_STROKE_POINTS = 5000;
export const MAX_SHEET_STROKES = 5000;

export const emptyContent = (): SheetContent => ({ chars: [], strokes: [], scan: null, cursor: null });

/** 有沒有落筆（移動打字頭不算） */
export const hasContent = (c: Pick<SheetContent, 'chars' | 'strokes' | 'scan'>): boolean => c.chars.length > 0 || c.strokes.length > 0 || !!c.scan;

/** 換行統一成 \n，並依「字」（code point）切開 */
export const splitChars = (text: string): string[] => [...text.replace(/\r\n?/g, '\n')];

/* ---------- 可寫區域 ---------- */

export interface PaperRef {
  kind: SheetKind;
  style: SheetStyle;
}

export interface PaperGrid {
  /** 一行有幾個半格 */
  units: number;
  /** 一張紙看得到的行數 */
  rows: number;
  /** 最多可以寫到第幾行（八行箋可以往左捲，其他紙＝rows） */
  maxRows: number;
  /** 直書 */
  vertical: boolean;
  /** 英數半形字佔半格（稿紙、八行箋是一字一格） */
  half: boolean;
}

/** 手寫筆畫可以落在哪裡（以紙寬為 1 的座標；含一點容許誤差） */
export interface HandArea {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 明信片背面：左半邊寫正文，右半邊是收件人地址與郵票（正文的界線，以紙寬為 1） */
export const POSTCARD_BODY_X = 0.55;

/**
 * 各種紙的可寫區域。數字要跟前端 paper.ts 的 GRID_CSS（版面的 cqw）對得上：
 * - 信紙（橫線、空白、自訂圖樣）：內文寬 84cqw，27 字 × 22 行
 * - 稿紙：16 × 20 格
 * - 八行箋：8 直行（可往左捲到 40 行），一行 20 字
 * - 明信片：只有左邊 52%（46.8cqw）的正文區，18 字 × 12 行；右半邊不在可寫區域
 */
export function paperGrid(p: PaperRef): PaperGrid {
  if (p.kind === 'postcard') return { units: 36, rows: 12, maxRows: 12, vertical: false, half: true };
  if (p.style === 'grid') return { units: 32, rows: 20, maxRows: 20, vertical: false, half: false };
  if (p.style === 'bahang') return { units: 40, rows: 8, maxRows: 40, vertical: true, half: false };
  return { units: 54, rows: 22, maxRows: 22, vertical: false, half: true };
}

export function handArea(p: PaperRef): HandArea {
  if (p.kind === 'postcard') return { x0: -0.1, x1: POSTCARD_BODY_X, y0: -0.1, y1: 0.7 };
  return { x0: -0.1, x1: 1.1, y0: -0.1, y1: 2 };
}

export const DEFAULT_PAPER: PaperRef = { kind: 'letter', style: 'lined' };

/* ---------- 格位排版 ---------- */

/** 東亞全形字（中日韓、全形標點、注音、表情符號）佔兩個半格 */
export function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

export const isBlank = (ch: string): boolean => ch === ' ' || ch === '　' || ch === '\t';

export const charWidth = (ch: string, g: PaperGrid): number => (!g.half || isWide(ch) ? 2 : 1);

/** 這個字在紙上看得到、會佔格子 */
export const inkOf = (o: CharCell): boolean => o.c !== '\n' && !isBlank(o.c);

/** 格子的編號（同一張紙裡唯一） */
export const cellKey = (g: PaperGrid, r: number, u: number): number => r * g.units + u;

/** 已經有字的半格 */
export function occupancy(chars: readonly CharCell[], g: PaperGrid): Set<number> {
  const occ = new Set<number>();
  for (const o of chars) {
    if (!o.p || !inkOf(o)) continue;
    const w = charWidth(o.c, g);
    for (let k = 0; k < w; k++) occ.add(cellKey(g, o.p[0], o.p[1] + k));
  }
  return occ;
}

/** 打字頭停在行尾（剛好打滿一行）時，下一個字從下一行開頭開始 */
export const normCursor = (c: Cell, g: PaperGrid): Cell => (c[1] >= g.units ? [c[0] + 1, 0] : c);

/** 放一個字：回傳它落在哪一格（換行沒有格位）與之後打字頭的位置；occ 會被更新 */
export function placeChar(ch: string, cur: Cell, occ: Set<number>, g: PaperGrid): { p?: Cell; cur: Cell } {
  let [r, u] = cur;
  if (ch === '\n') return { cur: [r + 1, 0] };
  const w = charWidth(ch, g);
  for (;;) {
    if (u + w > g.units) {
      r++;
      u = 0;
    }
    if (isBlank(ch)) break;
    let free = true;
    for (let k = 0; k < w; k++)
      if (occ.has(cellKey(g, r, u + k))) {
        free = false;
        break;
      }
    if (free) {
      for (let k = 0; k < w; k++) occ.add(cellKey(g, r, u + k));
      break;
    }
    u++; // 不能疊打：往後跳
  }
  return { p: [r, u], cur: [r, u + w] };
}

/** 順排的字改成格位：從第一行第一格依序排（第一次移動打字頭時用） */
export function layoutFlow(chars: readonly CharCell[], g: PaperGrid): { chars: CharCell[]; cursor: Cell } {
  const occ = new Set<number>();
  let cur: Cell = [0, 0];
  const out = chars.map((o) => {
    const r = placeChar(o.c, cur, occ, g);
    cur = r.cur;
    return r.p ? { c: o.c, m: o.m, p: r.p } : { c: o.c, m: o.m };
  });
  return { chars: out, cursor: cur };
}

/** 格位排版下目前的打字頭（順排的信紙：照格位規則算出「接著寫」會在哪裡） */
export function gridCursor(c: SheetContent, p: PaperRef): Cell {
  const g = paperGrid(p);
  return normCursor(c.cursor ?? layoutFlow(c.chars, g).cursor, g);
}

/** 打字頭可以停在這一格嗎（在可寫區域內、不是已經有字的格子） */
export function canMoveTo(c: SheetContent, p: PaperRef, at: Cell): 'MOVE_OUT_OF_AREA' | 'MOVE_OCCUPIED' | null {
  const g = paperGrid(p);
  const [r, u] = at;
  if (!Number.isInteger(r) || !Number.isInteger(u) || r < 0 || u < 0 || r >= g.maxRows || u >= g.units) return 'MOVE_OUT_OF_AREA';
  const chars = c.cursor ? c.chars : layoutFlow(c.chars, g).chars;
  return occupancy(chars, g).has(cellKey(g, r, u)) ? 'MOVE_OCCUPIED' : null;
}

/** 從某一格往後（同一行）找第一個能停的空格；找不到回 null */
export function nextFreeInRow(c: SheetContent, p: PaperRef, at: Cell): Cell | null {
  const g = paperGrid(p);
  if (at[0] < 0 || at[0] >= g.maxRows) return null;
  const occ = occupancy(c.cursor ? c.chars : layoutFlow(c.chars, g).chars, g);
  for (let u = Math.max(0, at[1]); u < g.units; u++) if (!occ.has(cellKey(g, at[0], u))) return [at[0], u];
  return null;
}

/**
 * 這串字從打字頭開始打，能打到第幾個字還留在紙上（順排的信紙不限制，回傳全長）。
 * 前端用來在紙寫滿時只送放得下的部分，後端用來擋 SHEET_FULL。
 */
export function fitText(c: SheetContent, p: PaperRef, text: string): number {
  const cs = splitChars(text);
  if (!c.cursor) return cs.length;
  const g = paperGrid(p);
  const occ = occupancy(c.chars, g);
  let cur = normCursor(c.cursor, g);
  for (let i = 0; i < cs.length; i++) {
    const r = placeChar(cs[i]!, cur, occ, g);
    if ((r.p && r.p[0] >= g.maxRows) || (!r.p && r.cur[0] >= g.maxRows)) return i;
    cur = r.cur;
  }
  return cs.length;
}

/* ---------- 套用 ---------- */

const markedAt = (op: Extract<SheetOp, { kind: 'mark' }>): ((i: number) => boolean) => {
  if (op.at) {
    const s = new Set(op.at);
    return (i) => s.has(i);
  }
  const from = op.from ?? 0,
    to = op.to ?? -1;
  return (i) => i >= from && i <= to;
};

export function applyOp(c: SheetContent, op: SheetOp, paper: PaperRef = DEFAULT_PAPER): SheetContent {
  switch (op.kind) {
    case 'chars': {
      const cs = splitChars(op.text);
      if (!c.cursor) return { ...c, chars: [...c.chars, ...cs.map((ch) => ({ c: ch, m: [] }))] };
      const g = paperGrid(paper);
      const occ = occupancy(c.chars, g);
      let cur = normCursor(c.cursor, g);
      const add = cs.map((ch) => {
        const r = placeChar(ch, cur, occ, g);
        cur = r.cur;
        return r.p ? { c: ch, m: [], p: r.p } : { c: ch, m: [] };
      });
      return { ...c, chars: [...c.chars, ...add], cursor: cur };
    }
    case 'move': {
      const g = paperGrid(paper);
      const chars = c.cursor ? c.chars : layoutFlow(c.chars, g).chars;
      // 重放時只夾在紙內（寫入時已經驗過；空白紙換過樣式時，舊的位置可能超出新紙）
      const at: Cell = [Math.min(Math.max(0, Math.trunc(op.at[0]) || 0), g.maxRows - 1), Math.min(Math.max(0, Math.trunc(op.at[1]) || 0), g.units - 1)];
      return { ...c, chars, cursor: at };
    }
    case 'mark': {
      const hit = markedAt(op);
      const chars = c.chars.map((x, i) => (hit(i) && x.c !== '\n' ? { ...x, m: [...x.m, { t: op.tool, g: op.g }] } : x));
      return { ...c, chars };
    }
    case 'stroke':
      return { ...c, strokes: [...c.strokes, op.stroke] };
    case 'scan':
      return { ...c, scan: op.attachmentId };
  }
}

/** 依序套用（伺服器重放整張信紙用；一次做完，不逐筆複製陣列） */
export function applyOps(ops: readonly SheetOp[], paper: PaperRef = DEFAULT_PAPER): SheetContent {
  const g = paperGrid(paper);
  const chars: CharCell[] = [];
  const strokes: Stroke[] = [];
  let scan: string | null = null;
  let cursor: Cell | null = null;
  let occ: Set<number> | null = null;
  for (const op of ops) {
    switch (op.kind) {
      case 'chars':
        for (const ch of splitChars(op.text)) {
          if (!cursor) chars.push({ c: ch, m: [] });
          else {
            const r = placeChar(ch, normCursor(cursor, g), occ!, g);
            cursor = r.cur;
            chars.push(r.p ? { c: ch, m: [], p: r.p } : { c: ch, m: [] });
          }
        }
        break;
      case 'move': {
        if (!cursor) {
          const l = layoutFlow(chars, g);
          chars.splice(0, chars.length, ...l.chars);
          occ = occupancy(chars, g);
        }
        cursor = [Math.min(Math.max(0, Math.trunc(op.at[0]) || 0), g.maxRows - 1), Math.min(Math.max(0, Math.trunc(op.at[1]) || 0), g.units - 1)];
        break;
      }
      case 'mark': {
        const hit = markedAt(op);
        const idx = op.at ?? Array.from({ length: Math.max(0, (op.to ?? -1) - (op.from ?? 0) + 1) }, (_, k) => (op.from ?? 0) + k);
        for (const i of idx) {
          const x = chars[i];
          if (x && x.c !== '\n' && hit(i)) chars[i] = { ...x, m: [...x.m, { t: op.tool, g: op.g }] };
        }
        break;
      }
      case 'stroke':
        strokes.push(op.stroke);
        break;
      case 'scan':
        scan = op.attachmentId;
        break;
    }
  }
  return { chars, strokes, scan, cursor };
}

/* ---------- 檢查 ---------- */

export type OpError =
  | 'WRONG_MODE'
  | 'EMPTY_TEXT'
  | 'TEXT_TOO_LONG'
  | 'SHEET_FULL'
  | 'MARK_OUT_OF_RANGE'
  | 'MARK_NOTHING'
  | 'BAD_TOOL'
  | 'BAD_STROKE'
  | 'STROKE_OUT_OF_AREA'
  | 'MOVE_OUT_OF_AREA'
  | 'MOVE_OCCUPIED'
  | 'SHEET_NOT_EMPTY';

/** 檢查一個追加操作能不能套在目前內容上 */
export function checkOp(c: SheetContent, mode: WriteMode, op: SheetOp, paper: PaperRef = DEFAULT_PAPER): OpError | null {
  switch (op.kind) {
    case 'chars': {
      if (mode !== 'type') return 'WRONG_MODE';
      const n = splitChars(op.text).length;
      if (n === 0) return 'EMPTY_TEXT';
      if (n > MAX_APPEND_CHARS) return 'TEXT_TOO_LONG';
      if (c.chars.length + n > MAX_SHEET_CHARS) return 'SHEET_FULL';
      if (c.cursor && fitText(c, paper, op.text) < n) return 'SHEET_FULL';
      return null;
    }
    case 'move': {
      if (mode !== 'type') return 'WRONG_MODE';
      if (!Array.isArray(op.at) || op.at.length !== 2) return 'MOVE_OUT_OF_AREA';
      return canMoveTo(c, paper, op.at);
    }
    case 'mark': {
      if (mode !== 'type') return 'WRONG_MODE';
      if (!MARK_TOOLS.includes(op.tool)) return 'BAD_TOOL';
      let idx: number[];
      if (op.at) {
        idx = op.at;
        if (!idx.length || idx.length > MAX_APPEND_CHARS || new Set(idx).size !== idx.length) return 'MARK_OUT_OF_RANGE';
      } else {
        const { from, to } = op;
        if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return 'MARK_OUT_OF_RANGE';
        if (to >= c.chars.length) return 'MARK_OUT_OF_RANGE';
        idx = Array.from({ length: Math.min(to - from + 1, MAX_SHEET_CHARS) }, (_, k) => from + k);
      }
      if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= c.chars.length)) return 'MARK_OUT_OF_RANGE';
      return idx.some((i) => c.chars[i]!.c !== '\n') ? null : 'MARK_NOTHING';
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
      const a = handArea(paper);
      if (s.pts.some((p) => p[0] < a.x0 || p[0] > a.x1 || p[1] < a.y0 || p[1] > a.y1)) return 'STROKE_OUT_OF_AREA';
      if (c.strokes.length >= MAX_SHEET_STROKES) return 'SHEET_FULL';
      return null;
    }
    case 'scan':
      return hasContent(c) ? 'SHEET_NOT_EMPTY' : null;
  }
}
