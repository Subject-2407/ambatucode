#!/usr/bin/env bash
# Redeploys Ambatucode from a checkout on the target Ubuntu host.
#
#   ./deploy/deploy.sh
#
# Assumes: Docker Engine and Go 1.26+ are already installed on this host
# (Node/pnpm are not — web and realtime install their own dependencies
# inside their Dockerfiles, self-contained); deploy/.env.production is
# filled in; the systemd units in deploy/systemd have been installed once
# (copied to /etc/systemd/system, `systemctl daemon-reload`, `systemctl
# enable`); the sandbox images have been built at least once. This script
# does not run the initial seed (prisma/seed.ts) — that is a one-time,
# deliberate step, not something a redeploy should repeat.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="deploy/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy deploy/.env.production.example and fill it in first." >&2
  exit 1
fi

echo "==> building worker binary"
(cd apps/worker && go build -o bin/worker ./cmd/worker)

echo "==> building web/realtime images"
docker compose -f docker/compose/prod.yml --env-file "$ENV_FILE" build

echo "==> starting postgres/redis and waiting for health"
docker compose -f docker/compose/prod.yml --env-file "$ENV_FILE" up -d postgres redis

echo "==> applying database migrations"
docker compose -f docker/compose/prod.yml --env-file "$ENV_FILE" run --rm web \
  pnpm --filter @ambatucode/db exec prisma migrate deploy

echo "==> starting web/realtime"
docker compose -f docker/compose/prod.yml --env-file "$ENV_FILE" up -d web realtime

echo "==> restarting worker"
sudo systemctl restart ambatucode-worker

echo "==> done"
docker compose -f docker/compose/prod.yml --env-file "$ENV_FILE" ps
sudo systemctl status ambatucode-worker --no-pager
