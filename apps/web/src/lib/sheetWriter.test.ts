import type { SheetDTO } from '@manxin/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { applyLocal, SheetWriter, type SendMeta, type WireOp } from './sheetWriter.ts';

const sheet = (o: Partial<SheetDTO> = {}): SheetDTO => ({
  id: 'S1',
  kind: 'letter',
  style: 'lined',
  mode: 'type',
  font: 'typewriter',
  fontUrl: null,
  bgAttachmentId: null,
  bgTemplate: null,
  seq: 0,
  chars: [],
  cursor: null,
  strokes: [],
  scan: null,
  createdAt: 0,
  ...o,
});

const textOf = (s: SheetDTO) => s.chars.map((c) => c.c).join('');
/** 劃掉的字後面加一條線，方便看 */
const marked = (s: SheetDTO) => s.chars.map((c) => c.c + (c.m.length ? '̶' : '')).join('');

/**
 * 假的後端：照後端的規則——先認 sheetId、再認 opId（寫過就回目前的信紙）、再檢查 seq——套用追加操作。
 * dropAck：寫進去之後故意讓回應「遺失」（丟網路錯誤），模擬 proxy 逾時。
 */
function fakeServer(start = sheet()) {
  let s = start;
  const seen = new Set<string>();
  const sent: { op: WireOp; meta: SendMeta }[] = [];
  let dropAck = 0;
  const send = vi.fn(async (op: WireOp, meta: SendMeta) => {
    sent.push({ op, meta });
    if (meta.sheetId !== s.id) throw new ApiError(409, 'SHEET_CHANGED', 'changed', { sheetId: s.id });
    if (seen.has(meta.opId)) return s;
    if (meta.seq !== s.seq) throw new ApiError(409, 'SEQ_CONFLICT', 'conflict', { seq: s.seq });
    s = { ...applyLocal(s, op, s.seq), seq: s.seq + 1 };
    seen.add(meta.opId);
    if (dropAck > 0) {
      dropAck--;
      throw new ApiError(0, 'NETWORK', 'lost response');
    }
    return s;
  });
  /** 別的分頁直接寫進來 */
  const other = (op: WireOp) => {
    s = { ...applyLocal(s, op, s.seq), seq: s.seq + 1 };
  };
  return { send, sent, other, get: () => s, set: (x: SheetDTO) => (s = x), dropNextAck: () => (dropAck = 1) };
}

const writerOn = (srv: ReturnType<typeof fakeServer>, extra: Partial<ConstructorParameters<typeof SheetWriter>[1]> = {}, init = srv.get()) =>
  new SheetWriter(init, { send: srv.send, reload: async () => srv.get(), onChange: () => {}, onError: () => {}, sleep: async () => {}, ...extra });

