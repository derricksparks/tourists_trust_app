-- AlterTable
ALTER TABLE "review_invites" ADD COLUMN     "inquiry_id" UUID;

-- AlterTable
ALTER TABLE "translators" ADD COLUMN     "telegram_user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "review_invites_inquiry_id_key" ON "review_invites"("inquiry_id");

-- CreateIndex
CREATE UNIQUE INDEX "translators_telegram_user_id_key" ON "translators"("telegram_user_id");

-- AddForeignKey
ALTER TABLE "review_invites" ADD CONSTRAINT "review_invites_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translators" ADD CONSTRAINT "translators_telegram_user_id_fkey" FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

