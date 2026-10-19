# syntax=docker/dockerfile:1

# --- deps -------------------------------------------------------------------
# Installed in a separate stage so the runtime image carries no build tooling.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# --- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Drop privileges: the previous image ran as root.
RUN groupadd --system --gid 1001 uptimepulse \
  && useradd --system --uid 1001 --gid uptimepulse --no-create-home uptimepulse

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY patches ./patches
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate \
  && CI=1 pnpm install --frozen-lockfile --prod \
  && pnpm store prune \
  && rm -rf /root/.cache /root/.local/share/pnpm

COPY --from=build --chown=uptimepulse:uptimepulse /app/dist ./dist

USER uptimepulse
EXPOSE 3000

# The app already exposes GET /api/health; wire it to the orchestrator.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
