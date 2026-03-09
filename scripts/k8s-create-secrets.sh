#!/usr/bin/env bash
# Creates the nfttoys-secrets Kubernetes Secret from the production .env files.
# Overrides DATABASE_URL to use the k3s postgres service hostname.
# Usage: bash scripts/k8s-create-secrets.sh [repo-path]
set -euo pipefail

REPO="${1:-/root/my-works/nfttoys-pro}"
NS="nfttoys-prod"

[[ ! -f "$REPO/server/.env" ]] && echo "ERROR: $REPO/server/.env not found" && exit 1

echo "Reading secrets from $REPO/{server,client,bot}/.env"

declare -A kv
declare -a order

parse_env() {
  local file="$1"
  [[ ! -f "$file" ]] && return
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    if [[ -z "${kv[$key]+_}" ]]; then
      kv[$key]="$val"
      order+=("$key")
    fi
  done < "$file"
}

parse_env "$REPO/server/.env"
parse_env "$REPO/client/.env"
parse_env "$REPO/bot/.env"

# Override DATABASE_URL to use k3s postgres service hostname instead of 127.0.0.1
PG_USER="${kv[POSTGRES_USER]:-nfttoys}"
PG_PASS="${kv[POSTGRES_PASSWORD]:-nfttoys}"
PG_DB="${kv[POSTGRES_DB]:-nfttoys}"
kv[DATABASE_URL]="postgresql://${PG_USER}:${PG_PASS}@postgres.nfttoys-prod.svc.cluster.local:5432/${PG_DB}?schema=public"
kv[DOCKER_DATABASE_URL]="postgresql://${PG_USER}:${PG_PASS}@postgres.nfttoys-prod.svc.cluster.local:5432/${PG_DB}?schema=public"

# Build --from-literal args
args=()
for key in "${order[@]}"; do
  args+=("--from-literal=${key}=${kv[$key]}")
done
# Add overrides if not already in order
for extra in DATABASE_URL DOCKER_DATABASE_URL; do
  found=false
  for k in "${order[@]}"; do [[ "$k" == "$extra" ]] && found=true && break; done
  $found || args+=("--from-literal=${extra}=${kv[$extra]}")
done

kubectl delete secret nfttoys-secrets -n "$NS" --ignore-not-found
kubectl create secret generic nfttoys-secrets -n "$NS" "${args[@]}"

echo "✓ Secret nfttoys-secrets created in namespace $NS (${#args[@]} keys)"
echo "  DATABASE_URL → postgres.nfttoys-prod.svc.cluster.local"
