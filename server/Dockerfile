# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    openssl \
    procps \
 && rm -rf /var/lib/apt/lists/*

# Production deps only — separate stage avoids npm prune issues with native modules (e.g. sharp)
FROM base AS deps-prod
COPY package*.json ./
# Install prod deps; verify sharp is present after install (GHA layer cache can
# occasionally serve a stale layer). Force-reinstall sharp if missing.
RUN npm ci --omit=dev && \
    node -e "require('sharp')" 2>/dev/null || \
    (echo "sharp missing after npm ci, force-installing..." && npm install --no-save sharp)

# All deps for TypeScript build + Prisma codegen
FROM base AS deps-all
COPY package*.json ./
RUN npm ci

FROM deps-all AS builder
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run prisma:generate && npm run build

FROM deps-all AS migrator
COPY prisma ./prisma
CMD ["npm", "run", "prisma:migrate"]

FROM base AS runtime
ENV NODE_ENV=production
# Build-time commit info — injected by CI so UpdateService shows correct version in k3s
ARG COMMIT_SHA=""
ARG COMMIT_DATE=""
ARG COMMIT_SUBJECT=""
ENV COMMIT_SHA=$COMMIT_SHA \
    COMMIT_DATE=$COMMIT_DATE \
    COMMIT_SUBJECT=$COMMIT_SUBJECT
# Use prod-only node_modules (clean install, no prune artifacts)
COPY --from=deps-prod /app/node_modules ./node_modules
# Overlay the Prisma generated client from builder (prisma generate output)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
