/**
 * 書寫的同步：畫面先顯示（打字不能等網路），再依序把「追加操作」送到後端。
 *
 * - 只有追加：字元、塗改標記、筆畫，以及移動打字頭（不寫字、不蓋字）。沒有任何改寫或刪除。
 * - 每個操作有自己的 opId（前端產生的 UUID），重送時後端認得出「已經寫過了」，不會重複（H1）。
 * - 每次送出帶 seq（樂觀鎖）與 sheetId（信紙換過了就停，M1）。
 * - 連續打的字會併成一次送出（一次最多 2000 字）；連續移動打字頭只送最後一次。
 * - 網路或伺服器錯誤：保留在佇列裡，退避後重送（字不會丟）。
 * - SEQ_CONFLICT（別的分頁也在寫）：重新讀信紙，排隊中的操作照樣追加上去：
 *   - 塗改記的是「哪一個操作的第幾個字」，送出時才換成伺服器上的位置，不會劃到別的分頁的字（H2）。
 *   - 格位排版時，打字前先確認伺服器上的打字頭還在這批字預期的起點，不在就補一個移動。
 * - SHEET_CHANGED（別的地方謄抄過）：排隊中的操作不屬於新的紙，丟掉並提醒。
 * - 其他錯誤（信鎖住了、操作不合法）：丟掉這個操作，重新讀信紙，提醒使用者。
 * - 離開書桌（retire）：不再收新的字，但把排隊中的送完才停（M7）。
 */
import {
  applyOp,
  canMoveTo,
  nextFreeInRow,
  normCursor,
  paperGrid,
  type Cell,
  type MarkTool,
  type PaperRef,
  type SheetContent,
  type SheetDTO,
  type SheetOp,
  type Stroke,
} from '@manxin/shared';
import { ApiError } from '../api/client.ts';

/** 畫面推進來的操作。塗改的 at 是畫面上（display）第幾個字 */
export type LocalOp =
  | { kind: 'chars'; text: string }
  | { kind: 'mark'; at: number[]; tool: MarkTool }
  | { kind: 'move'; at: Cell }
  | { kind: 'stroke'; stroke: Stroke };

/** 送給後端的操作（塗改的 at 已經換成伺服器上的位置） */
export type WireOp = LocalOp;

export interface SendMeta {
  seq: number;
  sheetId: string;
  opId: string;
}

export type WriterStatus = 'idle' | 'saving' | 'retrying';

export interface WriterDeps {
  send: (op: WireOp, meta: SendMeta) => Promise<SheetDTO>;
  reload: () => Promise<SheetDTO>;
  onChange: (display: SheetDTO, status: WriterStatus) => void;
  onError: (msg: string) => void;
  /** 信紙在別的地方換過了（謄抄）：書桌要重新讀整封信 */
  onSheetChanged?: (fresh: SheetDTO | null) => void;
  /** 測試用：退避等待 */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BATCH = 2000;

/** 塗改指到的字：已經在伺服器上的字用位置；還在排隊的字用「哪一個操作的第幾個字」 */
type Ref = number | { op: string; k: number };

interface Item {
  id: string;
  op: LocalOp;
  /** 塗改 */
  refs?: Ref[];
  /** 字元（格位排版時）：這批字預期從哪一格開始打 */
  start?: Cell | null;
  /** 已經為了對齊打字頭補過一次移動 */
  aligned?: boolean;
}

export const newOpId = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export const paperOfSheet = (sh: Pick<SheetDTO, 'kind' | 'style'>): PaperRef => ({ kind: sh.kind, style: sh.style });

export const contentOf = (sh: SheetDTO): SheetContent => ({ chars: sh.chars, strokes: sh.strokes, scan: sh.scan, cursor: sh.cursor ?? null });

type AnyLocal = LocalOp | { kind: 'mark'; from: number; to: number; tool: MarkTool };

/** 在畫面上套用一個操作（規則跟後端同一套：@manxin/engine 的 sheet 模組） */
export function applyLocal(sh: SheetDTO, op: AnyLocal, n = 0): SheetDTO {
  const e: SheetOp = op.kind === 'mark' ? { ...op, g: `local-${n}` } : op;
  const c = applyOp(contentOf(sh), e, paperOfSheet(sh));
  return { ...sh, chars: c.chars, strokes: c.strokes, scan: c.scan, cursor: c.cursor };
}

const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const textLen = (t: string) => [...t.replace(/\r\n?/g, '\n')].length;

export class SheetWriter {
  private confirmed: SheetDTO;
  private queue: Item[] = [];
  private inflight: Item | null = null;
  /** 已經寫進後端的字元操作：opId → 它的第一個字在伺服器上是第幾個字 */
  private bases = new Map<string, number>();
  private running = false;
  private stopped = false;
  private retired = false;
  private status: WriterStatus = 'idle';

  constructor(
    initial: SheetDTO,
    private readonly deps: WriterDeps,
  ) {
    this.confirmed = initial;
  }

  private items(): Item[] {
    return this.inflight ? [this.inflight, ...this.queue] : [...this.queue];
  }

