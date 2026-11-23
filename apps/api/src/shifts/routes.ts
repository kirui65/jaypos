import { CashMovementType, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";

const openInput = z
  .object({
    openingCashCents: z.number().int().min(0),
    deviceId: z.string().trim().max(120).optional(),
  })
  .strict();
const closeInput = z
  .object({
    countedCashCents: z.number().int().min(0),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
const cashMovementInput = z
  .object({
    type: z.nativeEnum(CashMovementType),
    amountCents: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export function calculateExpectedCash(
  openingCashCents: number,
  cashSalesCents: number,
  cashInCents: number,
  cashOutCents: number,
) {
  return openingCashCents + cashSalesCents + cashInCents - cashOutCents;
}

export const shiftsRouter = Router();
shiftsRouter.get(
  "/current",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    const shift = await prisma.shift.findFirst({
      where: { shopId: request.authUser!.shopId, sellerId: request.authUser!.id, closedAt: null },
      include: { cashMovements: { orderBy: { createdAt: "asc" } } },
    });
    return response.json({ shift });
  },
);

shiftsRouter.post(
  "/open",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = openInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid shift opening", details: parsed.error.flatten() });
    const shopId = request.authUser!.shopId;
    const sellerId = request.authUser!.id;
    const alreadyOpen = await prisma.shift.findFirst({
      where: { shopId, sellerId, closedAt: null },
    });
    if (alreadyOpen)
      return response
        .status(409)
        .json({ error: "An open shift already exists", shiftId: alreadyOpen.id });
    try {
      const shift = await prisma.$transaction(
        async (tx) => {
          const created = await tx.shift.create({
            data: {
              shopId,
              sellerId,
              openingCashCents: parsed.data.openingCashCents,
              deviceId: parsed.data.deviceId ?? null,
            },
          });
          await tx.auditLog.create({
            data: {
              shopId,
              userId: sellerId,
              action: "shift.opened",
              entity: "shift",
              entityId: created.id,
              afterJson: { openingCashCents: created.openingCashCents, deviceId: created.deviceId },
              ip: request.ip ?? null,
            },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return response.status(201).json({ shift });
    } catch {
      return response.status(409).json({ error: "An open shift already exists" });
    }
  },
);

shiftsRouter.post(
  "/cash-movements",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = cashMovementInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid cash movement", details: parsed.error.flatten() });
    const shopId = request.authUser!.shopId;
    const sellerId = request.authUser!.id;
    const movement = await prisma.$transaction(
      async (tx) => {
        const shift = await tx.shift.findFirst({ where: { shopId, sellerId, closedAt: null } });
        if (!shift) return null;
        const created = await tx.cashMovement.create({
          data: { ...parsed.data, shopId, shiftId: shift.id },
        });
        await tx.auditLog.create({
          data: {
            shopId,
            userId: sellerId,
            action: "shift.cash_movement_recorded",
            entity: "cash_movement",
            entityId: created.id,
            afterJson: {
              type: created.type,
              amountCents: created.amountCents,
              reason: created.reason,
            },
            ip: request.ip ?? null,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!movement)
      return response.status(409).json({ error: "Open a shift before recording cash movements" });
    return response.status(201).json({ movement });
  },
);

shiftsRouter.post(
  "/close",
  requirePermission("sales.create"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = closeInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid shift close", details: parsed.error.flatten() });
    const shopId = request.authUser!.shopId;
    const sellerId = request.authUser!.id;
    const result = await prisma.$transaction(
      async (tx) => {
        const shift = await tx.shift.findFirst({ where: { shopId, sellerId, closedAt: null } });
        if (!shift) return null;
        const [cashPayments, manualMpesaPayments, cardPayments, cashMovements] = await Promise.all([
          tx.payment.aggregate({
            where: {
              shopId,
              method: PaymentMethod.cash,
              status: PaymentStatus.paid,
              sale: { shiftId: shift.id, status: "completed" },
            },
            _sum: { amountCents: true },
          }),
          tx.payment.aggregate({
            where: {
              shopId,
              method: PaymentMethod.mpesa_manual,
              sale: { shiftId: shift.id, status: "completed" },
            },
            _sum: { amountCents: true },
          }),
          tx.payment.aggregate({
            where: {
              shopId,
              method: PaymentMethod.card,
              sale: { shiftId: shift.id, status: "completed" },
            },
            _sum: { amountCents: true },
          }),
          tx.cashMovement.groupBy({
            by: ["type"],
            where: { shopId, shiftId: shift.id },
            _sum: { amountCents: true },
          }),
        ]);
        const inCents =
          cashMovements.find(({ type }) => type === CashMovementType.in)?._sum.amountCents ?? 0;
        const outCents =
          cashMovements.find(({ type }) => type === CashMovementType.out)?._sum.amountCents ?? 0;
        const expectedCashCents = calculateExpectedCash(
          shift.openingCashCents,
          cashPayments._sum.amountCents ?? 0,
          inCents,
          outCents,
        );
        const varianceCents = parsed.data.countedCashCents - expectedCashCents;
        const updatedCount = await tx.shift.updateMany({
          where: { id: shift.id, closedAt: null },
          data: {
            closedAt: new Date(),
            expectedCashCents,
            countedCashCents: parsed.data.countedCashCents,
            varianceCents,
            notes: parsed.data.notes ?? null,
          },
        });
        if (!updatedCount.count) return null;
        const closed = await tx.shift.findUniqueOrThrow({ where: { id: shift.id } });
        await tx.auditLog.create({
          data: {
            shopId,
            userId: sellerId,
            action: "shift.closed",
            entity: "shift",
            entityId: shift.id,
            beforeJson: { closedAt: null },
            afterJson: {
              expectedCashCents,
              countedCashCents: parsed.data.countedCashCents,
              varianceCents,
              notes: parsed.data.notes ?? null,
            },
            ip: request.ip ?? null,
          },
        });
        return {
          shift: closed,
          totals: {
            expectedCashCents,
            countedCashCents: parsed.data.countedCashCents,
            varianceCents,
            mpesaManualCents: manualMpesaPayments._sum.amountCents ?? 0,
            cardCents: cardPayments._sum.amountCents ?? 0,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result) return response.status(409).json({ error: "There is no open shift to close" });
    return response.json(result);
  },
);
