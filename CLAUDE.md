# Project rules

Full spec: `docs/BUILD_SPEC.md` (Part A = requirements, Part B = gaps, decisions B5, schema changes B6).

- **No payment processing and no payment fields** (v1). Money fields are display/quote only.
  `services/api/test/schema.spec.ts` fails if a payment-like table or column appears.
- The data model (`services/api/prisma/schema.prisma`, documented in `docs/BUILD_SPEC.md`) is the source
  of truth — flag any change instead of redesigning silently, and record it in B6.
- Schema + migrations are reviewed before UI code. Build one phase at a time.
- Ship seed/fixture data with every phase (`services/api/prisma/seed.ts`). Demo data is fictional and marked "(demo)".
- Telegram: official Bot API + official Mini Apps SDK only, no third-party wrappers.
- The verification badge must work standalone when embedded on an unrelated third-party site.
- Reviews are invite-only: no review row without a `review_invites` row.

## Stack & commands

TypeScript everywhere: pnpm workspace, NestJS API, Prisma 6 + PostgreSQL 16, Jest + supertest.
Pinned versions are deliberate; don't bump majors without asking.

- `pnpm --filter @ttp/shared-types build` — needed before the API typechecks/tests
- `pnpm typecheck`, `pnpm test` (tests need Postgres; they use the `ttp_test` database)
- Schema change: edit `schema.prisma`, then `cd services/api && npx prisma migrate dev --name <change>`.
  CHECK constraints are hand-written SQL appended to migrations (Prisma doesn't manage them).
