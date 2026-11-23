import { randomUUID } from "node:crypto";
import { PaymentStatus, Prisma, SaleStatus } from "@prisma/client";
import type { PaymentMethod, StockMovementType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { canAccess } from "../auth/permissions.js";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { allocateSalePayments, calculateSaleTotals, type SalePayment } from "./math.js";

const itemInput = z
  .object({
    variantId: z.string().uuid(),
    quantity: z.number().int().positive().max(500),
    discountCents: z.number().int().min(0).default(0),
  })
  .strict();
const saleInput = z
  .object({
    clientUuid: z.string().uuid(),
    deviceId: z.string().trim().max(120).optional(),
    customerId: z.string().uuid().nullable().optional(),
    items: z.array(itemInput).min(1).max(200),
    cartDiscountCents: z.number().int().min(0).default(0),
    discountReason: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
    payments: z
      .array(
        z.discriminatedUnion("method", [
          z
            .object({ method: z.literal("cash"), amountCents: z.number().int().positive() })
            .strict(),
          z
            .object({
              method: z.literal("mpesa_manual"),
              amountCents: z.number().int().positive(),
              mpesaReceipt: z.string().trim().min(1).max(40),
            })
            .strict(),
          z
            .object({ method: z.literal("card"), amountCents: z.number().int().positive() })
            .strict(),
        ]),
      )
      .min(1)
      .max(5),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map(({ variantId }) => variantId)).size === value.items.length,
    { message: "Each variant may appear only once per sale", path: ["items"] },
  );

const heldCartInput = z
  .object({
    label: z.string().trim().max(120).optional(),
    customerId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    items: z.array(itemInput).min(1).max(200),
  })
  .strict();

const saleInclude = {
  items: { include: { variant: { include: { product: true } } } },
  payments: true,
  seller: { select: { id: true, name: true } },
} satisfies Prisma.SaleInclude;
type SaleRecord = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

export function serializeSale(sale: SaleRecord, admin: boolean) {
  const items = sale.items.map(({ variant, ...item }) => {
    const { unitCostCents, ...safeItem } = item;
    return {
      ...safeItem,
      ...(admin ? { unitCostCents } : {}),
      variant: {
        id: variant.id,
        sku: variant.sku,
        product: { id: variant.product.id, name: variant.product.name },
      },
    };
  });
  const result = {
    id: sale.id,
    clientUuid: sale.clientUuid,
    receiptNo: sale.receiptNo,
    status: sale.status,
    subtotalCents: sale.subtotalCents,
    discountCents: sale.discountCents,
    taxCents: sale.taxCents,
    totalCents: sale.totalCents,
    paidCents: sale.paidCents,
    changeCents: sale.changeCents,
    notes: sale.notes,
    createdAt: sale.createdAt,
    seller: sale.seller,
    items,
    payments: sale.payments.map(
      ({ rawCallbackJson: _rawCallbackJson, rawRequestJson: _rawRequestJson, ...payment }) =>
        payment,
    ),
  };
  if (!admin) return result;
  const costCents = sale.items.reduce((sum, item) => sum + item.unitCostCents * item.qty, 0);
  return {
    ...result,
    items: sale.items.map(({ variant, ...item }) => ({
      ...item,
      variant: {
        id: variant.id,
        sku: variant.sku,
        product: { id: variant.product.id, name: variant.product.name },
      },
    })),
    costCents,
    profitCents: sale.totalCents - costCents,
  };
}

type StockDemand = {
  variantId: string;
  quantity: number;
  ml: number;
  movementType: StockMovementType;
};
export function planStockDemands(
  lines: {
    variantId: string;
    stockVariantId?: string;
    quantity: number;
    mlPerUnit?: number;
    kind: "regular" | "decant" | "bulk" | "component";
  }[],
  bundleComponents: {
    bundleVariantId: string;
    componentVariantId: string;
    quantity: number;
    bulkVolumeMl?: number | null;
  }[],
) {
  const demands = new Map<string, StockDemand>();
  const add = (
    variantId: string,
    quantity: number,
    ml: number,
    movementType: StockMovementType,
  ) => {
    const existing = demands.get(variantId);
    demands.set(variantId, {
      variantId,
      quantity: (existing?.quantity ?? 0) + quantity,
      ml: (existing?.ml ?? 0) + ml,
      movementType:
        existing?.movementType === "decant" || movementType === "decant" ? "decant" : "sale",
    });
  };
  for (const line of lines) {
    const components = bundleComponents.filter(
      (component) => component.bundleVariantId === line.variantId,
    );
    if (components.length) {
      for (const component of components)
        add(
          component.componentVariantId,
          component.quantity * line.quantity,
          (component.bulkVolumeMl ?? 0) * component.quantity * line.quantity,
          "sale",
        );
    } else if (line.kind === "decant") {
      if (!line.mlPerUnit || line.mlPerUnit < 1)
        throw new Error("Decant variant must have a positive mlPerUnit");
      if (!line.stockVariantId) throw new Error("Decant variant must link to a bulk stock variant");
      add(line.stockVariantId, 0, line.mlPerUnit * line.quantity, "decant");
    } else if (line.kind === "bulk") {
      if (!line.mlPerUnit || line.mlPerUnit < 1)
        throw new Error("Bulk variant must have a positive bulkVolumeMl");
      add(line.variantId, line.quantity, line.mlPerUnit * line.quantity, "sale");
    } else {
      add(line.variantId, line.quantity, 0, "sale");
    }
  }
  return [...demands.values()];
}

function paymentPlan(payments: z.infer<typeof saleInput>["payments"], totalCents: number) {
  const normalized: SalePayment[] = payments.map((payment) => payment);
  const allocated = allocateSalePayments(normalized, totalCents);
  return allocated.applied.map((payment) => ({
    method: payment.method as PaymentMethod,
    status:
      payment.method === "mpesa_manual" ? PaymentStatus.pending_verification : PaymentStatus.paid,
    amountCents: payment.appliedCents,
    ...(payment.method === "mpesa_manual" ? { mpesaReceipt: payment.mpesaReceipt } : {}),
  }));
}

async function findSale(shopId: string, clientUuid: string) {
  return prisma.sale.findFirst({ where: { shopId, clientUuid }, include: saleInclude });
}

export const salesRouter = Router();
salesRouter.get(
  "/",
  requirePermission("sales.read.own"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    const canReadAll = canAccess(user, "sales.read.all");
    const all = canReadAll && request.query.scope === "all";
    const sales = await prisma.sale.findMany({
      where: { shopId: user.shopId, ...(all ? {} : { sellerId: user.id }) },
      include: saleInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return response.json({
      sales: sales.map((sale) => serializeSale(sale, user.role.name === "admin")),
    });
  },
);

salesRouter.post(
  "/",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = saleInput.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({ error: "Invalid sale", details: parsed.error.flatten() });
    const user = request.authUser!;
    const shopId = user.shopId;
    const prior = await findSale(shopId, parsed.data.clientUuid);
    if (prior)
      return response.json({
        sale: serializeSale(prior, user.role.name === "admin"),
        duplicate: true,
      });
    try {
      const created = await prisma.$transaction(
        async (tx) => {
          const shift = await tx.shift.findFirst({
            where: { shopId, sellerId: user.id, closedAt: null },
          });
          if (!shift) throw new Error("Open a shift before completing a sale");
          const shop = await tx.shop.findUniqueOrThrow({
            where: { id: shopId },
            select: { settingsJson: true },
          });
          const settings = (shop.settingsJson ?? {}) as Record<string, unknown>;
          const allowNegativeStock = settings.allow_negative_stock === true;
          const variants = await tx.productVariant.findMany({
            where: { shopId, id: { in: parsed.data.items.map(({ variantId }) => variantId) } },
            include: {
              product: { include: { productType: true } },
              parentBulkVariant: { include: { product: { include: { productType: true } } } },
              bundleComponents: {
                include: {
                  component: {
                    include: { product: { include: { productType: true } } },
                  },
                },
              },
            },
          });
          if (variants.length !== parsed.data.items.length)
            throw new Error("One or more variants are not available in this shop");
          const variantById = new Map(variants.map((variant) => [variant.id, variant]));
          const lines = parsed.data.items.map((input) => {
            const variant = variantById.get(input.variantId)!;
            if (!variant.active || !variant.product.active || variant.isTester)
              throw new Error("Variant " + variant.sku + " is not sellable");
            if (
              variant.parentBulkVariantId &&
              (!variant.parentBulkVariant?.isBulk ||
                variant.parentBulkVariant.product.productType.code.toLowerCase() !== "perfumes" ||
                variant.product.productType.code.toLowerCase() !== "perfumes" ||
                !variant.mlPerUnit)
            )
              throw new Error("Decant variant " + variant.sku + " is misconfigured");
            if (
              ["gift-sets", "gift_sets"].includes(variant.product.productType.code.toLowerCase()) &&
              !variant.bundleComponents.length
            )
              throw new Error("Gift set " + variant.sku + " has no bundle components");
            if (
              variant.bundleComponents.length &&
              variant.bundleComponents.some(
                ({ component }) =>
                  component.isTester ||
                  component.parentBulkVariantId ||
                  (component.isBulk && !component.bulkVolumeMl) ||
                  ["gift-sets", "gift_sets"].includes(
                    component.product.productType.code.toLowerCase(),
                  ),
              )
            )
              throw new Error("Bundle " + variant.sku + " has an unsupported component");
            const bundleCost = variant.bundleComponents.reduce(
              (sum, component) => sum + component.component.costCents * component.quantity,
              0,
            );
            const unitCostCents = variant.bundleComponents.length
              ? bundleCost
              : variant.parentBulkVariant && variant.parentBulkVariant.bulkVolumeMl
                ? Math.round(
                    (variant.parentBulkVariant.costCents * variant.mlPerUnit!) /
                      variant.parentBulkVariant.bulkVolumeMl,
                  )
                : variant.costCents;
            if (input.discountCents > variant.priceCents * input.quantity)
              throw new Error("Discount exceeds line price for " + variant.sku);
            return { input, variant, unitCostCents, unitPriceCents: variant.priceCents };
          });
          const total = calculateSaleTotals(
            lines.map(({ input, unitPriceCents }) => ({
              unitPriceCents,
              quantity: input.quantity,
              discountCents: input.discountCents,
            })),
            parsed.data.cartDiscountCents,
          );
          const userDiscountLimit = user.role.name === "admin" ? 100 : user.discountLimitPct;
          if (
            total.subtotalCents > 0 &&
            total.discountCents * 100 > total.subtotalCents * userDiscountLimit
          )
            throw new Error("Discount exceeds your permitted limit");
          const reasonThreshold =
            typeof settings.discount_reason_threshold_pct === "number"
              ? settings.discount_reason_threshold_pct
              : 0;
          if (
            total.subtotalCents > 0 &&
            total.discountCents * 100 > total.subtotalCents * reasonThreshold &&
            !parsed.data.discountReason
          )
            throw new Error("A discount reason is required");
          if (
            parsed.data.customerId &&
            !(await tx.customer.findFirst({ where: { id: parsed.data.customerId, shopId } }))
          )
            throw new Error("Customer not found in this shop");
          const paymentRows = paymentPlan(parsed.data.payments, total.totalCents);
          const bundleComponents = variants.flatMap((variant) =>
            variant.bundleComponents.map(({ component, quantity }) => ({
              bundleVariantId: variant.id,
              componentVariantId: component.id,
              quantity,
              bulkVolumeMl: component.isBulk ? component.bulkVolumeMl : null,
            })),
          );
          const demands = planStockDemands(
            lines.map(({ input, variant }) => ({
              variantId: variant.id,
              ...(variant.parentBulkVariantId
                ? { stockVariantId: variant.parentBulkVariantId }
                : {}),
              quantity: input.quantity,
              ...(variant.parentBulkVariantId && variant.mlPerUnit
                ? { mlPerUnit: variant.mlPerUnit }
                : variant.bulkVolumeMl
                  ? { mlPerUnit: variant.bulkVolumeMl }
                  : {}),
              kind: variant.parentBulkVariantId
                ? ("decant" as const)
                : variant.isBulk
                  ? ("bulk" as const)
                  : ("regular" as const),
            })),
            bundleComponents,
          );
          const saleId = randomUUID();
          for (const demand of demands) {
            const variant = await tx.productVariant.findFirst({
              where: { id: demand.variantId, shopId },
            });
            if (!variant) throw new Error("Bundle component not found in this shop");
            const stockLevel = await tx.stockLevel.findUnique({
              where: { shopId_variantId: { shopId, variantId: demand.variantId } },
            });
            if (!allowNegativeStock) {
              const where: Prisma.StockLevelWhereInput = {
                shopId,
                variantId: demand.variantId,
                ...(demand.quantity ? { quantity: { gte: demand.quantity } } : {}),
                ...(demand.ml ? { mlRemaining: { gte: demand.ml } } : {}),
              };
              const changed = await tx.stockLevel.updateMany({
                where,
                data: {
                  ...(demand.quantity ? { quantity: { decrement: demand.quantity } } : {}),
                  ...(demand.ml ? { mlRemaining: { decrement: demand.ml } } : {}),
                },
              });
              if (!changed.count) throw new Error("Insufficient stock for " + variant.sku);
            } else {
              await tx.stockLevel.upsert({
                where: { shopId_variantId: { shopId, variantId: demand.variantId } },
                create: {
                  shopId,
                  variantId: demand.variantId,
                  quantity: -demand.quantity,
                  mlRemaining: demand.ml ? -demand.ml : null,
                },
                update: {
                  ...(demand.quantity ? { quantity: { decrement: demand.quantity } } : {}),
                  ...(demand.ml
                    ? {
                        mlRemaining:
                          stockLevel?.mlRemaining === null ? -demand.ml : { decrement: demand.ml },
                      }
                    : {}),
                },
              });
            }
            await tx.stockMovement.create({
              data: {
                shopId,
                variantId: demand.variantId,
                quantityDelta: -demand.quantity,
                mlDelta: demand.ml ? -demand.ml : null,
                type: demand.movementType,
                referenceType: "sale",
                referenceId: saleId,
                reason: "Completed sale",
                userId: user.id,
              },
            });
          }
          const counter = await tx.receiptCounter.upsert({
            where: { shopId },
            create: { shopId, lastValue: 1 },
            update: { lastValue: { increment: 1 } },
          });
          const receiptNo = "EJ-" + String(counter.lastValue).padStart(6, "0");
          const sale = await tx.sale.create({
            data: {
              id: saleId,
              shopId,
              clientUuid: parsed.data.clientUuid,
              receiptNo,
              deviceId: parsed.data.deviceId ?? null,
              shiftId: shift.id,
              sellerId: user.id,
              customerId: parsed.data.customerId ?? null,
              status: SaleStatus.completed,
              subtotalCents: total.subtotalCents,
              discountCents: total.discountCents,
              taxCents: 0,
              totalCents: total.totalCents,
              paidCents: total.totalCents,
              changeCents: allocateSalePayments(
                parsed.data.payments as SalePayment[],
                total.totalCents,
              ).changeCents,
              notes: parsed.data.notes ?? null,
              items: {
                create: lines.map(({ input, variant, unitPriceCents, unitCostCents }) => ({
                  shopId,
                  variantId: variant.id,
                  qty: input.quantity,
                  mlQty: variant.parentBulkVariantId ? input.quantity * variant.mlPerUnit! : null,
                  unitPriceCents,
                  unitCostCents,
                  discountCents: input.discountCents,
                  taxCents: 0,
                  lineTotalCents: unitPriceCents * input.quantity - input.discountCents,
                })),
              },
              payments: {
                create: paymentRows.map(({ method, status, amountCents, ...extra }) => ({
                  shopId,
                  method,
                  status,
                  amountCents,
                  ...extra,
                })),
              },
            },
            include: saleInclude,
          });
          await tx.auditLog.create({
            data: {
              shopId,
              userId: user.id,
              action: "sale.completed",
              entity: "sale",
              entityId: sale.id,
              afterJson: {
                receiptNo,
                totalCents: sale.totalCents,
                discountCents: sale.discountCents,
                discountReason: parsed.data.discountReason ?? null,
                itemCount: sale.items.length,
                paymentMethods: paymentRows.map(({ method }) => method),
              },
              ip: request.ip ?? null,
            },
          });
          return sale;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return response
        .status(201)
        .json({ sale: serializeSale(created, user.role.name === "admin"), duplicate: false });
    } catch (error) {
      const duplicate = await findSale(shopId, parsed.data.clientUuid);
      if (duplicate)
        return response.json({
          sale: serializeSale(duplicate, user.role.name === "admin"),
          duplicate: true,
        });
      const message = error instanceof Error ? error.message : "Sale could not be completed";
      return response
        .status(message.startsWith("Insufficient stock") ? 409 : 400)
        .json({ error: message });
    }
  },
);

salesRouter.get(
  "/held-carts",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    const carts = await prisma.heldCart.findMany({
      where: { shopId: request.authUser!.shopId, sellerId: request.authUser!.id },
      orderBy: { createdAt: "asc" },
    });
    return response.json({ carts });
  },
);

salesRouter.post(
  "/held-carts",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = heldCartInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid held cart", details: parsed.error.flatten() });
    const user = request.authUser!;
    const shift = await prisma.shift.findFirst({
      where: { shopId: user.shopId, sellerId: user.id, closedAt: null },
    });
    if (!shift) return response.status(409).json({ error: "Open a shift before holding a cart" });
    const cart = await prisma.$transaction(async (tx) => {
      const created = await tx.heldCart.create({
        data: {
          shopId: user.shopId,
          sellerId: user.id,
          shiftId: shift.id,
          label: parsed.data.label ?? null,
          cartJson: parsed.data as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          shopId: user.shopId,
          userId: user.id,
          action: "sale.cart_held",
          entity: "held_cart",
          entityId: created.id,
          ip: request.ip ?? null,
        },
      });
      return created;
    });
    return response.status(201).json({ cart });
  },
);

salesRouter.post(
  "/held-carts/:id/resume",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success)
      return response.status(400).json({ error: "Invalid held cart id" });
    const user = request.authUser!;
    const shift = await prisma.shift.findFirst({
      where: { shopId: user.shopId, sellerId: user.id, closedAt: null },
    });
    if (!shift) return response.status(409).json({ error: "Open a shift before resuming a cart" });
    const cart = await prisma.$transaction(async (tx) => {
      const held = await tx.heldCart.findFirst({
        where: { id: request.params.id!, shopId: user.shopId, sellerId: user.id },
      });
      if (!held) return null;
      await tx.heldCart.delete({ where: { id: held.id } });
      await tx.auditLog.create({
        data: {
          shopId: user.shopId,
          userId: user.id,
          action: "sale.cart_resumed",
          entity: "held_cart",
          entityId: held.id,
          ip: request.ip ?? null,
        },
      });
      return held;
    });
    if (!cart) return response.status(404).json({ error: "Held cart not found" });
    return response.json({ cart });
  },
);
