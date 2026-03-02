#!/usr/bin/env bash
set -euo pipefail
cd /root/my-works/nfttoys-dev
exec docker compose -f docker-compose.dev.yml "$@"
