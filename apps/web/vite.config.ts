import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 開發伺服器開在 5173（.env.example 的 APP_URL 指向這裡）。
 * 後端路徑（/letters、/r/:token、/track/:no…）和前端網址有重疊，
 * 所以前端一律呼叫 /api/...，由 proxy 去掉 /api 再轉給 http://127.0.0.1:3000。
 */
const API_TARGET = process.env.MANXIN_API ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: API_TARGET, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
