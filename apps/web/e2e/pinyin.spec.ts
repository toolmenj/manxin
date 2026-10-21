/**
 * 拼音鍵盤（簡體）：打拼音 → 候選字 → 空白／數字選字；組字中可以退格，寫上紙的字不行。
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

test('拼音鍵盤打出簡體字', async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await login(page, `py-${Date.now().toString(36)}@example.com`);
  await expect(page.locator('#pw .paper')).toBeVisible();

  await page.locator('#twModeSeg button[data-v="py"]').click();
  await expect(page.locator('.tw-py')).toBeVisible();
  // 鍵帽印的是字母
  await expect(page.locator('.k[data-code="KeyQ"] small')).toBeVisible();

  const chars = page.locator('#pw .type-layer .c');
  const before = await chars.count();
  await page.locator('#pw .paper').click();

  // 打錯一個字母，組字中可以退格
  await page.keyboard.type('nk');
  await expect(page.locator('[data-tw="pybuf"]')).toHaveText('nk');
  await page.keyboard.press('Backspace');
  await expect(page.locator('[data-tw="pybuf"]')).toHaveText('n');
  await expect(chars).toHaveCount(before);

  // nihao：空白選「你」，剩下的 hao 再按空白
  await page.keyboard.type('ihao');
  await expect(page.locator('[data-tw="pycands"] i').first()).toHaveText('你');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-tw="pybuf"]')).toHaveText('hao');
  await page.keyboard.press('Space');
  // 數字選字、標點變全形
  await page.keyboard.type('zhong1guo1,');
  await expect(chars).toHaveCount(before + 5);
  await page.locator('.tw').screenshot({ path: 'test-results/pinyin-keyboard.png' });

  // 寫上紙之後，退格沒有用
  await page.keyboard.press('Backspace');
  await expect(chars).toHaveCount(before + 5);
  await expect
    .poll(async () => {
      const r = await (await page.request.get(`${API}/letters?status=drafting`)).json();
      return r.letters.map((l: { sheet: { chars: { c: string }[] } }) => l.sheet.chars.map((c) => c.c).join('')).join('|');
    })
    .toContain('你好中国，');

  // 也可以用點的選字
  await page.keyboard.type('xin');
  await page.locator('[data-tw="pycands"] i[data-pick="0"]').click();
  await expect(chars).toHaveCount(before + 6);
  await page.locator('#pw').screenshot({ path: 'test-results/pinyin-paper.png' });
});
