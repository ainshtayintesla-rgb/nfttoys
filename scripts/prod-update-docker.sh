#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# prod-update-docker.sh  — Docker build + artifact extraction
#
# This script ONLY handles Docker image building and artifact
# extraction. PM2 restart, health checks, and cleanup are
# handled by prod-update-runner.sh.
# ──────────────────────────────────────────────────────────────
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

cleanup() {
  if [[ -n "$server_cid" ]]; then
    docker rm -f "$server_cid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$client_cid" ]]; then
    docker rm -f "$client_cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

main() {
  require_cmd docker

  docker info >/dev/null

  # Backup current artifacts
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

  log "Build and extraction complete"
}

main "$@"

