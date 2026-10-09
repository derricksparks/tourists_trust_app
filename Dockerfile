# One build for the whole platform (see docs/DEPLOY.md):
#   target "app"   — API, public site and Telegram bot (same image, different commands)
#   target "proxy" — Caddy with HTTPS, serving the admin dashboard and partner portal
FROM node:22.22.2-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# The dashboards are static files, so the public site's address is baked in when they are built.
ARG SITE_URL
RUN test -n "$SITE_URL" || (echo "Build argument SITE_URL is required" && exit 1)
RUN pnpm --filter @ttp/shared-types build \
 && pnpm --filter @ttp/api build \
 && pnpm --filter @ttp/telegram-bot build \
 && pnpm --filter @ttp/web-content build \
 && VITE_PUBLIC_SITE_URL=$SITE_URL pnpm --filter @ttp/admin build \
 && VITE_PUBLIC_SITE_URL=$SITE_URL pnpm --filter @ttp/portal build

FROM base AS app
ENV NODE_ENV=production
# The site writes its page cache under apps/web-content/.next, so the app user owns the files.
COPY --from=build --chown=node:node /app /app
# Mount point for uploaded documents; a new Docker volume takes this ownership.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node

FROM caddy:2.10.2-alpine AS proxy
COPY --from=build /app/apps/admin/dist /srv/admin
COPY --from=build /app/apps/portal/dist /srv/portal
COPY infra/production/Caddyfile /etc/caddy/Caddyfile
