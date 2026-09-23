# Production image for apps/web.
#
# Build context is the repository root (this is a pnpm workspace, so pnpm
# needs every workspace member's package.json to resolve correctly):
#
#   docker build -f docker/app/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_REALTIME_URL=https://realtime.example.com \
#     -t ambatucode-web .
#
# Deliberately one stage, not build+runtime split: @node-rs/argon2 and sharp
# are native modules compiled during `pnpm install`, so the runtime image has
# to be the exact same base as the build step anyway — copying node_modules
# into a slimmer/different base (e.g. alpine's musl) would silently break
# those bindings. Trading image size for "it just runs" is the right call for
# a single-host deployment, not a public multi-tenant registry.
#
# apps/web's own "build"/"start" scripts wrap next with dotenv-cli to load
# ../../.env for local dev convenience. That file never exists in this image
# (see .dockerignore), so this Dockerfile calls next directly and gets its
# environment the normal container way instead: --build-arg at build time,
# --env-file/env_file at container start.

FROM node:22-bookworm-slim

# Prisma's query engine needs libssl on Debian slim images.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

WORKDIR /app

# Manifests only, so `pnpm install` is cached across builds that only touch
# application source. Every workspace member must be present even though
# this image only runs apps/web: pnpm's frozen-lockfile check validates the
# whole workspace, not just one filter.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/prisma packages/db/prisma

# packages/db's postinstall runs `prisma generate`, which fails fast if
# DATABASE_URL is unset — even though generate itself never opens a
# connection. Any parseable placeholder satisfies it; the real value is
# supplied at container start and is never read at build time (server env
# validation in src/server/env.ts is intentionally lazy for this reason).
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DATABASE_URL=${DATABASE_URL}

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/db packages/db
COPY packages/shared packages/shared

# Unlike the server env, NEXT_PUBLIC_REALTIME_URL is inlined into the client
# bundle by Next.js at build time. Setting it only at container start
# (docker run -e / env_file) has no effect on what already shipped to the
# browser — it must be supplied here, as a build arg, with the real public
# URL this deployment will use.
ARG NEXT_PUBLIC_REALTIME_URL
ENV NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL}
ENV NODE_ENV=production

RUN node apps/web/scripts/vendor-monaco.mjs
RUN pnpm --filter web exec next build

RUN chown -R node:node /app

EXPOSE 3000
USER node
CMD ["pnpm", "--filter", "web", "exec", "next", "start", "--port", "3000"]
