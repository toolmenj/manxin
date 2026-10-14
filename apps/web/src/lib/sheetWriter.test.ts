import type { SheetDTO } from '@manxin/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { applyLocal, SheetWriter, type LocalOp } from './sheetWriter.ts';

const sheet = (o: Partial<SheetDTO> = {}): SheetDTO => ({
  id: 'S1',
  kind: 'letter',
  style: 'lined',
  mode: 'type',
  font: 'typewriter',
  bgAttachmentId: null,
  seq: 0,
  chars: [],
  strokes: [],
  scan: null,
  createdAt: 0,
  ...o,
});

/** 假的後端：照順序套用追加操作，檢查 seq */
function fakeServer(start = sheet()) {
  let s = start;
  const sent: { op: LocalOp; seq: number }[] = [];
  const send = vi.fn(async (op: LocalOp, seq: number) => {
    sent.push({ op, seq });
    if (seq !== s.seq) throw new ApiError(409, 'SEQ_CONFLICT', 'conflict', { seq: s.seq });
    s = { ...applyLocal(s, op, s.seq), seq: s.seq + 1 };
    return s;
  });
  return { send, sent, get: () => s, set: (x: SheetDTO) => (s = x) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SheetWriter：書寫只送追加操作', () => {
  it('畫面先顯示，再依序送出；每次帶 seq', async () => {
    const srv = fakeServer();
    const shown: string[] = [];
    const w = new SheetWriter(sheet(), {
      send: srv.send,
      reload: async () => srv.get(),
      onChange: (d) => shown.push(d.chars.map((c) => c.c).join('')),
      onError: () => {},
    });
    w.push({ kind: 'chars', text: '慢' });
    expect(w.display().chars.map((c) => c.c).join('')).toBe('慢');
    await w.flush();
    w.push({ kind: 'chars', text: '信' });
    await w.flush();
    expect(srv.sent.map((x) => x.seq)).toEqual([0, 1]);
    expect(srv.get().chars.map((c) => c.c).join('')).toBe('慢信');
    expect(shown.at(-1)).toBe('慢信');
  });

  it('送出中連續打的字會併成一次（一次最多 2000 字）', async () => {
    const srv = fakeServer();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn(async (op: LocalOp, seq: number) => {
      await gate;
      return srv.send(op, seq);
    });
    const w = new SheetWriter(sheet(), { send, reload: async () => srv.get(), onChange: () => {}, onError: () => {} });
    w.push({ kind: 'chars', text: 'a' });
    w.push({ kind: 'chars', text: 'b' });
    w.push({ kind: 'chars', text: 'c' });
    release();
    await w.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(srv.sent.map((x) => (x.op as { text: string }).text)).toEqual(['a', 'bc']);
  });

  it('太長的字串切成多次，每次不超過 2000 字', async () => {
    const srv = fakeServer();
    const w = new SheetWriter(sheet(), { send: srv.send, reload: async () => srv.get(), onChange: () => {}, onError: () => {} });
    w.push({ kind: 'chars', text: 'x'.repeat(4500) });
    await w.flush();
    expect(srv.sent.map((x) => [...(x.op as { text: string }).text].length)).toEqual([2000, 2000, 500]);
  });

  it('網路斷了：字留在佇列裡，退避後重送，不會丟', async () => {
    const srv = fakeServer();
    let fail = 2;
    const send = vi.fn(async (op: LocalOp, seq: number) => {
      if (fail-- > 0) throw new ApiError(0, 'NETWORK', 'down');
      return srv.send(op, seq);
    });
    const statuses: string[] = [];
    const w = new SheetWriter(sheet(), {
      send,
      reload: async () => srv.get(),
      onChange: (_d, st) => statuses.push(st),
      onError: () => {},
      sleep: async () => {},
    });
    w.push({ kind: 'chars', text: '在' });
    await w.flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(srv.get().chars.map((c) => c.c)).toEqual(['在']);
    expect(statuses).toContain('retrying');
    expect(statuses.at(-1)).toBe('idle');
  });

  it('SEQ_CONFLICT（別的分頁也寫了）：重新讀信紙，字照樣追加上去', async () => {
    const srv = fakeServer();
    const w = new SheetWriter(sheet(), { send: srv.send, reload: async () => srv.get(), onChange: () => {}, onError: () => {} });
    // 別的分頁先寫了一個字
    srv.set({ ...applyLocal(srv.get(), { kind: 'chars', text: '別' }, 0), seq: 1 });
    w.push({ kind: 'chars', text: '我' });
    await w.flush();
    expect(srv.get().chars.map((c) => c.c).join('')).toBe('別我');
    expect(w.display().chars.map((c) => c.c).join('')).toBe('別我');
  });

  it('SEQ_CONFLICT 時塗改標記丟掉並提醒（位置可能已經不對）', async () => {
    const srv = fakeServer(sheet({ chars: [{ c: 'a', m: [] }], seq: 1 }));
    const onError = vi.fn();
    const w = new SheetWriter(srv.get(), { send: srv.send, reload: async () => srv.get(), onChange: () => {}, onError });
    srv.set({ ...srv.get(), seq: 2 });
    w.push({ kind: 'mark', from: 0, to: 0, tool: 's1' });
    await w.flush();
    expect(onError).toHaveBeenCalled();
    expect(srv.sent.filter((x) => x.op.kind === 'mark')).toHaveLength(1);
  });

  it('信鎖住了（LETTER_LOCKED）：丟掉佇列、提醒、重新讀', async () => {
    const onError = vi.fn();
    const reload = vi.fn(async () => sheet());
    const w = new SheetWriter(sheet(), {
      send: async () => {
        throw new ApiError(409, 'LETTER_LOCKED', '信帶去郵局了，回家才能繼續寫');
      },
      reload,
      onChange: () => {},
      onError,
    });
    w.push({ kind: 'chars', text: 'a' });
    w.push({ kind: 'stroke', stroke: { pen: 'ball', color: '#000000', pts: [[0, 0, 0.5]] } });
    await w.flush();
    expect(onError).toHaveBeenCalledWith('信帶去郵局了，回家才能繼續寫');
    expect(reload).toHaveBeenCalled();
    expect(w.pending).toBe(0);
  });

  it('applyLocal：塗改標記不加在換行上', () => {
    const s = applyLocal(sheet({ chars: [{ c: 'a', m: [] }, { c: '\n', m: [] }, { c: 'b', m: [] }] }), { kind: 'mark', from: 0, to: 2, tool: 'x' }, 0);
    expect(s.chars.map((c) => c.m.length)).toEqual([1, 0, 1]);
  });
});
