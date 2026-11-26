import { randomUUID } from "node:crypto";
import { PaymentMethod, PaymentStatus, Prisma, RefundStatus, SaleStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { canAccess } from "../auth/permissions.js";
import { normalizeKenyanPhone } from "@eminent/shared";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { businessWhere, sessionShopId, shopData, shopRowWhere, shopWhere } from "../tenant-scope.js";
import { readShopSettings, shopSettingText } from "../shop-settings.js";
import {
  allocateSalePayments,
  calculateSaleTotals,
  calculateTaxCents,
  type SalePayment,
} from "./math.js";
import { renderInvoiceHtml } from "./invoice-html.js";
import { calculateProfitability } from "./profitability.js";
import { planStockDemands } from "./inventory.js";
import PDFDocument from "pdfkit";

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
    customerDetails: z
      .object({
        name: z.string().trim().min(1).max(120),
        phone: z.string().trim().min(1).max(32),
        email: z.string().trim().email().max(254).optional(),
      })
      .strict()
      .optional(),
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
              method: z.literal("mpesa_stk"),
              amountCents: z.number().int().positive(),
              phone: z.string().trim().min(1).max(32),
            })
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
  )
  .refine(
    (value) => value.payments.filter((payment) => payment.method === "mpesa_stk").length <= 1,
    { message: "A sale can contain only one STK payment", path: ["payments"] },
  )
  .refine((value) => !(value.customerId && value.customerDetails), {
    message: "Choose an existing customer or enter new customer details",
    path: ["customerDetails"],
  });
const documentSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    logoUrl: z.union([z.string().trim().url().max(2048), z.literal("")]),
    address: z.string().trim().max(300),
    phone: z.string().trim().max(32),
    kraPin: z.string().trim().max(32),
    receiptPrefix: z.string().trim().max(12).regex(/^[A-Za-z0-9_-]*$/),
    receiptFooter: z.string().trim().max(300),
    invoiceTerms: z.string().trim().max(800),
    taxEnabled: z.boolean(),
    taxRateBps: z.number().int().min(0).max(10000),
    taxInclusive: z.boolean(),
  })
  .strict();

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

function nairobiDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDateDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function nairobiDayStart(day: string) {
  return new Date(`${day}T00:00:00+03:00`);
}

function paymentPlan(payments: z.infer<typeof saleInput>["payments"], totalCents: number) {
  const normalized: SalePayment[] = payments.map((payment) => payment);
  const allocated = allocateSalePayments(normalized, totalCents);
  return allocated.applied.map((payment) => ({
    method: payment.method as PaymentMethod,
    status:
      payment.method === "mpesa_stk"
        ? PaymentStatus.pending
        : payment.method === "mpesa_manual"
          ? PaymentStatus.pending_verification
          : PaymentStatus.paid,
    amountCents: payment.appliedCents,
    ...(payment.method === "mpesa_manual" ? { mpesaReceipt: payment.mpesaReceipt } : {}),
    ...(payment.method === "mpesa_stk"
      ? { phone: payment.phone, provider: process.env.PAYMENT_PROVIDER ?? "mock" }
      : {}),
  }));
}

async function findSale(shopId: string, clientUuid: string) {
  return prisma.sale.findFirst({ where: businessWhere(shopId, { clientUuid }), include: saleInclude });
}

async function getOwnerSummary(shopId: string) {
  const todayKey = nairobiDateKey(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDateDays(todayKey, index - 6);
    return {
      date,
      start: nairobiDayStart(date),
      end: nairobiDayStart(addDateDays(date, 1)),
      grossSalesCents: 0,
      taxCents: 0,
      costCents: 0,
      refundedCents: 0,
      refundedTaxCents: 0,
      restockedCostCents: 0,
      saleCount: 0,
    };
  });
  const rangeStart = days[0]!.start;
  const rangeEnd = days[6]!.end;
  const [sales, refunds] = await Promise.all([
    prisma.sale.findMany({
      where: businessWhere(shopId, {
        status: {
          in: [SaleStatus.completed, SaleStatus.partially_refunded, SaleStatus.refunded],
        },
        createdAt: { gte: rangeStart, lt: rangeEnd },
      }),
      select: {
        createdAt: true,
        totalCents: true,
        taxCents: true,
        items: { select: { qty: true, unitCostCents: true } },
      },
    }),
    prisma.refund.findMany({
      where: businessWhere(shopId, {
        status: RefundStatus.approved,
        updatedAt: { gte: rangeStart, lt: rangeEnd },
      }),
      select: {
        updatedAt: true,
        amountCents: true,
        items: {
          select: {
            quantity: true,
            disposition: true,
            saleItem: { select: { unitCostCents: true, qty: true, taxCents: true } },
          },
        },
      },
    }),
  ]);

  for (const sale of sales) {
    const bucket = days.find(({ start, end }) => sale.createdAt >= start && sale.createdAt < end);
    if (!bucket) continue;
    bucket.grossSalesCents += sale.totalCents;
    bucket.taxCents += sale.taxCents;
    bucket.costCents += sale.items.reduce((sum, item) => sum + item.unitCostCents * item.qty, 0);
    bucket.saleCount += 1;
  }
  for (const refund of refunds) {
    const bucket = days.find(
      ({ start, end }) => refund.updatedAt >= start && refund.updatedAt < end,
    );
    if (!bucket) continue;
    const refundedTaxCents = refund.items.reduce(
      (sum, item) => sum + Math.round((item.saleItem.taxCents * item.quantity) / item.saleItem.qty),
      0,
    );
    bucket.refundedCents += refund.amountCents;
    bucket.refundedTaxCents += refundedTaxCents;
    bucket.restockedCostCents += refund.items.reduce(
      (sum, item) =>
        sum + (item.disposition === "restock" ? item.saleItem.unitCostCents * item.quantity : 0),
      0,
    );
  }

  const summary = days.map(
    ({
      date,
      grossSalesCents,
      taxCents,
      costCents,
      refundedCents,
      refundedTaxCents,
      restockedCostCents,
      saleCount,
    }) => {
      return {
        date,
        ...calculateProfitability({
          grossSalesCents,
          taxCents,
          costCents,
          approvedRefundCents: refundedCents,
          refundedTaxCents,
          restockedCostCents,
        }),
        saleCount,
      };
    },
  );
  return { today: summary[6]!, days: summary };
}

