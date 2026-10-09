# tourists_trust_app

Russia–Africa tourism platform: a trust and discovery layer, concierge services and a B2B wholesale
connector between African tour operators and Russian DMCs. There is **no payment processing** in v1.

- Requirements, review and decisions: [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md)
- Data model: [`services/api/prisma/schema.prisma`](services/api/prisma/schema.prisma)

## Layout

```
apps/admin         internal admin dashboard (React + Vite)
apps/web-content   public Russian-language site, embeddable badge, Telegram Mini App (Next.js 14)
apps/telegram-bot  Telegram bot (official Bot API, long polling)
services/api       core NestJS API + PostgreSQL schema/migrations (Prisma)
packages/shared-types  enums and request schemas shared by every app
infra/             local Postgres (docker compose); deployment config later
```

## Local setup

Requires Node 22+, pnpm 10 and PostgreSQL 16 (or Docker).

```bash
pnpm install
pnpm db:up                                   # or point DATABASE_URL at your own Postgres
cp services/api/.env.example services/api/.env
pnpm --filter @ttp/shared-types build
pnpm db:migrate                              # apply migrations
pnpm db:seed                                 # fictional demo data (wipes the dev database)
pnpm dev:api                                 # API on http://localhost:3000/health
pnpm dev:admin                               # dashboard on http://localhost:5173
cp apps/web-content/.env.example apps/web-content/.env.local
pnpm dev:web                                 # public site on http://localhost:3001
```

### Telegram bot

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Put the same token in `services/api/.env` and `apps/telegram-bot/.env` as `TELEGRAM_BOT_TOKEN`
   (the API needs it to check Mini App sign-ins and to send staff replies).
3. Set `NEXT_PUBLIC_TELEGRAM_BOT` in `apps/web-content/.env.local` to the bot's username.
4. Telegram only opens Mini Apps over HTTPS, so `SITE_URL` must be a public `https://` address
   (for local testing, a tunnel such as `cloudflared` or `ngrok` in front of port 3001).
5. `pnpm dev:bot`. In BotFather, also set the bot's Mini App URL to `SITE_URL/tg`.

### Verification badge

Each operator's page in the dashboard has its embed code. Operators paste it into their own site:

```html
<script async src="https://SITE/badge.js" data-ttp-badge="BADGE_TOKEN"></script>
```

It shows "Verified" while the operator is approved and "Verification revoked" if suspended, and links
to their verification page. Without scripts: `<iframe src="https://SITE/badge/BADGE_TOKEN" width="340" height="64" style="border:0"></iframe>`.

Demo sign-ins (password = `SEED_ADMIN_PASSWORD`, default `change-me`): `admin@example.com` (super admin),
`moderator@example.com` (moderator), `editor@example.com` (content editor: can view, can't decide).

Tests use a separate database (`TEST_DATABASE_URL`, default `postgresql://ttp:ttp@localhost:5432/ttp_test`):

```bash
pnpm test        # API tests (Postgres), dashboard, site and bot unit tests
pnpm e2e         # browser tests for the dashboard and the public site (badge, Mini App);
                 # needs the API running and re-seeds its database; build the site first
```

If Playwright's own browser isn't installed, point it at another Chromium with `PW_CHROMIUM_PATH`.

## Status

**Phase 0 done** — schema, migrations, seed data, and the admin dashboard: sign-in, dashboard numbers,
operator approval queue, manual operator entry and editing, and review moderation.

**Phase 1 done** — public Russian site (operator verification pages, visa guides with document
checklists, travel guides, sitemap), the embeddable verification badge, the Telegram bot and Mini App
("request info"), and admin screens for the inquiry inbox (reply to travellers through the bot) and
for editing visa and travel guides. Seed data has 12 approved demo operators.

Next: Phase 2 (translator network, insurer comparison, review invites and submission).
