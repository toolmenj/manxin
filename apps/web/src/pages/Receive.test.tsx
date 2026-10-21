/**
 * 收信：點開連結就算 enter；每一步（倒出來、攤開、收進收藏）都送後端，內容等攤開後才拿得到。
 */
import type { ReceiveDTO } from '@manxin/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BASE_ROUTES, counterOf, fakeApi, httpError, renderPage, sheetOf } from '../test/fakeApi.tsx';
import { ReceivePage } from './Receive.tsx';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

function dto(o: Partial<ReceiveDTO['recv']> = {}, extra: Partial<ReceiveDTO> = {}): ReceiveDTO {
  const { letterId: _l, missing: _m, envLocked: _e, addrOk: _a, emode: _em, ...pkg } = counterOf({
    stampPos: { x: 0.87, y: 0.24, r: 3 },
    folds: [
      { a: 'h', at: 0.9426 },
      { a: 'h', at: 0.4713 },
    ],
    pack: { x0: 0, y0: 0, x1: 1, y1: 0.4713 },
    inserted: true,
    sealed: true,
  });
  return {
    no: 'RR123456785TW',
    fromName: '阿哲',
    office: '巷口郵筒',
    sentAt: Date.UTC(2026, 9, 10),
    pkg: { ...pkg, efont: 'kai', efontUrl: null },
    recv: {
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
      ...o,
    },
    letter: null,
    attachments: null,
    ...extra,
  };
}

describe('收信', () => {
  it('點開連結就送 enter；看到「阿哲寄來的信」與翻面按鈕', async () => {
    const api = fakeApi({ ...BASE_ROUTES, 'GET /r/:t': dto(), 'POST /r/:t/enter': dto({ entered: true }) });
    renderPage(<ReceivePage />, '/r/' + TOKEN, '/r/:token', null);
    expect(await screen.findByText('阿哲寄來的信')).toBeInTheDocument();
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toContain(`POST /r/${TOKEN}/enter`);
    fireEvent.click(screen.getByRole('button', { name: '翻到背面' }));
    expect(await screen.findByRole('button', { name: '拉易撕帶' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開信刀' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('沿著紅色易撕帶，從一頭拉到另一頭。')).toBeInTheDocument();
  });

  it('倒出來 → 攤開（內容這時才有）→ 收進收藏', async () => {
    let state = dto({ entered: true, opened: true, method: 'knife' });
    const api = fakeApi({
      ...BASE_ROUTES,
      'GET /r/:t': () => state,
      'POST /r/:t/pour': () => (state = { ...state, recv: { ...state.recv, poured: true }, attachments: [] }),
      'POST /r/:t/unfold': () =>
        (state = { ...state, recv: { ...state.recv, unfolded: true }, letter: { sheet: sheetOf('小雯：慢慢拆。'), attachments: [], frontAttachmentId: null } }),
      'POST /r/:t/collect': () => (state = { ...state, recv: { ...state.recv, collected: true } }),
    });
    renderPage(<ReceivePage />, '/r/' + TOKEN, '/r/:token', null);
    fireEvent.click(await screen.findByRole('button', { name: '倒出來' }));
    await waitFor(() => expect(document.querySelector('.rv-pack')).not.toBeNull());
    expect(screen.getByText('點一下摺起來的信紙，把它攤開。')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.rv-pack')!);
    await waitFor(() => expect(document.querySelector('#rvLetter .type-layer')).toHaveTextContent('小雯：慢慢拆。'));
    expect(document.querySelectorAll('#rvLetter .crease-h')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '收進收藏' }));
    await waitFor(() => expect(screen.getByText(/收好了，放在「收藏」的/)).toBeInTheDocument());
    expect(api.calls.filter((c) => c.method === 'POST').map((c) => c.path.split('/').pop())).toEqual(['pour', 'unfold', 'collect']);
  });

  it('連結失效（改寄過）：說明，不顯示信', async () => {
    fakeApi({
      ...BASE_ROUTES,
      'GET /r/:t': () => {
        throw httpError(404, 'INVALID_TOKEN', '這個開信連結不存在或已失效');
      },
    });
    renderPage(<ReceivePage />, '/r/' + TOKEN, '/r/:token', null);
    expect(await screen.findByText('打不開這個連結')).toBeInTheDocument();
  });

  it('信已退回：410 GONE', async () => {
    fakeApi({
      ...BASE_ROUTES,
      'GET /r/:t': () => {
        throw httpError(410, 'GONE', '這封信已經退回寄件人了');
      },
    });
    renderPage(<ReceivePage />, '/r/' + TOKEN, '/r/:token', null);
    expect(await screen.findByText('信已經退回了')).toBeInTheDocument();
  });
});

describe('收信的開場與收尾', () => {
  const hostAnims = (spy: { mock: { calls: unknown[][]; contexts: unknown[] } }) =>
    spy.mock.calls.filter((_c, i) => (spy.mock.contexts[i] as Element | undefined)?.id === 'rvEnv').map((c) => c[0] as Keyframe[]);

  it('還沒拆的信：第一次看到時信落到桌上（只播一次，不擋翻面）', async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    fakeApi({ ...BASE_ROUTES, 'GET /r/:t': dto(), 'POST /r/:t/enter': dto({ entered: true }) });
    renderPage(<ReceivePage />, '/r/' + TOKEN, '/r/:token', null);
    await screen.findByText('阿哲寄來的信');
    await waitFor(() => expect(hostAnims(spy).length).toBe(1));
    expect(hostAnims(spy)[0]![0]!.opacity).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '翻到背面' }));
    expect(await screen.findByRole('button', { name: '開信刀' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('已經拆開的信：不再播落到桌上的開場', async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    fakeApi({ ...BASE_ROUTES, 'GET /r/:t': dto({ entered: true, opened: true, method: 'knife' }) });
    renderPage(<ReceivePage />, '/r/' + TOKEN, '/r/:token', null);
    await screen.findByRole('button', { name: '倒出來' });
    expect(hostAnims(spy)).toHaveLength(0);
    spy.mockRestore();
  });
});
