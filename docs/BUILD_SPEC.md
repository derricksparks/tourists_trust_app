# Build Spec — Russia–Africa Tourism Platform

Extracted from *"Russia–Africa Tourism Platform: Build Requirements & Claude Code Guide"* (Drake Grace, 2026-09-30).
Part A is what the source document says, restated as buildable requirements. Part B is a critical review: gaps,
contradictions and risks that need a decision **before** the schema is frozen.

---

## Part A — Requirements as stated

### A1. Hard constraints (non-negotiable)

1. **No money movement in v1.** No payment capture, settlement, wallets, payment tables or payment fields.
   Monetary fields exist only for display/quoting. Payment is a later partner integration.
   Reason: sanctions/correspondent-banking risk (OFAC-listed Russian banks, weak Mir acceptance abroad, KZ/TR/UAE bank caution).
2. **The data model in this spec is the source of truth.** Any deviation must be flagged and approved, not silently redesigned.
3. **Schema + migrations first**, reviewed and approved, before any UI code.
4. **Build one phase at a time.**
5. **Seed/fixture data with every phase** (fake operators, packages, reviews, …) so each feature is testable immediately.
6. **Telegram: official Telegram Bot API + official Telegram Mini Apps SDK**, no third-party wrapper.
7. **Verification badge is a truly standalone embeddable artifact** (small script/iframe), tested on an unrelated third-party page.
8. The platform connects existing footprints — operators and DMCs keep their own sites; mirror pages link **back** to them.

### A2. Product layers

| Layer | Contents |
|---|---|
| Trust & Discovery | Vetted operator listings, verification badges, reviews |
| Concierge | Translation, visa help, insurance guidance, logistics content |
| B2B Wholesale | Operator inventory feed, DMC wholesale portal, fam-trip coordination |

### A3. Users

1. **African tour operators** — Uganda, Tanzania, Kenya first. Want Russian-market reach without rebuilding their web presence.
2. **Russian DMCs** — want vetted African supply without their own ground presence.
3. **Russian tourists** — want a trustworthy, Russian-language way to evaluate a trip.
4. **Translators / Russian-speaking guides** (implied supply side of the concierge layer).
5. **Internal admin staff.**

### A4. Architecture

Four client surfaces → one core API + PostgreSQL → three service modules.

```
 Telegram Bot & Mini App | Operator Web Portal | Public Content Site (SEO) | Admin Dashboard
                                      │
                           Core API + PostgreSQL
                                      │
     Trust & Verification  |  B2B Wholesale Connector  |  Concierge Services
 (listings, badges, reviews)                            (translate, visa, insure)
```

Recommended stack:

