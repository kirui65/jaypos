CREATE TABLE "unmatched_payments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_request_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "phone" TEXT,
    "mpesa_receipt" TEXT,
    "raw_json" JSONB NOT NULL,
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "unmatched_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unmatched_payments_provider_request_id_key" ON "unmatched_payments"("provider_request_id");
CREATE INDEX "unmatched_payments_shop_id_reconciled_at_created_at_idx" ON "unmatched_payments"("shop_id", "reconciled_at", "created_at");
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

