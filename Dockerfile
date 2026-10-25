# syntax=docker/dockerfile:1
# One image for both roles:
#   web    -> CMD ["node", "server.js"]        (default; runs migrations first)
#   worker -> CMD ["node", "dist/worker.mjs"]
# No secrets and no NEXT_PUBLIC_* values are needed at build time.

FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies (postinstall runs `prisma generate`) ----------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# --- build ------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .
RUN npm run build && npm run build:worker

# --- migration tooling, isolated from the standalone node_modules -----------
FROM base AS migrate
WORKDIR /migrate
COPY package-lock.json /tmp/package-lock.json
RUN PRISMA_VERSION=$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version") \
 && DOTENV_VERSION=$(node -p "require('/tmp/package-lock.json').packages['node_modules/dotenv'].version") \
 && npm init -y > /dev/null \
 && npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}" "dotenv@${DOTENV_VERSION}"
COPY prisma.config.ts ./
COPY prisma ./prisma

# --- runtime ----------------------------------------------------------------
FROM base AS runner
WORKDIR /app
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
# Versioned LLM prompts, read by the worker at runtime (src/llm/prompts.ts).
COPY --from=builder --chown=nextjs:nodejs /app/src/llm/prompts ./src/llm/prompts
COPY --from=migrate --chown=nextjs:nodejs /migrate ./migrate
COPY --chmod=755 docker-entrypoint.sh docker-healthcheck.sh /usr/local/bin/

# The whole .next tree must stay writable for the runtime user (ISR rewrites
# files under .next/server, not only .next/cache).
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["docker-healthcheck.sh"]

# tini reaps the zombie processes left behind by outbound HTTP on Alpine.
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "server.js"]
