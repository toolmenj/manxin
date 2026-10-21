/**
 * 自選書寫位置（2026-10-21）：點紙上的格子、方向鍵移動打字頭，字打在選的那一行；
 * 明信片右半邊（地址、郵票）寫不進去，打字與手寫都一樣。移動不是刪改：退格照樣刪不掉字。
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

type Sheet = { chars: { c: string; p?: [number, number] }[]; strokes: { pts: number[][] }[]; cursor?: [number, number] | null };

async function serverSheet(page: Page): Promise<Sheet> {
  const r = await (await page.request.get(`${API}/letters?status=drafting`)).json();
  return r.letters[0].sheet;
}

const placed = (s: Sheet) => s.chars.filter((c) => c.p).map((c) => `${c.c}@${c.p![0]},${c.p![1]}`);

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
});

test('移到某一行寫字：點第 6 行、方向鍵往下，字落在選的位置；退格刪不掉', async ({ page }) => {
  await login(page, `pos-${Date.now().toString(36)}@example.com`);
  await expect(page.locator('#pw .paper')).toBeVisible();
  await page.locator('#styleSel').selectOption('lined');
  await expect(page.locator('#pw .paper[data-style="lined"]')).toBeVisible();

  const tl = page.locator('#pw .type-layer');
  const box = (await tl.boundingBox())!;
  const pwW = await page.locator('#pw').evaluate((e) => e.clientWidth);
  const lh = 0.056 * pwW,
    cell = (0.84 * pwW) / 27;

  // 點第 6 行（r=5）第 4 格（u=6）
  await page.mouse.click(box.x + cell * 3 + cell / 2, box.y + lh * 5 + lh / 2);
  await expect(page.locator('#pw .gl[data-r="5"] #caret')).toHaveCount(1);
  await page.keyboard.type('慢信');
  await expect(page.locator('#pw .gl[data-r="5"] .c')).toHaveCount(2);

  // 方向鍵往下一行，再打一個字；退格、Delete、Ctrl+Z 都沒用
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('A');
  for (const k of ['Backspace', 'Delete', 'Control+z']) await page.keyboard.press(k);
  await expect.poll(async () => placed(await serverSheet(page))).toEqual(['慢@5,6', '信@5,8', 'A@6,10']);

  // 畫面上：「慢」就在第 6 條橫線那一行
  const mb = (await page.locator('#pw .gl[data-r="5"] .c').first().boundingBox())!;
  expect(Math.abs(mb.y - (box.y + lh * 5))).toBeLessThan(lh / 2);
  expect(Math.abs(mb.x - (box.x + cell * 3))).toBeLessThan(cell / 2);

  // 點在已經有字的格子（「慢」）上：不疊打，打字頭跳到同一行下一個空格
  await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2);
  await page.keyboard.type('！');
  await expect.poll(async () => placed(await serverSheet(page))).toEqual(['慢@5,6', '信@5,8', 'A@6,10', '！@5,10']);
  await expect(page.locator('#pw .type-layer .c')).toHaveCount(4);

  await page.locator('#pw .paper').screenshot({ path: 'test-results/position-lined.png' });
  // 重新整理：字還在原來的位置
  await page.reload();
  await expect(page.locator('#pw .gl[data-r="5"] .c')).toHaveCount(3);
  await expect(page.locator('#pw .gl[data-r="6"] .c')).toHaveCount(1);
});

test('明信片右半邊寫不進去：打字頭移不過去、寫到中線自動換行，手寫筆畫也畫不過去', async ({ page }) => {
  await login(page, `pc-${Date.now().toString(36)}@example.com`);
  await expect(page.locator('#pw .paper')).toBeVisible();
  await page.locator('#kindSeg button[data-v="postcard"]').click();
  await expect(page.locator('#pw .paper[data-kind="postcard"]')).toBeVisible();

  const side = (await page.locator('#pw .pc-side').boundingBox())!;
  const tl = page.locator('#pw .type-layer');
  const tb = (await tl.boundingBox())!;

  // 點右半邊（地址那邊）：提醒，打字頭不過去
  await page.mouse.click(side.x + side.width / 2, side.y + side.height / 2);
  await expect(page.locator('#toast')).toContainText('右半邊');
  await page.waitForTimeout(300);
  expect((await serverSheet(page)).cursor ?? null).toBeNull();

  // 點正文區第一行最後一格，一路打下去：碰到中線就換到下一行
  await page.mouse.click(tb.x + tb.width - 3, tb.y + 5);
  await page.keyboard.type('從前慢如今也慢');
  await expect.poll(async () => placed(await serverSheet(page))).toEqual(['從@0,34', '前@1,0', '慢@1,2', '如@1,4', '今@1,6', '也@1,8', '慢@1,10']);
  const rights = await page.locator('#pw .type-layer .c').evaluateAll((es) => es.map((e) => e.getBoundingClientRect().right));
  expect(rights).toHaveLength(7);
  for (const r of rights) expect(r).toBeLessThanOrEqual(side.x + 1);

  // 方向鍵往右推到中線：推不過去（叮一聲），不會送出移動
  await page.mouse.click(tb.x + tb.width - 3, tb.y + 0.044 * (await page.locator('#pw').evaluate((e) => e.clientWidth)) * 3 + 5);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('邊');
  await expect.poll(async () => placed(await serverSheet(page)).at(-1)).toBe('邊@3,34');

  // 手寫：從左邊畫到右半邊，只留下左邊那段
  await page.locator('#modeSeg button[data-v="hand"]').click();
  await expect(page.locator('#pw .paper.hand')).toBeVisible();
  const y = tb.y + tb.height * 0.8;
  await page.mouse.move(tb.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(side.x + side.width - 10, y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await serverSheet(page)).strokes.length).toBeGreaterThan(0);
  const s = await serverSheet(page);
  for (const st of s.strokes) for (const [x] of st.pts) expect(x).toBeLessThanOrEqual(0.55);
  // 從右半邊落筆：沒有筆畫
  const n = s.strokes.length;
  await page.mouse.move(side.x + side.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(side.x + side.width / 2 + 30, y + 10, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect((await serverSheet(page)).strokes.length).toBe(n);
});
