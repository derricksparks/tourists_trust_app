-- AlterTable
ALTER TABLE "insurers" ADD COLUMN     "source_url" TEXT;

-- AlterTable
ALTER TABLE "operator_documents" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by_id" UUID;

-- AlterTable
ALTER TABLE "visa_guides" ADD COLUMN     "source_url" TEXT,
ADD COLUMN     "verified_on" DATE;

-- CreateTable
CREATE TABLE "site_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_key_key" ON "site_settings"("key");

-- AddForeignKey
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written checks (Prisma does not manage CHECK constraints).
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_deleted_by_needs_deleted_at" CHECK ("deleted_by_id" IS NULL OR "deleted_at" IS NOT NULL);
ALTER TABLE "visa_guides" ADD CONSTRAINT "visa_guides_source_url_http" CHECK ("source_url" IS NULL OR "source_url" ~ '^https?://');
ALTER TABLE "insurers" ADD CONSTRAINT "insurers_source_url_http" CHECK ("source_url" IS NULL OR "source_url" ~ '^https?://');
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_key_format" CHECK ("key" ~ '^[a-z]+(\.[a-z_]+)+$');

-- Existing guides were never checked against a recorded source, so they start as "not yet verified":
-- verified_on and source_url stay empty until an editor fills them in.