async function getSalesAnalysis(shopId: string, from: string, to: string) {
  const dayCount =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  const groupByWeek = dayCount > 35;
  const bucketCount = groupByWeek ? Math.ceil(dayCount / 7) : dayCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const startDate = addDateDays(from, index * (groupByWeek ? 7 : 1));
    const endDate = addDateDays(startDate, groupByWeek ? 7 : 1);
    return {
      startDate,
      endDate: endDate > addDateDays(to, 1) ? addDateDays(to, 1) : endDate,
      start: nairobiDayStart(startDate),
      end: nairobiDayStart(endDate),
      grossSalesCents: 0,
      taxCents: 0,
      costCents: 0,
      approvedRefundCents: 0,
      refundedTaxCents: 0,
      restockedCostCents: 0,
      saleCount: 0,
    };
  });
  const rangeStart = nairobiDayStart(from);
  const rangeEnd = nairobiDayStart(addDateDays(to, 1));
  const [sales, refunds] = await Promise.all([
    prisma.sale.findMany({
      where: businessWhere(shopId, {
        status: { in: [SaleStatus.completed, SaleStatus.partially_refunded, SaleStatus.refunded] },
        createdAt: { gte: rangeStart, lt: rangeEnd },
      }),
      select: {
        createdAt: true,
        totalCents: true,
        taxCents: true,
        items: {
          select: {
            qty: true,
            unitCostCents: true,
            lineTotalCents: true,
            variant: {
              select: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    department: { select: { name: true } },
                    productType: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        payments: {
          where: { status: PaymentStatus.paid },
          select: { method: true, amountCents: true },
        },
      },
    }),
    prisma.refund.findMany({
      where: businessWhere(shopId, {
        status: RefundStatus.approved,
        updatedAt: { gte: rangeStart, lt: rangeEnd },
      }),
      select: {
        updatedAt: true,
        amountCents: true,
        items: {
          select: {
            quantity: true,
            disposition: true,
            saleItem: {
              select: {
                unitCostCents: true,
                qty: true,
                taxCents: true,
                lineTotalCents: true,
                variant: {
                  select: {
                    product: {
                      select: {
                        id: true,
                        name: true,
                        department: { select: { name: true } },
                        productType: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const bucketFor = (date: Date) => {
    const day = nairobiDateKey(date);
    return buckets.find(({ startDate, endDate }) => day >= startDate && day < endDate);
  };
  const payments = new Map<string, { amountCents: number; paymentCount: number }>();
  const products = new Map<
    string,
    { productId: string; name: string; quantity: number; salesCents: number; costCents: number }
  >();
  const categories = new Map<
    string,
    { department: string; type: string; quantity: number; salesCents: number }
  >();

  for (const sale of sales) {
    const bucket = bucketFor(sale.createdAt);
    if (!bucket) continue;
    bucket.grossSalesCents += sale.totalCents;
    bucket.taxCents += sale.taxCents;
    bucket.costCents += sale.items.reduce((sum, item) => sum + item.unitCostCents * item.qty, 0);
    bucket.saleCount += 1;
    for (const payment of sale.payments) {
      const current = payments.get(payment.method) ?? { amountCents: 0, paymentCount: 0 };
      current.amountCents += payment.amountCents;
      current.paymentCount += 1;
      payments.set(payment.method, current);
    }
    for (const item of sale.items) {
      const product = item.variant.product;
      const currentProduct = products.get(product.id) ?? {
        productId: product.id,
        name: product.name,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
      };
      currentProduct.quantity += item.qty;
      currentProduct.salesCents += item.lineTotalCents;
      currentProduct.costCents += item.unitCostCents * item.qty;
      products.set(product.id, currentProduct);

      const categoryKey = `${product.department.name}\u0000${product.productType.name}`;
      const currentCategory = categories.get(categoryKey) ?? {
        department: product.department.name,
        type: product.productType.name,
        quantity: 0,
        salesCents: 0,
      };
      currentCategory.quantity += item.qty;
      currentCategory.salesCents += item.lineTotalCents;
      categories.set(categoryKey, currentCategory);
    }
  }
  for (const refund of refunds) {
    const bucket = bucketFor(refund.updatedAt);
    if (!bucket) continue;
    bucket.approvedRefundCents += refund.amountCents;
    bucket.refundedTaxCents += refund.items.reduce(
      (sum, item) => sum + Math.round((item.saleItem.taxCents * item.quantity) / item.saleItem.qty),
      0,
    );
    bucket.restockedCostCents += refund.items.reduce(
      (sum, item) =>
        sum + (item.disposition === "restock" ? item.saleItem.unitCostCents * item.quantity : 0),
      0,
    );
    for (const item of refund.items) {
      const product = item.saleItem.variant.product;
      const refundedRevenueCents = Math.round(
        (item.saleItem.lineTotalCents * item.quantity) / item.saleItem.qty,
      );
      const productRow = products.get(product.id) ?? {
        productId: product.id,
        name: product.name,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
      };
      productRow.quantity -= item.quantity;
      productRow.salesCents -= refundedRevenueCents;
      if (item.disposition === "restock")
        productRow.costCents -= item.saleItem.unitCostCents * item.quantity;
      products.set(product.id, productRow);

      const categoryKey = `${product.department.name}\u0000${product.productType.name}`;
      const categoryRow = categories.get(categoryKey) ?? {
        department: product.department.name,
        type: product.productType.name,
        quantity: 0,
        salesCents: 0,
      };
      categoryRow.quantity -= item.quantity;
      categoryRow.salesCents -= refundedRevenueCents;
      categories.set(categoryKey, categoryRow);
    }
  }

  const series = buckets.map((bucket) => {
    const result = calculateProfitability({
      grossSalesCents: bucket.grossSalesCents,
      taxCents: bucket.taxCents,
      costCents: bucket.costCents,
      approvedRefundCents: bucket.approvedRefundCents,
      refundedTaxCents: bucket.refundedTaxCents,
      restockedCostCents: bucket.restockedCostCents,
    });
    return {
      date: bucket.startDate,
      endDate: bucket.endDate,
      ...result,
      saleCount: bucket.saleCount,
    };
  });
  const totals = series.reduce(
    (result, bucket) => ({
      netSalesCents: result.netSalesCents + bucket.netRevenueCents,
      grossProfitCents: result.grossProfitCents + bucket.profitCents,
      saleCount: result.saleCount + bucket.saleCount,
    }),
    { netSalesCents: 0, grossProfitCents: 0, saleCount: 0 },
  );
  return {
    range: { from, to, grouping: groupByWeek ? "week" : "day" },
    totals: {
      ...totals,
      averageSaleCents: totals.saleCount ? Math.round(totals.netSalesCents / totals.saleCount) : 0,
      marginPct:
        totals.netSalesCents > 0
          ? Number(((totals.grossProfitCents / totals.netSalesCents) * 100).toFixed(1))
          : null,
      refundCents: refunds.reduce((sum, refund) => sum + refund.amountCents, 0),
    },
    series,
    payments: [...payments.entries()]
      .map(([method, values]) => ({ method, ...values }))
      .sort((a, b) => b.amountCents - a.amountCents),
    topProducts: [...products.values()]
      .filter((product) => product.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity || b.salesCents - a.salesCents)
      .slice(0, 8)
      .map((product) => ({
        ...product,
        grossProfitCents: product.salesCents - product.costCents,
      })),
    topCategories: [...categories.values()]
      .filter((category) => category.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity || b.salesCents - a.salesCents)
      .slice(0, 8),
  };
}

export const salesRouter = Router();
salesRouter.get(
  "/documents/settings",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    if (user.role.name !== "admin") return response.status(403).json({ error: "Forbidden" });
    const shop = await prisma.shop.findUniqueOrThrow({ where: shopRowWhere(request, {}) });
    const settings = readShopSettings(shop.settingsJson);
    return response.json({
      settings: {
        name: shopSettingText(settings, "brand_name"),
        logoUrl: shopSettingText(settings, "logo_url"),
        address: shopSettingText(settings, "address"),
        phone: shopSettingText(settings, "phone"),
        kraPin: shopSettingText(settings, "kra_pin"),
        receiptPrefix: shopSettingText(settings, "receipt_prefix") || "EJ",
        receiptFooter: shopSettingText(settings, "receipt_footer"),
        invoiceTerms: shopSettingText(settings, "invoice_terms"),
        taxEnabled: settings.tax_enabled === true,
        taxRateBps: typeof settings.tax_rate_bps === "number" ? settings.tax_rate_bps : 0,
        taxInclusive: settings.tax_inclusive === true,
      },
    });
  },
);

salesRouter.patch(
  "/documents/settings",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    if (user.role.name !== "admin") return response.status(403).json({ error: "Forbidden" });
    const parsed = documentSettingsInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid document settings", details: parsed.error.flatten() });
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.shop.findUniqueOrThrow({ where: shopRowWhere(request, {}) });
      const settings = { ...readShopSettings(current.settingsJson) };
      settings.brand_name = parsed.data.name;
      settings.address = parsed.data.address || "";
      settings.phone = parsed.data.phone || "";
      settings.kra_pin = parsed.data.kraPin || "";
      settings.logo_url = parsed.data.logoUrl || "";
      settings.receipt_prefix = parsed.data.receiptPrefix || "EJ";
      settings.receipt_footer = parsed.data.receiptFooter;
      settings.invoice_terms = parsed.data.invoiceTerms;
      settings.tax_enabled = parsed.data.taxEnabled;
      settings.tax_rate_bps = parsed.data.taxRateBps;
      settings.tax_inclusive = parsed.data.taxInclusive;
      const shop = await tx.shop.update({
        where: shopRowWhere(request, {}),
        data: {
          settingsJson: settings as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: shopData(request, {
          userId: user.id,
          action: "shop.document_settings_updated",
          entity: "shop",
          entityId: shop.id,
          afterJson: {
          fields: ["brand_name", "logo_url", "address", "phone", "kra_pin", "receipt_prefix", "receipt_footer", "invoice_terms", "tax_enabled", "tax_rate_bps", "tax_inclusive"],
          },
          ip: request.ip ?? null,
        }),
      });
      return shop;
    });
    return response.json({ settings: { name: shopSettingText(updated.settingsJson, "brand_name") } });
  },
);

salesRouter.get(
  "/reports/owner-summary",
  requirePermission("sales.read.all"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    if (user.role.name !== "admin") return response.status(403).json({ error: "Forbidden" });

    return response.json(await getOwnerSummary(user.shopId));
  },
);

salesRouter.get(
  "/reports/analysis",
  requirePermission("sales.read.all"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    if (user.role.name !== "admin") return response.status(403).json({ error: "Forbidden" });
    const parsed = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(request.query);
    if (!parsed.success)
      return response.status(400).json({ error: "Choose a valid start and end date" });
    const { from, to } = parsed.data;
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime()) ||
      fromDate.toISOString().slice(0, 10) !== from ||
      toDate.toISOString().slice(0, 10) !== to
    )
      return response.status(400).json({ error: "Choose real calendar dates" });
    const dayCount = (toDate.getTime() - fromDate.getTime()) / 86_400_000 + 1;
    if (dayCount < 1 || dayCount > 366)
      return response.status(400).json({ error: "Choose a date range of up to one year" });
    response.setHeader("Cache-Control", "no-store");
    return response.json(await getSalesAnalysis(user.shopId, from, to));
  },
);

salesRouter.get(
  "/reports/owner-summary.pdf",
  requirePermission("sales.read.all"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    if (user.role.name !== "admin") return response.status(403).json({ error: "Forbidden" });
    const [summary, shop] = await Promise.all([
      getOwnerSummary(user.shopId),
      prisma.shop.findUniqueOrThrow({
        where: shopRowWhere(request, {}),
        select: { settingsJson: true },
      }),
    ]);
    const netRevenueCents = summary.days.reduce((sum, day) => sum + day.netRevenueCents, 0);
    const profitCents = summary.days.reduce((sum, day) => sum + day.profitCents, 0);
    const saleCount = summary.days.reduce((sum, day) => sum + day.saleCount, 0);
    const marginPct =
      netRevenueCents > 0 ? Number(((profitCents / netRevenueCents) * 100).toFixed(1)) : null;
    const money = (cents: number) =>
      `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dateLabel = (date: string) =>
      new Intl.DateTimeFormat("en-KE", {
        timeZone: "Africa/Nairobi",
        dateStyle: "medium",
      }).format(nairobiDayStart(date));

    await prisma.auditLog.create({
      data: shopData(request, {
        userId: user.id,
        action: "report.owner_pdf_generated",
        entity: "report",
        entityId: user.shopId,
        afterJson: { from: summary.days[0]!.date, to: summary.today.date },
        ip: request.ip ?? null,
      }),
    });

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="owner-profitability-report.pdf"',
    );
    doc.pipe(response);
    const navy = "#162A45";
    const blue = "#245AB8";
    const muted = "#65758B";
    const from = summary.days[0]!.date;
    const to = summary.today.date;
    const generatedAt = new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor(navy)
      .text(shopSettingText(shop.settingsJson, "brand_name"));
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(24).fillColor(blue).text("PROFITABILITY REPORT");
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(muted)
      .text(`${dateLabel(from)} – ${dateLabel(to)} · Generated ${generatedAt} EAT`);
    doc.moveDown(1.5);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(navy).text("LAST SEVEN DAYS");
    doc.moveDown(0.6);
    const tableX = 48;
    const tableWidth = 499;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(tableX, y, tableWidth, 25).fill(navy);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
      doc.text("DATE", 56, y + 8, { width: 120 });
      doc.text("SALES", 190, y + 8, { width: 45, align: "right" });
      doc.text("NET SALES", 240, y + 8, { width: 100, align: "right" });
      doc.text("GROSS PROFIT", 350, y + 8, { width: 115, align: "right" });
      doc.text("MARGIN", 480, y + 8, { width: 60, align: "right" });
      doc.y = y + 32;
    };
    drawHeader();
    for (const [index, day] of summary.days.entries()) {
      const y = doc.y;
      if (index % 2 === 1) doc.rect(tableX, y - 4, tableWidth, 23).fill("#F3F6FA");
      doc.font("Helvetica").fontSize(9).fillColor(navy);
      doc.text(dateLabel(day.date), 56, y, { width: 120 });
      doc.text(String(day.saleCount), 190, y, { width: 45, align: "right" });
      doc.text(money(day.netRevenueCents), 240, y, { width: 100, align: "right" });
      doc.text(money(day.profitCents), 350, y, { width: 115, align: "right" });
      doc.text(day.marginPct === null ? "—" : `${day.marginPct}%`, 480, y, {
        width: 60,
        align: "right",
      });
      doc.y = y + 24;
    }
    doc.moveDown(0.3);
    doc
      .strokeColor("#D8E0EA")
      .moveTo(tableX, doc.y)
      .lineTo(tableX + tableWidth, doc.y)
      .stroke();
    doc.moveDown(0.6);
    const totalY = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(navy)
      .text(`TOTAL · ${saleCount} sales`, 56, totalY);
    doc.text(money(netRevenueCents), 240, totalY, { width: 100, align: "right" });
    doc.text(money(profitCents), 350, totalY, { width: 115, align: "right" });
    doc.text(marginPct === null ? "—" : `${marginPct}%`, 480, totalY, {
      width: 60,
      align: "right",
    });
    doc.moveDown(2);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(muted)
      .text(
        "Gross profit is net sales less sale-time item costs, adjusted for approved refunds and items returned to sellable stock. It excludes rent, payroll, and other operating expenses.",
        { align: "left", width: tableWidth },
      );
    doc.end();
  },
);

salesRouter.get(
  "/",
  requirePermission("sales.read.own"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    const parsedPage = z
      .object({
        scope: z.enum(["all"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(100),
      })
      .safeParse(request.query);
    if (!parsedPage.success) return response.status(400).json({ error: "Invalid sales page" });
    const canReadAll = canAccess(user, "sales.read.all");
    const all = canReadAll && parsedPage.data.scope === "all";
    const sales = await prisma.sale.findMany({
      where: shopWhere(request, all ? {} : { sellerId: user.id }),
      include: saleInclude,
      orderBy: { createdAt: "desc" },
      skip: (parsedPage.data.page - 1) * parsedPage.data.pageSize,
      take: parsedPage.data.pageSize,
    });
    return response.json({
      sales: sales.map((sale) => serializeSale(sale, user.role.name === "admin")),
      page: parsedPage.data.page,
      pageSize: parsedPage.data.pageSize,
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
    let paymentsInput: z.infer<typeof saleInput>["payments"];
    let customerDetails: z.infer<typeof saleInput>["customerDetails"];
    try {
      paymentsInput = parsed.data.payments.map((payment) =>
        payment.method === "mpesa_stk"
          ? { ...payment, phone: normalizeKenyanPhone(payment.phone) }
          : payment,
      );
      customerDetails = parsed.data.customerDetails
        ? {
            ...parsed.data.customerDetails,
            phone: normalizeKenyanPhone(parsed.data.customerDetails.phone),
          }
        : undefined;
    } catch (error) {
      return response
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Invalid phone" });
    }
    if (
      paymentsInput.some(
        (payment) =>
          payment.method === "mpesa_stk" &&
          (payment.amountCents < 1000 || payment.amountCents % 100 !== 0),
      )
    )
      return response
        .status(400)
        .json({ error: "Lipwa STK payments must be whole KES amounts of at least KES 10" });
    const user = request.authUser!;
    const shopId = sessionShopId(request);
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
            where: shopWhere(request, { sellerId: user.id, closedAt: null }),
          });
          if (!shift) throw new Error("Open a shift before completing a sale");
          const shop = await tx.shop.findUniqueOrThrow({
            where: shopRowWhere(request, {}),
            select: { settingsJson: true },
          });
          const settings = readShopSettings(shop.settingsJson);
          const allowNegativeStock = settings.allow_negative_stock === true;
          const receiptPrefix = shopSettingText(settings, "receipt_prefix") || "EJ";
          const variants = await tx.productVariant.findMany({
            where: shopWhere(request, { id: { in: parsed.data.items.map(({ variantId }) => variantId) } }),
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
          const taxEnabled = settings.tax_enabled === true;
          const taxRateBps =
            typeof settings.tax_rate_bps === "number" && Number.isInteger(settings.tax_rate_bps)
              ? Math.max(0, Math.min(10000, settings.tax_rate_bps))
              : 0;
          const taxInclusive = settings.tax_inclusive === true;
          const netTotalCents = total.subtotalCents - total.discountCents;
          const lineNetBeforeCart = lines.map(
            ({ input, unitPriceCents }) => unitPriceCents * input.quantity - input.discountCents,
          );
          const lineNetBeforeCartTotal = lineNetBeforeCart.reduce((sum, amount) => sum + amount, 0);
          let allocatedNetCents = 0;
          const lineTaxCents = lineNetBeforeCart.map((lineNet, index) => {
            const lineNetAfterDiscount =
              index === lineNetBeforeCart.length - 1
                ? netTotalCents - allocatedNetCents
                : lineNetBeforeCartTotal > 0
                  ? Math.floor((netTotalCents * lineNet) / lineNetBeforeCartTotal)
                  : 0;
            allocatedNetCents += lineNetAfterDiscount;
            return calculateTaxCents(lineNetAfterDiscount, taxEnabled, taxRateBps, taxInclusive);
          });
          const taxCents = lineTaxCents.reduce((sum, amount) => sum + amount, 0);
          const saleTotalCents = netTotalCents + (taxInclusive ? 0 : taxCents);
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
            !(await tx.customer.findFirst({ where: shopWhere(request, { id: parsed.data.customerId }) }))
          )
            throw new Error("Customer not found in this shop");
          const customer = customerDetails
            ? await tx.customer.upsert({
                where: {
                  shopId_phone: shopWhere(request, { phone: customerDetails.phone }),
                },
              create: shopData(request, {
                  name: customerDetails.name,
                  phone: customerDetails.phone,
                  email: customerDetails.email ?? null,
              }),
                update: {
                  name: customerDetails.name,
                  ...(customerDetails.email ? { email: customerDetails.email } : {}),
                },
              })
            : null;
          const saleCustomerId = customer?.id ?? parsed.data.customerId ?? null;
          const paymentRows = paymentPlan(paymentsInput, saleTotalCents);
          const hasPendingStk = paymentRows.some(
            ({ method }) => method === PaymentMethod.mpesa_stk,
          );
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
          for (const demand of hasPendingStk ? [] : demands) {
            const variant = await tx.productVariant.findFirst({
              where: shopWhere(request, { id: demand.variantId }),
            });
            if (!variant) throw new Error("Bundle component not found in this shop");
            const stockLevel = await tx.stockLevel.findUnique({
              where: shopWhere(request, { shopId_variantId: { shopId, variantId: demand.variantId } }),
            });
            if (!allowNegativeStock) {
              const where: Prisma.StockLevelWhereInput = shopWhere(request, {
                variantId: demand.variantId,
                ...(demand.quantity ? { quantity: { gte: demand.quantity } } : {}),
                ...(demand.ml ? { mlRemaining: { gte: demand.ml } } : {}),
              });
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
                where: shopWhere(request, { shopId_variantId: { shopId, variantId: demand.variantId } }),
                create: shopData(request, {
                  variantId: demand.variantId,
                  quantity: -demand.quantity,
                  mlRemaining: demand.ml ? -demand.ml : null,
                }),
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
              data: shopData(request, {
                variantId: demand.variantId,
                quantityDelta: -demand.quantity,
                mlDelta: demand.ml ? -demand.ml : null,
                type: demand.movementType,
                referenceType: "sale",
                referenceId: saleId,
                reason: "Completed sale",
                userId: user.id,
              }),
            });
          }
          const counter = await tx.receiptCounter.upsert({
            where: shopWhere(request, {}),
            create: shopData(request, { lastValue: 1 }),
            update: { lastValue: { increment: 1 } },
          });
          const receiptNo = receiptPrefix + "-" + String(counter.lastValue).padStart(6, "0");
          const sale = await tx.sale.create({
            data: shopData(request, {
              id: saleId,
              clientUuid: parsed.data.clientUuid,
              receiptNo,
              deviceId: parsed.data.deviceId ?? null,
              shiftId: shift.id,
              sellerId: user.id,
              customerId: saleCustomerId,
              status: hasPendingStk ? SaleStatus.draft : SaleStatus.completed,
              subtotalCents: total.subtotalCents,
              discountCents: total.discountCents,
              taxCents,
              totalCents: saleTotalCents,
              paidCents: hasPendingStk
                ? paymentRows
                    .filter(({ method }) => method !== PaymentMethod.mpesa_stk)
                    .reduce((sum, { amountCents }) => sum + amountCents, 0)
                : saleTotalCents,
              changeCents: allocateSalePayments(paymentsInput as SalePayment[], saleTotalCents)
                .changeCents,
              notes: parsed.data.notes ?? null,
              items: {
                create: lines.map(({ input, variant, unitPriceCents, unitCostCents }, index) => shopData(request, {
                  variantId: variant.id,
                  qty: input.quantity,
                  mlQty: variant.parentBulkVariantId ? input.quantity * variant.mlPerUnit! : null,
                  unitPriceCents,
                  unitCostCents,
                  discountCents: input.discountCents,
                  taxCents: lineTaxCents[index] ?? 0,
                  lineTotalCents: unitPriceCents * input.quantity - input.discountCents,
                })),
              },
              payments: {
                create: paymentRows.map(({ method, status, amountCents, ...extra }) => shopData(request, {
                  method,
                  status,
                  amountCents,
                  ...extra,
                })),
              },
            }),
            include: saleInclude,
          });
          await tx.auditLog.create({
            data: shopData(request, {
              userId: user.id,
              action: hasPendingStk ? "sale.payment_pending" : "sale.completed",
              entity: "sale",
              entityId: sale.id,
              afterJson: {
                receiptNo,
                totalCents: sale.totalCents,
                discountCents: sale.discountCents,
                discountReason: parsed.data.discountReason ?? null,
                itemCount: sale.items.length,
                paymentMethods: paymentRows.map(({ method }) => method),
                awaitingStk: hasPendingStk,
              },
              ip: request.ip ?? null,
            }),
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
      where: shopWhere(request, { sellerId: request.authUser!.id }),
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
      where: shopWhere(request, { sellerId: user.id, closedAt: null }),
    });
    if (!shift) return response.status(409).json({ error: "Open a shift before holding a cart" });
    const cart = await prisma.$transaction(async (tx) => {
      const created = await tx.heldCart.create({
        data: shopData(request, {
          sellerId: user.id,
          shiftId: shift.id,
          label: parsed.data.label ?? null,
          cartJson: parsed.data as Prisma.InputJsonValue,
        }),
      });
      await tx.auditLog.create({
        data: shopData(request, {
          userId: user.id,
          action: "sale.cart_held",
          entity: "held_cart",
          entityId: created.id,
          ip: request.ip ?? null,
        }),
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
      where: shopWhere(request, { sellerId: user.id, closedAt: null }),
    });
    if (!shift) return response.status(409).json({ error: "Open a shift before resuming a cart" });
    const cart = await prisma.$transaction(async (tx) => {
      const held = await tx.heldCart.findFirst({
        where: shopWhere(request, { id: request.params.id!, sellerId: user.id }),
      });
      if (!held) return null;
      await tx.heldCart.delete({ where: shopWhere(request, { id: held.id }) });
      await tx.auditLog.create({
        data: shopData(request, {
          userId: user.id,
          action: "sale.cart_resumed",
          entity: "held_cart",
          entityId: held.id,
          ip: request.ip ?? null,
        }),
      });
      return held;
    });
    if (!cart) return response.status(404).json({ error: "Held cart not found" });
    return response.json({ cart });
  },
);

salesRouter.get(
  "/:id/invoice",
  requirePermission("sales.read.own"),
  async (request: AuthenticatedRequest, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success)
      return response.status(400).json({ error: "Invalid sale id" });
    const user = request.authUser!;
    const sale = await prisma.sale.findFirst({
      where: shopWhere(request, { id: request.params.id! }),
      include: {
        shop: true,
        customer: { select: { name: true, phone: true, email: true } },
        seller: { select: { name: true } },
        items: { include: { variant: { include: { product: true } } } },
        payments: { select: { method: true, status: true, amountCents: true } },
      },
    });
    if (!sale || (sale.sellerId !== user.id && !canAccess(user, "sales.read.all")))
      return response.status(404).json({ error: "Sale not found" });
    if (
      sale.status !== SaleStatus.completed &&
      sale.status !== SaleStatus.partially_refunded &&
      sale.status !== SaleStatus.refunded
    )
      return response.status(409).json({ error: "Only completed sales can be invoiced" });

    const invoiceNo = `INV-${sale.receiptNo ?? sale.id.slice(0, 8)}`;
    const filename = invoiceNo.replace(/[^a-zA-Z0-9_-]/g, "-");
    const isPdf = request.query.format === "pdf";
    await prisma.auditLog.create({
      data: shopData(request, {
        userId: user.id,
        action: isPdf ? "invoice.generated" : "invoice.previewed",
        entity: "sale",
        entityId: sale.id,
        afterJson: { invoiceNo, format: isPdf ? "pdf" : "html" },
        ip: request.ip ?? null,
      }),
    });

    const money = (cents: number) =>
      `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const time = new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(sale.createdAt);
    const documentSettings = readShopSettings(sale.shop.settingsJson);
    const brandName = shopSettingText(documentSettings, "brand_name") || "Shop";
    const address = shopSettingText(documentSettings, "address");
    const phone = shopSettingText(documentSettings, "phone");
    const kraPin = shopSettingText(documentSettings, "kra_pin");
    const invoiceTerms = shopSettingText(documentSettings, "invoice_terms");
    const receiptFooter = shopSettingText(documentSettings, "receipt_footer");
    if (!isPdf) {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
      );
      response
        .type("html")
        .send(renderInvoiceHtml({ sale, invoiceNo, invoiceTerms, receiptFooter }));
      return;
    }
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Disposition",
      `${request.query.download === "1" ? "attachment" : "inline"}; filename="${filename}.pdf"`,
    );
    doc.pipe(response);

    const navy = "#162A45";
    const blue = "#245AB8";
    const muted = "#65758B";
    doc.font("Helvetica-Bold").fontSize(20).fillColor(navy).text(brandName);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(muted)
      .text(
        [
          address,
          phone,
          kraPin ? `Business PIN: ${kraPin}` : null,
        ]
          .filter(Boolean)
          .join("  •  "),
      );
    doc.moveDown(1.2);
    doc
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor(blue)
      .text("SALES INVOICE", { align: "right" });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(navy)
      .text(`${invoiceNo}\nReceipt: ${sale.receiptNo ?? "—"}\nDate: ${time}`, { align: "right" });
    doc.moveDown(1.2);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(muted).text("BILLED TO");
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(navy)
      .text(sale.customer?.name ?? "Walk-in customer");
    if (sale.customer?.phone)
      doc.font("Helvetica").fontSize(9).fillColor(muted).text(sale.customer.phone);
    if (sale.customer?.email) doc.text(sale.customer.email);
    doc.moveDown(1);

    const tableX = 48;
    const itemWidth = 260;
    const qtyX = 320;
    const unitX = 372;
    const totalX = 478;
    const tableWidth = 499;
    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(tableX, y, tableWidth, 24).fill(navy);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF");
      doc.text("ITEM", tableX + 8, y + 7, { width: itemWidth - 8 });
      doc.text("QTY", qtyX, y + 7, { width: 38, align: "right" });
      doc.text("UNIT PRICE", unitX, y + 7, { width: 92, align: "right" });
      doc.text("TOTAL", totalX, y + 7, { width: 65, align: "right" });
      doc.y = y + 32;
    };
    drawTableHeader();
    for (const [index, item] of sale.items.entries()) {
      const name = `${item.variant.product.name}\nSKU: ${item.variant.sku}`;
      const rowHeight = Math.max(30, doc.heightOfString(name, { width: itemWidth - 8 }) + 10);
      if (doc.y + rowHeight > doc.page.height - 120) {
        doc.addPage();
        drawTableHeader();
      }
      const y = doc.y;
      if (index % 2 === 1) doc.rect(tableX, y - 4, tableWidth, rowHeight).fill("#F3F6FA");
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(navy)
        .text(name, tableX + 8, y, { width: itemWidth - 8 });
      doc.font("Helvetica").fontSize(9).fillColor(navy);
      doc.text(String(item.qty), qtyX, y + 1, { width: 38, align: "right" });
      doc.text(money(item.unitPriceCents), unitX, y + 1, { width: 92, align: "right" });
      doc
        .font("Helvetica-Bold")
        .text(money(item.lineTotalCents), totalX, y + 1, { width: 65, align: "right" });
      doc.y = y + rowHeight;
    }
    doc.moveDown(0.5);
    doc
      .strokeColor("#D8E0EA")
      .moveTo(tableX, doc.y)
      .lineTo(tableX + tableWidth, doc.y)
      .stroke();
    doc.moveDown(0.6);
    const totalLine = (label: string, amount: number, strong = false) => {
      doc
        .font(strong ? "Helvetica-Bold" : "Helvetica")
        .fontSize(strong ? 12 : 10)
        .fillColor(strong ? navy : muted)
        .text(label, 330, doc.y, { width: 100, continued: true });
      doc.text(money(amount), { align: "right" });
      doc.moveDown(0.45);
    };
    totalLine("Subtotal", sale.subtotalCents);
    if (sale.discountCents) totalLine("Discount", -sale.discountCents);
    totalLine("Recorded tax", sale.taxCents);
    totalLine("Total", sale.totalCents, true);
    totalLine("Paid", sale.paidCents);
    if (sale.totalCents > sale.paidCents)
      totalLine("Balance due", sale.totalCents - sale.paidCents, true);
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(navy).text("PAYMENT DETAILS");
    doc.font("Helvetica").fontSize(9).fillColor(muted);
    for (const payment of sale.payments) {
      doc.text(
        `${payment.method.replaceAll("_", " ")} · ${payment.status.replaceAll("_", " ")} · ${money(payment.amountCents)}`,
      );
    }
    if (invoiceTerms) {
      doc.moveDown(0.7).font("Helvetica").fontSize(8).fillColor(muted).text(invoiceTerms);
    }
    doc.moveDown(1.2);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(muted)
      .text(
        `${receiptFooter}\nServed by ${sale.seller.name}. This printable sales invoice is a shop record and is not an eTIMS tax invoice.`,
        { align: "center" },
      );
    doc.end();
  },
);

salesRouter.get(
  "/:id/receipt",
  requirePermission("sales.read.own"),
  async (request: AuthenticatedRequest, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success)
      return response.status(400).json({ error: "Invalid sale id" });
    const user = request.authUser!;
    const sale = await prisma.sale.findFirst({
      where: shopWhere(request, { id: request.params.id! }),
      include: {
        shop: true,
        customer: { select: { name: true, phone: true } },
        seller: { select: { name: true } },
        items: { include: { variant: { include: { product: true } } } },
        payments: true,
      },
    });
    if (!sale || (sale.sellerId !== user.id && !canAccess(user, "sales.read.all")))
      return response.status(404).json({ error: "Sale not found" });
    await prisma.auditLog.create({
      data: shopData(request, {
        userId: user.id,
        action: "receipt.reprinted",
        entity: "sale",
        entityId: sale.id,
        afterJson: {
          receiptNo: sale.receiptNo,
          format: request.query.format === "pdf" ? "pdf" : "html",
        },
      }),
    });
    const money = (cents: number) => `KES ${(cents / 100).toFixed(2)}`;
    const esc = (value: string) =>
      value.replace(
        /[&<>"']/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
      );
    const lines = sale.items.map(
      (item) =>
        `${item.qty} x ${item.variant.product.name} (${item.variant.sku})  ${money(item.lineTotalCents)}`,
    );
    const time = new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(sale.createdAt);
    const documentSettings = readShopSettings(sale.shop.settingsJson);
    const brandName = shopSettingText(documentSettings, "brand_name") || "Shop";
    const address = shopSettingText(documentSettings, "address");
    const phone = shopSettingText(documentSettings, "phone");
    const kraPin = shopSettingText(documentSettings, "kra_pin");
    const receiptFooter = shopSettingText(documentSettings, "receipt_footer");
    const thermalWidth = request.query.width === "58" ? 58 : 80;
    if (request.query.format === "pdf") {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `inline; filename="${sale.receiptNo ?? "receipt"}.pdf"`,
      );
      doc.pipe(response);
      doc.fontSize(18).text(brandName, { align: "center" });
      doc.moveDown(0.3).fontSize(9).text("COPY", { align: "center" });
      doc
        .moveDown()
        .fontSize(10)
        .text(
          `${address}\n${phone}\n${kraPin ? `KRA PIN: ${kraPin}` : ""}`,
        );
      doc
        .moveDown()
        .text(`Receipt: ${sale.receiptNo ?? "—"}\nDate: ${time}\nServed by: ${sale.seller.name}`);
      if (sale.customer)
        doc.text(
          `Customer: ${sale.customer.name ?? "Customer"}${sale.customer.phone ? ` · ${sale.customer.phone}` : ""}`,
        );
      doc.moveDown().text("----------------------------------------------");
      for (const line of lines) doc.text(line);
      doc.moveDown().text("----------------------------------------------");
      doc.text(
        `Subtotal: ${money(sale.subtotalCents)}\nDiscount: ${money(sale.discountCents)}\nTax: ${money(sale.taxCents)}\nTotal: ${money(sale.totalCents)}\nPaid: ${money(sale.paidCents)}`,
      );
      doc.moveDown().text("Payments");
      for (const payment of sale.payments)
        doc.text(
          `${payment.method} ${payment.status}: ${money(payment.amountCents)}${payment.mpesaReceipt ? ` (${payment.mpesaReceipt})` : ""}`,
        );
      doc.moveDown().fontSize(9).text(receiptFooter, { align: "center" });
      doc.end();
      return;
    }
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    response
      .type("html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Receipt ${esc(sale.receiptNo ?? "")}</title><style>@page{size:${thermalWidth}mm auto;margin:3mm}body{font:12px monospace;color:#000;width:calc(${thermalWidth}mm - 6mm);margin:auto}header{text-align:center;font-weight:bold;font-size:16px}hr{border:0;border-top:1px dashed #000}.row{display:flex;justify-content:space-between;gap:8px}.copy{text-align:center;font-weight:bold}.total{font-weight:bold;font-size:14px}@media print{button{display:none}}</style></head><body><header>${esc(brandName)}</header><p class="copy">COPY</p><center>${esc(address)}<br>${esc(phone)}<br>${kraPin ? `KRA PIN: ${esc(kraPin)}` : ""}</center><hr>Receipt: ${esc(sale.receiptNo ?? "—")}<br>${esc(time)}<br>Served by: ${esc(sale.seller.name)}${sale.customer ? `<br>Customer: ${esc(sale.customer.name ?? "Customer")}${sale.customer.phone ? ` · ${esc(sale.customer.phone)}` : ""}` : ""}<hr>${lines.map((line) => `<div>${esc(line)}</div>`).join("")}<hr><div class="row"><span>Subtotal</span><span>${money(sale.subtotalCents)}</span></div><div class="row"><span>Discount</span><span>${money(sale.discountCents)}</span></div><div class="row"><span>Tax</span><span>${money(sale.taxCents)}</span></div><div class="row total"><span>Total</span><span>${money(sale.totalCents)}</span></div><div class="row"><span>Paid</span><span>${money(sale.paidCents)}</span></div><hr>${sale.payments.map((payment) => `<div>${esc(payment.method)} ${esc(payment.status)} ${money(payment.amountCents)} ${payment.mpesaReceipt ? esc(payment.mpesaReceipt) : ""}</div>`).join("")}<p style="text-align:center">${esc(receiptFooter)}</p><button onclick="print()">Print</button></body></html>`,
      );
  },
);
