import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { sessionShopId, shopData, shopRowWhere, shopWhere } from "../tenant-scope.js";
import { dataUrlPrefix, isShopProductImage, readProductImage, storeProductImage } from "../files.js";
import { readShopSettings } from "../shop-settings.js";

const objectJson = z.record(z.string(), z.unknown()).default({});
const imageUrlInput = z.union([
  z.string().url().max(2048),
  z
    .string()
    .max(300_000)
    .regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/),
]);
const departmentInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_-]+$/i),
  })
  .strict();
const typeInput = departmentInput
  .extend({
    parentId: z.string().uuid().nullable().optional(),
    attributeTemplate: objectJson,
    taxCategory: z.string().trim().max(80).nullable().optional(),
    returnWindowDays: z.number().int().min(0).max(3650).nullable().optional(),
  })
  .strict();
const departmentPatchInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_-]+$/i)
      .optional(),
    active: z.boolean().optional(),
  })
  .strict();
const typePatchInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9_-]+$/i)
      .optional(),
    parentId: z.string().uuid().nullable().optional(),
    attributeTemplate: objectJson.optional(),
    taxCategory: z.string().trim().max(80).nullable().optional(),
    returnWindowDays: z.number().int().min(0).max(3650).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
const variantInput = z
  .object({
    sku: z.string().trim().min(1).max(80),
    barcode: z.string().trim().max(100).nullable().optional(),
    attributes: objectJson,
    imageUrl: imageUrlInput.nullable().optional(),
    priceCents: z.number().int().min(0),
    costCents: z.number().int().min(0),
    reorderLevel: z.number().int().min(0).default(0),
    batchNo: z.string().trim().max(100).nullable().optional(),
    expiryDate: z.string().date().nullable().optional(),
    isBulk: z.boolean().default(false),
    bulkVolumeMl: z.number().int().positive().nullable().optional(),
    parentBulkVariantId: z.string().uuid().nullable().optional(),
    mlPerUnit: z.number().int().positive().nullable().optional(),
    isTesterAllowed: z.boolean().default(false),
    isTester: z.boolean().default(false),
  })
  .strict();
const productInput = z
  .object({
    departmentId: z.string().uuid(),
    productTypeId: z.string().uuid(),
    brandId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4000).nullable().optional(),
    attributes: objectJson,
    imageUrl: imageUrlInput.nullable().optional(),
    variants: z.array(variantInput).min(1).max(300),
  })
  .strict();
