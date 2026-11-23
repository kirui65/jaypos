CREATE TABLE "damaged_stock_levels" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "damaged_stock_levels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "damaged_stock_levels_shop_id_variant_id_key" ON "damaged_stock_levels"("shop_id", "variant_id");
ALTER TABLE "damaged_stock_levels" ADD CONSTRAINT "damaged_stock_levels_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "damaged_stock_levels" ADD CONSTRAINT "damaged_stock_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
