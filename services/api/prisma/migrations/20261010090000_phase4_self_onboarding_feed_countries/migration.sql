-- AlterEnum
ALTER TYPE "OperatorStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "countries" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "licence_register_url" TEXT,
ADD COLUMN     "licensing_authority" TEXT,
ADD COLUMN     "name_ru_in" TEXT;

-- AlterTable
-- Defaults only fill rows that already exist (there are none outside test data), then are dropped.
ALTER TABLE "operator_documents" ADD COLUMN     "content_type" TEXT NOT NULL DEFAULT 'application/pdf',
ADD COLUMN     "size_bytes" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "operator_documents" ALTER COLUMN "content_type" DROP DEFAULT, ALTER COLUMN "size_bytes" DROP DEFAULT;

-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "external_ref" TEXT;

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by_id" UUID,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_operator_id_idx" ON "api_keys"("operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_operator_id_external_ref_key" ON "packages"("operator_id", "external_ref");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written (Prisma does not manage these) ──

-- Launch countries become active destinations and get their licensing authority and Russian locative.
UPDATE "countries" SET "active" = true, "name_ru_in" = 'в Уганде', "licensing_authority" = 'Uganda Tourism Board' WHERE "code" = 'UG';
UPDATE "countries" SET "active" = true, "name_ru_in" = 'в Танзании', "licensing_authority" = 'Tanzania Tourist Agency Licensing Authority (TALA)' WHERE "code" = 'TZ';
UPDATE "countries" SET "active" = true, "name_ru_in" = 'в Кении', "licensing_authority" = 'Tourism Regulatory Authority (Kenya)' WHERE "code" = 'KE';
UPDATE "countries" SET "active" = true, "name_ru_in" = 'в Руанде', "licensing_authority" = 'Rwanda Development Board' WHERE "code" = 'RW';
UPDATE "countries" SET "name_ru_in" = 'в России' WHERE "code" = 'RU';

-- Operators already in the queue count as submitted when they were created.
UPDATE "operators" SET "submitted_at" = "created_at";

ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_file" CHECK (
  "size_bytes" > 0 AND "content_type" IN ('application/pdf', 'image/jpeg', 'image/png')
);
ALTER TABLE "packages" ADD CONSTRAINT "packages_external_ref" CHECK ("external_ref" IS NULL OR "external_ref" ~ '^[A-Za-z0-9._:-]{1,100}$');
ALTER TABLE "countries" ADD CONSTRAINT "countries_register_url" CHECK ("licence_register_url" IS NULL OR "licence_register_url" ~ '^https?://');