const productPatchInput = z
  .object({
    departmentId: z.string().uuid().optional(),
    productTypeId: z.string().uuid().optional(),
    brandId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    attributes: objectJson.optional(),
    imageUrl: imageUrlInput.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
const bundleInput = z
  .object({
    bundleVariantId: z.string().uuid(),
    components: z
      .array(
        z.object({ variantId: z.string().uuid(), quantity: z.number().int().positive() }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

function audit(
  request: AuthenticatedRequest,
  action: string,
  entity: string,
  entityId: string,
  after: unknown,
) {
  return prisma.auditLog.create({
    data: shopData(request, {
      userId: request.authUser!.id,
      action,
      entity,
      entityId,
      afterJson: after as Prisma.InputJsonValue,
      ip: request.ip ?? null,
    }),
  });
}
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
type CatalogVariantRecord = {
  id: string;
  sku: string;
  barcode: string | null;
  attributesJson: unknown;
  imageUrl: string | null;
  priceCents: number;
  costCents: number;
  reorderLevel: number;
  batchNo: string | null;
  expiryDate: Date | null;
  isBulk: boolean;
  bulkVolumeMl: number | null;
  parentBulkVariantId: string | null;
  mlPerUnit: number | null;
  isTester: boolean;
  stockLevels: { quantity: number; mlRemaining: number | null }[];
};
type CatalogProductRecord = {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  attributesJson: unknown;
  imageUrl: string | null;
  active: boolean;
  department: unknown;
  productType: unknown;
  brand: unknown;
  variants: CatalogVariantRecord[];
};

export function publicProduct(product: CatalogProductRecord, admin: boolean) {
  const imageSource = (imageUrl: string | null, kind: "products" | "variants", id: string) =>
    imageUrl?.startsWith(dataUrlPrefix) || isShopProductImage(product.shopId, imageUrl ?? "")
      ? `/api/catalog/${kind}/${id}/image`
      : imageUrl;
  const serializeVariant = (variant: CatalogVariantRecord) => ({
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    attributes: variant.attributesJson,
    imageUrl: imageSource(variant.imageUrl, "variants", variant.id),
    priceCents: variant.priceCents,
    ...(admin ? { costCents: variant.costCents } : {}),
    reorderLevel: variant.reorderLevel,
    batchNo: variant.batchNo,
    expiryDate: variant.expiryDate,
    isBulk: variant.isBulk,
    bulkVolumeMl: variant.bulkVolumeMl,
    parentBulkVariantId: variant.parentBulkVariantId,
    mlPerUnit: variant.mlPerUnit,
    stock: variant.stockLevels[0]?.quantity ?? 0,
    mlRemaining: variant.stockLevels[0]?.mlRemaining ?? null,
  });
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    attributes: product.attributesJson,
    imageUrl: imageSource(product.imageUrl, "products", product.id),
    active: product.active,
    department: product.department,
    productType: product.productType,
    brand: product.brand,
    variants: product.variants.filter((variant) => !variant.isTester).map(serializeVariant),
    ...(admin
      ? {
          testerVariants: product.variants
            .filter((variant) => variant.isTester)
            .map(serializeVariant),
        }
      : {}),
  };
}

function validateAttributes(
  templateValue: unknown,
  attributes: Record<string, unknown>,
): string | null {
  if (!templateValue || typeof templateValue !== "object" || Array.isArray(templateValue))
    return null;
  const template = templateValue as { fields?: unknown };
  if (!Array.isArray(template.fields)) return null;
  for (const entry of template.fields) {
    if (!entry || typeof entry !== "object") continue;
    const field = entry as { key?: unknown; required?: unknown; values?: unknown };
    if (typeof field.key !== "string") continue;
    const value = attributes[field.key];
    if (field.required === true && (value === undefined || value === null || value === ""))
      return `${field.key} is required`;
    if (value !== undefined && Array.isArray(field.values) && !field.values.includes(value))
      return `${field.key} must be one of the configured values`;
  }
  return null;
}

export const catalogRouter = Router();
catalogRouter.get(
  "/products/:id/image",
  requirePermission("stock.read"),
  async (request: AuthenticatedRequest, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success)
      return response.status(400).json({ error: "Invalid product id" });
    const product = await prisma.product.findFirst({
      where: shopWhere(request, { id: request.params.id! }),
      select: { imageUrl: true },
    });
    if (!product?.imageUrl) return response.status(404).json({ error: "Product photo not found" });
    try {
      const image = product.imageUrl.startsWith(dataUrlPrefix)
        ? Buffer.from(product.imageUrl.slice(dataUrlPrefix.length), "base64")
        : isShopProductImage(sessionShopId(request), product.imageUrl)
          ? await readProductImage(sessionShopId(request), product.imageUrl)
          : null;
      if (!image) return response.status(404).json({ error: "Product photo not found" });
      response.setHeader("Cache-Control", "private, max-age=86400, immutable");
      return response.type("image/webp").send(image);
    } catch {
      return response.status(404).json({ error: "Product photo not found" });
    }
  },
);

catalogRouter.get(
  "/variants/:id/image",
  requirePermission("stock.read"),
  async (request: AuthenticatedRequest, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success)
      return response.status(400).json({ error: "Invalid variant id" });
    const variant = await prisma.productVariant.findFirst({
      where: shopWhere(request, { id: request.params.id! }),
      select: { imageUrl: true },
    });
    if (!variant?.imageUrl) return response.status(404).json({ error: "Variant photo not found" });
    try {
      const image = variant.imageUrl.startsWith(dataUrlPrefix)
        ? Buffer.from(variant.imageUrl.slice(dataUrlPrefix.length), "base64")
        : isShopProductImage(sessionShopId(request), variant.imageUrl)
          ? await readProductImage(sessionShopId(request), variant.imageUrl)
          : null;
      if (!image) return response.status(404).json({ error: "Variant photo not found" });
      response.setHeader("Cache-Control", "private, max-age=86400, immutable");
      return response.type("image/webp").send(image);
    } catch {
      return response.status(404).json({ error: "Variant photo not found" });
    }
  },
);

catalogRouter.get(
  "/",
  requirePermission("stock.read"),
  async (request: AuthenticatedRequest, response) => {
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    const [departments, productTypes, brands, products, bundles, shop] = await Promise.all([
      prisma.department.findMany({ where: shopWhere(request, {}), orderBy: { name: "asc" } }),
      prisma.productType.findMany({ where: shopWhere(request, {}), orderBy: { name: "asc" } }),
      prisma.brand.findMany({ where: shopWhere(request, {}), orderBy: { name: "asc" } }),
      prisma.product.findMany({
        where: shopWhere(request, {}),
        include: {
          department: true,
          productType: true,
          brand: true,
          variants: {
            where: shopWhere(request, {}),
            include: { stockLevels: { where: shopWhere(request, {}) } },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.bundleItem.findMany({
        where: shopWhere(request, {}),
        select: { bundleVariantId: true, componentVariantId: true, quantity: true },
      }),
      prisma.shop.findUniqueOrThrow({
        where: shopRowWhere(request, {}),
        select: { settingsJson: true },
      }),
    ]);
    const settings = readShopSettings(shop.settingsJson);
    const isAdmin = request.authUser!.role.name === "admin";
    return response.json({
      departments,
      productTypes,
      brands,
      products: products.map((product) => publicProduct(product, isAdmin)),
      bundles,
      taxSettings: {
        enabled: settings.tax_enabled === true,
        rateBps: typeof settings.tax_rate_bps === "number" ? settings.tax_rate_bps : 0,
        inclusive: settings.tax_inclusive === true,
      },
    });
  },
);

catalogRouter.post(
  "/departments",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = departmentInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid department", details: parsed.error.flatten() });
    const row = await prisma.department.create({
      data: shopData(request, parsed.data),
    });
    await audit(request, "catalog.department_created", "department", row.id, row);
    return response.status(201).json(row);
  },
);
catalogRouter.patch(
  "/departments/:id",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = departmentPatchInput.safeParse(request.body);
    if (!parsed.success || !Object.keys(request.body ?? {}).length)
      return response.status(400).json({ error: "Invalid department update" });
    const where = shopWhere(request, { id: request.params.id! });
    const before = await prisma.department.findFirst({ where });
    if (!before) return response.status(404).json({ error: "Department not found" });
    const updated = await prisma.department.update({
      where: shopWhere(request, { id: before.id }),
      data: defined(parsed.data) as Prisma.DepartmentUncheckedUpdateInput,
    });
    await audit(request, "catalog.department_updated", "department", updated.id, {
      before,
      after: updated,
    });
    return response.json(updated);
  },
);
catalogRouter.post(
  "/product-types",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = typeInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid product type", details: parsed.error.flatten() });
    const data = parsed.data;
    const row = await prisma.productType.create({
      data: {
        ...shopData(request, {}),
        name: data.name,
        code: data.code,
        parentId: data.parentId ?? null,
        attributeTemplateJson: data.attributeTemplate as Prisma.InputJsonValue,
        taxCategory: data.taxCategory ?? null,
        returnWindowDays: data.returnWindowDays ?? null,
      },
    });
    await audit(request, "catalog.product_type_created", "product_type", row.id, row);
    return response.status(201).json(row);
  },
);
catalogRouter.patch(
  "/product-types/:id",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = typePatchInput.safeParse(request.body);
    if (!parsed.success || !Object.keys(request.body ?? {}).length)
      return response.status(400).json({ error: "Invalid product type update" });
    const where = shopWhere(request, { id: request.params.id! });
    const before = await prisma.productType.findFirst({ where });
    if (!before) return response.status(404).json({ error: "Product type not found" });
    if (parsed.data.parentId) {
      const parent = await prisma.productType.findFirst({
        where: shopWhere(request, { id: parsed.data.parentId }),
      });
      if (!parent)
        return response.status(400).json({ error: "Parent type must belong to this shop" });
    }
    const { attributeTemplate, ...fields } = parsed.data;
    const updated = await prisma.productType.update({
      where: shopWhere(request, { id: before.id }),
      data: defined({
        ...fields,
        ...(attributeTemplate
          ? { attributeTemplateJson: attributeTemplate as Prisma.InputJsonValue }
          : {}),
      }) as Prisma.ProductTypeUncheckedUpdateInput,
    });
    await audit(request, "catalog.product_type_updated", "product_type", updated.id, {
      before,
      after: updated,
    });
    return response.json(updated);
  },
);
catalogRouter.post(
  "/brands",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(120) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid brand" });
    const row = await prisma.brand.create({
      data: shopData(request, parsed.data),
    });
    await audit(request, "catalog.brand_created", "brand", row.id, row);
    return response.status(201).json(row);
  },
);
catalogRouter.post(
  "/products",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = productInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid product", details: parsed.error.flatten() });
    const input = parsed.data;
    const shopId = sessionShopId(request);
    const [department, productType, brand] = await Promise.all([
      prisma.department.findFirst({ where: shopWhere(request, { id: input.departmentId }) }),
      prisma.productType.findFirst({ where: shopWhere(request, { id: input.productTypeId }) }),
      input.brandId
        ? prisma.brand.findFirst({ where: shopWhere(request, { id: input.brandId }) })
        : Promise.resolve(true),
    ]);
    if (!department || !productType || !brand)
      return response
        .status(400)
        .json({ error: "Department, product type, and brand must belong to this shop" });
    for (const item of input.variants) {
      const attributeError = validateAttributes(productType.attributeTemplateJson, item.attributes);
      if (attributeError)
        return response.status(400).json({ error: `Variant ${item.sku}: ${attributeError}` });
      if (
        (item.isBulk || item.parentBulkVariantId || item.mlPerUnit) &&
        productType.code.toLowerCase() !== "perfumes"
      )
        return response
          .status(400)
          .json({ error: "Bulk and decant variants are only supported for perfumes" });
    }
    if (input.variants.some((variant) => variant.isTester && variant.isTesterAllowed))
      return response.status(400).json({ error: "Tester variants cannot be sellable" });
    const bulkIds = input.variants.flatMap((item) =>
      item.parentBulkVariantId ? [item.parentBulkVariantId] : [],
    );
    if (bulkIds.length) {
      const bulkVariants = await prisma.productVariant.findMany({
        where: shopWhere(request, { id: { in: bulkIds } }),
        include: { product: { include: { productType: true } } },
      });
      if (
        bulkVariants.length !== new Set(bulkIds).size ||
        bulkVariants.some(
          (variant) =>
            !variant.isBulk || variant.product.productType.code.toLowerCase() !== "perfumes",
        )
      )
        return response
          .status(400)
          .json({ error: "Decants must link to an existing perfume bulk variant in this shop" });
    }
    const productImageUrl = await storeProductImage(shopId, input.imageUrl);
    const variantImageUrls = await Promise.all(
      input.variants.map((item) => storeProductImage(shopId, item.imageUrl)),
    );
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: shopData(request, {
          departmentId: input.departmentId,
          productTypeId: input.productTypeId,
          brandId: input.brandId ?? null,
          name: input.name,
          description: input.description ?? null,
          attributesJson: input.attributes as Prisma.InputJsonValue,
          imageUrl: productImageUrl ?? null,
        }),
      });
      for (const [index, item] of input.variants.entries())
        await tx.productVariant.create({
          data: shopData(request, {
            productId: product.id,
            sku: item.sku,
            barcode: item.barcode ?? null,
            attributesJson: item.attributes as Prisma.InputJsonValue,
            imageUrl: variantImageUrls[index] ?? null,
            priceCents: item.priceCents,
            costCents: item.costCents,
            reorderLevel: item.reorderLevel,
            batchNo: item.batchNo ?? null,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            isBulk: item.isBulk,
            bulkVolumeMl: item.bulkVolumeMl ?? null,
            parentBulkVariantId: item.parentBulkVariantId ?? null,
            mlPerUnit: item.mlPerUnit ?? null,
            isTesterAllowed: item.isTesterAllowed,
            isTester: item.isTester,
          }),
        });
      await tx.auditLog.create({
        data: shopData(request, {
          userId: request.authUser!.id,
          action: "catalog.product_created",
          entity: "product",
          entityId: product.id,
          afterJson: { name: product.name, variantCount: input.variants.length },
          ip: request.ip ?? null,
        }),
      });
      return product;
    });
    return response.status(201).json({ id: created.id, name: created.name });
  },
);
catalogRouter.patch(
  "/products/:id",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = productPatchInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid product update", details: parsed.error.flatten() });
    const shopId = sessionShopId(request);
    const before = await prisma.product.findFirst({
      where: shopWhere(request, { id: request.params.id! }),
    });
    if (!before) return response.status(404).json({ error: "Product not found" });
    const [department, productType, brand] = await Promise.all([
      parsed.data.departmentId
        ? prisma.department.findFirst({ where: shopWhere(request, { id: parsed.data.departmentId }) })
        : Promise.resolve(true),
      parsed.data.productTypeId
        ? prisma.productType.findFirst({ where: shopWhere(request, { id: parsed.data.productTypeId }) })
        : Promise.resolve(true),
      parsed.data.brandId
        ? prisma.brand.findFirst({ where: shopWhere(request, { id: parsed.data.brandId }) })
        : Promise.resolve(true),
    ]);
    if (!department || !productType || !brand)
      return response
        .status(400)
        .json({ error: "Department, product type, and brand must belong to this shop" });
    const { attributes, ...fields } = parsed.data;
    const imageUrl = await storeProductImage(shopId, fields.imageUrl);
    const data = defined({
      ...fields,
      ...(fields.imageUrl !== undefined ? { imageUrl } : {}),
      ...(attributes ? { attributesJson: attributes as Prisma.InputJsonValue } : {}),
    }) as Prisma.ProductUncheckedUpdateInput;
    const updated = await prisma.product.update({
      where: shopWhere(request, { id: before.id }),
      data,
    });
    await audit(request, "catalog.product_updated", "product", updated.id, {
      before,
      after: updated,
    });
    return response.json({ id: updated.id, name: updated.name, active: updated.active });
  },
);
catalogRouter.patch(
  "/variants/:id",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = variantInput.partial().strict().safeParse(request.body);
    if (!parsed.success || !Object.keys(request.body ?? {}).length)
      return response.status(400).json({
        error: "Invalid variant update",
        details: parsed.success ? undefined : parsed.error.flatten(),
      });
    const shopId = sessionShopId(request);
    const before = await prisma.productVariant.findFirst({
      where: shopWhere(request, { id: request.params.id! }),
    });
    if (!before) return response.status(404).json({ error: "Variant not found" });
    const { attributes, expiryDate, ...fields } = parsed.data;
    if (parsed.data.isTester === true && parsed.data.isTesterAllowed === true)
      return response.status(400).json({ error: "Tester variants cannot be sellable" });
    const imageUrl = await storeProductImage(shopId, fields.imageUrl);
    const updateData = defined({
      ...fields,
      ...(fields.imageUrl !== undefined ? { imageUrl } : {}),
      ...(attributes ? { attributesJson: attributes as Prisma.InputJsonValue } : {}),
      ...(expiryDate !== undefined ? { expiryDate: expiryDate ? new Date(expiryDate) : null } : {}),
    }) as Prisma.ProductVariantUncheckedUpdateInput;
    const updated = await prisma.productVariant.update({
      where: shopWhere(request, { id: before.id }),
      data: updateData,
    });
    await audit(request, "catalog.variant_updated", "product_variant", updated.id, {
      before,
      after: updated,
    });
    return response.json({ id: updated.id, sku: updated.sku });
  },
);
catalogRouter.post(
  "/bundles",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = bundleInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid bundle", details: parsed.error.flatten() });
    const ids = [
      parsed.data.bundleVariantId,
      ...parsed.data.components.map((item) => item.variantId),
    ];
    if (new Set(ids).size !== ids.length)
      return response.status(400).json({ error: "Bundle and component variants must be distinct" });
    const variants = await prisma.productVariant.findMany({
      where: shopWhere(request, { id: { in: ids } }),
      include: { product: { include: { productType: true } } },
    });
    if (variants.length !== ids.length)
      return response.status(400).json({ error: "All variants must belong to this shop" });
    const bundle = variants.find(({ id }) => id === parsed.data.bundleVariantId)!;
    if (
      bundle.product.productType.code !== "gift-sets" &&
      bundle.product.productType.code !== "gift_sets"
    )
      return response
        .status(400)
        .json({ error: "Bundle product must use the gift sets product type" });
    await prisma.$transaction(async (tx) => {
      await tx.bundleItem.deleteMany({
        where: shopWhere(request, { bundleVariantId: bundle.id }),
      });
      await tx.bundleItem.createMany({
        data: parsed.data.components.map((item) => shopData(request, {
          bundleVariantId: bundle.id,
          componentVariantId: item.variantId,
          quantity: item.quantity,
        })),
      });
      await tx.auditLog.create({
        data: shopData(request, {
          userId: request.authUser!.id,
          action: "catalog.bundle_updated",
          entity: "product_variant",
          entityId: bundle.id,
          afterJson: parsed.data as Prisma.InputJsonValue,
          ip: request.ip ?? null,
        }),
      });
    });
    return response.status(204).end();
  },
);
