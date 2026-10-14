/**
 * 書桌：打的字只用「追加字元」送後端；退格、復原、貼上沒有任何效果（落子無悔）。
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyLocal } from '../lib/sheetWriter.ts';
import { BASE_ROUTES, fakeApi, letterOf, renderPage } from '../test/fakeApi.tsx';
import { DeskPage } from './Desk.tsx';

function setup(text = '小雯：') {
  let L = letterOf(text);
  const api = fakeApi({
    ...BASE_ROUTES,
    'GET /letters': (_b: unknown, u: URL) => ({ letters: u.searchParams.get('status') === 'drafting' ? [L] : [] }),
    'GET /letters/:id': () => L,
    'POST /letters/:id/sheet/chars': (b: unknown) => {
      const { text: t, seq } = b as { text: string; seq: number };
      if (seq !== L.sheet.seq) throw Object.assign(new Error('conflict'), { status: 409, code: 'SEQ_CONFLICT' });
      L = { ...L, sheet: { ...applyLocal(L.sheet, { kind: 'chars', text: t }, 0), seq: L.sheet.seq + 1 } };
      return L.sheet;
    },
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
    expect(post[0]!.body).toEqual({ text: '好', seq: 1 });
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
});
