-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'WHATSAPP');

-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "preferred_channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL';

