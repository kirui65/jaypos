import { Prisma, RefundDisposition, RefundStatus, SaleStatus } from "@prisma/client";
import type { PaymentMethod } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { canAccess } from "../auth/permissions.js";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { businessData, businessWhere, shopData, shopWhere } from "../tenant-scope.js";

async function restockReturnedItem(
  tx: Prisma.TransactionClient,
  shopId: string,
  userId: string,
  refundId: string,
  saleItemId: string,
  quantity: number,
) {
  const item = await tx.saleItem.findFirstOrThrow({
    where: businessWhere(shopId, { id: saleItemId }),
    include: {
      variant: {
        include: { parentBulkVariant: true, bundleComponents: { include: { component: true } } },
      },
    },
  });
  const demands = item.variant.bundleComponents.length
    ? item.variant.bundleComponents.map(({ component, quantity: perBundle }) => ({
        variantId: component.id,
        quantity: perBundle * quantity,
        ml: component.isBulk ? (component.bulkVolumeMl ?? 0) * perBundle * quantity : 0,
      }))
    : item.variant.parentBulkVariantId
      ? [
          {
            variantId: item.variant.parentBulkVariantId,
            quantity: 0,
            ml: item.mlQty ?? (item.variant.mlPerUnit ?? 0) * quantity,
          },
        ]
      : [
          {
            variantId: item.variantId,
            quantity,
            ml: item.variant.isBulk ? (item.variant.bulkVolumeMl ?? 0) * quantity : 0,
          },
        ];
  for (const demand of demands) {
    await tx.stockLevel.upsert({
      where: businessWhere(shopId, { shopId_variantId: { shopId, variantId: demand.variantId } }),
      create: businessData(shopId, {
        variantId: demand.variantId,
        quantity: demand.quantity,
        mlRemaining: demand.ml || null,
      }),
      update: {
        ...(demand.quantity ? { quantity: { increment: demand.quantity } } : {}),
        ...(demand.ml ? { mlRemaining: { increment: demand.ml } } : {}),
      },
    });
    await tx.stockMovement.create({
      data: businessData(shopId, {
        variantId: demand.variantId,
        quantityDelta: demand.quantity,
        mlDelta: demand.ml || null,
        type: "refund_restock",
        referenceType: "refund",
        referenceId: refundId,
        reason: "Approved refund restock",
        userId,
      }),
    });
  }
}

const requestInput = z
  .object({
    saleId: z.string().uuid(),
    exchangeSaleId: z.string().uuid().optional(),
    reason: z.string().trim().min(2).max(500),
    items: z
      .array(
        z.object({ saleItemId: z.string().uuid(), quantity: z.number().int().positive() }).strict(),
      )
      .min(1),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map((item) => item.saleItemId)).size === value.items.length,
    {
      message: "Each sale item may appear only once",
      path: ["items"],
    },
  );
