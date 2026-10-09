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
  Start the API with `TELEGRAM_API_BASE=http://localhost:8099`: the suites run a fake Telegram there and check what was sent.
- Partner portal auth (`services/api/src/portal/portal-auth.ts`): JWT `typ: 'account'`, separate from admin tokens.
  Set-password links are signed JWTs bound to a fingerprint of the current password hash (no DB column), so they
  stop working once used. Operator scores (TV-6) come from `ScoringService`; recompute after anything that changes
  response times or listing completeness.
- Operator self-onboarding (Phase 4): `services/api/src/portal/onboarding.module.ts`. Operators sign up as `DRAFT` and
  submit with `OPERATOR_SUBMIT` (shared-types); `applicationMissing()` decides what is still needed. Documents go
  through `DocumentStore` (`src/storage`), AES-256-GCM on disk, key `DOCUMENT_ENCRYPTION_KEY`; never serve them publicly.
- Tour feed (Phase 4): `src/feed` (`/feed/v1`, API keys stored as sha256, CSV import). Feed, CSV and form must follow the same
  publish rules (`FeedService.targetStatus`). Countries are data (`countries.active`); check new country input with
  `activeCountry()` instead of hard-coding codes.
- Email: `NotificationsService` (`services/api/src/mail`) decides who is told what (EN operators/staff, RU DMCs) over
  `MailService` (SMTP via `SMTP_URL`; without it messages are only logged and kept in `MailService.sent`, which tests read).
  Notify after the action succeeds; never let an email failure undo it.
- Production: `infra/production` (Docker Compose + Caddy), guide in `docs/DEPLOY.md`. Never run the seed there;
  `node dist/cli/setup.js <email> "<name>" [role]` creates staff logins and the country list.
- Telegram from the API: `TelegramBotApi` (send only). The bot process forwards button presses to `/bot/*`,
  authenticated with `X-Bot-Secret` = HMAC-SHA256(bot token, "ttp-bot-internal"); no extra secret to configure.
- Public endpoints (`/public/*`) must only ever return approved operators and published content, and never
  internal fields (status reasons, reference contacts, documents, badge tokens). `test/public.e2e.spec.ts` checks this.
- Public site pages read the API at request time with tag-cached fetches (`lib/api.ts`); the API calls
  `/api/revalidate` after changes. Building the site must not need the API.
- Workflow rules (`OPERATOR_TRANSITIONS`, `REVIEW_TRANSITIONS`, `TRANSLATOR_TRANSITIONS`, `DMC_TRANSITIONS`) and request schemas live in
  `packages/shared-types` and are used by both the API and the dashboard — change them there only.
- Schema change: edit `schema.prisma`, then `cd services/api && npx prisma migrate dev --name <change>`.
  CHECK constraints are hand-written SQL appended to migrations (Prisma doesn't manage them).
  If `migrate dev` refuses because it wants to ask about a warning (non-interactive shell), write the SQL with
  `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
  --shadow-database-url <empty db> --script` into a new migration folder, then `prisma migrate deploy`.
