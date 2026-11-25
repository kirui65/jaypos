import { PaymentMethod, PaymentStatus, Prisma, SaleStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { canAccess } from "../auth/permissions.js";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { normalizeKenyanPhone } from "@eminent/shared";
import { prisma } from "../db.js";
import { deductSaleStock } from "../sales/inventory.js";
import { businessData, businessWhere, sessionShopId, shopWhere } from "../tenant-scope.js";
import { configuredShopId } from "../shop-settings.js";
import {
  getPaymentProvider,
  MockPaymentProvider,
  type PaymentProvider,
  type PaymentSnapshot,
} from "./provider.js";

const callbackInput = z.object({
  checkout_id: z.string().trim().min(1).max(200),
  api_ref: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

function canAccessPayment(user: NonNullable<AuthenticatedRequest["authUser"]>, sellerId: string) {
  return user.id === sellerId || canAccess(user, "sales.read.all");
}

async function recordOrphanPayment(
  provider: PaymentProvider,
  providerRequestId: string,
  snapshot: PaymentSnapshot,
) {
  if (snapshot.status !== "paid" || snapshot.amountCents === null) return;
  const shopId = await configuredShopId();
  if (!shopId) return;
  await prisma.$transaction(async (tx) => {
    const orphan = await tx.unmatchedPayment.upsert({
      where: { providerRequestId },
      create: businessData(shopId, {
        provider: provider.name,
        providerRequestId,
        amountCents: snapshot.amountCents!,
        phone: snapshot.phone,
        mpesaReceipt: snapshot.receipt,
        rawJson: snapshot.raw as Prisma.InputJsonValue,
      }),
      update: {},
    });
    await tx.auditLog.create({
      data: businessData(shopId, {
        action: "payment.unmatched_received",
        entity: "unmatched_payment",
        entityId: orphan.id,
        afterJson: { provider: provider.name, providerRequestId, amountCents: orphan.amountCents },
      }),
    });
  });
}

async function applyProviderSnapshot(
  paymentId: string,
  shopId: string,
  snapshot: PaymentSnapshot,
  notification?: unknown,
) {
  const initial = await prisma.payment.findFirst({
    where: businessWhere(shopId, { id: paymentId }),
    include: { sale: true },
  });
  if (!initial) return { found: false as const };
  if (initial.status === PaymentStatus.paid) return { found: true as const, status: "paid" };
  if (initial.status === PaymentStatus.unmatched)
    return { found: true as const, status: "unmatched" };
  if (snapshot.status === "pending") return { found: true as const, status: "pending" };
  const rawJson = {
    notification: notification ?? null,
    verifiedStatus: snapshot.raw,
  } as Prisma.InputJsonValue;
  const result = await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirstOrThrow({
        where: businessWhere(shopId, { id: paymentId }),
        include: { sale: true },
      });
      if (payment.status === PaymentStatus.paid) return { status: "paid" as const };
      if (snapshot.status === "failed") {
        if (payment.status !== PaymentStatus.failed) {
          const failed = await tx.payment.update({
            where: businessWhere(payment.shopId, { id: payment.id }),
            data: {
              status: PaymentStatus.failed,
              rawCallbackJson: rawJson,
              verifiedAt: new Date(),
            },
          });
          await tx.auditLog.create({
            data: {
              shopId: payment.shopId,
              userId: payment.sale.sellerId,
              action: "payment.failed",
              entity: "payment",
              entityId: payment.id,
              beforeJson: { status: payment.status },
              afterJson: { status: failed.status },
            },
          });
        }
        return { status: "failed" as const };
      }

      let mismatch: string | null = null;
      if (snapshot.amountCents === null || snapshot.amountCents !== payment.amountCents)
        mismatch = "Lipwa amount does not match the expected payment amount";
      if (!snapshot.receipt) mismatch = "Lipwa status did not include an M-Pesa receipt code";
      if (snapshot.phone && payment.phone) {
        try {
          if (normalizeKenyanPhone(snapshot.phone) !== normalizeKenyanPhone(payment.phone))
            mismatch = "Lipwa phone number does not match the payment phone";
        } catch {
          mismatch = "Lipwa returned an invalid phone number";
        }
      }
      if (payment.sale.status !== SaleStatus.draft) mismatch = "Sale is no longer awaiting payment";
      if (mismatch) {
        const updated = await tx.payment.update({
            where: businessWhere(payment.shopId, { id: payment.id }),
          data: {
            status: PaymentStatus.unmatched,
            mpesaReceipt: snapshot.receipt,
            rawCallbackJson: rawJson,
            verifiedAt: new Date(),
          },
        });
        await tx.sale.update({
          where: businessWhere(payment.shopId, { id: payment.saleId }),
          data: { needsReview: true, reviewReason: mismatch },
        });
        await tx.auditLog.create({
          data: {
            shopId: payment.shopId,
            userId: payment.sale.sellerId,
            action: "payment.mismatch",
            entity: "payment",
            entityId: payment.id,
            beforeJson: { status: payment.status, amountCents: payment.amountCents },
            afterJson: {
              status: updated.status,
              receivedAmountCents: snapshot.amountCents,
              reason: mismatch,
            },
          },
        });
        return { status: "unmatched" as const, reason: mismatch };
      }

      await tx.payment.update({
        where: businessWhere(payment.shopId, { id: payment.id }),
        data: {
          status: PaymentStatus.paid,
          mpesaReceipt: snapshot.receipt,
          rawCallbackJson: rawJson,
          verifiedAt: new Date(),
        },
      });
      const payments = await tx.payment.findMany({
        where: businessWhere(payment.shopId, { saleId: payment.saleId, status: PaymentStatus.paid }),
        select: { amountCents: true },
      });
      const paidCents = payments.reduce((sum, row) => sum + row.amountCents, 0);
      if (paidCents < payment.sale.totalCents) {
        await tx.auditLog.create({
          data: {
            shopId: payment.shopId,
            userId: payment.sale.sellerId,
            action: "payment.confirmed",
            entity: "payment",
            entityId: payment.id,
            afterJson: { status: PaymentStatus.paid, receipt: snapshot.receipt, paidCents },
          },
        });
        return { status: "paid" as const, saleCompleted: false };
      }
      const stock = await deductSaleStock(
        tx,
        payment.saleId,
        payment.shopId,
        payment.sale.sellerId,
        true,
      );
      await tx.sale.update({
        where: businessWhere(payment.shopId, { id: payment.saleId }),
        data: {
          status: SaleStatus.completed,
          paidCents,
          needsReview: stock.needsReview,
          reviewReason: stock.needsReview
            ? "Payment completed after available stock changed"
            : null,
        },
      });
      await tx.auditLog.create({
        data: {
          shopId: payment.shopId,
          userId: payment.sale.sellerId,
          action: "payment.confirmed",
          entity: "payment",
          entityId: payment.id,
          afterJson: { status: PaymentStatus.paid, receipt: snapshot.receipt, paidCents },
        },
      });
      await tx.auditLog.create({
        data: {
          shopId: payment.shopId,
          userId: payment.sale.sellerId,
          action: "sale.completed",
          entity: "sale",
          entityId: payment.saleId,
          afterJson: { totalCents: payment.sale.totalCents, paidCents, via: "mpesa_stk" },
        },
      });
      return { status: "paid" as const, saleCompleted: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return { found: true as const, ...result };
}

export function createLipwaCallbackRouter(provider: PaymentProvider) {
  const router = Router();
  router.post("/", async (request, response) => {
    const parsed = callbackInput.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid Lipwa callback" });
    try {
      const shopId = await configuredShopId();
      if (!shopId) return response.status(503).json({ error: "Shop is not configured" });
      let payment = await prisma.payment.findFirst({
        where: businessWhere(shopId, { provider: provider.name, providerRequestId: parsed.data.checkout_id }),
        include: { sale: true },
      });
      if (!payment && typeof parsed.data.api_ref === "string") {
        const sale = await prisma.sale.findFirst({
          where: businessWhere(shopId, { receiptNo: parsed.data.api_ref }),
          select: { id: true },
        });
        if (sale)
          payment = await prisma.payment.findFirst({
            where: businessWhere(shopId, {
              saleId: sale.id,
              method: PaymentMethod.mpesa_stk,
              status: PaymentStatus.pending,
            }),
            include: { sale: true },
          });
      }
      const snapshot = await provider.queryStatus(parsed.data.checkout_id);
      if (!payment) {
        await recordOrphanPayment(provider, parsed.data.checkout_id, snapshot);
        return response.status(200).json({ ok: true });
      }
      const result = await applyProviderSnapshot(payment.id, shopId, snapshot, request.body);
      if (result.status === "unmatched")
        await recordOrphanPayment(provider, parsed.data.checkout_id, snapshot);
      return response.status(200).json({ ok: true, result: result.status });
    } catch {
      return response.status(503).json({ error: "Payment status could not be verified yet" });
    }
  });
  return router;
}

export function createPaymentsRouter(provider: PaymentProvider = getPaymentProvider()) {
  const router = Router();

  router.post(
    "/:id/stk",
    requirePermission("sales.create"),
    async (request: AuthenticatedRequest, response) => {
      if (!z.string().uuid().safeParse(request.params.id).success)
        return response.status(400).json({ error: "Invalid payment id" });
      const user = request.authUser!;
      let payment = await prisma.payment.findFirst({
        where: shopWhere(request, { id: request.params.id!, method: PaymentMethod.mpesa_stk }),
        include: { sale: true },
      });
      if (!payment) return response.status(404).json({ error: "STK payment not found" });
      if (!canAccessPayment(user, payment.sale.sellerId))
        return response.status(403).json({ error: "Permission denied" });
      if (payment.sale.status !== SaleStatus.draft)
        return response.status(409).json({ error: "Sale is no longer awaiting STK payment" });
      if (payment.status === PaymentStatus.pending && payment.providerRequestId)
        return response.json({
          payment: {
            id: payment.id,
            status: payment.status,
            providerRequestId: payment.providerRequestId,
          },
        });
      if (
        ![PaymentStatus.pending, PaymentStatus.failed, PaymentStatus.expired].some(
          (status) => status === payment!.status,
        )
      )
        return response.status(409).json({ error: "This STK payment cannot be retried" });
      const callbackUrl = process.env.LIPWA_CALLBACK_URL ?? "";
      if (provider.name === "lipwa" && !callbackUrl)
        return response.status(503).json({ error: "LIPWA_CALLBACK_URL must be configured" });
      try {
        const initiated = await provider.initiateStk({
          phone: payment.phone ?? "",
          amountCents: payment.amountCents,
          reference: payment.sale.receiptNo ?? payment.sale.clientUuid,
          callbackUrl,
        });
        payment = await prisma.$transaction(async (tx) => {
          const updated = await tx.payment.update({
            where: shopWhere(request, { id: payment!.id }),
            data: {
              status: PaymentStatus.pending,
              provider: provider.name,
              providerRequestId: initiated.providerRequestId,
              rawRequestJson: initiated.raw as Prisma.InputJsonValue,
            },
            include: { sale: true },
          });
          await tx.auditLog.create({
            data: {
              shopId: updated.shopId,
              userId: updated.sale.sellerId,
              action: "payment.stk_initiated",
              entity: "payment",
              entityId: updated.id,
              afterJson: {
                provider: provider.name,
                providerRequestId: updated.providerRequestId,
                amountCents: updated.amountCents,
              },
            },
          });
          return updated;
        });
        return response.status(202).json({
          payment: {
            id: payment.id,
            status: payment.status,
            providerRequestId: payment.providerRequestId,
          },
        });
      } catch (error) {
        await prisma.payment.update({
          where: shopWhere(request, { id: payment.id }),
          data: { status: PaymentStatus.failed },
        });
        return response
          .status(502)
          .json({ error: error instanceof Error ? error.message : "STK request failed" });
      }
    },
  );

  router.post(
    "/:id/check",
    requirePermission("sales.create"),
    async (request: AuthenticatedRequest, response) => {
      if (!z.string().uuid().safeParse(request.params.id).success)
        return response.status(400).json({ error: "Invalid payment id" });
      const user = request.authUser!;
      const payment = await prisma.payment.findFirst({
        where: shopWhere(request, { id: request.params.id!, method: PaymentMethod.mpesa_stk }),
        include: { sale: true },
      });
      if (!payment) return response.status(404).json({ error: "STK payment not found" });
      if (!canAccessPayment(user, payment.sale.sellerId))
        return response.status(403).json({ error: "Permission denied" });
      if (!payment.providerRequestId)
        return response.status(409).json({ error: "STK payment has not been initiated" });
      try {
        const selectedProvider =
          payment.provider === provider.name
            ? provider
            : getPaymentProvider(payment.provider ?? undefined);
        const snapshot = await selectedProvider.queryStatus(payment.providerRequestId);
        let result = await applyProviderSnapshot(payment.id, sessionShopId(request), snapshot);
        if (snapshot.status === "pending" && Date.now() - payment.updatedAt.getTime() >= 90_000) {
          await prisma.payment.updateMany({
            where: shopWhere(request, { id: payment.id, status: PaymentStatus.pending }),
            data: { status: PaymentStatus.expired },
          });
          result = { found: true, status: "expired" };
        }
        return response.json({ paymentId: payment.id, status: result.status });
      } catch {
        return response.status(502).json({ error: "Payment status could not be checked" });
      }
    },
  );

  router.post(
    "/:id/mock-complete",
    requirePermission("sales.create"),
    async (request: AuthenticatedRequest, response) => {
      if (
        (process.env.NODE_ENV && process.env.NODE_ENV !== "development") ||
        !(provider instanceof MockPaymentProvider)
      )
        return response.status(404).json({ error: "Not found" });
      if (!z.string().uuid().safeParse(request.params.id).success)
        return response.status(400).json({ error: "Invalid payment id" });
      const payment = await prisma.payment.findFirst({
        where: shopWhere(request, {
          id: request.params.id!,
          method: PaymentMethod.mpesa_stk,
        }),
        include: { sale: true },
      });
      if (!payment) return response.status(404).json({ error: "STK payment not found" });
      if (!canAccessPayment(request.authUser!, payment.sale.sellerId))
        return response.status(403).json({ error: "Permission denied" });
      if (!payment.providerRequestId)
        return response.status(409).json({ error: "STK payment has not been initiated" });
      provider.setStatus(payment.providerRequestId, {
        status: "paid",
        amountCents: payment.amountCents,
        phone: payment.phone,
        receipt: "MOCK-" + payment.id.slice(0, 8).toUpperCase(),
        transactionId: payment.providerRequestId,
        raw: { simulated: true },
      });
      const result = await applyProviderSnapshot(
        payment.id,
        sessionShopId(request),
        await provider.queryStatus(payment.providerRequestId),
      );
      return response.json({
        paymentId: payment.id,
        status: result.status,
        saleCompleted: "saleCompleted" in result ? result.saleCompleted : false,
      });
    },
  );

  router.get(
    "/pending",
    requirePermission("sales.read.own"),
    async (request: AuthenticatedRequest, response) => {
      const user = request.authUser!;
      const all = canAccess(user, "sales.read.all") && request.query.scope === "all";
      const payments = await prisma.payment.findMany({
        where: shopWhere(request, {
          method: PaymentMethod.mpesa_stk,
          status: { in: [PaymentStatus.pending, PaymentStatus.expired, PaymentStatus.failed] },
          sale: { ...(all ? {} : { sellerId: user.id }) },
        }),
        select: {
          id: true,
          saleId: true,
          amountCents: true,
          phone: true,
          status: true,
          providerRequestId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      return response.json({ payments });
    },
  );

  router.get(
    "/unmatched",
    requirePermission("sales.read.all"),
    async (request: AuthenticatedRequest, response) => {
      const payments = await prisma.unmatchedPayment.findMany({
        where: shopWhere(request, { reconciledAt: null }),
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return response.json({ payments });
    },
  );

  router.patch(
    "/unmatched/:id/reconcile",
    requirePermission("sales.read.all"),
    async (request: AuthenticatedRequest, response) => {
      const parsed = z.object({ paymentId: z.string().uuid() }).strict().safeParse(request.body);
      if (!z.string().uuid().safeParse(request.params.id).success || !parsed.success)
        return response
          .status(400)
          .json({ error: "A valid unmatched payment and payment row are required" });
      const user = request.authUser!;
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const orphan = await tx.unmatchedPayment.findFirst({
              where: shopWhere(request, { id: request.params.id!, reconciledAt: null }),
            });
            const payment = await tx.payment.findFirst({
              where: shopWhere(request, {
                id: parsed.data.paymentId,
                method: PaymentMethod.mpesa_stk,
              }),
              include: { sale: true },
            });
            if (!orphan || !payment || payment.sale.status !== SaleStatus.draft)
              throw new Error("Unmatched payment or open sale not found");
            if (orphan.amountCents !== payment.amountCents)
              throw new Error("Unmatched payment amount does not match the sale payment");
            if (
              orphan.phone &&
              payment.phone &&
              normalizeKenyanPhone(orphan.phone) !== normalizeKenyanPhone(payment.phone)
            )
              throw new Error("Unmatched payment phone does not match");
            await tx.payment.update({
              where: shopWhere(request, { id: payment.id }),
              data: {
                status: PaymentStatus.paid,
                mpesaReceipt: orphan.mpesaReceipt,
                verifiedAt: new Date(),
                rawCallbackJson: orphan.rawJson as Prisma.InputJsonValue,
              },
            });
            const paidRows = await tx.payment.findMany({
              where: shopWhere(request, { saleId: payment.saleId, status: PaymentStatus.paid }),
              select: { amountCents: true },
            });
            const paidCents = paidRows.reduce((sum, row) => sum + row.amountCents, 0);
            if (paidCents >= payment.sale.totalCents) {
              const stock = await deductSaleStock(
                tx,
                payment.saleId,
                user.shopId,
                payment.sale.sellerId,
                true,
              );
              await tx.sale.update({
                where: shopWhere(request, { id: payment.saleId }),
                data: {
                  status: SaleStatus.completed,
                  paidCents,
                  needsReview: stock.needsReview,
                  reviewReason: stock.needsReview
                    ? "Payment completed after available stock changed"
                    : null,
                },
              });
            }
            await tx.unmatchedPayment.update({
              where: shopWhere(request, { id: orphan.id }),
              data: { reconciledAt: new Date() },
            });
            await tx.auditLog.create({
              data: businessData(user.shopId, {
                userId: user.id,
                action: "payment.unmatched_reconciled",
                entity: "unmatched_payment",
                entityId: orphan.id,
                afterJson: { paymentId: payment.id, saleId: payment.saleId, paidCents },
              }),
            });
            return { paymentId: payment.id, saleId: payment.saleId, paidCents };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return response.json({ reconciled: result });
      } catch (error) {
        return response.status(400).json({
          error: error instanceof Error ? error.message : "Payment reconciliation failed",
        });
      }
    },
  );

  return router;
}

export async function pollPendingPayments(provider: PaymentProvider = getPaymentProvider()) {
  const shopId = await configuredShopId();
  if (!shopId) return;
  const pending = await prisma.payment.findMany({
    where: businessWhere(shopId, {
      method: PaymentMethod.mpesa_stk,
      status: PaymentStatus.pending,
      providerRequestId: { not: null },
    }),
    include: { sale: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  for (const payment of pending) {
    try {
      const selectedProvider =
        payment.provider === provider.name
          ? provider
          : getPaymentProvider(payment.provider ?? undefined);
      const snapshot = await selectedProvider.queryStatus(payment.providerRequestId!);
      await applyProviderSnapshot(payment.id, payment.shopId, snapshot);
      if (snapshot.status === "pending" && Date.now() - payment.updatedAt.getTime() >= 90_000)
        await prisma.payment.updateMany({
          where: businessWhere(payment.shopId, { id: payment.id, status: PaymentStatus.pending }),
          data: { status: PaymentStatus.expired },
        });
    } catch {
      // Keep pending provider payments for the next polling pass.
    }
  }
}

export function createPaymentPoller(provider: PaymentProvider = getPaymentProvider()) {
  const timer = setInterval(
    () => void pollPendingPayments(provider).catch(() => undefined),
    30_000,
  );
  timer.unref();
  return () => clearInterval(timer);
}
