# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
WORKDIR /app

# Production deps only (clean install, no prune artifacts)
FROM base AS deps-prod
COPY package*.json ./
RUN npm ci --omit=dev

# All deps for Next.js build
FROM base AS deps-all
COPY package*.json ./
RUN npm ci

FROM deps-all AS builder
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
# Use prod-only node_modules (no npm prune — avoids native module removal)
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./next.config.mjs
CMD ["npm", "start"]
