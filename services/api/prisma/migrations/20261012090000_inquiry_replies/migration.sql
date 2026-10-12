-- CreateEnum
CREATE TYPE "ReplyDelivery" AS ENUM ('TELEGRAM', 'EMAIL');

-- CreateTable
CREATE TABLE "inquiry_replies" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_account_id" UUID,
    "author_admin_id" UUID,
    "delivered_via" "ReplyDelivery" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inquiry_replies_inquiry_id_created_at_idx" ON "inquiry_replies"("inquiry_id", "created_at");

-- AddForeignKey
ALTER TABLE "inquiry_replies" ADD CONSTRAINT "inquiry_replies_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_replies" ADD CONSTRAINT "inquiry_replies_author_account_id_fkey" FOREIGN KEY ("author_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_replies" ADD CONSTRAINT "inquiry_replies_author_admin_id_fkey" FOREIGN KEY ("author_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written ──

-- One author at most: the operator's login or a staff member (both can become NULL if deleted later).
ALTER TABLE "inquiry_replies" ADD CONSTRAINT "inquiry_replies_one_author" CHECK (num_nonnulls("author_account_id", "author_admin_id") <= 1);
ALTER TABLE "inquiry_replies" ADD CONSTRAINT "inquiry_replies_body" CHECK (length(btrim("body")) > 0);

-- Answers staff already sent through the bot were kept in the audit log; copy them in as staff replies.
INSERT INTO "inquiry_replies" ("id", "inquiry_id", "body", "author_admin_id", "delivered_via", "created_at")
SELECT gen_random_uuid(), a."entity_id", a."metadata"->>'text', a."actor_admin_id", 'TELEGRAM', a."created_at"
FROM "audit_log" a
JOIN "inquiries" i ON i."id" = a."entity_id"
WHERE a."action" = 'inquiry.reply' AND a."entity_type" = 'inquiry' AND coalesce(a."metadata"->>'text', '') <> '';