describe('SheetWriter：書寫只送追加操作', () => {
  it('畫面先顯示，再依序送出；每次帶 seq、sheetId、opId', async () => {
    const srv = fakeServer();
    const shown: string[] = [];
    const w = writerOn(srv, { onChange: (d) => shown.push(textOf(d)) });
    w.push({ kind: 'chars', text: '慢' });
    expect(textOf(w.display())).toBe('慢');
    await w.flush();
    w.push({ kind: 'chars', text: '信' });
    await w.flush();
    expect(srv.sent.map((x) => x.meta.seq)).toEqual([0, 1]);
    expect(srv.sent.every((x) => x.meta.sheetId === 'S1' && /^[0-9a-f-]{36}$/.test(x.meta.opId))).toBe(true);
    expect(new Set(srv.sent.map((x) => x.meta.opId)).size).toBe(2);
    expect(textOf(srv.get())).toBe('慢信');
    expect(shown.at(-1)).toBe('慢信');
  });

  it('送出中連續打的字會併成一次（一次最多 2000 字）', async () => {
    const srv = fakeServer();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn(async (op: WireOp, meta: SendMeta) => {
      await gate;
      return srv.send(op, meta);
    });
    const w = writerOn(srv, { send });
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
    const w = writerOn(srv);
    w.push({ kind: 'chars', text: 'x'.repeat(4500) });
    await w.flush();
    expect(srv.sent.map((x) => [...(x.op as { text: string }).text].length)).toEqual([2000, 2000, 500]);
  });

  it('網路斷了：字留在佇列裡，退避後重送（同一個 opId），不會丟', async () => {
    const srv = fakeServer();
    let fail = 2;
    const send = vi.fn(async (op: WireOp, meta: SendMeta) => {
      if (fail-- > 0) throw new ApiError(0, 'NETWORK', 'down');
      return srv.send(op, meta);
    });
    const statuses: string[] = [];
    const ids: string[] = [];
    const w = writerOn(srv, {
      send: async (op, meta) => (ids.push(meta.opId), send(op, meta)),
      onChange: (_d, st) => statuses.push(st),
    });
    w.push({ kind: 'chars', text: '在' });
    await w.flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(new Set(ids).size).toBe(1);
    expect(srv.get().chars.map((c) => c.c)).toEqual(['在']);
    expect(statuses).toContain('retrying');
    expect(statuses.at(-1)).toBe('idle');
  });

  it('H1：寫進去了但回應遺失 → 重送同一個 opId，後端認得，字不會重複', async () => {
    const srv = fakeServer();
    srv.dropNextAck();
    const w = writerOn(srv);
    w.push({ kind: 'chars', text: '我喜歡你' });
    await w.flush(2000);
    expect(textOf(srv.get())).toBe('我喜歡你');
    expect(srv.get().seq).toBe(1);
    expect(textOf(w.display())).toBe('我喜歡你');
  });

  it('H1：回應遺失之後別的分頁又寫了字：接著劃自己的字，劃到的還是自己的字', async () => {
    const srv = fakeServer(sheet({ chars: [...'AB'].map((c) => ({ c, m: [] })), seq: 1 }));
    srv.dropNextAck();
    let first = true;
    const w = writerOn(srv, {
      send: async (op, meta) => {
        try {
          return await srv.send(op, meta);
        } finally {
          if (first) {
            first = false;
            srv.other({ kind: 'chars', text: 'XY' }); // 回應遺失的同時，別的分頁寫了 XY
          }
        }
      },
    });
    w.push({ kind: 'chars', text: 'CD' });
    w.push({ kind: 'mark', at: [2, 3], tool: 's1' });
    await w.flush(2000);
    expect(marked(srv.get())).toBe('ABC̶D̶XY');
  });

  it('SEQ_CONFLICT（別的分頁也寫了）：重新讀信紙，字照樣追加上去', async () => {
    const srv = fakeServer();
    const w = writerOn(srv);
    srv.other({ kind: 'chars', text: '別' });
    w.push({ kind: 'chars', text: '我' });
    await w.flush();
    expect(textOf(srv.get())).toBe('別我');
    expect(textOf(w.display())).toBe('別我');
  });

  it('H2：多分頁時排隊中的塗改只劃到自己的字（不是別的分頁插進來的字）', async () => {
    // 伺服器：信紙 "AB"，seq=1
    const srv = fakeServer(sheet({ chars: [...'AB'].map((c) => ({ c, m: [] })), seq: 1 }));
    let gate!: () => void;
    const firstSend = new Promise<void>((r) => (gate = r));
    let n = 0;
    const onError = vi.fn();
    const w = writerOn(srv, {
      send: async (op, meta) => {
        if (n++ === 0) await firstSend;
        return srv.send(op, meta);
      },
      onError,
    });
    w.push({ kind: 'chars', text: 'CD' }); // 分頁 A 打 CD（送出中）
    await new Promise((r) => setTimeout(r, 5));
    w.push({ kind: 'mark', at: [2, 3], tool: 's1' }); // 分頁 A 劃掉自己剛打的 CD（畫面上第 2、3 個字）
    srv.other({ kind: 'chars', text: 'XY' }); // 分頁 B 這時寫了 XY
    gate();
    await w.flush(2000);
    expect(marked(srv.get())).toBe('ABXYC̶D̶');
    expect(marked(w.display())).toBe('ABXYC̶D̶');
    expect(onError).not.toHaveBeenCalled();
  });

  it('塗改已經在伺服器上的字：位置不會因為別的分頁的字而跑掉', async () => {
    const srv = fakeServer(sheet({ chars: [{ c: 'a', m: [] }], seq: 1 }));
    const w = writerOn(srv);
    srv.other({ kind: 'chars', text: 'z' });
    w.push({ kind: 'mark', at: [0], tool: 's1' });
    await w.flush();
    expect(marked(srv.get())).toBe('a̶z');
  });

  it('M1：信紙換過了（SHEET_CHANGED）→ 清空佇列、提醒、重新讀；舊的字不寫到新紙', async () => {
    const srv = fakeServer();
    const onError = vi.fn();
    const onSheetChanged = vi.fn();
    const w = writerOn(srv, { onError, onSheetChanged });
    srv.set(sheet({ id: 'S2' })); // 別的地方謄抄了
    w.push({ kind: 'chars', text: '舊分頁' });
    w.push({ kind: 'mark', at: [0], tool: 'x' });
    await w.flush();
    expect(srv.get().chars).toHaveLength(0);
    expect(w.pending).toBe(0);
    expect(w.sheetId).toBe('S2');
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/換了一張新的信紙/));
    expect(onSheetChanged).toHaveBeenCalled();
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

  it('SEQ_CONFLICT 後重新讀取失敗：退避再試，不會原地狂打', async () => {
    const srv = fakeServer();
    let reloads = 0;
    const sleeps: number[] = [];
    const w = writerOn(srv, {
      reload: async () => {
        if (reloads++ < 2) throw new ApiError(0, 'NETWORK', 'down');
        return srv.get();
      },
      sleep: async (ms) => void sleeps.push(ms),
    });
    srv.other({ kind: 'chars', text: '別' });
    w.push({ kind: 'chars', text: '我' });
    await w.flush();
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect(textOf(srv.get())).toBe('別我');
  });

  it('applyLocal：塗改標記不加在換行上', () => {
    const s = applyLocal(sheet({ chars: [{ c: 'a', m: [] }, { c: '\n', m: [] }, { c: 'b', m: [] }] }), { kind: 'mark', at: [0, 1, 2], tool: 'x' }, 0);
    expect(s.chars.map((c) => c.m.length)).toEqual([1, 0, 1]);
  });
});