| Piece | Recommendation |
|---|---|
| Backend | NestJS/Express **or** FastAPI (team's choice; CRUD/workflow-heavy) |
| DB | PostgreSQL (use built-in full-text search for operator/destination search) |
| Admin | Retool **or** simple React admin — don't hand-build CRUD |
| Telegram | Bot API + Mini App (web app inside Telegram); build early |
| Operator portal | React or Next.js; forms + file uploads |
| Content site | Next.js static export or headless CMS; Russian-language SEO |
| Files/video | S3-compatible object storage |
| Hosting | Single VPS or Railway/Render |

Repo layout:

```
/apps
  /web-content       public Russian-language content site (Next.js static)
  /operator-portal   African operator portal (Next.js)
  /admin             internal admin dashboard
  /telegram-bot      Telegram bot + Mini App
/services
  /api               core backend API (NestJS or FastAPI)
/packages
  /shared-types      shared TS types / schema definitions
/infra               deployment config
```

### A5. Functional requirements

**Trust & verification**
- TV-1 Operator intake: business registration, tourism board licence (Uganda Tourism Board, TALA Tanzania, …), physical address, years operating, reference contact.
- TV-2 Admin review workflow: approve / reject / **flag** before going live.
- TV-3 Embeddable verification badge (JS/iframe) linking to the operator's verification page.
- TV-4 Verification video per operator (upload, or YouTube/Telegram link) showing camp/office/vehicles.
- TV-5 Structured post-trip reviews (ratings + free text), moderated before publish.
- TV-6 Automatic response-time and listing-completeness scores from activity data.

**Translator & guide network**
- TR-1 Signup + verification (self-reported language proficiency + staff spot-check).
- TR-2 Directory searchable by country and specialty.
- TR-3 Request flow: document translation (async) and live interpretation (real-time chat handoff).
- TR-4 Per-translator rating and incentive tracking (jobs completed, feedback score).

**Visa assistance** (content + tracking only)
- VI-1 Russian-language guides: Kenya eTA, Tanzania/Zanzibar eVisa, Uganda eVisa, East African Tourist Visa.
- VI-2 Document checklist generator per destination.
- VI-3 Application status tracker — staff- or user-entered, informational; **no** government-portal integration.

**Insurance guidance** (informational only, no underwriting/sales)
- IN-1 Curated Russian insurers with verified claims/repatriation capability in target countries; periodically re-verified.
- IN-2 Comparison table: coverage, exclusions, claims contact.

**Flights & logistics** — FL-1 per-destination "how to get there" guide (routings, layover visa rules, seasonal notes); manually maintained, no live flight search.

**B2B wholesale**
- B2B-1 Operator package feed: price, dates, capacity, inclusions (form/spreadsheet import → API later).
- B2B-2 DMC portal: browse/filter vetted inventory, request quotes, white-label package details for their own site.
- B2B-3 Fam-trip tool: scheduling, participants (DMC reps + operators), itinerary.
- B2B-4 Russian "mirror" listing pages linking back to the operator's site and the selling DMC.

**Distribution**
- DI-1 Telegram bot/Mini App: browse verified operators, request info, reach translators (tourists + DMCs).
- DI-2 Operator web portal: listing management, package feed submission.
- DI-3 Public Russian SEO site: destination guides, verification pages, visa walkthroughs.

**Admin**
- AD-1 One dashboard: operator approval queue, review moderation, translator verification, insurer data, fam-trip scheduling.
- AD-2 Analytics: listings live, DMCs onboarded, quote requests, translator jobs completed.

### A6. Core data model (as given)

| Entity | Fields |
|---|---|
| Operator | id, name, country, business_reg_number, tourism_board_license, address, status (pending/approved/rejected), verification_video_url, response_time_score, completeness_score |
| DMC | id, name, country (Russia), website, contact, status |
| Package | id, operator_id, title, description_ru, description_en, price, currency, dates_available, capacity, inclusions |
| QuoteRequest | id, dmc_id, package_id, status (open/quoted/closed), notes |
| Review | id, operator_id, author_name, rating, body_ru, status (pending/published), trip_date |
| Translator | id, name, languages, specialty_country, verification_status, jobs_completed, rating |
| TranslationJob | id, translator_id, requester_type (tourist/operator), type (document/live), status |
| Insurer | id, name, countries_covered, claims_contact, verified_at, notes |
| VisaGuide | id, country, visa_type, requirements_ru, last_updated |
| FamTrip | id, title, date_range, participant_dmc_ids, participant_operator_ids, itinerary |
| AdminUser | id, name, role |

### A7. Phases

| Phase | When | Deliverable | Features |
|---|---|---|---|
| 0 | Wk 1–2 | Data model + admin skeleton | Schema, admin login, operator approval queue (manual entry) |
| 1 | Wk 3–8 | Trust layer MVP | Content site with 10–15 vetted operators, badge widget, visa pages (UG/TZ/KE), Telegram bot to browse + request info |
| 2 | Wk 9–16 | Concierge + translators | Translator signup/verification, translation requests via Telegram, insurer comparison, review submission + moderation |
| 3 | Wk 17–26 | B2B wholesale | Package feed (form), DMC portal (browse, quote), fam-trip tool |
| 4 | Month 7+ | Self-serve + scale | Operator self-onboarding, API package feed, more countries |

Build order: API + schema → admin CRUD → content site + badge → Telegram bot → translator/insurer → operator portal → DMC portal + fam trips.

---

## Part B — Critical review

### B1. Contradictions / inconsistencies in the source

1. **Diagram title says "three client surfaces"; diagram and text show four.** Four is correct.
2. **Telegram bot scope drifts.** Phase 1 = "browse + request info"; build-order step 4 = "browse, request a quote, request a translator". Quotes belong to DMCs (Phase 3) and translators to Phase 2. → Phase 1 bot should be browse + info-request only.
3. **Content site "static export" vs "reading from the API".** A static export won't show a newly approved operator, a revoked badge or a new review until a rebuild. → Use Next.js SSR/ISR with on-demand revalidation, or rebuild webhooks.
4. **Admin tooling: Retool vs `/apps/admin`.** Retool is a US SaaS (see B3 on sanctions/data residency). → Recommend React-Admin (or similar) in `/apps/admin`.
5. **Backend is left open, but `/packages/shared-types` implies TypeScript everywhere.** → A NestJS + TypeScript monorepo is the consistent choice; FastAPI would need codegen (OpenAPI → TS).
6. **Package feed: "form/spreadsheet import" (requirements) vs "form-based" (Phase 3).** Decide whether CSV import is in Phase 3.
7. **Operator status lacks `flagged`**, although TV-2 requires "flag". There's also no `suspended`/`revoked` state, which a badge needs.
8. **Operator portal is a "primary distribution" surface but isn't built until step 6.** Until then, admins enter every operator by hand. This is fine for 10–15 operators, but it should be stated.
9. **East African Tourist Visa covers Kenya, Uganda and Rwanda, not Tanzania.** Visa content must not suggest it covers Tanzania. `VisaGuide.country` (single value) can't represent a multi-country visa.

### B2. Gaps in the data model (needed to build the listed features)

| Missing | Needed by |
|---|---|
| **Operator:** `slug`, `website_url` (badge and mirror pages link back), contact email/phone/telegram, `years_operating`, `reference_contact`, `licensing_authority`, `description_ru/en`, photos, `badge_token`, `approved_at`, `status` + `flagged`/`suspended` | TV-1, TV-2, TV-3, B2B-4, SEO |
| **OperatorDocument** (licence/registration scans, reviewer notes) | TV-1, TV-2 manual review |
| **Media** (photos/video, storage key, moderation state) | TV-4, "operator photos" |
| **Inquiry / Lead** (a tourist's "request info" from Telegram → operator, with timestamps) | DI-1, Phase 1 bot. Also the only viable input for **response-time scoring** (TV-6) |
| **TelegramUser / Tourist** (telegram_id, language, consent) | Bot, reviews, translation jobs, visa tracker |
| **User accounts + roles** for operators, DMCs and translators (only AdminUser exists) | Operator portal, DMC portal, translator flow |
| **Package:** `status` (draft/published), `slug`, `destination_country`, `duration_days`, price basis (per person/group, rack vs net/wholesale) | B2B-1, B2B-2, SEO |
| **DMC ↔ Package link** (which DMC sells/white-labels which package) | B2B-2 white-label, B2B-4 "link back to selling DMC" |
| **QuoteRequest:** pax, travel dates, quoted price/terms, operator response, timestamps | B2B-2, response-time score |
| **Review:** `package_id`, reviewer contact/telegram id, per-criterion ratings, `body_en`/original language, `rejected` status, operator reply, **trip-proof** mechanism | TV-5 (fake reviews undermine the whole trust proposition) |
| **Translator:** contact/telegram, `specialty` (text says specialty; model says specialty_country), proficiency self-report, spot-check result/date | TR-1, TR-2 |
| **TranslationJob:** requester id, source/target languages, document file, deadline, rating + feedback, `requester_type` including `dmc` | TR-3, TR-4 (rating must come from somewhere) |
| **Insurer:** `coverage`, `exclusions`, `repatriation_confirmed`, website | IN-2 comparison table |
| **VisaGuide:** structured `checklist_items`, `countries[]`, official links, fees (display only), processing time | VI-1, VI-2 |
| **VisaApplication** (status tracker) | VI-3 — no entity exists |
| **DestinationGuide / Article** (logistics & destination content) | FL-1, DI-3 — no entity/CMS defined |
| **FamTrip:** status, capacity; participant **join table** instead of id arrays | B2B-3 |
| **AuditLog** (who approved/rejected/flagged what, and why) | AD-1, trust defensibility |
| **Countries** reference table (UG/TZ/KE + expansion) | Everywhere |

Scoring formulas (TV-6) are undefined, e.g. median time from inquiry to first operator reply, and % of required fields and media present.

### B3. Legal and operational risks the document doesn't address

1. **Russian personal-data localisation (Federal Law 152-FZ).** Personal data of Russian citizens must first be recorded and stored in databases located in Russia. Tourist Telegram IDs, names, reviews and especially visa/passport details trigger this. Hosting on Railway/Render/US S3 conflicts with it. **Needs legal advice before choosing hosting.**
2. **Sanctions still apply without payments.** The US has restricted certain IT/software services to persons in Russia, and the EU has similar service bans. Your company's jurisdiction decides what's allowed, and it also limits which SaaS/hosting vendors (Retool, Vercel, AWS) you can use. Fund flows aren't the only exposure.
3. **Telegram availability in Russia.** Telegram is the primary surface, and Russia has recently been throttling or restricting foreign messengers. Keep the web content site fully functional on its own, and design the core API so the Mini App's web UI can also run as a normal website.
4. **Liability for advice.** Visa and insurance pages need disclaimers, "last verified" dates and source links. Insurer "recommendations" may be regulated advertising.
5. **Sensitive documents** (passports, licences): encryption at rest, access control, and retention/deletion policy.
6. **Licensing authorities list:** Uganda Tourism Board, TALA (Tanzania), and Tourism Regulatory Authority (Kenya). Verification checklists per authority are needed.

### B4. Non-functional requirements that are missing (proposed defaults)

- **Languages:** Russian for public/tourist/DMC UI; English for operator portal and admin; content stored ru + en.
- **Auth:** Telegram `initData` validation for Mini App users; email magic link or password for operators/DMCs/translators; role-based admin.
- **Badge:** served from our domain, reflects **live** status (revoked → shows revoked), keyed by an unguessable token, no third-party cookies, tiny and CSP-friendly, with an iframe fallback.
- **Search:** Postgres FTS with the `russian` config plus trigram for names.
- **Notifications:** Telegram/email to operators on new inquiry/quote (required for response-time scoring to be meaningful).
- **Abuse:** rate limiting, spam protection on review/inquiry forms, and file-type/size limits on uploads.
- **Ops:** backups, error tracking, CI (lint/typecheck/test), seed script per phase.

### B5. Decisions (answered by the product owner, 2026-10-09)

| # | Question | Decision |
|---|---|---|
| 1 | Backend language | **TypeScript** — NestJS API, Prisma ORM, pnpm monorepo |
| 2 | Hosting / Russian data residency (152-FZ) | **Not localising for now.** Users come from several countries; host wherever is best today and revisit later. Risk accepted by the product owner. |
| 3 | Admin tooling | **Build in-repo** (`/apps/admin`), no Retool. Built as a plain React + Vite app rather than React-Admin: the screens are workflow pages (approve/flag with reasons), not generic CRUD |
| 4 | Content site rendering | **SSR/ISR** with on-demand revalidation, not a pure static export |
| 5 | Data-model additions in B2 | **Accepted** — implemented in `services/api/prisma/schema.prisma` |
| 6 | Review trust mechanism | **Invite-only**: a one-time link is sent to the traveller after the trip; a review can only be written through it |

Consequences of decision 2: keep personal data in clearly separated tables (`telegram_users`, `accounts`,
`inquiries`, `visa_applications`) and never store passport numbers or scans, so moving that data to a
Russian-hosted database later stays a bounded job.

Consequence of decision 6: in v1 only **staff** issue invites (`review_invites.issued_by_id` → admin).
Operators supply traveller lists, which still lets an operator leave unhappy travellers out. Mitigation to
decide before Phase 2: e.g. invite every traveller from confirmed inquiries/quotes, and show the
invite-to-review ratio to moderators.

### B6. Schema representation changes against A6 (flagged, not silent)

These keep the meaning of the spec's fields but change how they are stored:

| Spec field | Stored as | Why |
|---|---|---|
| `Operator.status` (pending/approved/rejected) | adds `FLAGGED`, `SUSPENDED` | TV-2 needs "flag"; a badge needs a revoked state |
| Operator "years operating" (TV-1) | `year_established` | a year doesn't go stale; years are derived |
| `Package.dates_available` | `package_date_ranges` table (start, end, optional capacity) | DMCs filter by date (B2B-2) |
| `Package.title` | `title` + `title_ru` | Russian mirror pages need a Russian title |
| `Review.body_ru` | `body_ru` + `body_en` + `original_language`, at least one body required | reviewers may write in English |
| `Review.status` (pending/published) | adds `REJECTED` | moderation needs a reject outcome |
| `Translator.specialty_country` | `specialty_country_code` + `specialties[]` | TR-2 searches by country **and** specialty |
| `TranslationJob.requester_type` (tourist/operator) | adds `DMC`, plus a requester FK per type | DMCs request translations too |
| `DMC.contact` | `contact_name`, `email`, `phone`, `telegram_username` | structured contact |
| `FamTrip.date_range` | `start_date`, `end_date` | plain dates are easier to query |
| `FamTrip.participant_dmc_ids/operator_ids` | `fam_trip_dmcs`, `fam_trip_operators` join tables | referential integrity, per-participant confirmation |
| `AdminUser` (id, name, role) | adds `email`, `password_hash`, `active` | admin login |
| `VisaGuide.country` | `country_code` (primary) + `covered_countries[]` | East African Tourist Visa spans KE/UG/RW |
| `VisaGuide.requirements_ru` | + structured `checklist_items` | VI-2 checklist generator |
