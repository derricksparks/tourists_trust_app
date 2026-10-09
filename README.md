# tourists_trust_app

Russia–Africa tourism platform: a trust and discovery layer, concierge services and a B2B wholesale
connector between African tour operators and Russian DMCs. There is **no payment processing** in v1.

- Requirements, review and decisions: [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md)
- Data model: [`services/api/prisma/schema.prisma`](services/api/prisma/schema.prisma)

## Layout

```
apps/admin         internal admin dashboard (React + Vite)
apps/web-content   public Russian-language site, embeddable badge, Telegram Mini App (Next.js 14)
apps/portal        partner portal: tour operators (English) and Russian DMCs (Russian) (React + Vite)
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
pnpm dev:portal                              # partner portal on http://localhost:5174
```

Portal demo sign-ins (same password): `operator@example.com` (Pearl Gorilla Treks), `dmc@example.com`
(approved DMC), `dmc-pending@example.com` (DMC waiting for approval). Russian DMCs can also apply at `/signup`.
New operator logins are created on the operator's page in the dashboard, which gives a one-time
set-password link to send them.

### Telegram bot

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Put the same token in `services/api/.env` and `apps/telegram-bot/.env` as `TELEGRAM_BOT_TOKEN`
   (the API needs it to check Mini App sign-ins and to send staff replies).
3. Set `NEXT_PUBLIC_TELEGRAM_BOT` in `apps/web-content/.env.local` to the bot's username.
4. Telegram only opens Mini Apps over HTTPS, so `SITE_URL` must be a public `https://` address
   (for local testing, a tunnel such as `cloudflared` or `ngrok` in front of port 3001).
5. `pnpm dev:bot`. In BotFather, also set the bot's Mini App URL to `SITE_URL/tg`.

Demo review link (seeded, works once per seed): `http://localhost:3001/review/demo-review-link-kilima-horizon-0000000001`.

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

**Phase 2 done** — translator and guide network (sign-up and requests in the Telegram Mini App, staff
verification, public directory, offers accepted in the bot with a contact hand-off, ratings after the
job), insurer comparison page, and invite-only reviews (links from the dashboard or straight from an
answered inquiry, a one-time review form, invites-vs-reviews per operator).

**Phase 3 done** — partner portal: operators manage their tour feed (draft → publish → archive, dates,
indicative prices), answer DMC quote requests and confirm fam trips, and see their response-time and
completeness scores; Russian DMCs apply, browse vetted inventory, request net prices, list tours under
their own brand (copy-ready text, "where to buy" on the public tour page) and ask to join fam trips.
Dashboard: DMC approval, portal logins, fam-trip planner, quote overview with 48-hour alerts.

Next: Phase 4 (operator self-onboarding, API-based package feed, more countries).
