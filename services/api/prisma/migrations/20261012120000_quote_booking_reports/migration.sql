-- CreateEnum
CREATE TYPE "BookingOutcome" AS ENUM ('BOOKED', 'NOT_BOOKED');

-- CreateEnum
CREATE TYPE "BookingSide" AS ENUM ('DMC', 'OPERATOR');

-- CreateTable
CREATE TABLE "quote_booking_reports" (
    "id" UUID NOT NULL,
    "quote_request_id" UUID NOT NULL,
    "side" "BookingSide" NOT NULL,
    "outcome" "BookingOutcome" NOT NULL,
    "booked_on" DATE,
    "net_price" DECIMAL(12,2),
    "currency" CHAR(3),
    "pax" INTEGER,
    "note" TEXT,
    "reported_by_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_booking_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_booking_reports_booked_on_idx" ON "quote_booking_reports"("booked_on");

-- CreateIndex
CREATE UNIQUE INDEX "quote_booking_reports_quote_request_id_side_key" ON "quote_booking_reports"("quote_request_id", "side");

-- AddForeignKey
ALTER TABLE "quote_booking_reports" ADD CONSTRAINT "quote_booking_reports_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_booking_reports" ADD CONSTRAINT "quote_booking_reports_reported_by_account_id_fkey" FOREIGN KEY ("reported_by_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written ──

ALTER TABLE "quote_booking_reports" ADD CONSTRAINT "quote_booking_reports_values" CHECK (
  ("outcome" <> 'BOOKED' OR "booked_on" IS NOT NULL)
  AND ("net_price" IS NULL OR "net_price" >= 0)
  AND (("net_price" IS NULL) = ("currency" IS NULL))
  AND ("pax" IS NULL OR "pax" > 0)
);

-- DMCs already closed some quotes as sold / not sold; that outcome was only kept in the audit log.
INSERT INTO "quote_booking_reports" ("id", "quote_request_id", "side", "outcome", "booked_on", "reported_by_account_id", "created_at", "updated_at")
SELECT DISTINCT ON (a."entity_id") gen_random_uuid(), a."entity_id", 'DMC',
       CASE WHEN a."metadata"->>'outcome' = 'booked' THEN 'BOOKED'::"BookingOutcome" ELSE 'NOT_BOOKED'::"BookingOutcome" END,
       CASE WHEN a."metadata"->>'outcome' = 'booked' THEN a."created_at"::date END,
       a."actor_account_id", a."created_at", a."created_at"
FROM "audit_log" a
JOIN "quote_requests" q ON q."id" = a."entity_id"
WHERE a."action" = 'quote.close' AND a."entity_type" = 'quote_request' AND a."metadata"->>'outcome' IN ('booked', 'not_booked')
ORDER BY a."entity_id", a."created_at" DESC;
