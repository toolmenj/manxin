/**
 * 上線後的安全與帳號功能，在真的瀏覽器裡走一次：
 * 寄一封信（用 API 快速走完櫃台）→ 收件人按「收下」→ 檢舉並封鎖 → 管理員在管理頁看到、停權
 * → 帳號設定、隱私權政策。最後用手機尺寸拍主要頁面，檢查小螢幕排版。
 */
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const API = 'http://localhost:5173/api';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('電子信箱').fill(email);
  await page.getByRole('button', { name: '寄登入信' }).click();
  await expect(page.getByText('登入信寄到')).toBeVisible();
  const r = await (await page.request.get(`${API}/dev/outbox?to=${encodeURIComponent(email)}`)).json();
  const token = r.mails.find((m: { meta: { kind: string } }) => m.meta.kind === 'login').meta.token;
  await page.goto('/login?token=' + token);
  await page.getByRole('button', { name: '登入慢信' }).click();
  await page.waitForURL('**/desk');
}

/** 用 API 寫信、走去郵筒、在櫃台摺好裝好貼郵票、投郵筒，快轉到送達；回傳收件人的開信 token */
async function sendAndDeliver(req: APIRequestContext, to: string): Promise<{ no: string; token: string }> {
  const ok = async (p: Promise<APIResponse>) => {
    const r = await p;
    if (!r.ok()) throw new Error(await r.text());
    return r;
  };
  const L = await (await ok(req.post(`${API}/letters`, { data: { env: { fromName: '阿哲', fromAddr: '臺北市', toName: '小雯', toEmail: to, toAddr: '臺南市' } } }))).json();
  await ok(req.post(`${API}/letters/${L.id}/sheet/chars`, { data: { text: '這是一封測試用的信。' } }));
  await ok(req.post(`${API}/letters/${L.id}/trip`, { data: { place: 'box', mode: 'walk', box: 'green' } }));
  await ok(req.post(`${API}/dev/clock`, { data: { advanceMs: 3600_000 } }));
  for (const [u, d] of [
    ['trip/enter'],
    ['counter/confirm-address'],
    ['counter/folds', { edge: 'b', at: (1.414 * 2) / 3 }],
    ['counter/folds', { edge: 'b', at: 1.414 / 3 }],
    ['counter/insert'],
    ['counter/seal'],
    ['counter/stamp', { x: 0.87, y: 0.24, r: 3 }],
  ] as [string, object?][]) {
    await ok(req.post(`${API}/letters/${L.id}/${u}`, d ? { data: d } : {}));
  }
  const s = await (await ok(req.post(`${API}/letters/${L.id}/post`))).json();
  for (let i = 0; i < 4; i++) {
    await ok(req.post(`${API}/dev/clock`, { data: { advanceMs: 7 * 86400_000 } }));
    const x = await (await req.get(`${API}/shipments/${s.no}`)).json();
    if (x.state === 'waiting') break;
  }
  const out = await (await req.get(`${API}/dev/outbox?to=${encodeURIComponent(to)}`)).json();
  const m = out.mails.find((x: { meta: { kind: string; no: string } }) => x.meta.kind === 'deliver' && x.meta.no === s.no);
  return { no: s.no, token: m.meta.token };
}

test.afterAll(async ({ request }) => {
  await request.post(`${API}/dev/clock`, { data: { reset: true } });
});

