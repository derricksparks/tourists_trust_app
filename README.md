# tourists_trust_app

Russia–Africa tourism platform: a trust and discovery layer, concierge services and a B2B wholesale
connector between African tour operators and Russian DMCs. There is **no payment processing** in v1.

- Requirements, review and decisions: [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md)
- Data model: [`services/api/prisma/schema.prisma`](services/api/prisma/schema.prisma)

## Layout

```
apps/admin         internal admin dashboard (React + Vite)
apps/              other client surfaces (web-content, operator-portal, telegram-bot) arrive phase by phase
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
```

Demo sign-ins (password = `SEED_ADMIN_PASSWORD`, default `change-me`): `admin@example.com` (super admin),
`moderator@example.com` (moderator), `editor@example.com` (content editor: can view, can't decide).

Tests use a separate database (`TEST_DATABASE_URL`, default `postgresql://ttp:ttp@localhost:5432/ttp_test`):

```bash
pnpm test        # API tests (Postgres) + dashboard component tests
pnpm e2e         # browser tests; needs the API running, and re-seeds its database
```

If Playwright's own browser isn't installed, point it at another Chromium with `PW_CHROMIUM_PATH`.

## Status

**Phase 0 done** — schema, migrations, seed data, and the admin dashboard: sign-in, dashboard numbers,
operator approval queue (approve / reject / flag / suspend with reasons and history), manual operator
entry and editing, and review moderation. Next: Phase 1 (public Russian site, verification badge,
visa guides, Telegram bot).
