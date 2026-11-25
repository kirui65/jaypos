import { describe, expect, it } from "vitest";
import { allocateSalePayments, calculateSaleTotals, calculateTaxCents } from "../src/sales/math.js";
import { planStockDemands } from "../src/sales/inventory.js";
import { serializeSale } from "../src/sales/routes.js";

describe("sale calculations", () => {
  it("calculates tax from enabled shop settings and keeps it off by default", () => {
    expect(calculateTaxCents(10_000, false, 1600, false)).toBe(0);
    expect(calculateTaxCents(10_000, true, 1600, false)).toBe(1600);
    expect(calculateTaxCents(10_000, true, 1600, true)).toBe(1379);
  });

  it("calculates server-owned prices and discounts in integer cents", () => {
    expect(
      calculateSaleTotals(
        [
          { unitPriceCents: 1000, quantity: 2, discountCents: 100 },
          { unitPriceCents: 500, quantity: 1, discountCents: 0 },
        ],
        200,
      ),
    ).toEqual({
      subtotalCents: 2500,
      lineDiscountCents: 100,
      discountCents: 300,
      totalCents: 2200,
    });
  });

  it("rejects discounts above the subtotal", () => {
    expect(() =>
      calculateSaleTotals([{ unitPriceCents: 100, quantity: 1, discountCents: 101 }], 0),
    ).toThrow(/exceed/);
  });

  it("allocates split cash and manual M-Pesa and calculates change", () => {
    expect(
      allocateSalePayments(
        [
          { method: "cash", amountCents: 5000 },
          { method: "mpesa_manual", amountCents: 2000, mpesaReceipt: "ABC123" },
        ],
        6500,
      ),
    ).toMatchObject({
      paidCents: 6500,
      changeCents: 500,
      applied: [{ appliedCents: 4500 }, { appliedCents: 2000 }],
    });
  });

  it("rejects underpayment and change that cannot come from cash", () => {
    expect(() => allocateSalePayments([{ method: "card", amountCents: 900 }], 1000)).toThrow(
      /cover/,
    );
    expect(() => allocateSalePayments([{ method: "card", amountCents: 1100 }], 1000)).toThrow(
      /cash tendered/,
    );
  });

  it("plans component deductions, bottle volume, and decant millilitres", () => {
    expect(
      planStockDemands(
        [
          {
            variantId: "decant",
            stockVariantId: "bulk",
            quantity: 2,
            mlPerUnit: 10,
            kind: "decant",
          },
          { variantId: "bundle", quantity: 1, kind: "regular" },
        ],
        [
          { bundleVariantId: "bundle", componentVariantId: "shirt", quantity: 2 },
          {
            bundleVariantId: "bundle",
            componentVariantId: "bottle",
            quantity: 1,
            bulkVolumeMl: 50,
          },
        ],
      ),
    ).toEqual([
      { variantId: "bulk", quantity: 0, ml: 20, movementType: "decant" },
      { variantId: "shirt", quantity: 2, ml: 0, movementType: "sale" },
      { variantId: "bottle", quantity: 1, ml: 50, movementType: "sale" },
    ]);
  });

  it("keeps cost and profit out of staff sale responses", () => {
    const sale = {
      id: "sale-1",
      clientUuid: "client-1",
      receiptNo: "EJ-000001",
      status: "completed",
      subtotalCents: 1000,
      discountCents: 0,
      taxCents: 0,
      totalCents: 1000,
      paidCents: 1000,
      changeCents: 0,
      notes: null,
      createdAt: new Date(0),
      seller: { id: "staff-1", name: "Staff" },
      payments: [],
      items: [
        {
          id: "item-1",
          qty: 1,
          unitCostCents: 400,
          variant: { id: "variant-1", sku: "SKU-1", product: { id: "product-1", name: "Item" } },
        },
      ],
    } as unknown as Parameters<typeof serializeSale>[0];
    const staffResponse = serializeSale(sale, false);
    expect(JSON.stringify(staffResponse)).not.toMatch(/costCents|profitCents/i);
    expect(serializeSale(sale, true)).toMatchObject({ costCents: 400, profitCents: 600 });
  });
});
