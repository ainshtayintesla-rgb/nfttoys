#!/usr/bin/env bash
# One-time migration: Docker Compose prod → k3s
# Safe to run multiple times (idempotent).
# Run from the server after first successful GitHub Actions deploy.
set -euo pipefail

NS="nfttoys-prod"
COMPOSE_FILE="/root/my-works/nfttoys-pro/docker-compose.yml"
COMPOSE_PROJECT="nfttoys-prod"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "=== Step 1: Stop Docker prod api and web (nginx still serves from Docker during build) ==="
docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" stop api web || true

log "=== Step 2: Stop Docker prod postgres (k3s postgres will take over same data dir) ==="
docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" stop postgres || true

log "=== Step 3: Scale up k3s postgres and wait ==="
kubectl scale statefulset postgres --replicas=1 -n $NS
kubectl rollout status statefulset/postgres -n $NS --timeout=2m

log "=== Step 4: Scale up k3s bot ==="
kubectl scale deployment bot --replicas=1 -n $NS

log "=== Step 5: Check k3s api and web are running ==="
kubectl rollout status deployment/api -n $NS --timeout=5m
kubectl rollout status deployment/web -n $NS --timeout=5m

log "=== Step 6: Update nginx to point to k3s NodePorts ==="
# Atomically swap api.nfttoys.shop proxy from 4100 → 30100
sed -i 's|proxy_pass http://127.0.0.1:4100;|proxy_pass http://127.0.0.1:30100;|g' /etc/nginx/sites-enabled/api.nfttoys.shop
# Atomically swap nfttoys.shop proxy from 4101 → 30101
sed -i 's|proxy_pass http://127.0.0.1:4101;|proxy_pass http://127.0.0.1:30101;|g' /etc/nginx/sites-enabled/nfttoys.shop

nginx -t && nginx -s reload
log "nginx reloaded → now serving from k3s"

log "=== Step 7: Stop remaining Docker prod containers ==="
docker compose -f "$COMPOSE_FILE" --project-name "$COMPOSE_PROJECT" stop bot || true

log "=== Migration complete! ==="
log "  nfttoys.shop     → k3s web pod  (NodePort 30101)"
log "  api.nfttoys.shop → k3s api pod  (NodePort 30100)"
log "  Postgres data:     same hostPath, no data loss"
