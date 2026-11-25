import { describe, expect, it } from "vitest";
import { renderInvoiceHtml } from "../src/sales/invoice-html.js";

const sampleInput = {
  invoiceNo: "INV-EJ-000042",
  invoiceTerms: "Please contact the shop with questions.",
  receiptFooter: "Thank you for shopping with us.",
  sale: {
    shop: {
      settingsJson: { brand_name: "Test Shop", address: "Nairobi", phone: "+254700000000" },
    },
    receiptNo: "EJ-000042",
    createdAt: new Date("2026-11-24T08:00:00Z"),
    customer: { name: "Amina", phone: "+254711111111", email: null },
    seller: { name: "Test cashier" },
    items: [
      {
        qty: 2,
        unitPriceCents: 550000,
        lineTotalCents: 1100000,
        variant: { sku: "PERF-002", product: { name: "Citrus Bloom" } },
      },
    ],
    payments: [{ method: "mpesa_manual", status: "completed", amountCents: 1100000 }],
    subtotalCents: 1100000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 1100000,
    paidCents: 1100000,
  },
};

describe("sales invoice preview", () => {
  it("renders a print-ready invoice and keeps amounts from the saved sale", () => {
    const html = renderInvoiceHtml(sampleInput);

    expect(html).toContain("INV-EJ-000042");
    expect(html).toContain("Citrus Bloom");
    expect(html).toContain("KES 11,000.00");
    expect(html).toContain("BILLED TO");
    expect(html).toContain("window.print()");
    expect(html).toContain("format=pdf&amp;download=1");
    expect(html).toContain("not an eTIMS tax invoice");
  });

  it("escapes shop, customer, and item text before placing it in HTML", () => {
    const html = renderInvoiceHtml({
      ...sampleInput,
      invoiceTerms: "<script>alert(1)</script>",
      sale: {
        ...sampleInput.sale,
        shop: { ...sampleInput.sale.shop, settingsJson: { brand_name: "<img src=x onerror=alert(1)>" } },
        customer: { ...sampleInput.sale.customer, name: "<b>Customer</b>" },
        items: [
          {
            ...sampleInput.sale.items[0]!,
            variant: {
              ...sampleInput.sale.items[0]!.variant,
              product: { name: "<svg onload=alert(1)>" },
            },
          },
        ],
      },
    });

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;svg onload=alert(1)&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
