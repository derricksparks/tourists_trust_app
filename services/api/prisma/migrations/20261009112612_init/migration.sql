-- CreateEnum
CREATE TYPE "OperatorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DmcStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PriceBasis" AS ENUM ('PER_PERSON', 'PER_GROUP');

-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TranslatorVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TranslationJobType" AS ENUM ('DOCUMENT', 'LIVE');

-- CreateEnum
CREATE TYPE "RequesterType" AS ENUM ('TOURIST', 'OPERATOR', 'DMC');

-- CreateEnum
CREATE TYPE "TranslationJobStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'RESPONDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InquiryChannel" AS ENUM ('TELEGRAM', 'WEB');

-- CreateEnum
CREATE TYPE "VisaApplicationStatus" AS ENUM ('NOT_STARTED', 'GATHERING_DOCUMENTS', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "GuideKind" AS ENUM ('DESTINATION', 'LOGISTICS');

-- CreateEnum
CREATE TYPE "FamTripStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'MODERATOR', 'CONTENT_EDITOR');

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('OPERATOR', 'DMC', 'TRANSLATOR');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OperatorDocumentType" AS ENUM ('BUSINESS_REGISTRATION', 'TOURISM_LICENSE', 'OTHER');

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "operator_id" UUID,
    "dmc_id" UUID,
    "translator_id" UUID,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_users" (
    "id" UUID NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "language_code" TEXT,
    "consent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "business_reg_number" TEXT NOT NULL,
    "tourism_board_license" TEXT NOT NULL,
    "licensing_authority" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "year_established" INTEGER,
    "reference_contact_name" TEXT,
    "reference_contact_info" TEXT,
    "website_url" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "telegram_username" TEXT,
    "description_ru" TEXT,
    "description_en" TEXT,
    "status" "OperatorStatus" NOT NULL DEFAULT 'PENDING',
    "status_reason" TEXT,
    "verification_video_url" TEXT,
    "response_time_score" DOUBLE PRECISION,
    "completeness_score" DOUBLE PRECISION,
    "scores_computed_at" TIMESTAMP(3),
    "badge_token" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_documents" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "type" "OperatorDocumentType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "reviewed_by_id" UUID,
    "review_notes" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "package_id" UUID,
    "kind" "MediaKind" NOT NULL,
    "storage_key" TEXT,
    "external_url" TEXT,
    "caption_ru" TEXT,
    "caption_en" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_invites" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "operator_id" UUID NOT NULL,
    "package_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "recipient_contact" TEXT NOT NULL,
    "trip_date" DATE NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "package_id" UUID,
    "invite_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "rating_guide" SMALLINT,
    "rating_vehicle" SMALLINT,
    "rating_accommodation" SMALLINT,
    "rating_value" SMALLINT,
    "body_ru" TEXT,
    "body_en" TEXT,
    "original_language" VARCHAR(8) NOT NULL DEFAULT 'ru',
    "trip_date" DATE NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "moderated_by_id" UUID,
    "moderated_at" TIMESTAMP(3),
    "operator_reply" TEXT,
    "operator_replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "id" UUID NOT NULL,
    "telegram_user_id" UUID,
    "operator_id" UUID NOT NULL,
    "package_id" UUID,
    "channel" "InquiryChannel" NOT NULL DEFAULT 'TELEGRAM',
    "contact_name" TEXT,
    "contact_info" TEXT,
    "message" TEXT NOT NULL,
    "travel_month" VARCHAR(7),
    "group_size" INTEGER,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "first_response_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dmcs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country_code" CHAR(2) NOT NULL DEFAULT 'RU',
    "website_url" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "telegram_username" TEXT,
    "status" "DmcStatus" NOT NULL DEFAULT 'PENDING',
    "status_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dmcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "title_ru" TEXT,
    "description_ru" TEXT,
    "description_en" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "price" DECIMAL(12,2),
    "currency" CHAR(3),
    "price_basis" "PriceBasis" NOT NULL DEFAULT 'PER_PERSON',
    "capacity" INTEGER,
    "inclusions" TEXT[],
    "exclusions" TEXT[],
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_date_ranges" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "capacity" INTEGER,

    CONSTRAINT "package_date_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" UUID NOT NULL,
    "dmc_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "pax" INTEGER,
    "travel_start_date" DATE,
    "travel_end_date" DATE,
    "quoted_price" DECIMAL(12,2),
    "quoted_currency" CHAR(3),
    "quote_terms" TEXT,
    "quoted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dmc_package_listings" (
    "id" UUID NOT NULL,
    "dmc_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "white_label_title" TEXT,
    "dmc_page_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dmc_package_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fam_trips" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FamTripStatus" NOT NULL DEFAULT 'PLANNED',
    "capacity" INTEGER,
    "itinerary" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fam_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fam_trip_dmcs" (
    "fam_trip_id" UUID NOT NULL,
    "dmc_id" UUID NOT NULL,
    "representative_name" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fam_trip_dmcs_pkey" PRIMARY KEY ("fam_trip_id","dmc_id")
);

-- CreateTable
CREATE TABLE "fam_trip_operators" (
    "fam_trip_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "role" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fam_trip_operators_pkey" PRIMARY KEY ("fam_trip_id","operator_id")
);

-- CreateTable
CREATE TABLE "translators" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "telegram_username" TEXT,
    "languages" TEXT[],
    "proficiency" JSONB NOT NULL DEFAULT '{}',
    "specialty_country_code" CHAR(2) NOT NULL,
    "specialties" TEXT[],
    "bio_ru" TEXT,
    "verification_status" "TranslatorVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "spot_check_notes" TEXT,
    "spot_checked_at" TIMESTAMP(3),
    "spot_checked_by_id" UUID,
    "jobs_completed" INTEGER NOT NULL DEFAULT 0,
    "rating" DECIMAL(3,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_jobs" (
    "id" UUID NOT NULL,
    "translator_id" UUID,
    "requester_type" "RequesterType" NOT NULL,
    "requester_telegram_user_id" UUID,
    "requester_operator_id" UUID,
    "requester_dmc_id" UUID,
    "type" "TranslationJobType" NOT NULL,
    "status" "TranslationJobStatus" NOT NULL DEFAULT 'REQUESTED',
    "source_language" VARCHAR(8) NOT NULL,
    "target_language" VARCHAR(8) NOT NULL,
    "description" TEXT,
    "document_storage_key" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "rating" SMALLINT,
    "feedback" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_ru" TEXT,
    "website_url" TEXT,
    "countries_covered" TEXT[],
    "claims_contact" TEXT NOT NULL,
    "repatriation_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "coverage_ru" TEXT,
    "exclusions_ru" TEXT,
    "medical_limit_info" TEXT,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "notes" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_guides" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "covered_countries" TEXT[],
    "visa_type" TEXT NOT NULL,
    "title_ru" TEXT NOT NULL,
    "requirements_ru" TEXT NOT NULL,
    "checklist_items" JSONB NOT NULL DEFAULT '[]',
    "official_url" TEXT,
    "fee_info" TEXT,
    "processing_time" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_applications" (
    "id" UUID NOT NULL,
    "telegram_user_id" UUID NOT NULL,
    "visa_guide_id" UUID NOT NULL,
    "status" "VisaApplicationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "travel_date" DATE,
    "checked_items" TEXT[],
    "notes" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visa_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destination_guides" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "kind" "GuideKind" NOT NULL,
    "title_ru" TEXT NOT NULL,
    "summary_ru" TEXT,
    "body_ru" TEXT NOT NULL,
    "title_en" TEXT,
    "body_en" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "destination_guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_admin_id" UUID,
    "actor_account_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "accounts_operator_id_idx" ON "accounts"("operator_id");

-- CreateIndex
CREATE INDEX "accounts_dmc_id_idx" ON "accounts"("dmc_id");

-- CreateIndex
CREATE INDEX "accounts_translator_id_idx" ON "accounts"("translator_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_users_telegram_id_key" ON "telegram_users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "operators_slug_key" ON "operators"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "operators_badge_token_key" ON "operators"("badge_token");

-- CreateIndex
CREATE INDEX "operators_status_idx" ON "operators"("status");

-- CreateIndex
CREATE INDEX "operators_country_code_status_idx" ON "operators"("country_code", "status");

-- CreateIndex
CREATE INDEX "operator_documents_operator_id_idx" ON "operator_documents"("operator_id");

-- CreateIndex
CREATE INDEX "media_operator_id_idx" ON "media"("operator_id");

-- CreateIndex
CREATE INDEX "media_package_id_idx" ON "media"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_invites_token_hash_key" ON "review_invites"("token_hash");

-- CreateIndex
CREATE INDEX "review_invites_operator_id_idx" ON "review_invites"("operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_invite_id_key" ON "reviews"("invite_id");

-- CreateIndex
CREATE INDEX "reviews_operator_id_status_idx" ON "reviews"("operator_id", "status");

-- CreateIndex
CREATE INDEX "reviews_status_idx" ON "reviews"("status");

-- CreateIndex
CREATE INDEX "inquiries_operator_id_created_at_idx" ON "inquiries"("operator_id", "created_at");

-- CreateIndex
CREATE INDEX "inquiries_status_idx" ON "inquiries"("status");

-- CreateIndex
CREATE INDEX "dmcs_status_idx" ON "dmcs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "packages_slug_key" ON "packages"("slug");

-- CreateIndex
CREATE INDEX "packages_operator_id_idx" ON "packages"("operator_id");

-- CreateIndex
CREATE INDEX "packages_country_code_status_idx" ON "packages"("country_code", "status");

-- CreateIndex
CREATE INDEX "package_date_ranges_package_id_start_date_idx" ON "package_date_ranges"("package_id", "start_date");

-- CreateIndex
CREATE INDEX "quote_requests_dmc_id_status_idx" ON "quote_requests"("dmc_id", "status");

-- CreateIndex
CREATE INDEX "quote_requests_package_id_idx" ON "quote_requests"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "dmc_package_listings_dmc_id_package_id_key" ON "dmc_package_listings"("dmc_id", "package_id");

-- CreateIndex
CREATE INDEX "translators_specialty_country_code_verification_status_idx" ON "translators"("specialty_country_code", "verification_status");

-- CreateIndex
CREATE INDEX "translation_jobs_translator_id_status_idx" ON "translation_jobs"("translator_id", "status");

-- CreateIndex
CREATE INDEX "translation_jobs_status_idx" ON "translation_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "visa_guides_slug_key" ON "visa_guides"("slug");

-- CreateIndex
CREATE INDEX "visa_guides_country_code_status_idx" ON "visa_guides"("country_code", "status");

-- CreateIndex
CREATE INDEX "visa_applications_telegram_user_id_idx" ON "visa_applications"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "destination_guides_slug_key" ON "destination_guides"("slug");

-- CreateIndex
CREATE INDEX "destination_guides_country_code_kind_status_idx" ON "destination_guides"("country_code", "kind", "status");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_dmc_id_fkey" FOREIGN KEY ("dmc_id") REFERENCES "dmcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_translator_id_fkey" FOREIGN KEY ("translator_id") REFERENCES "translators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_invites" ADD CONSTRAINT "review_invites_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_invites" ADD CONSTRAINT "review_invites_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_invites" ADD CONSTRAINT "review_invites_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "review_invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_id_fkey" FOREIGN KEY ("moderated_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_telegram_user_id_fkey" FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dmcs" ADD CONSTRAINT "dmcs_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_date_ranges" ADD CONSTRAINT "package_date_ranges_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_dmc_id_fkey" FOREIGN KEY ("dmc_id") REFERENCES "dmcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dmc_package_listings" ADD CONSTRAINT "dmc_package_listings_dmc_id_fkey" FOREIGN KEY ("dmc_id") REFERENCES "dmcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dmc_package_listings" ADD CONSTRAINT "dmc_package_listings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fam_trip_dmcs" ADD CONSTRAINT "fam_trip_dmcs_fam_trip_id_fkey" FOREIGN KEY ("fam_trip_id") REFERENCES "fam_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fam_trip_dmcs" ADD CONSTRAINT "fam_trip_dmcs_dmc_id_fkey" FOREIGN KEY ("dmc_id") REFERENCES "dmcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fam_trip_operators" ADD CONSTRAINT "fam_trip_operators_fam_trip_id_fkey" FOREIGN KEY ("fam_trip_id") REFERENCES "fam_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fam_trip_operators" ADD CONSTRAINT "fam_trip_operators_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translators" ADD CONSTRAINT "translators_specialty_country_code_fkey" FOREIGN KEY ("specialty_country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translators" ADD CONSTRAINT "translators_spot_checked_by_id_fkey" FOREIGN KEY ("spot_checked_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_translator_id_fkey" FOREIGN KEY ("translator_id") REFERENCES "translators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_requester_telegram_user_id_fkey" FOREIGN KEY ("requester_telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_requester_operator_id_fkey" FOREIGN KEY ("requester_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_requester_dmc_id_fkey" FOREIGN KEY ("requester_dmc_id") REFERENCES "dmcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurers" ADD CONSTRAINT "insurers_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_guides" ADD CONSTRAINT "visa_guides_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_telegram_user_id_fkey" FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_visa_guide_id_fkey" FOREIGN KEY ("visa_guide_id") REFERENCES "visa_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destination_guides" ADD CONSTRAINT "destination_guides_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Integrity rules Prisma cannot express (hand-written; Prisma leaves CHECKs alone) ───

-- Ratings are 1–5.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ratings_range" CHECK (
  "rating" BETWEEN 1 AND 5
  AND ("rating_guide" IS NULL OR "rating_guide" BETWEEN 1 AND 5)
  AND ("rating_vehicle" IS NULL OR "rating_vehicle" BETWEEN 1 AND 5)
  AND ("rating_accommodation" IS NULL OR "rating_accommodation" BETWEEN 1 AND 5)
  AND ("rating_value" IS NULL OR "rating_value" BETWEEN 1 AND 5)
);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_has_body" CHECK ("body_ru" IS NOT NULL OR "body_en" IS NOT NULL);
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_rating_range" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
ALTER TABLE "translators" ADD CONSTRAINT "translators_rating_range" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);

-- Computed scores are 0–100.
ALTER TABLE "operators" ADD CONSTRAINT "operators_scores_range" CHECK (
  ("response_time_score" IS NULL OR "response_time_score" BETWEEN 0 AND 100)
  AND ("completeness_score" IS NULL OR "completeness_score" BETWEEN 0 AND 100)
);

-- Display/quote money: non-negative, and an amount always has a currency.
ALTER TABLE "packages" ADD CONSTRAINT "packages_price_currency" CHECK (
  ("price" IS NULL OR "price" >= 0) AND ("price" IS NULL OR "currency" IS NOT NULL)
);
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_price_currency" CHECK (
  ("quoted_price" IS NULL OR "quoted_price" >= 0) AND ("quoted_price" IS NULL OR "quoted_currency" IS NOT NULL)
);

-- Positive sizes and ordered date ranges.
ALTER TABLE "packages" ADD CONSTRAINT "packages_positive" CHECK ("duration_days" > 0 AND ("capacity" IS NULL OR "capacity" > 0));
ALTER TABLE "package_date_ranges" ADD CONSTRAINT "package_date_ranges_order" CHECK ("end_date" >= "start_date" AND ("capacity" IS NULL OR "capacity" > 0));
ALTER TABLE "fam_trips" ADD CONSTRAINT "fam_trips_order" CHECK ("end_date" >= "start_date");
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_dates" CHECK (
  ("pax" IS NULL OR "pax" > 0)
  AND ("travel_start_date" IS NULL OR "travel_end_date" IS NULL OR "travel_end_date" >= "travel_start_date")
);

-- A media item is either uploaded or an external link (YouTube/Telegram).
ALTER TABLE "media" ADD CONSTRAINT "media_source" CHECK ("storage_key" IS NOT NULL OR "external_url" IS NOT NULL);

-- A portal account belongs to exactly the entity its role names.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_role_owner" CHECK (
  ("role" = 'OPERATOR'   AND "operator_id" IS NOT NULL AND "dmc_id" IS NULL AND "translator_id" IS NULL)
  OR ("role" = 'DMC'        AND "dmc_id" IS NOT NULL AND "operator_id" IS NULL AND "translator_id" IS NULL)
  OR ("role" = 'TRANSLATOR' AND "translator_id" IS NOT NULL AND "operator_id" IS NULL AND "dmc_id" IS NULL)
);

-- A translation job's requester FK matches its requester_type.
-- (Requester FKs are SET NULL on delete, so the row survives with all three NULL.)
ALTER TABLE "translation_jobs" ADD CONSTRAINT "translation_jobs_requester" CHECK (
  ("requester_type" = 'TOURIST'  AND "requester_operator_id" IS NULL AND "requester_dmc_id" IS NULL)
  OR ("requester_type" = 'OPERATOR' AND "requester_telegram_user_id" IS NULL AND "requester_dmc_id" IS NULL)
  OR ("requester_type" = 'DMC'      AND "requester_telegram_user_id" IS NULL AND "requester_operator_id" IS NULL)
);

-- Country code columns are upper-case ISO alpha-2.
ALTER TABLE "countries" ADD CONSTRAINT "countries_code_format" CHECK ("code" ~ '^[A-Z]{2}$');