  private resolve(refs: Ref[], bases: Map<string, number>): number[] {
    const out: number[] = [];
    for (const r of refs) {
      if (typeof r === 'number') out.push(r);
      else {
        const b = bases.get(r.op);
        if (b !== undefined) out.push(b + r.k);
      }
    }
    return out;
  }

  /** 目前畫面該顯示的信紙：已確認 + 送出中 + 排隊中 */
  display(): SheetDTO {
    let s = this.confirmed;
    const bases = new Map(this.bases);
    let n = 0;
    for (const it of this.items()) {
      if (it.op.kind === 'chars') bases.set(it.id, s.chars.length);
      if (it.op.kind === 'mark') {
        const at = this.resolve(it.refs ?? [], bases);
        if (at.length) s = applyLocal(s, { ...it.op, at }, n++);
        continue;
      }
      s = applyLocal(s, it.op, n++);
    }
    return s;
  }

  get pending(): number {
    return this.queue.length + (this.inflight ? 1 : 0);
  }

  /** 還有字沒送到後端（關分頁前要提醒） */
  get hasUnsent(): boolean {
    return this.items().some((it) => it.op.kind !== 'move');
  }

  get sheetId(): string {
    return this.confirmed.id;
  }

  /** 換一張信紙（謄抄後、重新載入後）；佇列要先清空才能換 */
  reset(sheet: SheetDTO): void {
    if (sheet.id !== this.confirmed.id) this.bases.clear();
    this.confirmed = sheet;
    this.queue = [];
    this.emit();
  }

  /** 信紙設定（紙種、樣式、書寫方式、字型、圖樣）改了：只換設定，內容不動 */
  setMeta(meta: Pick<SheetDTO, 'id' | 'kind' | 'style' | 'mode' | 'font' | 'fontUrl' | 'bgAttachmentId' | 'bgTemplate'> & Partial<Pick<SheetDTO, 'chars' | 'cursor'>>): void {
    if (meta.id !== this.confirmed.id) return;
    this.confirmed = {
      ...this.confirmed,
      kind: meta.kind,
      style: meta.style,
      mode: meta.mode,
      font: meta.font,
      fontUrl: meta.fontUrl,
      bgAttachmentId: meta.bgAttachmentId,
      bgTemplate: meta.bgTemplate,
      // 換了紙（只在空白時可以），打字頭的位置由後端依新紙重算
      ...(meta.cursor !== undefined && meta.chars && !this.confirmed.chars.length && !this.pending ? { cursor: meta.cursor, chars: meta.chars } : {}),
    };
    this.emit();
  }

  /** 立刻停（不再送） */
  stop(): void {
    this.stopped = true;
  }

  /**
   * 離開這張信紙（換頁、換一封信）：不再收新的操作，畫面也不再更新，
   * 但排隊中的會繼續送完才停。回傳是否全部送完。
   */
  async retire(timeoutMs = 60000): Promise<boolean> {
    this.retired = true;
    const ok = await this.flush(timeoutMs);
    this.stopped = true;
    return ok;
  }

  /** 等佇列送完（謄抄、出門前要先等） */
  async flush(timeoutMs = 15000): Promise<boolean> {
    const t0 = Date.now();
    while (this.pending && Date.now() - t0 < timeoutMs && !this.stopped) await new Promise((r) => setTimeout(r, 40));
    return this.pending === 0;
  }

  /** 畫面上第幾個字 → 塗改用的參照 */
  private toRefs(at: number[]): Ref[] {
    const L0 = this.confirmed.chars.length;
    const ranges: { id: string; from: number; len: number }[] = [];
    let base = L0;
    for (const it of this.items())
      if (it.op.kind === 'chars') {
        const len = textLen(it.op.text);
        ranges.push({ id: it.id, from: base, len });
        base += len;
      }
    const out: Ref[] = [];
    for (const i of at) {
      if (i < L0) out.push(i);
      else {
        const r = ranges.find((x) => i >= x.from && i < x.from + x.len);
        if (r) out.push({ op: r.id, k: i - r.from });
      }
    }
    return out;
  }

  push(op: LocalOp): void {
    if (this.stopped || this.retired) return;
    const last = this.queue[this.queue.length - 1];
    if (op.kind === 'move') {
      // 連續移動打字頭：還沒送的那次直接改成新的位置
      if (last?.op.kind === 'move') last.op = op;
      else this.queue.push({ id: newOpId(), op });
    } else if (op.kind === 'mark') {
      const refs = this.toRefs([...new Set(op.at)].sort((a, b) => a - b));
      if (!refs.length) return;
      this.queue.push({ id: newOpId(), op, refs });
    } else if (op.kind === 'chars') {
      const d = this.display();
      const start = d.cursor ?? null;
      if (last?.op.kind === 'chars' && textLen(last.op.text) + textLen(op.text) <= MAX_BATCH) {
        last.op = { kind: 'chars', text: last.op.text + op.text };
      } else if (textLen(op.text) > MAX_BATCH) {
        const cs = [...op.text];
        for (let i = 0; i < cs.length; i += MAX_BATCH)
          this.queue.push({ id: newOpId(), op: { kind: 'chars', text: cs.slice(i, i + MAX_BATCH).join('') }, start: i === 0 ? start : undefined });
      } else this.queue.push({ id: newOpId(), op, start });
    } else this.queue.push({ id: newOpId(), op });
    this.emit();
    void this.pump();
  }

