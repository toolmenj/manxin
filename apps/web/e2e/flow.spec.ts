/**
 * 從頭走到尾：登入 → 書桌打字（退格、復原無效）→ 郵局（出發、快轉、走進去）
 * → 櫃台（確認地址、摺信、裝信、封口、貼郵票、投郵筒）→ 追蹤 → 快轉到送達
 * → 收件人開信（翻面、拉易撕帶、倒出來、攤開、收進收藏）→ 寄件人看到已簽收。
 */
import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:5173/api';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('電子信箱').fill(email);
  await page.getByRole('button', { name: '寄登入信' }).click();
  await expect(page.getByText('登入信寄到')).toBeVisible();
  const r = await (await page.request.get(`${API}/dev/outbox?to=${encodeURIComponent(email)}`)).json();
  const token = r.mails.find((m: { meta: { kind: string } }) => m.meta.kind === 'login').meta.token;
  await page.goto('/login?token=' + token);
  await page.waitForURL('**/desk');
}

async function fastForward(page: Page, label: string) {
  await page.locator('details.ff summary', { hasText: '快轉' }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#toast')).toContainText('模擬時間');
}

/** 等元素上的動畫跑完再量位置（第一次量信紙時用；摺完後的放大動畫中按下去也要能摺，見第二摺） */
async function settle(page: Page, sel: string) {
  await page.locator(sel).evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

/** 拖一段（滑鼠按下 → 分幾步移動 → 放開） */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

test.afterAll(async ({ request }) => {
  await request.post(`${API}/dev/clock`, { data: { reset: true } });
});

test('寫信 → 郵局 → 寄出 → 快轉 → 收信開信', async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('response', async (r) => { if (r.status() >= 400 && r.url().includes('/api/') && !r.url().endsWith('/me')) console.log('HTTP', r.status(), r.url(), await r.text().catch(() => '')); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  // 每次用新的帳號，測試可以重跑（後端沿用同一個 PGlite 也不互相干擾）
  const stamp = Date.now().toString(36);
  const me = `e2e-${stamp}@example.com`;
  const to = `r-${stamp}@example.org`;
  await login(page, me);

  /* ---------- 書桌：打字只追加，退格與復原沒有用 ---------- */
  await expect(page.locator('#pw .paper')).toBeVisible();
  const typed = 'Slow mail.';
  const before = await page.locator('#pw .type-layer .c').count();
  await page.locator('#pw .paper').click();
  await page.keyboard.type(typed);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+z');
  // 空白也是一個字
  await expect(page.locator('#pw .type-layer .c')).toHaveCount(before + typed.length);
  await expect
    .poll(async () => {
      const r = await (await page.request.get(`${API}/letters?status=drafting`)).json();
      return r.letters.map((l: { sheet: { chars: { c: string }[] } }) => l.sheet.chars.map((c) => c.c).join('')).join('|');
    })
    .toContain(typed);

  /* ---------- 郵局：出發 → 快轉 → 走進去 ---------- */
  await page.getByRole('button', { name: '裝進信封 →' }).click();
  await page.waitForURL('**/post');
  await page.locator('.place', { hasText: '巷口郵筒' }).click();
  await page.getByRole('button', { name: '帶著信出發' }).click();
  await expect(page.locator('#cd')).toBeVisible();
  await fastForward(page, '+1 小時');
  await page.getByRole('button', { name: '走進郵局' }).click();
  await expect(page.locator('.ct-head')).toContainText('櫃台');

  /* ---------- 櫃台 ---------- */
  await page.locator('input[data-k="fromName"]').fill('阿哲');
  await page.locator('input[data-k="fromAddr"]').fill('臺北市大安區');
  await page.locator('input[data-k="toName"]').fill('小雯');
  await page.locator('input[data-k="toEmail"]').fill(to);
  await page.locator('input[data-k="toAddr"]').fill('臺南市東區');
  await page.getByRole('button', { name: '確認地址' }).click();
  await page.getByRole('button', { name: '地址沒錯' }).click();
  await expect(page.locator('#steps li').first()).toHaveClass(/ok/);

  // 沒摺就裝：塞不進去
  await page.getByRole('button', { name: '放進信封', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('塞不進去');

  // 摺兩次：先從下緣往上摺到三分之一，再對摺
  // 量位置前先把東西捲進畫面（右側表單填完時頁面可能已經往下捲，座標會變成負的）
  // 第一摺：按在紙下緣「外面」8px（可抓範圍往紙外放寬 12px）
  await page.locator('#ctFold .pk').scrollIntoViewIfNeeded();
  await settle(page, '#ctFold .pk');
  let pk = (await page.locator('#ctFold .pk').boundingBox())!;
  await drag(page, { x: pk.x + pk.width / 2, y: pk.y + pk.height + 8 }, { x: pk.x + pk.width / 2, y: pk.y + pk.height / 3 });
  await expect(page.locator('#foldInfo')).toHaveText('摺了 1 次。');
  // 第二摺：不等摺完那下放大動畫（scale 1.04 → 1）停，馬上按在下緣外一點點
  pk = (await page.locator('#ctFold .pk').boundingBox())!;
  await drag(page, { x: pk.x + pk.width / 2, y: pk.y + pk.height + 4 }, { x: pk.x + pk.width / 2, y: pk.y + 3 });
  await expect(page.locator('#foldInfo')).toHaveText('摺了 2 次。');
  // 離紙太遠（超過 12px）不算抓到紙：不會多摺一次
  pk = (await page.locator('#ctFold .pk').boundingBox())!;
  await drag(page, { x: pk.x + pk.width / 2, y: pk.y + pk.height + 30 }, { x: pk.x + pk.width / 2, y: pk.y + 3 });
  await page.waitForTimeout(600);
  await expect(page.locator('#foldInfo')).toHaveText('摺了 2 次。');
  await page.getByRole('button', { name: '放進信封', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('放進去了');
  await page.getByRole('button', { name: '封口', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('封好了', { timeout: 20_000 });

  // 貼郵票：拖到信封右上角（等封口翻面的動畫停下來，信封和郵票都在畫面裡）
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(async () => (await page.locator('#ctEnv .envf').boundingBox())?.width ?? 0).toBeGreaterThan(200);
  const env = (await page.locator('#ctEnv .envf').boundingBox())!;
  const st = (await page.locator('#trayStamp').boundingBox())!;
  await drag(page, { x: st.x + st.width / 2, y: st.y + st.height / 2 }, { x: env.x + env.width * 0.85, y: env.y + env.height * 0.3 });
  await expect(page.getByText('郵票貼好了。')).toBeVisible();

  // 投郵筒：把信封拖進投遞口
  await page.evaluate(() => scrollTo(0, 0));
  const slit = (await page.locator('#ctBox .slit').boundingBox())!;
  const ev = (await page.locator('#ctEnv').boundingBox())!;
  await drag(page, { x: ev.x + ev.width / 2, y: ev.y + ev.height / 2 }, { x: slit.x + slit.width / 2, y: slit.y + slit.height / 2 }, 20);
  // 信滑進投信口、郵筒晃一下之後，是「郵差來收信 → 單號」的過場；按「略過」讓測試不用等
  await expect(page.locator('#ctBox .pbx')).toBeVisible();
  await page.locator('.scene .skip').click({ timeout: 15_000 });
  await expect(page.locator('.scene')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForURL(/\/track\/RR\d{9}TW/, { timeout: 30_000 });
  const no = page.url().split('/').pop()!;
  await expect(page.locator('.detail .chip').first()).toHaveText('運送中');

  /* ---------- 快轉到送達 ---------- */
  for (let i = 0; i < 4; i++) {
    await fastForward(page, '+7 天');
    const s = await (await page.request.get(`${API}/shipments/${no}`)).json();
    if (s.state === 'waiting') break;
  }
  await page.reload();
  await expect(page.locator('.detail .chip').first()).toHaveText('已送達・未簽收');
  await expect(page.locator('.calc')).toContainText('基礎時間');

  /* ---------- 收件人：開信 ---------- */
  await page.getByRole('button', { name: '到收件人的信箱看看' }).click();
  await page.waitForURL(/\/r\//);
  await expect(page.locator('.rv-head')).toContainText('阿哲寄來的信');
  await page.getByRole('button', { name: '翻到背面' }).click();
  await expect(page.locator('#rvEnv .envb')).toBeVisible();
  const back = (await page.locator('#rvEnv .envb').boundingBox())!;
  // 郵政信封：易撕帶在上緣 10.5% 的位置，從左拉到右
  const y = back.y + back.height * 0.105;
  await drag(page, { x: back.x + 2, y }, { x: back.x + back.width - 2, y }, 40);
  await expect(page.locator('#toast')).toContainText(/劃開了|拉開了|撕開了/);
  await page.getByRole('button', { name: '倒出來' }).click();
  await page.locator('.rv-pack').click();
  await expect(page.locator('#rvLetter .type-layer')).toContainText(typed);
  await expect(page.locator('#rvLetter .crease-h')).toHaveCount(2);
  await page.getByRole('button', { name: '收進收藏' }).click();
  await expect(page.locator('#toast')).toContainText('收進');

  // 寄件人的追蹤頁：已簽收
  await page.goto('/track/' + no);
  await expect(page.locator('.detail .chip').first()).toHaveText('已簽收');
});
