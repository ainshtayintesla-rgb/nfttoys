#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"
BACKUP_ROOT="$ROOT_DIR/.deploy-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

SERVER_IMAGE="${NFTTOYS_SERVER_IMAGE:-nfttoys-prod-server:local}"
SERVER_MIGRATOR_IMAGE="${NFTTOYS_SERVER_MIGRATOR_IMAGE:-nfttoys-prod-server-migrator:local}"
CLIENT_IMAGE="${NFTTOYS_CLIENT_IMAGE:-nfttoys-prod-client:local}"

PM2_API_APP="${NFTTOYS_PM2_API_APP:-nfttoys-prod-api}"
PM2_WEB_APP="${NFTTOYS_PM2_WEB_APP:-nfttoys-prod-web}"
PM2_BOT_APP="${NFTTOYS_PM2_BOT_APP:-nfttoys-prod-bot}"

API_HEALTH_URL="${NFTTOYS_API_HEALTH_URL:-http://127.0.0.1:4100/health}"
WEB_HEALTH_URL="${NFTTOYS_WEB_HEALTH_URL:-http://127.0.0.1:4101}"

server_cid=""
client_cid=""

log() {
  printf '[docker-update] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

backup_path() {
  local src="$1"
  local dst="$2"
  if [[ -e "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  fi
}

restore_path() {
  local src="$1"
  local dst="$2"
  if [[ -e "$src" ]]; then
    rm -rf "$dst"
    cp -a "$src" "$dst"
  fi
}

cleanup() {
  if [[ -n "$server_cid" ]]; then
    docker rm -f "$server_cid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$client_cid" ]]; then
    docker rm -f "$client_cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_health() {
  local url="$1"
  local retries="${NFTTOYS_HEALTH_RETRIES:-60}"
  local delay="${NFTTOYS_HEALTH_DELAY_SEC:-2}"

  for ((i=1; i<=retries; i+=1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

rollback() {
  log "Health check failed. Rolling back previous artifacts"

  restore_path "$BACKUP_DIR/server/dist" "$SERVER_DIR/dist"
  restore_path "$BACKUP_DIR/server/node_modules" "$SERVER_DIR/node_modules"
  restore_path "$BACKUP_DIR/client/.next" "$CLIENT_DIR/.next"
  restore_path "$BACKUP_DIR/client/node_modules" "$CLIENT_DIR/node_modules"

  pm2 restart "$PM2_API_APP" || true
  pm2 restart "$PM2_WEB_APP" || true
  pm2 restart "$PM2_BOT_APP" || true
  pm2 save || true
}

main() {
  require_cmd docker
  require_cmd pm2
  require_cmd curl

  docker info >/dev/null

  mkdir -p "$BACKUP_DIR/server" "$BACKUP_DIR/client"
  backup_path "$SERVER_DIR/dist" "$BACKUP_DIR/server/dist"
  backup_path "$SERVER_DIR/node_modules" "$BACKUP_DIR/server/node_modules"
  backup_path "$CLIENT_DIR/.next" "$BACKUP_DIR/client/.next"
  backup_path "$CLIENT_DIR/node_modules" "$BACKUP_DIR/client/node_modules"

  log "Building server runtime image"
  docker build --pull -f "$SERVER_DIR/Dockerfile" --target runtime -t "$SERVER_IMAGE" "$SERVER_DIR"

  log "Building server migrator image"
  docker build --pull -f "$SERVER_DIR/Dockerfile" --target migrator -t "$SERVER_MIGRATOR_IMAGE" "$SERVER_DIR"

  log "Running Prisma migrations in Docker"
  docker run --rm --network host --env-file "$SERVER_DIR/.env" "$SERVER_MIGRATOR_IMAGE" npm run prisma:migrate

  log "Building client runtime image"
  docker build --pull -f "$CLIENT_DIR/Dockerfile" --target runtime -t "$CLIENT_IMAGE" "$CLIENT_DIR"

  log "Extracting server artifacts"
  server_cid="$(docker create "$SERVER_IMAGE")"
  rm -rf "$SERVER_DIR/dist" "$SERVER_DIR/node_modules"
  docker cp "$server_cid:/app/dist" "$SERVER_DIR/dist"
  docker cp "$server_cid:/app/node_modules" "$SERVER_DIR/node_modules"
  docker rm -f "$server_cid" >/dev/null
  server_cid=""

  log "Extracting client artifacts"
  client_cid="$(docker create "$CLIENT_IMAGE")"
  rm -rf "$CLIENT_DIR/.next" "$CLIENT_DIR/node_modules"
  docker cp "$client_cid:/app/.next" "$CLIENT_DIR/.next"
  docker cp "$client_cid:/app/node_modules" "$CLIENT_DIR/node_modules"
  docker rm -f "$client_cid" >/dev/null
  client_cid=""

  log "Restarting PM2 services"
  pm2 restart "$PM2_API_APP"
  pm2 restart "$PM2_WEB_APP"
  pm2 restart "$PM2_BOT_APP" || true
  pm2 save || true

  log "Running health checks"
  if ! wait_for_health "$API_HEALTH_URL" || ! wait_for_health "$WEB_HEALTH_URL"; then
    rollback
    exit 1
  fi

  log "Health checks passed"

  if [[ -d "$BACKUP_ROOT" ]]; then
    ls -1dt "$BACKUP_ROOT"/* 2>/dev/null | tail -n +4 | xargs -r rm -rf
  fi
}

main "$@"
