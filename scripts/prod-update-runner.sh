#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# prod-update-runner.sh  — standalone update runner
#
# Spawned by the API as a detached process. Handles the full
# update lifecycle: pull → build → restart → health check → cleanup.
# Writes progress to server/data/update-progress.json so the API
# can report status without being killed mid-update.
# ──────────────────────────────────────────────────────────────
set -Euo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
PROGRESS_FILE="$SERVER_DIR/data/update-progress.json"
BUILD_MARKER="$SERVER_DIR/data/last-built-commit.txt"
LOG_FILE="$SERVER_DIR/data/update-runner.log"

BRANCH="${1:-main}"

PM2_API_APP="${NFTTOYS_PM2_API_APP:-nfttoys-prod-api}"
PM2_WEB_APP="${NFTTOYS_PM2_WEB_APP:-nfttoys-prod-web}"
PM2_BOT_APP="${NFTTOYS_PM2_BOT_APP:-nfttoys-prod-bot}"

API_HEALTH_URL="${NFTTOYS_API_HEALTH_URL:-http://127.0.0.1:4100/health}"
WEB_HEALTH_URL="${NFTTOYS_WEB_HEALTH_URL:-http://127.0.0.1:4101}"

BACKUP_ROOT="$ROOT_DIR/.deploy-backups"
KEEP_BACKUPS=2

# ── helpers ──────────────────────────────────────────────────

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

write_marker() {
  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo '')"
  if [[ -n "$commit" ]]; then
    mkdir -p "$(dirname "$BUILD_MARKER")"
    printf '%s\n' "$commit" > "$BUILD_MARKER"
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

cleanup_docker() {
  log "Pruning unused Docker images"
  docker image prune -af --filter "until=24h" 2>/dev/null || true
  docker builder prune -af --filter "until=24h" 2>/dev/null || true
}

cleanup_backups() {
  if [[ -d "$BACKUP_ROOT" ]]; then
    local count
    count="$(ls -1d "$BACKUP_ROOT"/* 2>/dev/null | wc -l)"
    if (( count > KEEP_BACKUPS )); then
      log "Removing old backups (keeping last $KEEP_BACKUPS)"
      ls -1dt "$BACKUP_ROOT"/* 2>/dev/null | tail -n "+$((KEEP_BACKUPS + 1))" | xargs -r rm -rf
    fi
  fi
}

cleanup_npm() {
  log "Cleaning npm cache"
  npm cache clean --force 2>/dev/null || true
}

cleanup_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    local size
    size="$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)"
    if (( size > 5242880 )); then
      tail -c 1048576 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
      log "Truncated old log entries"
    fi
  fi
}

# ── main ─────────────────────────────────────────────────────

main() {
  log "=== Update started (branch: $BRANCH) ==="
  write_progress "pulling"

  # 1. Pull latest code
  log "Pulling from origin/$BRANCH"
  if ! git -C "$ROOT_DIR" pull --ff-only origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
    log "ERROR: git pull failed"
    write_progress "failed" '"error":"git pull failed"'
    exit 1
  fi

  # 2. Build via Docker
  write_progress "building"
  log "Running Docker build pipeline"

  local docker_script="$ROOT_DIR/scripts/prod-update-docker.sh"
  if [[ ! -x "$docker_script" ]]; then
    chmod +x "$docker_script" 2>/dev/null || true
  fi

  if ! bash "$docker_script" >> "$LOG_FILE" 2>&1; then
    log "ERROR: Docker build failed"
    write_progress "failed" '"error":"Docker build pipeline failed"'
    exit 1
  fi

  # 3. Restart PM2 apps
  write_progress "restarting"
  log "Restarting PM2 services"

  pm2 restart "$PM2_API_APP" >> "$LOG_FILE" 2>&1 || true
  pm2 restart "$PM2_WEB_APP" >> "$LOG_FILE" 2>&1 || true
  pm2 restart "$PM2_BOT_APP" >> "$LOG_FILE" 2>&1 || true
  pm2 save >> "$LOG_FILE" 2>&1 || true

  # 4. Health checks
  write_progress "health_check"
  log "Running health checks"

  local health_ok=true
  if ! wait_for_health "$API_HEALTH_URL"; then
    log "WARNING: API health check failed"
    health_ok=false
  fi
  if ! wait_for_health "$WEB_HEALTH_URL"; then
    log "WARNING: Web health check failed"
    health_ok=false
  fi

  if [[ "$health_ok" == "false" ]]; then
    log "Health checks failed — services may need manual attention"
    write_progress "failed" '"error":"Health checks failed after restart"'
    exit 1
  fi

  # 5. Write build marker (success)
  write_marker
  log "Build marker written"

  # 6. Cleanup
  write_progress "cleaning"
  cleanup_docker
  cleanup_backups
  cleanup_npm
  cleanup_logs

  # 7. Done
  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  write_progress "done" "\"commit\":\"$commit\""
  log "=== Update completed successfully (commit: $commit) ==="
}

main "$@"
