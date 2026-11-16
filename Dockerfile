# 慢信正式版映像檔：一個映像檔，兩種用法
#   API（含前端網頁）：node dist/server.mjs   ← 預設
#   排程 worker：       node dist/worker.mjs
#   資料庫遷移：         node dist/migrate.mjs  ← Kubernetes 的 initContainer 用
#
# 建置：docker build -t manxin:<版本> .

# ---------- 建置 ----------
FROM node:24-bookworm-slim AS build
WORKDIR /src
# 先只複製 package.json，依賴沒變時可以用快取
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @manxin/web && npm run build -w @manxin/api

# ---------- 執行 ----------
# API、worker、遷移都已打包成單一檔案，執行時不需要 node_modules
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    MIGRATIONS_DIR=/app/drizzle \
    WEB_DIR=/app/web \
    TZ=Asia/Taipei
WORKDIR /app
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/api/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./web
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
