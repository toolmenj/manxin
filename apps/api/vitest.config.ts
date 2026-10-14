import { defineConfig } from 'vitest/config';

// 預設用 PGlite（不需要 Docker）。設定 TEST_DATABASE_URL 就改用真的 PostgreSQL（會清空資料表，檔案依序執行）。
const realPg = !!process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup-tz.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: !realPg,
  },
});
