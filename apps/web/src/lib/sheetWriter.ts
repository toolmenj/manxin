/**
 * 書寫的同步：畫面先顯示（打字不能等網路），再依序把「追加操作」送到後端。
 *
 * - 只有三種追加：字元、塗改標記、筆畫。沒有任何改寫或刪除。
 * - 每次送出都帶 seq（後端的追加次數）做樂觀鎖；重送不會重複。
 * - 連續打的字會併成一次送出（一次最多 2000 字）。
 * - 網路或伺服器錯誤：保留在佇列裡，退避後重送（字不會丟）。
 * - SEQ_CONFLICT（別的分頁也在寫）：重新讀信紙，字元與筆畫照樣追加上去；塗改標記的位置可能已經不對，丟掉並提醒。
 * - 其他錯誤（信鎖住了、操作不合法）：丟掉這個操作，重新讀信紙，提醒使用者。
 */
import type { MarkTool, SheetDTO, Stroke } from '@manxin/shared';
import { ApiError } from '../api/client.ts';

export type LocalOp = { kind: 'chars'; text: string } | { kind: 'mark'; from: number; to: number; tool: MarkTool } | { kind: 'stroke'; stroke: Stroke };

export type WriterStatus = 'idle' | 'saving' | 'retrying';

export interface WriterDeps {
  send: (op: LocalOp, seq: number) => Promise<SheetDTO>;
  reload: () => Promise<SheetDTO>;
  onChange: (display: SheetDTO, status: WriterStatus) => void;
  onError: (msg: string) => void;
  /** 測試用：退避等待 */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BATCH = 2000;

export function applyLocal(sh: SheetDTO, op: LocalOp, n: number): SheetDTO {
  if (op.kind === 'chars') return { ...sh, chars: [...sh.chars, ...[...op.text.replace(/\r\n?/g, '\n')].map((c) => ({ c, m: [] }))] };
  if (op.kind === 'stroke') return { ...sh, strokes: [...sh.strokes, op.stroke] };
  const g = `local-${n}`;
  return {
    ...sh,
    chars: sh.chars.map((x, i) => (i >= op.from && i <= op.to && x.c !== '\n' ? { c: x.c, m: [...x.m, { t: op.tool, g }] } : x)),
  };
}

export class SheetWriter {
  private confirmed: SheetDTO;
  private queue: LocalOp[] = [];
  private inflight: LocalOp | null = null;
  private running = false;
  private stopped = false;
  private status: WriterStatus = 'idle';

  constructor(
    initial: SheetDTO,
    private readonly deps: WriterDeps,
  ) {
    this.confirmed = initial;
  }

  /** 目前畫面該顯示的信紙：已確認 + 送出中 + 排隊中 */
  display(): SheetDTO {
    let s = this.confirmed;
    let n = 0;
    for (const op of this.inflight ? [this.inflight, ...this.queue] : this.queue) s = applyLocal(s, op, n++);
    return s;
  }

  get pending(): number {
    return this.queue.length + (this.inflight ? 1 : 0);
  }

  get sheetId(): string {
    return this.confirmed.id;
  }

  /** 換一張信紙（謄抄後、重新載入後）；佇列要先清空才能換 */
  reset(sheet: SheetDTO): void {
    this.confirmed = sheet;
    this.queue = [];
    this.emit();
  }

  /** 信紙設定（紙種、樣式、書寫方式、字型、圖樣）改了：只換設定，內容不動 */
  setMeta(meta: Pick<SheetDTO, 'id' | 'kind' | 'style' | 'mode' | 'font' | 'bgAttachmentId'>): void {
    if (meta.id !== this.confirmed.id) return;
    this.confirmed = { ...this.confirmed, kind: meta.kind, style: meta.style, mode: meta.mode, font: meta.font, bgAttachmentId: meta.bgAttachmentId };
    this.emit();
  }

  stop(): void {
    this.stopped = true;
  }

  /** 等佇列送完（謄抄、出門前要先等） */
  async flush(timeoutMs = 15000): Promise<boolean> {
    const t0 = Date.now();
    while (this.pending && Date.now() - t0 < timeoutMs && !this.stopped) await new Promise((r) => setTimeout(r, 40));
    return this.pending === 0;
  }

  push(op: LocalOp): void {
    if (this.stopped) return;
    const last = this.queue[this.queue.length - 1];
    if (op.kind === 'chars' && last?.kind === 'chars' && [...last.text].length + [...op.text].length <= MAX_BATCH) {
      last.text += op.text;
    } else if (op.kind === 'chars' && [...op.text].length > MAX_BATCH) {
      const cs = [...op.text];
      for (let i = 0; i < cs.length; i += MAX_BATCH) this.queue.push({ kind: 'chars', text: cs.slice(i, i + MAX_BATCH).join('') });
    } else this.queue.push(op);
    this.emit();
    void this.pump();
  }

  private emit(): void {
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

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let backoff = 800;
    try {
      while (!this.stopped && (this.inflight || this.queue.length)) {
        if (!this.inflight) this.inflight = this.queue.shift()!;
        const op = this.inflight;
        this.setStatus('saving');
        try {
          const sh = await this.deps.send(op, this.confirmed.seq);
          this.confirmed = sh;
          this.inflight = null;
          backoff = 800;
          this.emit();
        } catch (e) {
          if (e instanceof ApiError && e.code === 'SEQ_CONFLICT') {
            const fresh = await this.deps.reload().catch(() => null);
            if (fresh) this.confirmed = fresh;
            if (op.kind === 'mark') {
              this.inflight = null;
              this.deps.onError('信紙在別的地方也有新的內容，剛才的塗改沒有記下來，請再劃一次。');
            }
            this.emit();
            continue;
          }
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.code !== 'NETWORK') {
            this.inflight = null;
            if (e.code === 'LETTER_LOCKED') this.queue = [];
            this.deps.onError(e.message);
            const fresh = await this.deps.reload().catch(() => null);
            if (fresh) {
              // 信紙換了（例如別的地方謄抄過），排隊中的操作不屬於這張紙了
              if (fresh.id !== this.confirmed.id) this.queue = [];
              this.confirmed = fresh;
            }
            this.emit();
            continue;
          }
          // 網路或伺服器錯誤：留著，等一下再送
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
