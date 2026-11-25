import { describe, expect, it } from "vitest";
import { publicProduct } from "../src/catalog/routes.js";

const sample = {
  id: "product-1",
  shopId: "shop-a",
  name: "Perfume",
  description: null,
  attributesJson: {},
  imageUrl: null,
  active: true,
  department: { id: "department-1", name: "Men" },
  productType: { id: "type-1", name: "Perfumes" },
  brand: null,
  variants: [
    {
      id: "variant-1",
      sku: "SELL-1",
      barcode: null,
      attributesJson: { sizeMl: 50 },
      imageUrl: null,
      priceCents: 1000,
      costCents: 500,
      reorderLevel: 2,
      batchNo: null,
      expiryDate: null,
      isBulk: false,
      bulkVolumeMl: null,
      parentBulkVariantId: null,
      mlPerUnit: null,
      isTester: false,
      stockLevels: [{ quantity: 4, mlRemaining: null }],
    },
    {
      id: "variant-2",
      sku: "TEST-1",
      barcode: null,
      attributesJson: {},
      imageUrl: null,
      priceCents: 0,
      costCents: 500,
      reorderLevel: 0,
      batchNo: null,
      expiryDate: null,
      isBulk: false,
      bulkVolumeMl: null,
      parentBulkVariantId: null,
      mlPerUnit: null,
      isTester: true,
      stockLevels: [{ quantity: 1, mlRemaining: null }],
    },
  ],
};

describe("catalog serialization", () => {
  it("keeps cost and tester stock out of staff catalog responses", () => {
    const serialized = publicProduct(sample, false);
    expect(serialized.variants).toHaveLength(1);
    expect(serialized).not.toHaveProperty("testerVariants");
    expect(serialized.variants[0]).not.toHaveProperty("costCents");
    expect(JSON.stringify(serialized)).not.toMatch(/costCents|profit/i);
  });

  it("exposes cost and dedicated tester stock only to admins", () => {
    const serialized = publicProduct(sample, true);
    expect(serialized.variants[0]).toHaveProperty("costCents", 500);
    expect(serialized.testerVariants).toHaveLength(1);
  });
});
