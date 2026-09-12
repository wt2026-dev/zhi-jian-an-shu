# ============================================================
# 工业设备智能检修与作业协同系统 - 生产级多阶段构建
# 主服务：Node.js (Express + React + PGlite)
# 说明：esbuild 打包 server.ts 时 --packages=external，
#       因此运行时镜像需安装生产依赖；同时需保留 src/db/migrations
#       （迁移 SQL 在运行时通过 fs 读取）与 dist/ 前端产物。
# ============================================================

# ---------- 阶段 1：构建 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 先复制依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并构建（vite 前端 + esbuild 后端单文件）
COPY . .
RUN npm run build

# ---------- 阶段 2：运行 ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# 仅安装生产依赖（--omit=dev）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 安装 FFmpeg（多段视频拼接用）
RUN apk add --no-cache ffmpeg

# 运行时需要的产物：前端静态 + 后端 bundle + 迁移 SQL + 上传目录骨架
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public

# PGlite 数据库与上传图片持久化卷
VOLUME ["/app/data", "/app/public/uploads"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
