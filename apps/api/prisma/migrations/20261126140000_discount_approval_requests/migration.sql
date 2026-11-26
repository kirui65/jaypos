CREATE TYPE "DiscountApprovalStatus" AS ENUM ('requested', 'approved', 'rejected', 'used');

CREATE TABLE "discount_approval_requests" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "approver_id" UUID,
    "sale_id" UUID,
    "status" "DiscountApprovalStatus" NOT NULL DEFAULT 'requested',
    "cart_items_json" JSONB NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discount_approval_requests_sale_id_key" ON "discount_approval_requests"("sale_id");
CREATE INDEX "discount_approval_requests_shop_id_status_created_at_idx" ON "discount_approval_requests"("shop_id", "status", "created_at");
CREATE INDEX "discount_approval_requests_shop_id_requester_id_created_at_idx" ON "discount_approval_requests"("shop_id", "requester_id", "created_at");

ALTER TABLE "discount_approval_requests" ADD CONSTRAINT "discount_approval_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discount_approval_requests" ADD CONSTRAINT "discount_approval_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discount_approval_requests" ADD CONSTRAINT "discount_approval_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_approval_requests" ADD CONSTRAINT "discount_approval_requests_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
