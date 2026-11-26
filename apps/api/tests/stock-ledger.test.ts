import { describe, expect, it } from "vitest";
import { calculateStockChange } from "../src/stock/routes.js";

const line = {
  variantId: "variant-1",
  type: "purchase" as const,
  quantityDelta: 5,
  reason: "Supplier receipt",
  costPerUnitCents: 700,
};

describe("stock ledger calculations", () => {
  it("calculates receipt quantity and weighted average cost with integer rounding", () => {
    expect(calculateStockChange({ quantity: 5, mlRemaining: null, costCents: 500 }, line)).toEqual({
      quantityDelta: 5,
      mlDelta: 0,
      quantity: 10,
      mlRemaining: null,
      costCents: 600,
    });
  });

  it("uses counted quantity as the adjustment delta", () => {
    expect(
      calculateStockChange(
        { quantity: 8, mlRemaining: null, costCents: 500 },
        { ...line, type: "adjustment", quantityDelta: 0 },
        6,
      ),
    ).toMatchObject({ quantityDelta: -2, quantity: 6 });
  });

  it("restores an out-of-stock variant through a positive adjustment", () => {
    expect(
      calculateStockChange(
        { quantity: 0, mlRemaining: null, costCents: 500 },
        { ...line, type: "adjustment", quantityDelta: 4 },
      ),
    ).toMatchObject({ quantityDelta: 4, quantity: 4, mlRemaining: null });
  });

  it("restores bulk bottle quantity and remaining volume together", () => {
    expect(
      calculateStockChange(
        { quantity: 0, mlRemaining: 0, costCents: 5000 },
        { ...line, type: "adjustment", quantityDelta: 1, mlDelta: 100 },
      ),
    ).toMatchObject({ quantityDelta: 1, mlDelta: 100, quantity: 1, mlRemaining: 100 });
  });

  it("rejects a stock operation that would make quantity negative", () => {
    expect(() =>
      calculateStockChange(
        { quantity: 2, mlRemaining: null, costCents: 500 },
        { ...line, type: "damage", quantityDelta: -3 },
      ),
    ).toThrow(/below zero/);
  });

  it("tracks millilitres independently for bulk perfume stock", () => {
    expect(
      calculateStockChange(
        { quantity: 1, mlRemaining: 90, costCents: 5000 },
        { ...line, type: "adjustment", quantityDelta: 0, mlDelta: -10 },
      ),
    ).toMatchObject({ quantity: 1, mlRemaining: 80, mlDelta: -10 });
  });
});
