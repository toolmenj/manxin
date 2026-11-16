/**
 * 正式環境建置：把 API、worker、遷移各打包成一個檔案（dist/*.mjs），容器裡只要 node，不需要 tsx（review M16）。
 * 遷移檔（drizzle/*.sql）另外複製到映像檔，用 MIGRATIONS_DIR 指定位置。
 */
import { build } from 'esbuild';

await build({
  entryPoints: {
    server: 'src/server.ts',
    worker: 'src/worker-main.ts',
    migrate: 'src/db/migrate-cli.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // PGlite 只在開發用：連同 drizzle 的 PGlite 驅動一起排除（驅動一載入就會 import PGlite，
  // 包進來的話容器一啟動就找不到套件；2026-11-12 用 docker-compose.prod.yml 實際跑起來才抓到）。
  // pg-native 是 pg 的選配原生模組。
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/*', 'pg-native'],
  // 打包進 ESM 的 CommonJS 套件需要 require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
