ALTER TABLE "product_variants"
  ADD COLUMN "image_url" TEXT,
  ADD COLUMN "is_tester" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "permissions" ("id", "key", "description")
VALUES ('00000000-0000-4000-8000-000000000099', 'catalog.manage', 'Create and edit catalog data')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'admin' AND p."key" = 'catalog.manage'
ON CONFLICT DO NOTHING;