test('收下 → 檢舉並封鎖 → 管理員停權；帳號設定與隱私權政策', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const sender = `s-${stamp}@example.com`;
  const rcpt = `r-${stamp}@example.org`;

  /* 寄件人寄信 */
  const sCtx = await browser.newContext();
  const sp = await sCtx.newPage();
  await login(sp, sender);
  const { no, token } = await sendAndDeliver(sp.request, rcpt);

  /* 收件人：打開連結不會自己簽收，按「收下」才算 */
  const rCtx = await browser.newContext();
  const rp = await rCtx.newPage();
  await rp.goto('/r/' + token);
  await expect(rp.getByRole('button', { name: '收下這封信' })).toBeVisible();
  expect((await (await rp.request.get(`${API}/r/${token}`)).json()).recv.entered).toBe(false);
  await rp.getByRole('button', { name: '收下這封信' }).click();
  await expect(rp.getByRole('button', { name: '翻到背面' })).toBeVisible();

  /* 民國風格：深色木桌上的「翻到背面」按鈕要看得清楚（文字與底色對比 ≥ 4.5，WCAG AA） */
  await rp.locator('#eraSeg button[data-v="minguo"]').click();
  await rp.waitForTimeout(1200);
  const ratio = await rp.getByRole('button', { name: '翻到背面' }).evaluate((el) => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const cs = getComputedStyle(el);
    let bg = cs.backgroundColor;
    for (let p: HTMLElement | null = el as HTMLElement; p && /rgba\(.*,\s*0\)|transparent/.test(bg); p = p.parentElement) bg = getComputedStyle(p).backgroundColor;
    const [a, b] = [lum(rgb(cs.color)), lum(rgb(bg))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  await rp.screenshot({ path: 'test-results/receive-minguo.png' });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  await rp.locator('#eraSeg button[data-v="80s"]').click();

  /* 檢舉並封鎖 */
  await rp.getByText('這封信讓你不舒服？').click();
  await rp.locator('#rvReport').click();
  await rp.locator('.rv-report select').selectOption('harass');
  await rp.locator('.rv-report textarea').fill('端到端測試的檢舉');
  await rp.getByRole('button', { name: '送出檢舉' }).click();
  await expect(rp.locator('#toast')).toContainText('收到你的檢舉');

  /* 管理員：頁首有「管理」，看得到檢舉（看不到信的內容），停權 */
  const aCtx = await browser.newContext();
  const ap = await aCtx.newPage();
  await login(ap, 'admin@example.com');
  await expect(ap.locator('nav.tabs button[data-view="admin"]')).toBeVisible();
  await ap.goto('/admin');
  const row = ap.locator('.admin-table tr', { hasText: no });
  await expect(row).toContainText('騷擾');
  await expect(row).toContainText('端到端測試的檢舉');
  await expect(ap.locator('#admin')).not.toContainText('這是一封測試用的信');
  ap.on('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: '停權' }).click();
  await expect(ap.locator('#toast')).toContainText('停權了');
  await expect(ap.locator('.admin-table tr', { hasText: no })).toContainText('已停權');

  /* 一般使用者看不到管理頁 */
  await sp.goto('/admin');
  await expect(sp.getByText('這裡什麼都沒有')).toBeVisible();
  await expect(sp.locator('nav.tabs button[data-view="admin"]')).toHaveCount(0);

  /* 收件人登入：帳號設定裡看得到封鎖名單 */
  await login(rp, rcpt);
  await rp.goto('/account');
  await expect(rp.locator('.plain-list')).toContainText('阿哲');
  await expect(rp.locator('#deleteAccount')).toBeDisabled();

  /* 隱私權政策：聯絡信箱來自伺服器設定 */
  await rp.goto('/privacy');
  await expect(rp.getByRole('heading', { name: '隱私權政策' })).toBeVisible();
  await expect(rp.getByRole('link', { name: 'hello@manxin.example' }).first()).toBeVisible();
  await expect(rp.locator('.site-foot')).toContainText('使用條款');

  await Promise.all([sCtx.close(), rCtx.close(), aCtx.close()]);
});

test('手機尺寸：主要頁面不會橫向捲動，截圖留存', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, `m-${Date.now().toString(36)}@example.com`);
  for (const [path, name] of [
    ['/', 'home'],
    ['/desk', 'desk'],
    ['/post', 'post'],
    ['/track', 'track'],
    ['/account', 'account'],
    ['/privacy', 'privacy'],
  ] as const) {
    await page.goto(path);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `test-results/mobile-${name}.png`, fullPage: false });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(over, `${path} 橫向超出 ${over}px`).toBeLessThanOrEqual(2);
  }
  await ctx.close();
});
