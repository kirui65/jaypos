import { describe, expect, it } from "vitest";
import { calculateProfitability } from "../src/sales/profitability.js";

describe("owner profitability calculations", () => {
  it("subtracts approved refunds and recovers cost for sellable returns", () => {
    expect(
      calculateProfitability({
        grossSalesCents: 10_000,
        taxCents: 0,
        costCents: 6_000,
        approvedRefundCents: 1_000,
        refundedTaxCents: 0,
        restockedCostCents: 600,
      }),
    ).toEqual({ netRevenueCents: 9_000, profitCents: 3_600, marginPct: 40 });
  });

  it("keeps cost expensed for damaged returns and removes recorded tax", () => {
    expect(
      calculateProfitability({
        grossSalesCents: 10_000,
        taxCents: 1_500,
        costCents: 4_000,
        approvedRefundCents: 2_300,
        refundedTaxCents: 300,
        restockedCostCents: 0,
      }),
    ).toEqual({ netRevenueCents: 6_500, profitCents: 2_500, marginPct: 38.5 });
  });

  it("leaves margin blank when net sales are zero or negative", () => {
    expect(
      calculateProfitability({
        grossSalesCents: 0,
        taxCents: 0,
        costCents: 0,
        approvedRefundCents: 100,
        refundedTaxCents: 0,
        restockedCostCents: 0,
      }).marginPct,
    ).toBeNull();
  });
});
