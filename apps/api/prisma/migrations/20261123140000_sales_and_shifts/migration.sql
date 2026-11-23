CREATE TABLE "held_carts" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "label" TEXT,
    "cart_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "held_carts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receipt_counters" (
    "shop_id" UUID NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "receipt_counters_pkey" PRIMARY KEY ("shop_id")
);

CREATE INDEX "held_carts_shop_id_seller_id_created_at_idx" ON "held_carts"("shop_id", "seller_id", "created_at");
CREATE UNIQUE INDEX "shifts_one_open_per_seller" ON "shifts"("shop_id", "seller_id") WHERE "closed_at" IS NULL;
CREATE UNIQUE INDEX "sales_shop_id_receipt_no_key" ON "sales"("shop_id", "receipt_no");

ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "held_carts" ADD CONSTRAINT "held_carts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
