/**
 * 郵局與追蹤：時間、狀態、能不能裝進信封都由後端判斷，前端照實顯示。
 */
import type { ShipmentDTO } from '@manxin/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BASE_ROUTES, counterOf, fakeApi, httpError, letterOf, renderPage } from '../test/fakeApi.tsx';
import { fontCSS as fontCSSOf } from '../lib/paper.ts';
import { PostPage } from './Post.tsx';
import { TrackPage } from './Track.tsx';
import { FOLD_REACH } from './Counter.tsx';

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

describe('投進郵筒', () => {
  const ready = () => counterOf({ addrOk: true, inserted: true, sealed: true, stampPos: { x: 0.85, y: 0.3, r: 2 }, missing: [] });
  const drop = () => {
    fireEvent.pointerDown(document.querySelector('#ctEnv')!, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10, pointerId: 1 });
  };

  it('先送 POST /post，動畫同時播；郵差收信的過場可以略過，播完到追蹤頁', async () => {
    const L = letterOf('小雯：', { trip: trip({ enteredAt: NOW + 6 * 60_000, arrived: true }) });
    let posted = 0;
    const api = fakeApi({
      ...BASE_ROUTES,
      'GET /letters': () => ({ letters: [L] }),
      'GET /places': PLACES,
      'GET /letters/:id/counter': ready(),
      'POST /letters/:id/post': () => {
        posted++;
        return ship();
      },
    });
    renderPage(<PostPage />, '/post');
    await screen.findByText('巷口郵筒・櫃台');
    // 郵筒照年代畫，有投信口
    expect(document.querySelector('#ctBox .pbx .slit')).not.toBeNull();
    drop();
    // 請求在動畫之前就送出了
    await waitFor(() => expect(posted).toBe(1));
    expect(document.querySelector('[data-testid="elsewhere"]')).toBeNull();
    const skip = await waitFor(
      () => {
        const b = document.querySelector<HTMLButtonElement>('.scene .skip');
        expect(b).not.toBeNull();
        return b!;
      },
      { timeout: 4000 },
    );
    expect(document.querySelector('.scene .pb-stage .pbx')).not.toBeNull();
    fireEvent.click(skip);
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toBeInTheDocument(), { timeout: 6000 });
    // 過場收乾淨，不留殘影
    expect(document.querySelector('.scene')).toBeNull();
    expect(document.querySelector('.dragghost')).toBeNull();
    expect(api.calls.filter((c) => c.path.endsWith('/post'))).toHaveLength(1);
  }, 15_000);

  it('寄不出去：信抽回來，提示後端的訊息，不跳頁也不播收信過場', async () => {
    const L = letterOf('小雯：', { trip: trip({ enteredAt: NOW + 6 * 60_000, arrived: true }) });
    fakeApi({
      ...BASE_ROUTES,
      'GET /letters': () => ({ letters: [L] }),
      'GET /places': PLACES,
      'GET /letters/:id/counter': ready(),
      'POST /letters/:id/post': () => {
        throw httpError(409, 'NOT_READY', '還沒貼郵票。');
      },
    });
    renderPage(<PostPage />, '/post');
    await screen.findByText('巷口郵筒・櫃台');
    drop();
    await waitFor(() => expect(document.querySelector('#toast')).toHaveTextContent('還沒貼郵票。'), { timeout: 4000 });
    await waitFor(() => expect(document.querySelector('.dragghost')).toBeNull(), { timeout: 4000 });
    expect(document.querySelector('.scene')).toBeNull();
    expect((document.querySelector('#ctEnv') as HTMLElement).style.visibility).toBe('');
    expect(document.querySelector('[data-testid="elsewhere"]')).toBeNull();
  }, 15_000);

  it('換頁（元件卸載）時過場立刻收掉，也不會再自動跳到追蹤頁', async () => {
    const L = letterOf('小雯：', { trip: trip({ enteredAt: NOW + 6 * 60_000, arrived: true }) });
    fakeApi({
      ...BASE_ROUTES,
      'GET /letters': () => ({ letters: [L] }),
      'GET /places': PLACES,
      'GET /letters/:id/counter': ready(),
      'POST /letters/:id/post': () => ship(),
    });
    const view = renderPage(<PostPage />, '/post');
    await screen.findByText('巷口郵筒・櫃台');
    drop();
    await waitFor(() => expect(document.querySelector('.scene')).not.toBeNull(), { timeout: 4000 });
    view.unmount();
    expect(document.querySelector('.scene')).toBeNull();
    await waitFor(() => expect(document.querySelector('.dragghost')).toBeNull(), { timeout: 6000 });
  }, 15_000);
});

