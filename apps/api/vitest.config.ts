import { defineConfig } from 'vitest/config';

// 預設用 PGlite（不需要 Docker）。設定 TEST_DATABASE_URL 就改用真的 PostgreSQL（每個測試 App 建自己的暫時資料庫，用完刪掉）。
const realPg = !!process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup-tz.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // 每個 App 有自己的資料庫，可以平行；但同時建太多資料庫會很慢，真 PG 時限制一點
    maxWorkers: realPg ? 4 : undefined,
  },
});
