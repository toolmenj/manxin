/**
 * 書桌：打的字只用「追加字元」送後端；退格、復原、貼上沒有任何效果（落子無悔）。
 */
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react';
import type { LetterDTO, Stroke } from '@manxin/shared';
import { describe, expect, it } from 'vitest';
import { applyLocal } from '../lib/sheetWriter.ts';
import { BASE_ROUTES, fakeApi, letterOf, renderPage, sheetOf } from '../test/fakeApi.tsx';
import { DeskPage } from './Desk.tsx';

// 整套一起跑時，第一次畫書桌（冷啟動）偶爾超過預設的 1 秒
configure({ asyncUtilTimeout: 4000 });

function setup(text = '小雯：', o: Partial<LetterDTO> = {}) {
  let L = letterOf(text, o);
  if (o.sheet) L = { ...L, sheet: o.sheet };
  const apply = (b: unknown, op: Parameters<typeof applyLocal>[1]) => {
    const { seq } = b as { seq: number };
    if (seq !== L.sheet.seq) throw Object.assign(new Error('conflict'), { status: 409, code: 'SEQ_CONFLICT' });
    L = { ...L, sheet: { ...applyLocal(L.sheet, op, 0), seq: L.sheet.seq + 1 } };
    return L.sheet;
  };
  const api = fakeApi({
    ...BASE_ROUTES,
    'GET /letters': (_b: unknown, u: URL) => ({ letters: u.searchParams.get('status') === 'drafting' ? [L] : [] }),
    'GET /letters/:id': () => L,
    'POST /letters/:id/sheet/chars': (b: unknown) => apply(b, { kind: 'chars', text: (b as { text: string }).text }),
    'POST /letters/:id/sheet/moves': (b: unknown) => apply(b, { kind: 'move', at: (b as { at: [number, number] }).at }),
    'POST /letters/:id/sheet/strokes': (b: unknown) => apply(b, { kind: 'stroke', stroke: (b as { stroke: Stroke }).stroke }),
  });
  renderPage(<DeskPage />, '/desk');
  return { api, get: () => L };
}

const typeIme = (ime: HTMLTextAreaElement, v: string) => {
  ime.value = v;
  fireEvent.input(ime, { data: v, inputType: 'insertText' });
};

