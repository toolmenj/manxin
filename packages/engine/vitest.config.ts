import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 故意讓測試程序跑在 UTC（伺服器常見設定），確認引擎不依賴伺服器時區
    setupFiles: ['./test/setup-tz.ts'],
  },
});