describe('櫃台摺信（滑鼠、觸控）', () => {
  // jsdom 沒有版面：外框 #ctFold 量起來是 0，所以用預設 300×400；信紙 1×1.414 → 縮放 186，
  // 中心 (150, 200)，寬 186、高 263，下緣在 y = 331.5。
  const setup = (fold: (body: unknown) => unknown) => {
    const L = letterOf('小雯：', { trip: trip({ enteredAt: NOW + 6 * 60_000, arrived: true }) });
    const api = fakeApi({
      ...BASE_ROUTES,
      'GET /letters': () => ({ letters: [L] }),
      'GET /places': PLACES,
      'GET /letters/:id/counter': counterOf(),
      'POST /letters/:id/counter/folds': fold,
    });
    renderPage(<PostPage />, '/post');
    return api;
  };
  const folds = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.path.endsWith('/counter/folds'));
  const press = (type: 'touch' | 'mouse', from: { x: number; y: number }, to: { x: number; y: number }) => {
    const box = document.querySelector('#ctFold')!;
    const o = { pointerId: 7, pointerType: type, button: 0 };
    fireEvent.pointerDown(document.querySelector('#ctFold .pk-reach')!, { ...o, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(box, { ...o, clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 });
    fireEvent.pointerMove(box, { ...o, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(box, { ...o, clientX: to.x, clientY: to.y });
  };

  it('可抓的範圍比紙大一圈（FOLD_REACH = 12px）：按在紙下緣外 8px 往上拖也會摺（觸控、滑鼠都一樣）', async () => {
    expect(FOLD_REACH).toBe(12);
    const api = setup(() => counterOf({ folds: [{ a: 'h', at: 0.9 }], pack: { x0: 0, y0: 0, x1: 1, y1: 0.9 } }));
    await screen.findByText('巷口郵筒・櫃台');
    expect(document.querySelector('#ctFold .pk .pk-reach')).not.toBeNull();
    press('touch', { x: 150, y: 331.5 + 8 }, { x: 150, y: 250 });
    await waitFor(() => expect(folds(api)).toHaveLength(1));
    expect((folds(api)[0]!.body as { edge: string }).edge).toBe('b');
    await waitFor(() => expect(document.querySelector('#foldInfo')).toHaveTextContent('摺了 1 次。'));
    // 換成滑鼠，按在新的下緣（0.9 × 186 / 2 = 83.7）外 10px
    press('mouse', { x: 150, y: 200 + 83.7 + 10 }, { x: 150, y: 220 });
    await waitFor(() => expect(folds(api)).toHaveLength(2));
  });

  it('離紙太遠（超過 12px）不算抓到紙', async () => {
    const api = setup(() => counterOf());
    await screen.findByText('巷口郵筒・櫃台');
    press('touch', { x: 150, y: 331.5 + 20 }, { x: 150, y: 250 });
    await new Promise((r) => setTimeout(r, 50));
    expect(folds(api)).toHaveLength(0);
    expect(document.querySelector('#ctFold .pk-flap')).toBeNull();
  });

  it('上一摺還在送、信紙還沒換好（放大動畫前）就按下去：記住這一按，紙換好就接著摺', async () => {
    let release!: () => void;
    let n = 0;
    const api = setup(async () => {
      n++;
      if (n === 1) await new Promise<void>((r) => (release = r));
      return counterOf({ folds: Array.from({ length: n }, () => ({ a: 'h' as const, at: 0.9 })), pack: { x0: 0, y0: 0, x1: 1, y1: 0.9 } });
    });
    await screen.findByText('巷口郵筒・櫃台');
    press('touch', { x: 150, y: 331 }, { x: 150, y: 250 });
    await waitFor(() => expect(folds(api)).toHaveLength(1));
    // 第一摺的回應還沒回來：這時按在（即將換上的）新信紙下緣
    press('touch', { x: 150, y: 200 + 83.7 + 4 }, { x: 150, y: 220 });
    expect(folds(api)).toHaveLength(1);
    release();
    await waitFor(() => expect(folds(api)).toHaveLength(2));
    expect((folds(api)[1]!.body as { edge: string }).edge).toBe('b');
    await waitFor(() => expect(document.querySelector('#foldInfo')).toHaveTextContent('摺了 2 次。'));
  });
});

describe('櫃台信封上的字型（D-028）', () => {
  const render = async (font: string, fontUrl: string | null) => {
    const L = letterOf('小雯：', { trip: trip({ enteredAt: NOW + 6 * 60_000, arrived: true }) });
    L.sheet = { ...L.sheet, font, fontUrl };
    fakeApi({ ...BASE_ROUTES, 'GET /letters': () => ({ letters: [L] }), 'GET /places': PLACES, 'GET /letters/:id/counter': counterOf() });
    renderPage(<PostPage />, '/post');
    await screen.findByText('巷口郵筒・櫃台');
    return document.querySelector<HTMLElement>('#ctEnv .ez-t')!.style.fontFamily;
  };

  it('跟信紙同一個字型，不再固定文楷', async () => {
    const ff = await render('typewriter', null);
    const el = document.createElement('span');
    el.style.fontFamily = fontCSSOf('typewriter');
    expect(ff).toBe(el.style.fontFamily);
    el.style.fontFamily = fontCSSOf('kai');
    expect(ff).not.toBe(el.style.fontFamily);
  });

  it('自訂字型：用信紙的 fontUrl 載入，信封上用同一個 font-family', async () => {
    const added: string[] = [];
    const g = globalThis as unknown as { FontFace?: unknown };
    const prevFF = g.FontFace;
    const prevFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    g.FontFace = class {
      constructor(
        public family: string,
        public src: string,
      ) {
        added.push(family + ' ' + src);
      }
      load() {
        return Promise.resolve(this);
      }
    };
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {}, delete() {} } });
    try {
      const ff = await render('f:abc123', '/fonts/abc123');
      expect(ff).toContain('mxf-abc123');
      expect(added.some((a) => a.startsWith('mxf-abc123') && a.includes('/api/fonts/abc123'))).toBe(true);
    } finally {
      g.FontFace = prevFF;
      if (prevFonts) Object.defineProperty(document, 'fonts', prevFonts);
      else delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });
});
