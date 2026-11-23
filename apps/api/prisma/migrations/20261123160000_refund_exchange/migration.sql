ALTER TABLE "refunds" ADD COLUMN "exchange_sale_id" UUID;
CREATE INDEX "refunds_exchange_sale_id_idx" ON "refunds"("exchange_sale_id");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_exchange_sale_id_fkey" FOREIGN KEY ("exchange_sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
