# tourists_trust_app

Russia–Africa tourism platform: a trust and discovery layer, concierge services and a B2B wholesale
connector between African tour operators and Russian DMCs. There is **no payment processing** in v1.

- Requirements, review and decisions: [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md)
- Data model: [`services/api/prisma/schema.prisma`](services/api/prisma/schema.prisma)

## Layout

```
apps/              client surfaces (admin, web-content, operator-portal, telegram-bot) — added phase by phase
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
pnpm dev:api                                 # http://localhost:3000/health
```

Tests use a separate database (`TEST_DATABASE_URL`, default `postgresql://ttp:ttp@localhost:5432/ttp_test`):

```bash
pnpm test
```

## Status

**Phase 0** — schema, migrations, seed data, admin login and the operator approval API
(`/admin/auth/*`, `/admin/operators/*`). The admin dashboard UI comes next, after schema review.
