/**
 * 郵局與追蹤：時間、狀態、能不能裝進信封都由後端判斷，前端照實顯示。
 */
import type { ShipmentDTO } from '@manxin/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BASE_ROUTES, counterOf, fakeApi, httpError, letterOf, renderPage } from '../test/fakeApi.tsx';
import { PostPage } from './Post.tsx';
import { TrackPage } from './Track.tsx';

const NOW = Date.UTC(2026, 9, 14, 13, 0);
const PLACES = {
  places: [
    { id: 'box', name: '巷口郵筒', kind: '郵筒，綠紅一對', m: 350, minutes: { walk: 5, bike: 4, car: 7 } },
    { id: 'po', name: '社區郵局', kind: '郵局，櫃台旁有郵筒', m: 1300, minutes: { walk: 17, bike: 8, car: 10 } },
    { id: 'main', name: '總局夜間投遞口', kind: '郵局，24 小時投遞', m: 3800, minutes: { walk: 48, bike: 18, car: 16 } },
  ],
  modes: { walk: { label: '步行', mpm: 80, extra: 0 }, bike: { label: '騎車', mpm: 250, extra: 2 }, car: { label: '開車', mpm: 420, extra: 6 } },
};
const trip = (o = {}) => ({ id: 't', letterId: 'L', place: 'box' as const, placeName: '巷口郵筒', mode: 'walk' as const, box: 'green' as const, startAt: NOW, arriveAt: NOW + 5 * 60_000, enteredAt: null, serverNow: NOW, arrived: false, ...o });

