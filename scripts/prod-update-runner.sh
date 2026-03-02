#!/usr/bin/env bash
# Production update runner for Docker Compose deployment.
set -Euo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
PROGRESS_FILE="$SERVER_DIR/data/update-progress.json"
BUILD_MARKER="$SERVER_DIR/data/last-built-commit.txt"
LOG_FILE="$SERVER_DIR/data/update-runner.log"

BRANCH="${1:-main}"
COMPOSE_FILE="${NFTTOYS_COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nfttoys-prod}"
API_HEALTH_URL="${NFTTOYS_API_HEALTH_URL:-http://127.0.0.1:4100/health}"
WEB_HEALTH_URL="${NFTTOYS_WEB_HEALTH_URL:-http://127.0.0.1:4101}"

compose() {
  docker compose --project-name "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  printf '[%s] %s\n' "$ts" "$*" | tee -a "$LOG_FILE"
}

write_progress() {
  local phase="$1"
  local extra="${2:-}"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  mkdir -p "$(dirname "$PROGRESS_FILE")"

  if [[ -n "$extra" ]]; then
    printf '{"phase":"%s","updatedAt":"%s",%s}\n' "$phase" "$now" "$extra" > "$PROGRESS_FILE"
  else
    printf '{"phase":"%s","updatedAt":"%s"}\n' "$phase" "$now" > "$PROGRESS_FILE"
  fi
}

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

write_marker() {
  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [[ -n "$commit" ]]; then
    mkdir -p "$(dirname "$BUILD_MARKER")"
    printf '%s\n' "$commit" > "$BUILD_MARKER"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

main() {
  require_cmd git
  require_cmd docker
  require_cmd curl

  log "=== Compose update started (branch: $BRANCH) ==="
  write_progress "pulling"

  if ! git -C "$ROOT_DIR" pull --ff-only origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
    log "ERROR: git pull failed"
    write_progress "failed" '"error":"git pull failed"'
    exit 1
  fi

  write_progress "building"
  log "Building service images"
  if ! compose build --pull api web bot >> "$LOG_FILE" 2>&1; then
    log "ERROR: docker compose build failed"
    write_progress "failed" '"error":"docker compose build failed"'
    exit 1
  fi

  log "Starting database for migrations"
  if ! compose up -d postgres >> "$LOG_FILE" 2>&1; then
    log "ERROR: failed to start postgres"
    write_progress "failed" '"error":"failed to start postgres"'
    exit 1
  fi

  log "Running Prisma migrations"
  if ! compose run --rm --no-deps api npm run prisma:migrate >> "$LOG_FILE" 2>&1; then
    log "ERROR: Prisma migration failed"
    write_progress "failed" '"error":"Prisma migration failed"'
    exit 1
  fi

  write_progress "restarting"
  log "Applying compose deployment"
  if ! compose up -d --remove-orphans postgres bot api web >> "$LOG_FILE" 2>&1; then
    log "ERROR: docker compose up failed"
    write_progress "failed" '"error":"docker compose up failed"'
    exit 1
  fi

  write_progress "health_check"
  log "Running health checks"

  local health_ok=true
  if ! wait_for_health "$API_HEALTH_URL"; then
    log "WARNING: API health check failed"
    health_ok=false
  fi
  if ! wait_for_health "$WEB_HEALTH_URL"; then
    log "WARNING: WEB health check failed"
    health_ok=false
  fi

  if [[ "$health_ok" == "false" ]]; then
    write_progress "failed" '"error":"Health checks failed after compose up"'
    exit 1
  fi

  write_progress "cleaning"
  log "Pruning unused images"
  docker image prune -af --filter "until=24h" >> "$LOG_FILE" 2>&1 || true

  write_marker

  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  write_progress "done" "\"commit\":\"$commit\""
  log "=== Compose update completed successfully (commit: $commit) ==="
}

main "$@"
