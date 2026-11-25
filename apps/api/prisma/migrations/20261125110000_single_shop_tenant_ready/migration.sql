-- Retain the existing shop and its data while moving runtime branding and tax
-- configuration to settings_json and making business identifiers shop-scoped.
ALTER TABLE "shops" ADD COLUMN "slug" TEXT;
UPDATE "shops" SET "slug" = 'main' WHERE "slug" IS NULL;
ALTER TABLE "shops" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

UPDATE "shops"
SET "settings_json" =
  COALESCE("settings_json", '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
    'brand_name', COALESCE("settings_json" ->> 'brand_name', "name"),
    'logo_url', COALESCE("settings_json" ->> 'logo_url', "logo_url"),
    'address', COALESCE("settings_json" ->> 'address', "address"),
    'phone', COALESCE("settings_json" ->> 'phone', "phone"),
    'kra_pin', COALESCE("settings_json" ->> 'kra_pin', "kra_pin")
  ))
  || jsonb_build_object(
    'receipt_prefix', COALESCE("settings_json" -> 'receipt_prefix', to_jsonb('EJ'::text)),
    'receipt_footer', COALESCE("settings_json" -> 'receipt_footer', to_jsonb('Thank you for shopping with us'::text)),
    'invoice_terms', COALESCE("settings_json" -> 'invoice_terms', to_jsonb('Please contact the shop with any questions about this invoice.'::text)),
    'tax_enabled', COALESCE("settings_json" -> 'tax_enabled', 'false'::jsonb),
    'tax_rate_bps', COALESCE("settings_json" -> 'tax_rate_bps', '0'::jsonb),
    'tax_inclusive', COALESCE("settings_json" -> 'tax_inclusive', 'false'::jsonb)
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users" a
    JOIN "users" b ON a."id" <> b."id"
    WHERE lower(a."username") = lower(b."username")
       OR (a."email" IS NOT NULL AND b."email" IS NOT NULL AND lower(a."email") = lower(b."email"))
       OR (a."email" IS NOT NULL AND lower(a."email") = lower(b."username"))
       OR (b."email" IS NOT NULL AND lower(b."email") = lower(a."username"))
  ) THEN
    RAISE EXCEPTION 'Cannot make login identifiers globally unique: duplicate username/email values exist';
  END IF;
END
$$;

UPDATE "users" SET "username" = lower("username");
UPDATE "users" SET "email" = lower("email") WHERE "email" IS NOT NULL;
DROP INDEX "users_shop_id_username_key";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

DROP INDEX "product_variants_sku_key";
DROP INDEX "product_variants_barcode_key";
CREATE UNIQUE INDEX "product_variants_shop_id_sku_key" ON "product_variants"("shop_id", "sku");
CREATE UNIQUE INDEX "product_variants_shop_id_barcode_key" ON "product_variants"("shop_id", "barcode");

ALTER TABLE "auth_sessions" ADD COLUMN "shop_id" UUID;
UPDATE "auth_sessions" AS session
SET "shop_id" = "users"."shop_id"
FROM "users"
WHERE "users"."id" = session."user_id";
ALTER TABLE "auth_sessions" ALTER COLUMN "shop_id" SET NOT NULL;
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "auth_sessions_user_id_revoked_at_idx";
CREATE INDEX "auth_sessions_shop_id_user_id_revoked_at_idx"
  ON "auth_sessions"("shop_id", "user_id", "revoked_at");