describe('書桌', () => {
  it('把伺服器上的信紙畫出來，含打字機與落子無悔的說明', async () => {
    setup('小雯：');
    await waitFor(() => expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(3));
    expect(screen.getByText(/落子無悔：沒有復原、沒有刪除、沒有橡皮擦/)).toBeInTheDocument();
    expect(document.querySelector('#tw .tw-keys')).not.toBeNull();
    expect(screen.getByRole('button', { name: '謄打' })).toBeInTheDocument();
  });

  it('打字：先畫在紙上，再用 POST /sheet/chars（帶 seq）追加到後端', async () => {
    const { api, get } = setup('小雯：');
    await waitFor(() => expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(3));
    const ime = document.querySelector<HTMLTextAreaElement>('#ime')!;
    act(() => typeIme(ime, '好'));
    expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(4);
    expect(ime.value).toBe('');
    await waitFor(() => expect(get().sheet.chars.map((c) => c.c).join('')).toBe('小雯：好'));
    const post = api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/sheet/chars'));
    expect(post).toHaveLength(1);
    expect(post[0]!.body).toMatchObject({ text: '好', seq: 1, sheetId: 'S1' });
    expect((post[0]!.body as { opId: string }).opId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('退格、Delete、Ctrl+Z、貼上：沒有發出任何請求，紙上的字一個都沒少，並且提醒', async () => {
    const { api } = setup('小雯：好久不見');
    await waitFor(() => expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(7));
    const ime = document.querySelector<HTMLTextAreaElement>('#ime')!;
    const n0 = api.calls.length;
    for (const k of [{ key: 'Backspace' }, { key: 'Delete' }, { key: 'z', ctrlKey: true }, { key: 'v', ctrlKey: true }]) {
      expect(fireEvent.keyDown(ime, k)).toBe(false); // preventDefault
    }
    expect(fireEvent.paste(ime)).toBe(false);
    expect(fireEvent.contextMenu(document.querySelector('#pw .paper')!)).toBe(false);
    const bi = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' });
    ime.dispatchEvent(bi);
    expect(bi.defaultPrevented).toBe(true);
    expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(7);
    expect(api.calls.slice(n0).filter((c) => c.method !== 'GET')).toEqual([]);
    expect(document.querySelector('#toast')).toHaveTextContent(/落子無悔|沒有復原|貼上已停用/);
  });

  it('改錯：打開工具列，改錯時打字無效', async () => {
    const { api } = setup('小雯：');
    await waitFor(() => expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: '改錯' }));
    expect(document.querySelector('#fixBar')).not.toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: '改完了' })).toHaveAttribute('aria-pressed', 'true');
    for (const t of ['單橫線', '雙橫線', '打叉', '塗黑', '修正帶']) expect(screen.getAllByRole('button', { name: new RegExp(t) }).length).toBeGreaterThan(0);
    const ime = document.querySelector<HTMLTextAreaElement>('#ime')!;
    act(() => typeIme(ime, 'x'));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls.filter((c) => c.path.endsWith('/sheet/chars'))).toEqual([]);
  });

  it('信帶去郵局了：書桌鎖住，打字不送', async () => {
    const L = letterOf('小雯：', {
      trip: { id: 't', letterId: 'x', place: 'box', placeName: '巷口郵筒', mode: 'walk', box: 'green', startAt: 0, arriveAt: 1, enteredAt: null, serverNow: 0, arrived: false },
    });
    const api = fakeApi({ ...BASE_ROUTES, 'GET /letters': () => ({ letters: [L] }) });
    renderPage(<DeskPage />, '/desk');
    await waitFor(() => expect(document.querySelector('#deskLock')).not.toHaveAttribute('hidden'));
    expect(screen.getByText('信在你身上')).toBeInTheDocument();
    const ime = document.querySelector<HTMLTextAreaElement>('#ime')!;
    act(() => typeIme(ime, 'x'));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('方向鍵移動打字頭：只送「移動」，紙上的字一個都沒少；之後的字打在新的位置', async () => {
    const { api, get } = setup('小雯：');
    await waitFor(() => expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(3));
    const ime = document.querySelector<HTMLTextAreaElement>('#ime')!;
    // 順排的信紙：打字頭在「小雯：」後面（第 0 行第 6 個半格）；往下兩行、往右一格
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight']) expect(fireEvent.keyDown(ime, { key })).toBe(false);
    await waitFor(() => expect(get().sheet.cursor).toEqual([2, 8]));
    const moves = api.calls.filter((c) => c.path.endsWith('/sheet/moves'));
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves.at(-1)!.body).toMatchObject({ at: [2, 8] });
    expect(get().sheet.chars.map((c) => c.c).join('')).toBe('小雯：');
    // 換成格位排版：每一行一個 .gl，打字頭在第 3 行
    expect(document.querySelectorAll('#pw .type-layer.gridded .gl')).toHaveLength(3);
    expect(document.querySelector('#pw .gl[data-r="2"] #caret')).not.toBeNull();
    act(() => typeIme(ime, '好'));
    await waitFor(() => expect(get().sheet.chars.at(-1)).toMatchObject({ c: '好', p: [2, 8] }));
    expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(4);
    expect(api.calls.filter((c) => c.method === 'POST' && !/\/sheet\/(chars|moves)$/.test(c.path))).toEqual([]);
  });

  it('打字頭推不進有字的格子：往上推到第一行的字上就跳過，推到紙邊叮一聲、不送東西', async () => {
    const { api } = setup('小雯：');
    await waitFor(() => expect(document.querySelectorAll('#pw .type-layer .c')).toHaveLength(3));
    const ime = document.querySelector<HTMLTextAreaElement>('#ime')!;
    const n0 = api.calls.filter((c) => c.method === 'POST').length;
    fireEvent.keyDown(ime, { key: 'ArrowUp' }); // 第 0 行再往上是紙邊
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls.filter((c) => c.method === 'POST').length).toBe(n0);
  });

  it('明信片：手寫筆畫畫到右半邊（地址、郵票）會被截掉，只送左半邊那段', async () => {
    const sheet = sheetOf('', { kind: 'postcard', mode: 'hand' });
    const { api } = setup('', { sheet });
    await waitFor(() => expect(document.querySelector('#pw .paper.hand')).not.toBeNull());
    const cv = document.querySelector<HTMLCanvasElement>('#pw canvas.ink-layer')!;
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const ev = (type: string, x: number, y: number) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }) as MouseEvent & { pointerId: number; pressure: number };
      Object.assign(e, { pointerId: 1, pressure: 0.5 });
      cv.dispatchEvent(e);
    };
    // 從右半邊落筆：不畫、提醒
    ev('pointerdown', 500, 50);
    ev('pointerup', 500, 50);
    // 從左邊畫到右邊：只留左邊
    ev('pointerdown', 60, 60);
    ev('pointermove', 200, 60);
    ev('pointermove', 450, 60);
    ev('pointermove', 550, 60);
    ev('pointerup', 550, 60);
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith('/sheet/strokes'))).toHaveLength(1));
    const st = api.calls.find((c) => c.path.endsWith('/sheet/strokes'))!.body as { stroke: Stroke };
    expect(st.stroke.pts.every(([x]) => x <= 0.55)).toBe(true);
    expect(st.stroke.pts.length).toBe(2);
    expect(document.querySelector('#toast')).toHaveTextContent(/右半邊/);
  });
});
