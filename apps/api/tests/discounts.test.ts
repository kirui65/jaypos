import { describe, expect, it } from "vitest";
import {
  cartItemsMatch,
  discountExceedsLimit,
  discountExceedsMaximum,
  normalizedCartItems,
} from "../src/sales/discounts.js";

describe("discount request cart binding", () => {
  it("normalizes item order so the same cart matches", () => {
    const requested = [
      { variantId: "variant-b", quantity: 2 },
      { variantId: "variant-a", quantity: 1 },
    ];

    expect(normalizedCartItems(requested)).toEqual([
      { variantId: "variant-a", quantity: 1 },
      { variantId: "variant-b", quantity: 2 },
    ]);
    expect(cartItemsMatch(requested, [...requested].reverse())).toBe(true);
  });

  it("rejects a changed cart quantity or product", () => {
    const approved = [{ variantId: "variant-a", quantity: 1 }];

    expect(cartItemsMatch(approved, [{ variantId: "variant-a", quantity: 2 }])).toBe(false);
    expect(cartItemsMatch(approved, [{ variantId: "variant-b", quantity: 1 }])).toBe(false);
    expect(cartItemsMatch(null, approved)).toBe(false);
  });

  it("enforces the percentage limit using integer cents", () => {
    expect(discountExceedsLimit(10_000, 1_000, 10)).toBe(false);
    expect(discountExceedsLimit(10_000, 1_001, 10)).toBe(true);
    expect(discountExceedsLimit(0, 1, 0)).toBe(false);
  });

  it("caps all discounts at twenty percent of the subtotal", () => {
    expect(discountExceedsMaximum(10_000, 2_000)).toBe(false);
    expect(discountExceedsMaximum(10_000, 2_001)).toBe(true);
    expect(discountExceedsMaximum(4, 1)).toBe(true);
  });
});
