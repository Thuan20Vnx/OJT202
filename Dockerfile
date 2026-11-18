# TaskFlow API + giao diện web trong một image (cùng origin: /api, /socket.io và SPA).
# Build:  docker build --build-arg RELEASE_SHA=$(git rev-parse HEAD) -t taskflow:<sha> .
# Chạy:   docker run -p 4000:4000 --env-file BackEnd/.env taskflow:<sha>
# Image KHÔNG chứa .env, .data hay khóa bí mật; mọi cấu hình đọc từ biến môi trường lúc chạy.

# ---------- 1. Build giao diện ----------
FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY shared ./shared
COPY FrontEnd/package.json FrontEnd/package-lock.json ./FrontEnd/
RUN npm --prefix FrontEnd ci
COPY FrontEnd ./FrontEnd
RUN npm --prefix FrontEnd run build

# ---------- 2. Thư viện API (chỉ production) ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# Prisma cần OpenSSL để chọn đúng query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY BackEnd/package.json BackEnd/package-lock.json ./BackEnd/
COPY BackEnd/prisma ./BackEnd/prisma
# Không cài PostgreSQL nhúng: container luôn dùng DATABASE_URL.
RUN npm --prefix BackEnd ci --omit=dev --omit=optional

# ---------- 3. Image chạy ----------
FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000 SEED_DEMO=false
COPY --from=deps /app/BackEnd/node_modules ./BackEnd/node_modules
COPY shared ./shared
COPY BackEnd/package.json ./BackEnd/
COPY BackEnd/prisma ./BackEnd/prisma
COPY BackEnd/src ./BackEnd/src
COPY BackEnd/scripts ./BackEnd/scripts
COPY --from=web /app/FrontEnd/dist ./FrontEnd/dist
# Mã commit để /api/health báo đúng bản đang chạy (dùng khi smoke và khi rollback).
ARG RELEASE_SHA=""
ARG RELEASE_SOURCE_HASH=""
ENV RELEASE_SHA=$RELEASE_SHA RELEASE_SOURCE_HASH=$RELEASE_SOURCE_HASH
RUN mkdir -p /app/BackEnd/.data/uploads && chown -R node:node /app/BackEnd/.data
USER node
EXPOSE 4000
# Readiness: chỉ khỏe khi truy vấn được database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Khi khởi động, server tự `prisma migrate deploy` trước khi nhận request.
CMD ["node", "BackEnd/src/index.ts"]
