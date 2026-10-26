# Один образ на всё приложение: веб (Next.js), воркер и миграции.
# Какой процесс запускать, решает docker-compose.prod.yml.
#
# Сборка: docker compose -f docker-compose.prod.yml --env-file .env.production build

FROM node:22-bookworm-slim

# openssl нужен движку Prisma, ca-certificates — запросам к Meta и Gemini.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9.12.0 \
 && npm cache clean --force

ENV NEXT_TELEMETRY_DISABLED=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    npm_config_update_notifier=false

WORKDIR /app

# Сначала только манифесты: пока зависимости не менялись, Docker берёт
# слой с node_modules из кэша, и пересборка после правки кода идёт быстро.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/whatsapp/package.json packages/whatsapp/
RUN pnpm install --frozen-lockfile

COPY . .

RUN cd packages/db && node_modules/.bin/prisma generate

# Сборка Next. Ограничение памяти — чтобы на маленьком сервере сборка
# опиралась на swap, а не падала по нехватке памяти.
RUN cd apps/web && NODE_OPTIONS=--max-old-space-size=1536 node_modules/.bin/next build

ENV NODE_ENV=production

# Next пишет кэш в .next/cache — только эта папка нужна на запись.
RUN chown -R node:node /app/apps/web/.next
USER node

EXPOSE 3000
