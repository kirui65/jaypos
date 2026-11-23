import type { Prisma, StockMovementType } from "@prisma/client";

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

export async function deductSaleStock(
  tx: Prisma.TransactionClient,
  saleId: string,
  shopId: string,
  sellerId: string,
  allowNegativeOverride = false,
): Promise<{ needsReview: boolean }> {
  const saleItems = await tx.saleItem.findMany({
    where: { saleId, shopId },
    include: {
      variant: {
        include: {
          parentBulkVariant: true,
          bundleComponents: { include: { component: true } },
        },
      },
    },
  });
  const bundleComponents = saleItems.flatMap((item) =>
    item.variant.bundleComponents.map(({ component, quantity }) => ({
      bundleVariantId: item.variantId,
      componentVariantId: component.id,
      quantity,
      bulkVolumeMl: component.isBulk ? component.bulkVolumeMl : null,
    })),
  );
  const demands = planStockDemands(
    saleItems.map(({ variant, variantId, qty }) => ({
      variantId,
      ...(variant.parentBulkVariantId ? { stockVariantId: variant.parentBulkVariantId } : {}),
      quantity: qty,
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
  const shop = await tx.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { settingsJson: true },
  });
  const settings = (shop.settingsJson ?? {}) as Record<string, unknown>;
  const allowNegativeStock = settings.allow_negative_stock === true || allowNegativeOverride;
  let needsReview = false;
  for (const demand of demands) {
    const variant = await tx.productVariant.findFirst({
      where: { id: demand.variantId, shopId },
    });
    if (!variant) throw new Error("Stock component not found in this shop");
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
      if (
        allowNegativeOverride &&
        ((demand.quantity > 0 && (stockLevel?.quantity ?? 0) < demand.quantity) ||
          (demand.ml > 0 && (stockLevel?.mlRemaining ?? 0) < demand.ml))
      )
        needsReview = true;
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
        userId: sellerId,
      },
    });
  }
  return { needsReview };
}