describe('移動打字頭', () => {
  it('移動後打字：畫面與後端都依格位擺字；連續移動只送最後一次', async () => {
    const srv = fakeServer(sheet({ chars: [...'你好'].map((c) => ({ c, m: [] })), seq: 1 }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = writerOn(srv, {
      send: async (op, meta) => {
        await gate;
        return srv.send(op, meta);
      },
    });
    w.push({ kind: 'move', at: [1, 0] }); // 送出中
    w.push({ kind: 'move', at: [2, 0] });
    w.push({ kind: 'move', at: [4, 6] }); // 取代上一個還沒送的
    w.push({ kind: 'chars', text: '這裡' });
    const d = w.display();
    expect(d.cursor).toEqual([4, 10]);
    expect(d.chars.map((c) => `${c.c}${c.p}`)).toEqual(['你0,0', '好0,2', '這4,6', '裡4,8']);
    release();
    await w.flush();
    expect(srv.sent.map((x) => x.op.kind)).toEqual(['move', 'move', 'chars']);
    expect((srv.sent[1]!.op as { at: number[] }).at).toEqual([4, 6]);
    expect(srv.get().chars.map((c) => `${c.c}${c.p}`)).toEqual(['你0,0', '好0,2', '這4,6', '裡4,8']);
  });

  it('別的分頁移過打字頭：打字前先補一個移動，字還是打在自己選的位置', async () => {
    const srv = fakeServer();
    const w = writerOn(srv);
    w.push({ kind: 'move', at: [3, 0] });
    await w.flush();
    srv.other({ kind: 'move', at: [10, 0] });
    srv.other({ kind: 'chars', text: '乙' });
    w.push({ kind: 'chars', text: '甲' });
    await w.flush();
    const pos = Object.fromEntries(srv.get().chars.map((c) => [c.c, String(c.p)]));
    expect(pos).toEqual({ 甲: '3,0', 乙: '10,0' });
  });

  it('M7：離開書桌（retire）：不再收新的字、不再更新畫面，但排隊中的會送完', async () => {
    const srv = fakeServer();
    let fail = 1;
    const onChange = vi.fn();
    const w = writerOn(srv, {
      send: async (op, meta) => {
        if (fail-- > 0) throw new ApiError(0, 'NETWORK', 'down');
        return srv.send(op, meta);
      },
      onChange,
    });
    w.push({ kind: 'chars', text: '還沒送出' });
    expect(w.hasUnsent).toBe(true);
    const calls = onChange.mock.calls.length;
    const done = await w.retire(2000);
    expect(done).toBe(true);
    expect(textOf(srv.get())).toBe('還沒送出');
    expect(onChange.mock.calls.length).toBe(calls);
    w.push({ kind: 'chars', text: 'x' });
    expect(w.pending).toBe(0);
  });
});