  private emit(): void {
    if (this.retired) return;
    this.deps.onChange(this.display(), this.status);
  }

  private setStatus(s: WriterStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.emit();
    }
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  private error(msg: string): void {
    if (!this.retired) this.deps.onError(msg);
  }

  /** 信紙換過了：排隊中的都不屬於新的紙 */
  private sheetChanged(fresh: SheetDTO | null): void {
    const lost = this.items().some((it) => it.op.kind !== 'move');
    this.queue = [];
    this.inflight = null;
    this.bases.clear();
    if (fresh) this.confirmed = fresh;
    if (lost) this.error('這封信在別的地方換了一張新的信紙，剛才還沒收進去的字沒有寫到新的紙上。');
    if (!this.retired) this.deps.onSheetChanged?.(fresh);
    this.emit();
  }

  /**
   * 格位排版：這批字預期的起點跟伺服器上的打字頭不一樣（別的分頁移過打字頭、寫過字）時，
   * 先補一個移動。起點被別的分頁的字佔了，就移到同一行下一個空格；整行都滿了就照伺服器的打字頭接著打。
   */
  private alignItem(it: Item): Item | null {
    if (it.op.kind !== 'chars' || !it.start || it.aligned) return null;
    const cur = this.confirmed.cursor;
    if (!cur) return null;
    const g = paperGrid(paperOfSheet(this.confirmed));
    const want = normCursor(it.start, g);
    if (sameCell(want, normCursor(cur, g))) return null;
    it.aligned = true;
    const c = contentOf(this.confirmed),
      paper = paperOfSheet(this.confirmed);
    const err = canMoveTo(c, paper, want);
    const target = !err ? want : err === 'MOVE_OCCUPIED' ? nextFreeInRow(c, paper, want) : null;
    if (!target) return null;
    return { id: newOpId(), op: { kind: 'move', at: target } };
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let backoff = 800;
    try {
      while (!this.stopped && (this.inflight || this.queue.length)) {
        if (!this.inflight) this.inflight = this.queue.shift()!;
        const mv = this.alignItem(this.inflight);
        if (mv) {
          this.queue.unshift(this.inflight);
          this.inflight = mv;
        }
        const it = this.inflight;
        const pre = this.confirmed;
        let wire: WireOp = it.op;
        if (it.op.kind === 'mark') {
          const at = this.resolve(it.refs ?? [], this.bases);
          if (!at.length) {
            this.inflight = null;
            this.error('要塗改的字沒有收進去，剛才的塗改沒有記下來。');
            this.emit();
            continue;
          }
          wire = { ...it.op, at };
        }
        this.setStatus('saving');
        try {
          const sh = await this.deps.send(wire, { seq: pre.seq, sheetId: pre.id, opId: it.id });
          if (sh.id !== pre.id) {
            this.sheetChanged(sh);
            continue;
          }
          // 寫入成功（含重送時後端認出已經寫過）：這個操作就是接在 pre 後面寫進去的
          if (it.op.kind === 'chars') this.bases.set(it.id, pre.chars.length);
          this.confirmed = sh;
          this.inflight = null;
          backoff = 800;
          this.emit();
        } catch (e) {
          if (e instanceof ApiError && e.code === 'SHEET_CHANGED') {
            this.sheetChanged(await this.deps.reload().catch(() => null));
            continue;
          }
          if (e instanceof ApiError && e.code === 'SEQ_CONFLICT') {
            const fresh = await this.deps.reload().catch(() => null);
            if (!fresh) {
              // 重新讀取也失敗：等一下再試，不要原地狂打
              this.setStatus('retrying');
              await this.sleep(backoff);
              backoff = Math.min(10000, backoff * 2);
              continue;
            }
            if (fresh.id !== pre.id) {
              this.sheetChanged(fresh);
              continue;
            }
            this.confirmed = fresh;
            this.emit();
            continue;
          }
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.code !== 'NETWORK') {
            this.inflight = null;
            if (e.code === 'LETTER_LOCKED') this.queue = [];
            this.error(e.message);
            const fresh = await this.deps.reload().catch(() => null);
            if (fresh) {
              if (fresh.id !== this.confirmed.id) {
                this.sheetChanged(fresh);
                continue;
              }
              this.confirmed = fresh;
            }
            this.emit();
            continue;
          }
          // 網路或伺服器錯誤：留著，等一下再送（同一個 opId，後端不會重複寫）
          this.setStatus('retrying');
          await this.sleep(backoff);
          backoff = Math.min(10000, backoff * 2);
        }
      }
    } finally {
      this.running = false;
      if (!this.stopped) this.setStatus('idle');
    }
  }
}
