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

TypeScript everywhere: pnpm workspace, NestJS API, Prisma 6 + PostgreSQL 16, Jest + supertest;
admin dashboard is React 18 + Vite + TanStack Query + React Router; public site is Next.js 14 (App Router);
bot is plain TypeScript over the Bot API. Unit tests use Vitest (Jest in the API); browser tests use Playwright.
Pinned versions are deliberate; don't bump majors without asking.

- `pnpm --filter @ttp/shared-types build` — needed before the API typechecks/tests
- `pnpm typecheck`, `pnpm test` (API tests need Postgres; they use the `ttp_test` database)
- `pnpm e2e` — dashboard and site browser tests; needs the API running, re-seeds its database, and the
  site built (`pnpm --filter @ttp/web-content build`). Set `PW_CHROMIUM_PATH` if Playwright's browser isn't installed.
- Public endpoints (`/public/*`) must only ever return approved operators and published content, and never
  internal fields (status reasons, reference contacts, documents, badge tokens). `test/public.e2e.spec.ts` checks this.
- Public site pages read the API at request time with tag-cached fetches (`lib/api.ts`); the API calls
  `/api/revalidate` after changes. Building the site must not need the API.
- Workflow rules (`OPERATOR_TRANSITIONS`, `REVIEW_TRANSITIONS`) and request schemas live in
  `packages/shared-types` and are used by both the API and the dashboard — change them there only.
- Schema change: edit `schema.prisma`, then `cd services/api && npx prisma migrate dev --name <change>`.
  CHECK constraints are hand-written SQL appended to migrations (Prisma doesn't manage them).
