# NFT Toys - Docker Compose

## Quick start

```bash
cd /root/my-works/nfttoys-pro
docker compose up -d --build
```

Services:
- `web` -> `http://127.0.0.1:4101`
- `api` -> `http://127.0.0.1:4100`
- `bot` -> internal `bot:8090`
- `postgres` -> internal `postgres:5432`

## Common commands

```bash
# status
docker compose ps

# logs
docker compose logs -f --tail=200 api web bot postgres

# restart stack
docker compose up -d --remove-orphans

# stop stack
docker compose down

# full rebuild
docker compose build --no-cache api web bot
docker compose up -d
```

## Environment

Compose reads runtime env from:
- `server/.env`
- `client/.env`
- `bot/.env`

Compose-level defaults:
- Postgres DB/user/pass default to `nfttoys`
- `DOCKER_DATABASE_URL` can override API database URL

Example override before launch:

```bash
export DOCKER_DATABASE_URL='postgresql://user:pass@postgres:5432/nfttoys?schema=public'
docker compose up -d
```

## Production update runner

For server-side update flow (`admin -> updates`), runner script is:

```bash
scripts/prod-update-runner.sh
```

It now uses Docker Compose (pull/build/migrate/up/health).