describe('郵局', () => {
  it('路程分鐘數用後端 /places 的；出發用 POST /trip，倒數照後端給的抵達時間', async () => {
    const L = letterOf('小雯：');
    const api = fakeApi({
      ...BASE_ROUTES,
      'GET /letters': () => ({ letters: [L] }),
      'GET /places': PLACES,
      'POST /letters/:id/trip': (b: unknown) => trip({ mode: (b as { mode: 'walk' }).mode }),
    });
    renderPage(<PostPage />, '/post');
    await screen.findByText('帶去郵局的東西');
    expect(screen.getByText(/步行到巷口郵筒約/)).toHaveTextContent('5 分鐘');
    fireEvent.click(screen.getByRole('button', { name: '帶著信出發' }));
    await waitFor(() => expect(document.querySelector('#cd')).not.toBeNull());
    const post = api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/trip'))!;
    expect(post.body).toEqual({ place: 'box', mode: 'walk', box: 'green' });
    expect(screen.getByText(/預計 115\/10\/14（三） 21:05 抵達/)).toBeInTheDocument();
  });

  it('桌邊還有舊信紙：不能出發', async () => {
    const L = letterOf('小雯：', { refs: [letterOf('舊').sheet] });
    fakeApi({ ...BASE_ROUTES, 'GET /letters': () => ({ letters: [L] }), 'GET /places': PLACES });
    renderPage(<PostPage />, '/post');
    await screen.findByText(/桌邊還有 1 張舊信紙沒處理/);
    expect(screen.getByRole('button', { name: '帶著信出發' })).toBeDisabled();
  });

  it('櫃台：裝不下時顯示後端的 TOO_LONG 訊息，不自己判斷', async () => {
    const L = letterOf('小雯：', { trip: trip({ enteredAt: NOW + 6 * 60_000, arrived: true }) });
    fakeApi({
      ...BASE_ROUTES,
      'GET /letters': () => ({ letters: [L] }),
      'GET /places': PLACES,
      'GET /letters/:id/counter': counterOf(),
      'POST /letters/:id/counter/insert': () => {
        throw httpError(422, 'TOO_LONG', '塞不進去。信紙太長了，要再摺。', { w: 1, h: 1.414, envW: 1.05, envH: 0.52 });
      },
    });
    renderPage(<PostPage />, '/post');
    await screen.findByText('巷口郵筒・櫃台');
    fireEvent.click(screen.getByRole('button', { name: '放進信封' }));
    await waitFor(() => expect(document.querySelector('#toast')).toHaveTextContent('塞不進去。信紙太長了，要再摺。'));
    // 寄出前的步驟清單照後端狀態
    expect(screen.getByText(/確認地址/, { selector: '#steps li' })).not.toHaveClass('ok');
  });

  it('櫃台：確認地址前會提醒「如無法收信，退回所需時間很長」', async () => {
    const L = letterOf('小雯：', { trip: trip({ enteredAt: NOW, arrived: true }) });
    const api = fakeApi({
      ...BASE_ROUTES,
      'GET /letters': () => ({ letters: [L] }),
      'GET /places': PLACES,
      'GET /letters/:id/counter': counterOf(),
      'POST /letters/:id/counter/confirm-address': counterOf({ addrOk: true, missing: ['INSERT', 'STAMP'] }),
    });
    renderPage(<PostPage />, '/post');
    await screen.findByText('巷口郵筒・櫃台');
    fireEvent.click(screen.getByRole('button', { name: '確認地址' }));
    expect(await screen.findByText('如無法收信，退回所需時間很長。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '地址沒錯' }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith('/confirm-address'))).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: '地址確認過了・再看一次' })).toBeInTheDocument());
  });
});

const ship = (o: Partial<ShipmentDTO> = {}): ShipmentDTO => ({
  no: 'RR123456785TW',
  letterId: 'L',
  sentAt: NOW - 3 * 86400e3,
  office: '巷口郵筒',
  box: 'green',
  state: 'transit',
  curEmail: 'wen@example.org',
  curDeliver: NOW,
  editsLeft: 0,
  reached: 1,
  stops: ['臺北大安區 巷口郵筒', '臺北郵件處理中心', '臺南東區郵局 投遞股'],
  events: [{ t: NOW - 3 * 86400e3, tx: '已交寄（綠色郵筒・普通）', pl: '臺北大安區 巷口郵筒' }],
  deliverAt: null,
  signedAt: null,
  returnedAt: null,
  returnPostmark: null,
  env: { fromName: '阿哲', fromEmail: 'zhe@example.com', fromAddr: '', toName: '小雯', toEmail: 'wen@example.org', toAddr: '' },
  calc: null,
  ...o,
});

describe('追蹤', () => {
  it('運送中：送達前不透露送達時間，計算明細也還沒有', async () => {
    fakeApi({ ...BASE_ROUTES, 'GET /shipments': { shipments: [ship()] } });
    renderPage(<TrackPage />, '/track');
    expect(await screen.findByText('送達前不透露')).toBeInTheDocument();
    expect(screen.getAllByText('運送中').length).toBeGreaterThan(0);
    expect(screen.getByText(/送達之後，這裡會列出實際怎麼算的/)).toBeInTheDocument();
    expect(screen.getByText('已交寄（綠色郵筒・普通）')).toBeInTheDocument();
  });

  it('已送達未簽收：顯示後端給的計算明細；可改信箱時用 POST /recipient-email', async () => {
    const s = ship({
      state: 'waiting',
      editsLeft: 1,
      deliverAt: NOW - 86400e3,
      calc: { start: NOW - 3 * 86400e3, base: 3, baseWhy: '跨區域', randDelay: 2 * 3600e3, wDelay: 0, raw: NOW - 86400e3, deliver: NOW - 86400e3 },
    });
    const api = fakeApi({
      ...BASE_ROUTES,
      'GET /shipments': { shipments: [s] },
      'POST /shipments/:no/recipient-email': (b: unknown) => ship({ ...s, state: 'rerouting', curEmail: (b as { email: string }).email, editsLeft: 0 }),
    });
    renderPage(<TrackPage />, '/track');
    expect(await screen.findByText(/基礎時間/)).toHaveTextContent('3 天');
    expect(screen.getByText('跨區域', { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('正確的收件信箱'), { target: { value: 'wen2@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: '修改並重新投遞' }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith('/recipient-email'))?.body).toEqual({ email: 'wen2@example.org' }));
    await waitFor(() => expect(screen.getAllByText('改寄中').length).toBeGreaterThan(0));
  });

  it('已退回：畫出後端給的退件郵戳', async () => {
    fakeApi({
      ...BASE_ROUTES,
      'GET /shipments': { shipments: [ship({ state: 'returned', returnPostmark: { place: '臺南東區', shape: 2, color: '#2B3F73', date: '115.11.20' }, returnedAt: NOW })] },
    });
    renderPage(<TrackPage />, '/track');
    expect(await screen.findByText(/郵戳依目的地「臺南東區」產生/)).toBeInTheDocument();
    expect(document.querySelector('.returned .pmark')).toHaveAttribute('aria-label', '退件郵戳：臺南東區 115.11.20');
  });
});
