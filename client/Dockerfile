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
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_BOT_USERNAME
ARG NEXT_PUBLIC_ADMIN_IDS
ARG NEXT_PUBLIC_TG_GROUP
ARG NEXT_PUBLIC_TG_CHANNEL
ARG NEXT_PUBLIC_WALLET_NETWORK
ARG NEXT_PUBLIC_WALLET_V2_NETWORK
ARG TOKEN_SECRET
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL     NEXT_PUBLIC_BOT_USERNAME=$NEXT_PUBLIC_BOT_USERNAME     NEXT_PUBLIC_ADMIN_IDS=$NEXT_PUBLIC_ADMIN_IDS     NEXT_PUBLIC_TG_GROUP=$NEXT_PUBLIC_TG_GROUP     NEXT_PUBLIC_TG_CHANNEL=$NEXT_PUBLIC_TG_CHANNEL     NEXT_PUBLIC_WALLET_NETWORK=$NEXT_PUBLIC_WALLET_NETWORK     NEXT_PUBLIC_WALLET_V2_NETWORK=$NEXT_PUBLIC_WALLET_V2_NETWORK     TOKEN_SECRET=$TOKEN_SECRET
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
