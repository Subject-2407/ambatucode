# Production image for apps/realtime.
#
# Build context is the repository root — see docker/app/web.Dockerfile for
# why (shared pnpm workspace) and why this bypasses dotenv-cli the same way.
#
#   docker build -f docker/app/realtime.Dockerfile -t ambatucode-realtime .
#
# apps/realtime ships no build step (it runs straight off TypeScript source
# via tsx), so there is no client-bundle env-inlining concern here the way
# there is for apps/web — every variable this image needs can be supplied
# purely at container start.

FROM node:22-bookworm-slim

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/prisma packages/db/prisma

# Same reasoning as the web image: packages/db's postinstall (prisma
# generate) only needs DATABASE_URL to be present and parseable, never a
# real database connection.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DATABASE_URL=${DATABASE_URL}

RUN pnpm install --frozen-lockfile

COPY apps/realtime apps/realtime
COPY packages/db packages/db
COPY packages/shared packages/shared

ENV NODE_ENV=production
RUN chown -R node:node /app

EXPOSE 3001
USER node
CMD ["pnpm", "--filter", "realtime", "exec", "tsx", "src/index.ts"]
