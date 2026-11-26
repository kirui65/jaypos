import "dotenv/config";
import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PERMISSION_KEYS, DEFAULT_STAFF_PERMISSION_KEYS } from "@eminent/shared";

const prisma = new PrismaClient();
const permissionDescriptions: Record<string, string> = {
  "sales.create": "Create and complete sales",
  "sales.read.own": "View own sales",
  "sales.read.all": "View all sales",
  "sales.void": "Void completed sales",
  "stock.read": "View stock levels",
  "stock.write": "Receive and adjust stock",
  "stock.report": "Submit stock issue reports",
  "catalog.manage": "Create and edit catalog data",
  "customers.write": "Create and edit customers",
  "customers.delete": "Delete customers",
  "refunds.request": "Request sale refunds",
  "refunds.approve": "Approve or reject refunds",
  "staff.manage": "Manage staff accounts",
  "settings.manage": "Manage shop settings",
  "audit.read": "View audit history",
};

async function main() {
  const shop = await prisma.shop.upsert({
    where: { slug: "main" },
    update: {},
    create: {
      slug: "main",
      name: "Eminent Jay",
      settingsJson: {
        brand_name: "Eminent Jay",
        logo_url: "",
        address: "",
        phone: "",
        kra_pin: "",
        receipt_prefix: "EJ",
        receipt_footer: "Thank you for shopping with us",
        invoice_terms: "Please contact the shop with any questions about this invoice.",
        tax_enabled: false,
        tax_rate_bps: 0,
        tax_inclusive: false,
        currency: "KES",
        timeZone: "Africa/Nairobi",
      },
    },
  });

  const roles = await Promise.all(
    ["admin", "staff"].map((name) =>
      prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, description: name === "admin" ? "Shop owner" : "Shop staff" },
      }),
    ),
  );
  const roleByName = new Map(roles.map((role) => [role.name, role]));

  const permissions = await Promise.all(
    DEFAULT_PERMISSION_KEYS.map((key) => {
      const description = permissionDescriptions[key];
      if (!description) throw new Error(`Missing description for permission ${key}`);
      return prisma.permission.upsert({
        where: { key },
        update: { description },
        create: { key, description },
      });
    }),
  );
  const staffPermissionKeys = new Set<string>(DEFAULT_STAFF_PERMISSION_KEYS);
  for (const permission of permissions) {
    const allowedForStaff = staffPermissionKeys.has(permission.key);
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: roleByName.get("admin")!.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: roleByName.get("admin")!.id, permissionId: permission.id },
    });
    if (allowedForStaff) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: roleByName.get("staff")!.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: roleByName.get("staff")!.id, permissionId: permission.id },
      });
    }
  }

  const adminEmail = (process.env.ADMIN_SEED_EMAIL ?? "owner@retail.local").trim().toLowerCase();
  const configuredAdminPin = process.env.ADMIN_SEED_PIN?.trim();
  if (configuredAdminPin && !/^\d{8}$/.test(configuredAdminPin))
    throw new Error("ADMIN_SEED_PIN must contain exactly 8 digits");
  const existingAdmin = await prisma.user.findUnique({ where: { username: adminEmail } });
  if (existingAdmin && existingAdmin.shopId !== shop.id)
    throw new Error("The configured seed login is already assigned to another shop");
  const generatedAdminPin = !existingAdmin?.pinHash && !configuredAdminPin
    ? String(randomInt(10_000_000, 100_000_000))
    : undefined;
  const initialAdminPin = existingAdmin?.pinHash ? undefined : configuredAdminPin ?? generatedAdminPin;
  const adminPasswordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          mustChangePassword: false,
          ...(initialAdminPin ? { pinHash: await bcrypt.hash(initialAdminPin, 12) } : {}),
        },
      })
    : await prisma.user.create({
      data: {
        shopId: shop.id,
        roleId: roleByName.get("admin")!.id,
        name: "Shop Owner",
        username: adminEmail,
        email: adminEmail,
        passwordHash: adminPasswordHash,
        pinHash: await bcrypt.hash(initialAdminPin!, 12),
        mustChangePassword: false,
      },
    });
  if (generatedAdminPin) process.stdout.write(`Initial admin PIN: ${generatedAdminPin}\n`);

  const departmentDefinitions = [
    { code: "men", name: "Men" },
    { code: "ladies", name: "Ladies" },
    { code: "children", name: "Children" },
  ];
  const departments = new Map<string, { id: string }>();
  for (const department of departmentDefinitions) {
    const saved = await prisma.department.upsert({
      where: { shopId_code: { shopId: shop.id, code: department.code } },
      update: { name: department.name },
      create: { ...department, shopId: shop.id },
    });
    departments.set(department.code, saved);
  }

  const typeDefinitions = [
    { code: "perfumes", name: "Perfumes", attributes: { sizeMl: true, concentration: true } },
    { code: "cosmetics", name: "Cosmetics", attributes: { shade: true, volume: true } },
    { code: "clothing", name: "Clothing", attributes: { size: true, colour: true } },
  ];
  const types = new Map<string, { id: string }>();
  for (const type of typeDefinitions) {
    const saved = await prisma.productType.upsert({
      where: { shopId_code: { shopId: shop.id, code: type.code } },
      update: { name: type.name, attributeTemplateJson: type.attributes },
      create: {
        shopId: shop.id,
        code: type.code,
        name: type.name,
        attributeTemplateJson: type.attributes,
      },
    });
    types.set(type.code, saved);
  }

  const brand = await prisma.brand.upsert({
    where: { shopId_name: { shopId: shop.id, name: "Sample Brand" } },
    update: {},
    create: { shopId: shop.id, name: "Sample Brand" },
  });
  const samples = [
    {
      department: "men",
      type: "perfumes",
      name: "Amber Woods Eau de Parfum",
      sku: "SAMPLE-PERF-001",
      priceCents: 850_000,
      costCents: 500_000,
      attributes: { sizeMl: 100, concentration: "EDP" },
    },
    {
      department: "ladies",
      type: "perfumes",
      name: "Citrus Bloom Eau de Toilette",
      sku: "SAMPLE-PERF-002",
      priceCents: 550_000,
      costCents: 320_000,
      attributes: { sizeMl: 50, concentration: "EDT" },
    },
    {
      department: "ladies",
      type: "cosmetics",
      name: "Velvet Matte Lip Colour",
      sku: "SAMPLE-COS-001",
      priceCents: 125_000,
      costCents: 70_000,
      attributes: { shade: "Rosewood", volume: "4g" },
    },
    {
      department: "ladies",
      type: "cosmetics",
      name: "Velvet Matte Lip Colour",
      sku: "SAMPLE-COS-002",
      priceCents: 125_000,
      costCents: 70_000,
      attributes: { shade: "Berry", volume: "4g" },
    },
    {
      department: "children",
      type: "clothing",
      name: "Everyday Cotton T-Shirt",
      sku: "SAMPLE-CLO-001",
      priceCents: 180_000,
      costCents: 100_000,
      attributes: { size: "4-5Y", colour: "Navy" },
    },
    {
      department: "children",
      type: "clothing",
      name: "Everyday Cotton T-Shirt",
      sku: "SAMPLE-CLO-002",
      priceCents: 180_000,
      costCents: 100_000,
      attributes: { size: "6-7Y", colour: "Navy" },
    },
  ];
  for (const sample of samples) {
    const existingProduct = await prisma.product.findFirst({
      where: { shopId: shop.id, name: sample.name },
    });
    const product = existingProduct
      ? await prisma.product.update({
          where: { id: existingProduct.id },
          data: {
            departmentId: departments.get(sample.department)!.id,
            productTypeId: types.get(sample.type)!.id,
            brandId: brand.id,
          },
        })
      : await prisma.product.create({
          data: {
            shopId: shop.id,
            departmentId: departments.get(sample.department)!.id,
            productTypeId: types.get(sample.type)!.id,
            brandId: brand.id,
            name: sample.name,
          },
        });
    const variant = await prisma.productVariant.upsert({
      where: { shopId_sku: { shopId: shop.id, sku: sample.sku } },
      update: {
        shopId: shop.id,
        productId: product.id,
        attributesJson: sample.attributes,
        priceCents: sample.priceCents,
        costCents: sample.costCents,
      },
      create: {
        shopId: shop.id,
        productId: product.id,
        sku: sample.sku,
        attributesJson: sample.attributes,
        priceCents: sample.priceCents,
        costCents: sample.costCents,
      },
    });
    await prisma.$transaction(async (transaction) => {
      const openingMovement = await transaction.stockMovement.findFirst({
        where: {
          shopId: shop.id,
          variantId: variant.id,
          referenceType: "seed",
          referenceId: variant.id,
        },
      });
      if (openingMovement) return;

      await transaction.stockLevel.upsert({
        where: { shopId_variantId: { shopId: shop.id, variantId: variant.id } },
        update: { quantity: { increment: 10 } },
        create: { shopId: shop.id, variantId: variant.id, quantity: 10 },
      });
      await transaction.stockMovement.create({
        data: {
          shopId: shop.id,
          variantId: variant.id,
          quantityDelta: 10,
          type: "adjustment",
          referenceType: "seed",
          referenceId: variant.id,
          reason: "Development sample opening stock",
          userId: admin.id,
        },
      });
    });
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
