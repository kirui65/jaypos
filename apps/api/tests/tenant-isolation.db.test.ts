import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp as createAppFunction } from "../src/app.js";
import type { prisma as prismaSingleton } from "../src/db.js";
import type supertest from "supertest";

const databaseUrl = process.env.TENANT_TEST_DATABASE_URL;
if (databaseUrl) {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!databaseName.includes("tenant_test")) {
    throw new Error("TENANT_TEST_DATABASE_URL must point to a database with tenant_test in its name");
  }
  process.env.DATABASE_URL = databaseUrl;
}

const testSuite = databaseUrl ? describe : describe.skip;

testSuite("session shop isolation on main list endpoints", () => {
  let prisma: typeof prismaSingleton;
  let app: ReturnType<typeof createAppFunction>;
  let request: typeof supertest;
  let mainCookie = "";
  let mainFixture: {
    shopId: string;
    ownerId: string;
    staffId: string;
    productId: string;
    variantId: string;
    customerId: string;
    saleId: string;
    token: string;
  };
  let otherFixture: {
    shopId: string;
    ownerId: string;
    staffId: string;
    productId: string;
    variantId: string;
    customerId: string;
    saleId: string;
    token: string;
  };

  beforeAll(async () => {
    if (!databaseUrl) return;
    const [{ prisma: db }, { createApp }, supertest] = await Promise.all([
      import("../src/db.js"),
      import("../src/app.js"),
      import("supertest"),
    ]);
    prisma = db;
    const runSuffix = randomUUID().slice(0, 8);
    const mainSlug = `tenant-test-main-${runSuffix}`;
    process.env.PUBLIC_SHOP_SLUG = mainSlug;
    app = createApp();
    request = supertest.default;

    const adminRole = await prisma.role.upsert({
      where: { name: "admin" },
      update: {},
      create: { name: "admin", description: "Test administrator" },
    });
    const staffRole = await prisma.role.upsert({
      where: { name: "staff" },
      update: {},
      create: { name: "staff", description: "Test staff" },
    });
    const requiredPermissions = await Promise.all(
      ["sales.read.own", "stock.read", "customers.write", "staff.manage"].map((key) =>
        prisma.permission.upsert({ where: { key }, update: {}, create: { key } }),
      ),
    );
    await prisma.rolePermission.createMany({
      data: requiredPermissions.map((permission) => ({
        roleId: adminRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });

    async function seedShop(prefix: string, slug: string) {
      const shop = await prisma.shop.create({
        data: {
          slug,
          name: `Legacy name ${prefix}`,
          settingsJson: {
            brand_name: `Configured ${prefix}`,
            logo_url: `/shops/${prefix.toLowerCase()}/logo.webp`,
            tax_enabled: prefix === "Main",
            tax_rate_bps: prefix === "Main" ? 1600 : 0,
            tax_inclusive: true,
          },
        },
      });
      const owner = await prisma.user.create({
        data: {
          shopId: shop.id,
          roleId: adminRole.id,
          name: `${prefix} owner`,
          username: `tenant_test_${prefix.toLowerCase()}_${runSuffix}_owner`,
          passwordHash: "not-used-by-test",
          mustChangePassword: false,
        },
      });
      const staff = await prisma.user.create({
        data: {
          shopId: shop.id,
          roleId: staffRole.id,
          name: `${prefix} staff`,
          username: `tenant_test_${prefix.toLowerCase()}_${runSuffix}_staff`,
          passwordHash: "not-used-by-test",
          mustChangePassword: false,
        },
      });
      const token = `tenant-test-session-${prefix}-${runSuffix}`;
      await prisma.authSession.create({
        data: {
          shopId: shop.id,
          userId: owner.id,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const department = await prisma.department.create({
        data: { shopId: shop.id, name: "Test department", code: "test" },
      });
      const productType = await prisma.productType.create({
        data: { shopId: shop.id, name: "Test type", code: "test" },
      });
      const product = await prisma.product.create({
        data: {
          shopId: shop.id,
          departmentId: department.id,
          productTypeId: productType.id,
          name: `${prefix} product`,
        },
      });
      const variant = await prisma.productVariant.create({
        data: {
          shopId: shop.id,
          productId: product.id,
          sku: "SHARED-TEST-SKU",
          barcode: "SHARED-TEST-BARCODE",
          priceCents: 1000,
          costCents: 500,
        },
      });
      const customer = await prisma.customer.create({
        data: { shopId: shop.id, name: `${prefix} customer`, phone: "+254700000001" },
      });
      const shift = await prisma.shift.create({
        data: { shopId: shop.id, sellerId: owner.id, openingCashCents: 0 },
      });
      const sale = await prisma.sale.create({
        data: {
          shopId: shop.id,
          clientUuid: randomUUID(),
          receiptNo: "SHARED-TEST-RECEIPT",
          shiftId: shift.id,
          sellerId: owner.id,
          subtotalCents: 1000,
          totalCents: 1000,
          paidCents: 1000,
          status: "completed",
        },
      });
      await prisma.stockLevel.create({
        data: { shopId: shop.id, variantId: variant.id, quantity: 7 },
      });
      return {
        shopId: shop.id,
        ownerId: owner.id,
        staffId: staff.id,
        productId: product.id,
        variantId: variant.id,
        customerId: customer.id,
        saleId: sale.id,
        token,
      };
    }

    mainFixture = await seedShop("Main", mainSlug);
    otherFixture = await seedShop("Other", `tenant-test-other-${runSuffix}`);
    mainCookie = `ej_session=${mainFixture.token}`;
  });

  afterAll(async () => {
    if (databaseUrl && prisma!) await prisma.$disconnect();
  });

  it("allows receipt, SKU, barcode, and customer phone values to repeat across shops", () => {
    expect(mainFixture.shopId).not.toBe(otherFixture.shopId);
    expect(mainFixture.variantId).not.toBe(otherFixture.variantId);
  });

  it("keeps the sales, products, customers, staff, and stock lists inside the session shop", async () => {
    const sales = await request(app).get("/api/sales").set("Cookie", mainCookie).expect(200);
    const products = await request(app).get("/api/catalog").set("Cookie", mainCookie).expect(200);
    const customers = await request(app).get("/api/customers").set("Cookie", mainCookie).expect(200);
    const staff = await request(app).get("/api/auth/staff").set("Cookie", mainCookie).expect(200);
    const stock = await request(app).get("/api/stock").set("Cookie", mainCookie).expect(200);

    expect(sales.body.sales.map((row: { id: string }) => row.id)).toContain(mainFixture.saleId);
    expect(sales.body.sales.map((row: { id: string }) => row.id)).not.toContain(otherFixture.saleId);
    expect(products.body.products.map((row: { id: string }) => row.id)).toContain(mainFixture.productId);
    expect(products.body.products.map((row: { id: string }) => row.id)).not.toContain(otherFixture.productId);
    expect(customers.body.customers.map((row: { id: string }) => row.id)).toContain(mainFixture.customerId);
    expect(customers.body.customers.map((row: { id: string }) => row.id)).not.toContain(otherFixture.customerId);
    expect(staff.body.staff.map((row: { id: string }) => row.id)).toContain(mainFixture.staffId);
    expect(staff.body.staff.map((row: { id: string }) => row.id)).not.toContain(otherFixture.staffId);
    expect(stock.body.stock.map((row: { variantId: string }) => row.variantId)).toContain(mainFixture.variantId);
    expect(stock.body.stock.map((row: { variantId: string }) => row.variantId)).not.toContain(otherFixture.variantId);
    expect(products.body.taxSettings).toEqual({ enabled: true, rateBps: 1600, inclusive: true });
  });

  it("loads public brand values from settings_json instead of legacy shop columns", async () => {
    const brand = await request(app).get("/api/brand").expect(200);
    expect(brand.body).toEqual({
      brandName: "Configured Main",
      logoUrl: "/shops/main/logo.webp",
    });
  });

  it("rejects duplicate identifiers inside one shop", async () => {
    await expect(
      prisma.productVariant.create({
        data: {
          shopId: mainFixture.shopId,
          productId: mainFixture.productId,
          sku: "SHARED-TEST-SKU",
          priceCents: 1000,
          costCents: 500,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.productVariant.create({
        data: {
          shopId: mainFixture.shopId,
          productId: mainFixture.productId,
          sku: "OTHER-TEST-SKU",
          barcode: "SHARED-TEST-BARCODE",
          priceCents: 1000,
          costCents: 500,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.customer.create({
        data: { shopId: mainFixture.shopId, name: "Duplicate phone", phone: "+254700000001" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.sale.create({
        data: {
          shopId: mainFixture.shopId,
          clientUuid: randomUUID(),
          receiptNo: "SHARED-TEST-RECEIPT",
          shiftId: (await prisma.shift.findFirstOrThrow({ where: { shopId: mainFixture.shopId } })).id,
          sellerId: mainFixture.ownerId,
          status: "completed",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
