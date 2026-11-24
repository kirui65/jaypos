import { randomUUID } from "node:crypto";
import { PaymentMethod, PaymentStatus, Prisma, SaleStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { canAccess } from "../auth/permissions.js";
import { normalizeKenyanPhone } from "@eminent/shared";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { allocateSalePayments, calculateSaleTotals, type SalePayment } from "./math.js";
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
    address: z.string().trim().max(300),
    phone: z.string().trim().max(32),
    kraPin: z.string().trim().max(32),
    receiptFooter: z.string().trim().max(300),
    invoiceTerms: z.string().trim().max(800),
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

function documentSetting(value: unknown, key: string, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const setting = (value as Record<string, unknown>)[key];
  return typeof setting === "string" ? setting : fallback;
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
  return prisma.sale.findFirst({ where: { shopId, clientUuid }, include: saleInclude });
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
      where: {
        shopId,
        status: {
          in: [SaleStatus.completed, SaleStatus.partially_refunded, SaleStatus.refunded],
        },
        createdAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: {
        createdAt: true,
        totalCents: true,
        taxCents: true,
        items: { select: { qty: true, unitCostCents: true } },
      },
    }),
    prisma.refund.findMany({
      where: {
        shopId,
        status: "approved",
        updatedAt: { gte: rangeStart, lt: rangeEnd },
      },
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

export const salesRouter = Router();
salesRouter.get(
  "/documents/settings",
  requirePermission("catalog.manage"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    if (user.role.name !== "admin") return response.status(403).json({ error: "Forbidden" });
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: user.shopId } });
    return response.json({
      settings: {
        name: shop.name,
        address: shop.address ?? "",
        phone: shop.phone ?? "",
        kraPin: shop.kraPin ?? "",
        receiptFooter: documentSetting(
          shop.settingsJson,
          "receipt_footer",
          "Thank you for shopping with us",
        ),
        invoiceTerms: documentSetting(
          shop.settingsJson,
          "invoice_terms",
          "Please contact the shop with any questions about this invoice.",
        ),
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
      const current = await tx.shop.findUniqueOrThrow({ where: { id: user.shopId } });
      const settings =
        current.settingsJson &&
        typeof current.settingsJson === "object" &&
        !Array.isArray(current.settingsJson)
          ? { ...(current.settingsJson as Record<string, unknown>) }
          : {};
      settings.brand_name = parsed.data.name;
      settings.receipt_footer = parsed.data.receiptFooter;
      settings.invoice_terms = parsed.data.invoiceTerms;
      const shop = await tx.shop.update({
        where: { id: user.shopId },
        data: {
          name: parsed.data.name,
          address: parsed.data.address || null,
          phone: parsed.data.phone || null,
          kraPin: parsed.data.kraPin || null,
          settingsJson: settings as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          shopId: user.shopId,
          userId: user.id,
          action: "shop.document_settings_updated",
          entity: "shop",
          entityId: shop.id,
          afterJson: {
            fields: ["name", "address", "phone", "kraPin", "receipt_footer", "invoice_terms"],
          },
          ip: request.ip ?? null,
        },
      });
      return shop;
    });
    return response.json({ settings: { name: updated.name } });
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
  "/reports/owner-summary.pdf",
  requirePermission("sales.read.all"),
  async (request: AuthenticatedRequest, response) => {
    const user = request.authUser!;
    if (user.role.name !== "admin") return response.status(403).json({ error: "Forbidden" });
    const [summary, shop] = await Promise.all([
      getOwnerSummary(user.shopId),
      prisma.shop.findUniqueOrThrow({ where: { id: user.shopId }, select: { name: true } }),
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
      data: {
        shopId: user.shopId,
        userId: user.id,
        action: "report.owner_pdf_generated",
        entity: "report",
        entityId: user.shopId,
        afterJson: { from: summary.days[0]!.date, to: summary.today.date },
        ip: request.ip ?? null,
      },
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
    doc.font("Helvetica-Bold").fontSize(20).fillColor(navy).text(shop.name);
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
      where: { shopId: user.shopId, ...(all ? {} : { sellerId: user.id }) },
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
          const customer = customerDetails
            ? await tx.customer.upsert({
                where: {
                  shopId_phone: { shopId, phone: customerDetails.phone },
                },
                create: {
                  shopId,
                  name: customerDetails.name,
                  phone: customerDetails.phone,
                  email: customerDetails.email ?? null,
                },
                update: {
                  name: customerDetails.name,
                  ...(customerDetails.email ? { email: customerDetails.email } : {}),
                },
              })
            : null;
          const saleCustomerId = customer?.id ?? parsed.data.customerId ?? null;
          const paymentRows = paymentPlan(paymentsInput, total.totalCents);
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
              customerId: saleCustomerId,
              status: hasPendingStk ? SaleStatus.draft : SaleStatus.completed,
              subtotalCents: total.subtotalCents,
              discountCents: total.discountCents,
              taxCents: 0,
              totalCents: total.totalCents,
              paidCents: hasPendingStk
                ? paymentRows
                    .filter(({ method }) => method !== PaymentMethod.mpesa_stk)
                    .reduce((sum, { amountCents }) => sum + amountCents, 0)
                : total.totalCents,
              changeCents: allocateSalePayments(paymentsInput as SalePayment[], total.totalCents)
                .changeCents,
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

salesRouter.get(
  "/:id/invoice",
  requirePermission("sales.read.own"),
  async (request: AuthenticatedRequest, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success)
      return response.status(400).json({ error: "Invalid sale id" });
    const user = request.authUser!;
    const sale = await prisma.sale.findFirst({
      where: { id: request.params.id!, shopId: user.shopId },
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
      data: {
        shopId: user.shopId,
        userId: user.id,
        action: isPdf ? "invoice.generated" : "invoice.previewed",
        entity: "sale",
        entityId: sale.id,
        afterJson: { invoiceNo, format: isPdf ? "pdf" : "html" },
        ip: request.ip ?? null,
      },
    });

    const money = (cents: number) =>
      `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const time = new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(sale.createdAt);
    const invoiceTerms = documentSetting(
      sale.shop.settingsJson,
      "invoice_terms",
      "Please contact the shop with any questions about this invoice.",
    );
    const receiptFooter = documentSetting(
      sale.shop.settingsJson,
      "receipt_footer",
      "Thank you for shopping with us",
    );
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
    doc.font("Helvetica-Bold").fontSize(20).fillColor(navy).text(sale.shop.name);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(muted)
      .text(
        [
          sale.shop.address,
          sale.shop.phone,
          sale.shop.kraPin ? `Business PIN: ${sale.shop.kraPin}` : null,
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
      where: { id: request.params.id!, shopId: user.shopId },
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
      data: {
        shopId: user.shopId,
        userId: user.id,
        action: "receipt.reprinted",
        entity: "sale",
        entityId: sale.id,
        afterJson: {
          receiptNo: sale.receiptNo,
          format: request.query.format === "pdf" ? "pdf" : "html",
        },
      },
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
    const receiptFooter = documentSetting(
      sale.shop.settingsJson,
      "receipt_footer",
      "Thank you for shopping with us",
    );
    const thermalWidth = request.query.width === "58" ? 58 : 80;
    if (request.query.format === "pdf") {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `inline; filename="${sale.receiptNo ?? "receipt"}.pdf"`,
      );
      doc.pipe(response);
      doc.fontSize(18).text(sale.shop.name, { align: "center" });
      doc.moveDown(0.3).fontSize(9).text("COPY", { align: "center" });
      doc
        .moveDown()
        .fontSize(10)
        .text(
          `${sale.shop.address ?? ""}\n${sale.shop.phone ?? ""}\n${sale.shop.kraPin ? `KRA PIN: ${sale.shop.kraPin}` : ""}`,
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
        `Subtotal: ${money(sale.subtotalCents)}\nDiscount: ${money(sale.discountCents)}\nTotal: ${money(sale.totalCents)}\nPaid: ${money(sale.paidCents)}`,
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
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Receipt ${esc(sale.receiptNo ?? "")}</title><style>@page{size:${thermalWidth}mm auto;margin:3mm}body{font:12px monospace;color:#000;width:calc(${thermalWidth}mm - 6mm);margin:auto}header{text-align:center;font-weight:bold;font-size:16px}hr{border:0;border-top:1px dashed #000}.row{display:flex;justify-content:space-between;gap:8px}.copy{text-align:center;font-weight:bold}.total{font-weight:bold;font-size:14px}@media print{button{display:none}}</style></head><body><header>${esc(sale.shop.name)}</header><p class="copy">COPY</p><center>${esc(sale.shop.address ?? "")}<br>${esc(sale.shop.phone ?? "")}<br>${sale.shop.kraPin ? `KRA PIN: ${esc(sale.shop.kraPin)}` : ""}</center><hr>Receipt: ${esc(sale.receiptNo ?? "—")}<br>${esc(time)}<br>Served by: ${esc(sale.seller.name)}${sale.customer ? `<br>Customer: ${esc(sale.customer.name ?? "Customer")}${sale.customer.phone ? ` · ${esc(sale.customer.phone)}` : ""}` : ""}<hr>${lines.map((line) => `<div>${esc(line)}</div>`).join("")}<hr><div class="row"><span>Subtotal</span><span>${money(sale.subtotalCents)}</span></div><div class="row"><span>Discount</span><span>${money(sale.discountCents)}</span></div><div class="row total"><span>Total</span><span>${money(sale.totalCents)}</span></div><div class="row"><span>Paid</span><span>${money(sale.paidCents)}</span></div><hr>${sale.payments.map((payment) => `<div>${esc(payment.method)} ${esc(payment.status)} ${money(payment.amountCents)} ${payment.mpesaReceipt ? esc(payment.mpesaReceipt) : ""}</div>`).join("")}<p style="text-align:center">${esc(receiptFooter)}</p><button onclick="print()">Print</button></body></html>`,
      );
  },
);
