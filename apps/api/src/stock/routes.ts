import { Prisma, StockReportStatus, StockReportType } from "@prisma/client";
import type { StockMovementType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { sessionShopId, shopData, shopWhere } from "../tenant-scope.js";

const manualTypes = ["purchase", "adjustment", "damage", "tester"] as const;
const movementLine = z
  .object({
    variantId: z.string().uuid(),
    type: z.enum(manualTypes),
    quantityDelta: z.number().int(),
    mlDelta: z.number().int().optional(),
    costPerUnitCents: z.number().int().min(0).optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (value) => value.quantityDelta !== 0 || (value.mlDelta ?? 0) !== 0,
    "A quantity or volume change is required",
  );
const reportInput = z
  .object({
    variantId: z.string().uuid(),
    type: z.nativeEnum(StockReportType),
    quantity: z.number().int().positive().optional(),
    reason: z.string().trim().min(1).max(1000),
    photoUrl: z.string().url().optional(),
  })
  .strict();

type MovementLine = z.infer<typeof movementLine>;
type StockSnapshot = { quantity: number; mlRemaining: number | null; costCents: number };

export function calculateStockChange(
  current: StockSnapshot,
  line: MovementLine,
  countedQuantity?: number,
) {
  const quantityDelta =
    countedQuantity === undefined ? line.quantityDelta : countedQuantity - current.quantity;
  const mlDelta = line.mlDelta ?? 0;
  const quantity = current.quantity + quantityDelta;
  const mlRemaining =
    current.mlRemaining === null && mlDelta === 0 ? null : (current.mlRemaining ?? 0) + mlDelta;
  if (quantity < 0 || (mlRemaining !== null && mlRemaining < 0))
    throw new Error("Stock cannot fall below zero");
  let costCents = current.costCents;
  if (line.type === "purchase" && line.costPerUnitCents !== undefined && quantityDelta > 0) {
    const previousValue = current.quantity * current.costCents;
    costCents = Math.round((previousValue + quantityDelta * line.costPerUnitCents) / quantity);
  }
  return { quantityDelta, mlDelta, quantity, mlRemaining, costCents };
}

async function writeStockChange(
  tx: Prisma.TransactionClient,
  request: AuthenticatedRequest,
  line: MovementLine,
  countedQuantity?: number,
) {
  const shopId = sessionShopId(request);
  const variant = await tx.productVariant.findFirst({
    where: shopWhere(request, { id: line.variantId }),
    include: { stockLevels: { where: shopWhere(request, {}) } },
  });
  if (!variant) throw new Error("Variant not found in this shop");
  if (line.type === "tester" && !variant.isTester)
    throw new Error("Tester movements require a tester variant");
  if (line.type === "tester" && line.quantityDelta >= 0)
    throw new Error("Tester movements must reduce tester stock");
  if (line.type === "damage" && line.quantityDelta >= 0)
    throw new Error("Damage movements must reduce stock");
  if (line.type === "purchase" && line.quantityDelta <= 0)
    throw new Error("Purchase receipts must increase stock");
  if (variant.isTester && line.type === "purchase")
    throw new Error("Receive tester stock using a tester movement");
  if (line.type === "purchase" && line.costPerUnitCents === undefined)
    throw new Error("Purchase receipts require costPerUnitCents");
  if (!variant.isBulk && (line.mlDelta ?? 0) !== 0)
    throw new Error("Volume changes are only valid for bulk perfume variants");
  if (
    variant.isBulk &&
    (line.mlDelta ?? 0) !== 0 &&
    line.type !== "purchase" &&
    line.type !== "adjustment"
  )
    throw new Error("Bulk volume changes require a purchase or adjustment movement");
  if (
    variant.isBulk &&
    line.type === "purchase" &&
    (line.quantityDelta <= 0 || (line.mlDelta ?? 0) <= 0)
  )
    throw new Error("Bulk bottle receipts require positive bottle and ml quantities");
  const level = variant.stockLevels[0];
  const next = calculateStockChange(
    {
      quantity: level?.quantity ?? 0,
      mlRemaining: level?.mlRemaining ?? null,
      costCents: variant.costCents,
    },
    line,
    countedQuantity,
  );
  if (variant.isBulk && next.quantity > 0 && next.mlRemaining === null)
    throw new Error("Bulk stock must track remaining millilitres");
  const movementType: StockMovementType = countedQuantity === undefined ? line.type : "stock_take";
  await tx.stockLevel.upsert({
    where: shopWhere(request, { shopId_variantId: { shopId, variantId: variant.id } }),
    create: {
      shopId,
      variantId: variant.id,
      quantity: next.quantity,
      mlRemaining: next.mlRemaining,
    },
    update: { quantity: next.quantity, mlRemaining: next.mlRemaining },
  });
  if (next.costCents !== variant.costCents)
    await tx.productVariant.update({
    where: shopWhere(request, { id: variant.id }),
      data: { costCents: next.costCents },
    });
  const movement = await tx.stockMovement.create({
    data: shopData(request, {
      variantId: variant.id,
      quantityDelta: next.quantityDelta,
      mlDelta: line.mlDelta ?? null,
      type: movementType,
      reason: line.reason,
      userId: request.authUser!.id,
    }),
  });
  await tx.auditLog.create({
    data: shopData(request, {
      userId: request.authUser!.id,
      action: "stock.movement_created",
      entity: "stock_movement",
      entityId: movement.id,
      beforeJson: {
        quantity: level?.quantity ?? 0,
        mlRemaining: level?.mlRemaining ?? null,
        costCents: variant.costCents,
      },
      afterJson: {
        quantity: next.quantity,
        mlRemaining: next.mlRemaining,
        costCents: next.costCents,
        type: movement.type,
        reason: line.reason,
      },
      ip: request.ip ?? null,
    }),
  });
  return { movement, level: { quantity: next.quantity, mlRemaining: next.mlRemaining } };
}

export const stockRouter = Router();
stockRouter.get(
  "/damaged",
  requirePermission("stock.write"),
  async (request: AuthenticatedRequest, response) => {
    const levels = await prisma.damagedStockLevel.findMany({
      where: shopWhere(request, { quantity: { gt: 0 } }),
      include: {
        variant: { select: { id: true, sku: true, product: { select: { name: true } } } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return response.json({ levels });
  },
);
stockRouter.get(
  "/",
  requirePermission("stock.read"),
  async (request: AuthenticatedRequest, response) => {
    const levels = await prisma.stockLevel.findMany({
      where: shopWhere(request, {}),
      include: { variant: { include: { product: true } } },
      orderBy: { updatedAt: "desc" },
    });
    const isAdmin = request.authUser!.role.name === "admin";
    const stock = levels.map(({ variant, ...level }) => ({
      ...level,
      variant: {
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        attributes: variant.attributesJson,
        priceCents: variant.priceCents,
        ...(isAdmin ? { costCents: variant.costCents } : {}),
        isTester: variant.isTester,
        product: { id: variant.product.id, name: variant.product.name },
      },
    }));
    return response.json({ stock });
  },
);

stockRouter.get(
  "/movements",
  requirePermission("stock.read"),
  async (request: AuthenticatedRequest, response) => {
    const movements = await prisma.stockMovement.findMany({
      where: shopWhere(request, {}),
      include: {
        variant: { include: { product: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return response.json({
      movements: movements.map(({ variant, ...movement }) => ({
        ...movement,
        variant: {
          id: variant.id,
          sku: variant.sku,
          product: { id: variant.product.id, name: variant.product.name },
        },
      })),
    });
  },
);

stockRouter.post(
  "/movements",
  requirePermission("stock.write"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = z
      .object({ movements: z.array(movementLine).min(1).max(500) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid stock movements", details: parsed.error.flatten() });
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const written = [];
          for (const line of parsed.data.movements)
            written.push(await writeStockChange(tx, request, line));
          return written;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return response.status(201).json({ movements: result });
    } catch (error) {
      return response
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Stock update failed" });
    }
  },
);

stockRouter.post(
  "/counts",
  requirePermission("stock.write"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = z
      .object({
        reason: z.string().trim().min(1).max(500),
        counts: z
          .array(
            z
              .object({ variantId: z.string().uuid(), countedQuantity: z.number().int().min(0) })
              .strict(),
          )
          .min(1)
          .max(500),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid stock count", details: parsed.error.flatten() });
    if (
      new Set(parsed.data.counts.map(({ variantId }) => variantId)).size !==
      parsed.data.counts.length
    )
      return response.status(400).json({ error: "A variant can appear only once per count" });
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const written = [];
          for (const count of parsed.data.counts)
            written.push(
              await writeStockChange(
                tx,
                request,
                {
                  variantId: count.variantId,
                  type: "adjustment",
                  quantityDelta: 0,
                  reason: parsed.data.reason,
                },
                count.countedQuantity,
              ),
            );
          return written;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return response.status(201).json({ counts: result });
    } catch (error) {
      return response
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Stock count failed" });
    }
  },
);

stockRouter.post(
  "/reports",
  requirePermission("stock.report"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = reportInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid stock report", details: parsed.error.flatten() });
    const variant = await prisma.productVariant.findFirst({
      where: shopWhere(request, { id: parsed.data.variantId }),
    });
    if (!variant) return response.status(404).json({ error: "Variant not found" });
    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.stockReport.create({
        data: shopData(request, {
          ...parsed.data,
          quantity: parsed.data.quantity ?? null,
          photoUrl: parsed.data.photoUrl ?? null,
          reportedBy: request.authUser!.id,
        }),
      });
      await tx.auditLog.create({
        data: shopData(request, {
          userId: request.authUser!.id,
          action: "stock.report_submitted",
          entity: "stock_report",
          entityId: created.id,
          afterJson: {
            type: created.type,
            variantId: created.variantId,
            quantity: created.quantity,
            reason: created.reason,
          },
          ip: request.ip ?? null,
        }),
      });
      return created;
    });
    return response.status(201).json({ report });
  },
);

stockRouter.get(
  "/reports",
  requirePermission("stock.write"),
  async (request: AuthenticatedRequest, response) => {
    const reports = await prisma.stockReport.findMany({
      where: shopWhere(request, {}),
      include: {
        variant: { include: { product: true } },
        reporter: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return response.json({ reports });
  },
);

stockRouter.patch(
  "/reports/:id",
  requirePermission("stock.write"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = z
      .object({ status: z.enum([StockReportStatus.reviewed, StockReportStatus.dismissed]) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid report status" });
    const before = await prisma.stockReport.findFirst({
      where: shopWhere(request, { id: request.params.id! }),
    });
    if (!before) return response.status(404).json({ error: "Stock report not found" });
    if (before.status !== StockReportStatus.pending)
      return response.status(409).json({ error: "Stock report has already been reviewed" });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.stockReport.update({
        where: shopWhere(request, { id: before.id }),
        data: {
          status: parsed.data.status,
          reviewedBy: request.authUser!.id,
          reviewedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: shopData(request, {
          userId: request.authUser!.id,
          action: "stock.report_reviewed",
          entity: "stock_report",
          entityId: row.id,
          beforeJson: { status: before.status },
          afterJson: { status: row.status },
          ip: request.ip ?? null,
        }),
      });
      return row;
    });
    return response.json({ report: updated });
  },
);
