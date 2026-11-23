CREATE TYPE "StockReportType" AS ENUM ('damage', 'tester', 'count');
CREATE TYPE "StockReportStatus" AS ENUM ('pending', 'reviewed', 'dismissed');

CREATE TABLE "stock_reports" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "type" "StockReportType" NOT NULL,
    "quantity" INTEGER,
    "reason" TEXT NOT NULL,
    "photo_url" TEXT,
    "status" "StockReportStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_reports_shop_id_status_created_at_idx" ON "stock_reports"("shop_id", "status", "created_at");
ALTER TABLE "stock_reports" ADD CONSTRAINT "stock_reports_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reports" ADD CONSTRAINT "stock_reports_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reports" ADD CONSTRAINT "stock_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description")
VALUES ('00000000-0000-4000-8000-000000000098', 'stock.report', 'Submit stock issue reports')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" IN ('admin', 'staff') AND p."key" = 'stock.report'
ON CONFLICT DO NOTHING;