const decisionInput = z
  .object({
    decision: z.enum(["approve", "reject"]),
    refundMethod: z.enum(["cash", "mpesa_manual", "card"]).optional(),
    dispositions: z
      .array(
        z
          .object({ saleItemId: z.string().uuid(), disposition: z.nativeEnum(RefundDisposition) })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const refundsRouter = Router();
refundsRouter.get(
  "/",
  requirePermission("refunds.request"),
  async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const all = canAccess(user, "refunds.approve") || canAccess(user, "sales.read.all");
    const refunds = await prisma.refund.findMany({
      where: shopWhere(req, all ? {} : { requestedBy: user.id }),
      include: {
        items: { include: { saleItem: { include: { variant: { include: { product: true } } } } } },
        sale: { select: { receiptNo: true, sellerId: true } },
        requester: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ refunds });
  },
);

refundsRouter.post(
  "/",
  requirePermission("refunds.request"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = requestInput.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Invalid refund request", details: parsed.error.flatten() });
    const user = req.authUser!;
    try {
      const refund = await prisma.$transaction(
        async (tx) => {
          const sale = await tx.sale.findFirst({
            where: shopWhere(req, { id: parsed.data.saleId }),
            include: {
              items: true,
              refunds: {
                where: { status: { in: [RefundStatus.requested, RefundStatus.approved] } },
                include: { items: true },
              },
            },
          });
          if (!sale || sale.status === SaleStatus.draft || sale.status === SaleStatus.voided)
            throw new Error("Completed sale not found");
          if (parsed.data.exchangeSaleId) {
            const exchangeSale = await tx.sale.findFirst({
              where: shopWhere(req, {
                id: parsed.data.exchangeSaleId,
                status: SaleStatus.completed,
              }),
            });
            if (!exchangeSale)
              throw new Error("Linked exchange sale must be a completed sale in this shop");
          }
          const saleLineValue = sale.items.reduce((sum, item) => sum + item.lineTotalCents, 0);
          const lineRefundTargets = new Map<string, number>();
          let assignedLineCents = 0;
          sale.items.forEach((item, index) => {
            const target =
              index === sale.items.length - 1
                ? sale.totalCents - assignedLineCents
                : saleLineValue > 0
                  ? Math.floor((item.lineTotalCents * sale.totalCents) / saleLineValue)
                  : 0;
            lineRefundTargets.set(item.id, target);
            assignedLineCents += target;
          });
          const amountById = new Map<string, number>();
          for (const requested of parsed.data.items) {
            const sold = sale.items.find((item) => item.id === requested.saleItemId);
            if (!sold) throw new Error("Refund item is not part of this sale");
            const priorQty = sale.refunds
              .flatMap((row) => row.items)
              .filter((item) => item.saleItemId === sold.id)
              .reduce((sum, item) => sum + item.quantity, 0);
            if (priorQty + requested.quantity > sold.qty)
              throw new Error("Refund quantity exceeds quantity sold or already requested");
            const targetCents = lineRefundTargets.get(sold.id) ?? 0;
            amountById.set(
              sold.id,
              Math.floor((targetCents * (priorQty + requested.quantity)) / sold.qty) -
                Math.floor((targetCents * priorQty) / sold.qty),
            );
          }
          const amountCents = [...amountById.values()].reduce((sum, amount) => sum + amount, 0);
          const priorAmount = sale.refunds.reduce((sum, row) => sum + row.amountCents, 0);
          if (amountCents < 1 || priorAmount + amountCents > sale.paidCents)
            throw new Error("Refund amount exceeds the amount paid");
          const created = await tx.refund.create({
            data: businessData(user.shopId, {
              saleId: sale.id,
              exchangeSaleId: parsed.data.exchangeSaleId ?? null,
              requestedBy: user.id,
              reason: parsed.data.reason,
              amountCents,
              items: {
                create: parsed.data.items.map((item) => businessData(user.shopId, {
                  saleItemId: item.saleItemId,
                  quantity: item.quantity,
                  disposition: RefundDisposition.damaged,
                })),
              },
            }),
            include: { items: true },
          });
          await tx.auditLog.create({
            data: businessData(user.shopId, {
              userId: user.id,
              action: "refund.requested",
              entity: "refund",
              entityId: created.id,
              afterJson: { saleId: sale.id, amountCents, reason: parsed.data.reason },
            }),
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.status(201).json({ refund });
    } catch (error) {
      return res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Refund request failed" });
    }
  },
);

refundsRouter.patch(
  "/:id",
  requirePermission("refunds.approve"),
  async (req: AuthenticatedRequest, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success)
      return res.status(400).json({ error: "Invalid refund id" });
    const parsed = decisionInput.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Invalid refund decision", details: parsed.error.flatten() });
    if (parsed.data.decision === "approve" && !parsed.data.refundMethod)
      return res.status(400).json({ error: "Refund method is required" });
    const user = req.authUser!;
    try {
      const refund = await prisma.$transaction(
        async (tx) => {
          const current = await tx.refund.findFirst({
            where: shopWhere(req, { id: req.params.id! }),
            include: {
              items: true,
              sale: { include: { refunds: { where: { status: RefundStatus.approved } } } },
            },
          });
          if (!current || current.status !== RefundStatus.requested)
            throw new Error("Pending refund request not found");
          const status =
            parsed.data.decision === "approve" ? RefundStatus.approved : RefundStatus.rejected;
          if (status === RefundStatus.approved) {
            const otherApproved = current.sale.refunds
              .filter((row) => row.id !== current.id)
              .reduce((sum, row) => sum + row.amountCents, 0);
            if (otherApproved + current.amountCents > current.sale.paidCents)
              throw new Error("Refund exceeds remaining paid amount");
            const dispositions = parsed.data.dispositions ?? [];
            if (dispositions.length !== current.items.length)
              throw new Error("Choose restock or damaged disposition for every returned item");
            for (const item of current.items) {
              const disposition = dispositions.find(
                (row) => row.saleItemId === item.saleItemId,
              )?.disposition;
              if (!disposition) throw new Error("Missing item disposition");
              await tx.refundItem.update({
                where: shopWhere(req, { id: item.id }),
                data: { disposition },
              });
              if (disposition === RefundDisposition.restock) {
                await restockReturnedItem(
                  tx,
                  user.shopId,
                  user.id,
                  current.id,
                  item.saleItemId,
                  item.quantity,
                );
              } else {
                const saleItem = await tx.saleItem.findFirstOrThrow({
                  where: shopWhere(req, { id: item.saleItemId }),
                });
                await tx.damagedStockLevel.upsert({
                  where: shopWhere(req, {
                    shopId_variantId: { shopId: user.shopId, variantId: saleItem.variantId },
                  }),
                  create: shopData(req, {
                    variantId: saleItem.variantId,
                    quantity: item.quantity,
                  }),
                  update: { quantity: { increment: item.quantity } },
                });
                await tx.stockMovement.create({
                  data: shopData(req, {
                    variantId: saleItem.variantId,
                    quantityDelta: 0,
                    type: "damage",
                    referenceType: "refund",
                    referenceId: current.id,
                    reason: `Refund return placed in damaged stock (${item.quantity} units)`,
                    userId: user.id,
                  }),
                });
              }
            }
          }
          const updated = await tx.refund.update({
            where: shopWhere(req, { id: current.id }),
            data: {
              status,
              approvedBy: user.id,
              refundMethod:
                status === RefundStatus.approved
                  ? (parsed.data.refundMethod as PaymentMethod)
                  : null,
            },
            include: { items: true, sale: true },
          });
          const allRefunds = await tx.refund.findMany({
            where: shopWhere(req, { saleId: current.saleId, status: RefundStatus.approved }),
          });
          const refunded = allRefunds.reduce((sum, row) => sum + row.amountCents, 0);
          if (status === RefundStatus.approved)
            await tx.sale.update({
              where: shopWhere(req, { id: current.saleId }),
              data: {
                status:
                  refunded >= current.sale.paidCents
                    ? SaleStatus.refunded
                    : SaleStatus.partially_refunded,
              },
            });
          await tx.auditLog.create({
            data: shopData(req, {
              userId: user.id,
              action: status === RefundStatus.approved ? "refund.approved" : "refund.rejected",
              entity: "refund",
              entityId: current.id,
              beforeJson: { status: current.status },
              afterJson: {
                status,
                amountCents: current.amountCents,
                method: parsed.data.refundMethod ?? null,
              },
            }),
          });
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return res.json({ refund });
    } catch (error) {
      return res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Refund decision failed" });
    }
  },
);
