import { defineConfig } from '@playwright/test';

/**
 * 端到端測試：寫信 → 郵局 → 寄出 → 快轉 → 收信開信。
 * 會自己起前後端（後端用 PGlite 記憶體資料庫，每次啟動都是乾淨的範例資料）。
 * 已經有開著的 dev server 就直接用（reuseExistingServer）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 1200 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:api:pglite',
      cwd: '../..',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:web',
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
