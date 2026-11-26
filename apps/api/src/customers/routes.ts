import { PaymentStatus, RefundStatus, SaleStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { normalizeKenyanPhone } from "@eminent/shared";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { shopData, shopWhere } from "../tenant-scope.js";

export const customersRouter = Router();

const stringList = z.array(z.string().trim().min(1).max(80)).max(30);
const preferenceInput = z
  .object({
    departments: stringList.default([]),
    productTypes: stringList.default([]),
    scentFamilies: stringList.default([]),
    likedNotes: stringList.default([]),
    dislikedNotes: stringList.default([]),
    brands: stringList.default([]),
    budgetMinCents: z.number().int().min(0).nullable().optional(),
    budgetMaxCents: z.number().int().min(0).nullable().optional(),
    occasions: stringList.default([]),
    sizes: stringList.default([]),
    colours: stringList.default([]),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.budgetMinCents == null ||
      value.budgetMaxCents == null ||
      value.budgetMinCents <= value.budgetMaxCents,
    { message: "Minimum budget must not exceed maximum budget", path: ["budgetMaxCents"] },
  );

const customerInput = z
  .object({
    name: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().min(1).max(32),
    email: z.union([z.string().trim().email().max(254), z.literal(""), z.null()]).optional(),
    birthday: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
      .optional(),
    gender: z.string().trim().max(40).nullable().optional(),
    smsConsent: z.boolean().default(false),
    consentSource: z.string().trim().max(80).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    preferences: preferenceInput.default({}),
  })
  .strict();

const customerPatchInput = customerInput.partial();
const includedSaleStatuses = [
  SaleStatus.completed,
  SaleStatus.partially_refunded,
  SaleStatus.refunded,
];

function dateValue(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function preferenceData(value: z.infer<typeof preferenceInput>) {
  return {
    departments: value.departments,
    productTypes: value.productTypes,
    scentFamilies: value.scentFamilies,
    likedNotes: value.likedNotes,
    dislikedNotes: value.dislikedNotes,
    brands: value.brands,
    budgetMinCents: value.budgetMinCents ?? null,
    budgetMaxCents: value.budgetMaxCents ?? null,
    occasions: value.occasions,
    sizes: value.sizes,
    colours: value.colours,
    notes: value.notes ?? null,
  };
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

customersRouter.get(
  "/",
  requirePermission("customers.write"),
  async (request: AuthenticatedRequest, response) => {
    const q = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 120) : "";
    const where = shopWhere(
      request,
      q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { phone: { contains: q } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {},
    );
    const customers = await prisma.customer.findMany({
      where,
      include: { preferences: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const ids = customers.map(({ id }) => id);
    const [sales, refunds] = ids.length
      ? await Promise.all([
          prisma.sale.groupBy({
            by: ["customerId"],
            where: shopWhere(request, {
              customerId: { in: ids },
              status: { in: includedSaleStatuses },
            }),
            _sum: { totalCents: true },
            _count: { _all: true },
            _max: { createdAt: true },
          }),
          prisma.refund.findMany({
            where: shopWhere(request, {
              status: RefundStatus.approved,
              sale: { customerId: { in: ids } },
            }),
            select: { amountCents: true, sale: { select: { customerId: true } } },
          }),
        ])
      : [[], []];
    const metrics = new Map(sales.map((sale) => [sale.customerId, sale]));
    const refundedAmounts = new Map<string, number>();
    for (const refund of refunds) {
      const customerId = refund.sale.customerId;
      if (!customerId) continue;
      refundedAmounts.set(customerId, (refundedAmounts.get(customerId) ?? 0) + refund.amountCents);
    }
    return response.json({
      customers: customers.map((customer) => {
        const totals = metrics.get(customer.id);
        return {
          ...customer,
          purchaseCount: totals?._count._all ?? 0,
          lifetimeSalesCents: Math.max(
            0,
            (totals?._sum.totalCents ?? 0) - (refundedAmounts.get(customer.id) ?? 0),
          ),
          lastVisitAt: totals?._max.createdAt ?? null,
        };
      }),
      limit: 500,
    });
  },
);

customersRouter.get(
  "/:id",
  requirePermission("customers.write"),
  async (request: AuthenticatedRequest, response) => {
    const customerId = request.params.id;
    if (!customerId) return response.status(404).json({ error: "Customer not found" });
    const customer = await prisma.customer.findFirst({
      where: shopWhere(request, { id: customerId }),
      include: { preferences: true },
    });
    if (!customer) return response.status(404).json({ error: "Customer not found" });

    const [sales, totals, refunds] = await Promise.all([
      prisma.sale.findMany({
        where: shopWhere(request, {
          customerId: customer.id,
          status: { in: includedSaleStatuses },
        }),
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          receiptNo: true,
          status: true,
          createdAt: true,
          totalCents: true,
          payments: {
            where: { status: PaymentStatus.paid },
            select: { method: true, amountCents: true },
          },
          items: {
            select: {
              qty: true,
              lineTotalCents: true,
              variant: { select: { product: { select: { name: true } } } },
            },
          },
        },
      }),
      prisma.sale.aggregate({
        where: shopWhere(request, {
          customerId: customer.id,
          status: { in: includedSaleStatuses },
        }),
        _sum: { totalCents: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.refund.aggregate({
        where: shopWhere(request, {
          status: RefundStatus.approved,
          sale: { customerId: customer.id },
        }),
        _sum: { amountCents: true },
      }),
    ]);
    const totalSpendCents = Math.max(
      0,
      (totals._sum.totalCents ?? 0) - (refunds._sum.amountCents ?? 0),
    );
    return response.json({
      customer: {
        ...customer,
        purchaseCount: totals._count._all,
        lifetimeSalesCents: totalSpendCents,
        lastVisitAt: totals._max.createdAt,
        purchases: sales,
      },
    });
  },
);

customersRouter.post(
  "/",
  requirePermission("customers.write"),
  async (request: AuthenticatedRequest, response) => {
    const parsed = customerInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid customer", details: parsed.error.flatten() });
    let phone: string;
    try {
      phone = normalizeKenyanPhone(parsed.data.phone);
    } catch (error) {
      return response
        .status(400)
        .json({
          error: error instanceof Error ? error.message : "Enter a valid Kenyan mobile number",
        });
    }
    const consentSource = parsed.data.consentSource?.trim() || null;
    if (parsed.data.smsConsent && !consentSource)
      return response.status(400).json({ error: "Record where marketing consent was given" });
    const birthday = dateValue(parsed.data.birthday);
    if (parsed.data.birthday && !birthday)
      return response.status(400).json({ error: "Enter a valid birthday" });

    try {
      const customer = await prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: {
            ...shopData(request, {
              name: parsed.data.name?.trim() || null,
              phone,
              email: parsed.data.email || null,
              birthday,
              gender: parsed.data.gender || null,
              smsConsent: parsed.data.smsConsent,
              consentAt: parsed.data.smsConsent ? new Date() : null,
              consentSource: parsed.data.smsConsent ? consentSource : null,
              optedOutAt: null,
              notes: parsed.data.notes || null,
            }),
          },
        });
        await tx.customerPreference.create({
          data: {
            ...preferenceData(parsed.data.preferences),
            customerId: created.id,
            shopId: created.shopId,
          },
        });
        await tx.auditLog.create({
          data: shopData(request, {
            userId: request.authUser!.id,
            action: "customer.created",
            entity: "customer",
            entityId: created.id,
            afterJson: { fields: ["profile", "preferences", "marketing_consent"] },
            ip: request.ip ?? null,
          }),
        });
        return tx.customer.findUniqueOrThrow({
          where: { id: created.id },
          include: { preferences: true },
        });
      });
      return response.status(201).json({ customer });
    } catch (error) {
      if (isUniqueConstraint(error))
        return response.status(409).json({ error: "A customer already uses this phone number" });
      throw error;
    }
  },
);

customersRouter.patch(
  "/:id",
  requirePermission("customers.write"),
  async (request: AuthenticatedRequest, response) => {
    const customerId = request.params.id;
    if (!customerId) return response.status(404).json({ error: "Customer not found" });
    const parsed = customerPatchInput.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid customer", details: parsed.error.flatten() });
    const current = await prisma.customer.findFirst({
      where: shopWhere(request, { id: customerId }),
    });
    if (!current) return response.status(404).json({ error: "Customer not found" });

    let phone: string | undefined;
    if (parsed.data.phone !== undefined) {
      try {
        phone = normalizeKenyanPhone(parsed.data.phone);
      } catch (error) {
        return response
          .status(400)
          .json({
            error: error instanceof Error ? error.message : "Enter a valid Kenyan mobile number",
          });
      }
    }
    const birthday =
      parsed.data.birthday === undefined ? undefined : dateValue(parsed.data.birthday);
    if (parsed.data.birthday && !birthday)
      return response.status(400).json({ error: "Enter a valid birthday" });
    const isNewConsent = parsed.data.smsConsent === true && !current.smsConsent;
    const consentSource = parsed.data.consentSource?.trim() || current.consentSource;
    if (isNewConsent && !consentSource)
      return response.status(400).json({ error: "Record where marketing consent was given" });
    const fields = Object.keys(parsed.data).filter((key) => key !== "preferences");

    try {
      const customer = await prisma.$transaction(async (tx) => {
        const updateData = {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name?.trim() || null } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(parsed.data.email !== undefined ? { email: parsed.data.email || null } : {}),
          ...(parsed.data.birthday !== undefined ? { birthday: birthday ?? null } : {}),
          ...(parsed.data.gender !== undefined ? { gender: parsed.data.gender || null } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
          ...(parsed.data.smsConsent !== undefined
            ? {
                smsConsent: parsed.data.smsConsent,
                consentAt: isNewConsent ? new Date() : current.consentAt,
                consentSource: parsed.data.smsConsent ? consentSource : current.consentSource,
                optedOutAt: parsed.data.smsConsent
                  ? null
                  : current.smsConsent
                    ? new Date()
                    : current.optedOutAt,
              }
            : {}),
        };
        const updated = await tx.customer.update({
          where: { id: current.id },
          data: updateData,
        });
        if (parsed.data.preferences) {
          await tx.customerPreference.upsert({
            where: { customerId: current.id },
            create: {
              ...preferenceData(parsed.data.preferences),
              customerId: current.id,
              shopId: current.shopId,
            },
            update: preferenceData(parsed.data.preferences),
          });
        }
        await tx.auditLog.create({
          data: shopData(request, {
            userId: request.authUser!.id,
            action: "customer.updated",
            entity: "customer",
            entityId: current.id,
            beforeJson: { fields },
            afterJson: {
              fields: [
                ...fields,
                ...(parsed.data.preferences ? ["preferences"] : []),
                ...(parsed.data.smsConsent !== undefined ? ["marketing_consent"] : []),
              ],
            },
            ip: request.ip ?? null,
          }),
        });
        return tx.customer.findUniqueOrThrow({
          where: { id: updated.id },
          include: { preferences: true },
        });
      });
      return response.json({ customer });
    } catch (error) {
      if (isUniqueConstraint(error))
        return response.status(409).json({ error: "A customer already uses this phone number" });
      throw error;
    }
  },
);
