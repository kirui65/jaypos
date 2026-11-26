import { expect, test, type Page } from "@playwright/test";

const ids = {
  department: "11111111-1111-4111-8111-111111111111",
  productType: "22222222-2222-4222-8222-222222222222",
  brand: "33333333-3333-4333-8333-333333333333",
  product: "44444444-4444-4444-8444-444444444444",
  variantOne: "55555555-5555-4555-8555-555555555555",
  variantTwo: "66666666-6666-4666-8666-666666666666",
  newProduct: "77777777-7777-4777-8777-777777777777",
  newVariant: "88888888-8888-4888-8888-888888888888",
};

const user = {
  id: "99999999-9999-4999-8999-999999999999",
  name: "Cashier",
  username: "cashier",
  role: "staff",
  permissions: ["sales.create", "sales.read.own", "stock.read"],
  mustChangePassword: false,
  hasPin: true,
  active: true,
  discountLimitPct: 0,
};
const adminUser = {
  ...user,
  name: "Owner",
  username: "owner",
  role: "admin",
  permissions: [...user.permissions, "catalog.manage"],
  discountLimitPct: 100,
};

function catalogWithProduct(
  variants = [
    {
      id: ids.variantOne,
      sku: "JASMINE-50",
      barcode: null,
      attributes: { size_ml: 50 },
      priceCents: 10_000,
      costCents: 5_000,
      stock: 5,
      mlRemaining: null,
      isBulk: false,
      bulkVolumeMl: null,
      parentBulkVariantId: null,
      mlPerUnit: null,
    },
  ],
) {
  return {
    departments: [{ id: ids.department, name: "Fragrance", code: "fragrance" }],
    productTypes: [
      { id: ids.productType, name: "Perfume", code: "perfume", attributeTemplateJson: {} },
    ],
    brands: [{ id: ids.brand, name: "Existing Brand" }],
    products: [
      {
        id: ids.product,
        name: "Jasmine Mist",
        active: true,
        imageUrl: null,
        department: { id: ids.department, name: "Fragrance", code: "fragrance" },
        productType: { id: ids.productType, name: "Perfume", code: "perfume" },
        brand: { name: "Existing Brand" },
        variants,
      },
    ],
    bundles: [],
    taxSettings: { enabled: false, rateBps: 0, inclusive: false },
  };
}

async function mockApi(
  page: Page,
  catalog: ReturnType<typeof catalogWithProduct>,
  authUser = user,
) {
  let createdBrand = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "" };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/brand") return json({ brandName: "Eminent Jay", logoUrl: null });
    if (path === "/auth/me") return json({ user: authUser });
    if (path === "/shifts/current") return json({ shift: { id: "shift-1" } });
    if (path === "/catalog" && method === "GET") return json(catalog);
    if (path === "/sales/held-carts") return json({ carts: [] });
    if (path === "/catalog/brands" && method === "POST") {
      createdBrand = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...request.postDataJSON() };
      catalog.brands.push(createdBrand);
      return json(createdBrand, 201);
    }
    if (path === "/catalog/products" && method === "POST") {
      const input = request.postDataJSON();
      const product = {
        id: ids.newProduct,
        name: input.name,
        active: true,
        imageUrl: input.imageUrl,
        department: catalog.departments[0],
        productType: catalog.productTypes[0],
        brand: createdBrand.name ? { name: createdBrand.name } : null,
        variants: input.variants.map((variant: Record<string, unknown>) => ({
          id: ids.newVariant,
          ...variant,
          barcode: null,
          stock: 0,
          mlRemaining: null,
          isBulk: false,
          bulkVolumeMl: null,
          parentBulkVariantId: null,
          mlPerUnit: null,
        })),
      };
      catalog.products.push(product);
      return json({ id: product.id, name: product.name }, 201);
    }
    if (path === `/catalog/products/${ids.product}` && method === "PATCH") {
      return json({ id: ids.product, name: request.postDataJSON().name, active: true });
    }
    if (path.startsWith("/catalog/variants/") && method === "PATCH") {
      return json({ id: path.split("/").at(-1), sku: request.postDataJSON().sku });
    }
    if (path === "/sales/discount-requests" && method === "POST")
      return json(
        { request: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "requested" } },
        201,
      );
    if (
      path.endsWith("/approve") &&
      path.startsWith("/sales/discount-requests/") &&
      method === "POST"
    )
      return json({
        request: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          status: "approved",
          approvedBy: "Owner",
        },
      });
    if (path === "/sales" && method === "POST") {
      return json({
        sale: {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          receiptNo: "EJ-000001",
          status: "completed",
          subtotalCents: 10_000,
          discountCents: 1_000,
          taxCents: 0,
          totalCents: 9_000,
          paidCents: 9_000,
          changeCents: 1_000,
          notes: null,
          createdAt: new Date().toISOString(),
          seller: { id: user.id, name: user.name },
          items: [],
          payments: [{ id: "payment-1", method: "cash", amountCents: 9_000, status: "paid" }],
        },
      });
    }
    return json({});
  });
}

test("checkout requests and uses an administrator-approved cart discount", async ({ page }) => {
  await mockApi(page, catalogWithProduct());
  let requestBody: Record<string, unknown> | null = null;
  let saleBody: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/sales/discount-requests"))
      requestBody = request.postDataJSON();
    if (request.url().endsWith("/api/sales")) saleBody = request.postDataJSON();
  });

  await page.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:4173"}/`);
  await expect(page.getByText("Opening your shop")).toBeHidden();
  await expect(page).toHaveURL(/\/shift$/);
  await page.getByRole("link", { name: "Point of sale", exact: true }).dispatchEvent("click");
  await page
    .getByTestId("product-card")
    .getByRole("button", { name: "Add Jasmine Mist" })
    .first()
    .click();
  await page.getByRole("button", { name: /Pay ·/ }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const discountSlider = page.getByRole("slider", { name: "Cart discount (KES)" });
  await discountSlider.evaluate((element) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, "10");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(discountSlider).toHaveValue("10");
  await page.getByLabel("Discount reason").fill("Customer promotion");
  await page.getByRole("button", { name: "Request manager approval" }).click();
  await expect(page.getByLabel("Administrator username")).toBeVisible();
  await page.getByLabel("Administrator username").fill("owner");
  await page.getByLabel("Administrator PIN").fill("87654321");
  await page.getByRole("button", { name: "Approve discount" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approved by Owner" })).toBeVisible();
  await page.getByRole("button", { name: "Complete cash sale" }).click();
  await expect(page.getByText(/Sale EJ-000001 completed/)).toBeVisible();

  expect(requestBody).toMatchObject({ discountCents: 1_000, reason: "Customer promotion" });
  expect(saleBody).toMatchObject({
    cartDiscountCents: 1_000,
    discountReason: "Customer promotion",
    discountApprovalRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
});

test("catalog supports manual brands and compressed photo uploads", async ({ page }) => {
  await mockApi(page, catalogWithProduct(), adminUser);
  let productBody: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/catalog/products") && request.method() === "POST")
      productBody = request.postDataJSON();
  });

  await page.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:4173"}/admin/catalog`);
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  expect(await page.getByLabel("Brand name").evaluate((field) => field.tagName)).toBe("INPUT");
  await page.getByLabel("Product name").fill("Citrus Bloom");
  await page.getByLabel("SKU").fill("CITRUS-50");
  await page.getByLabel("Department").selectOption(ids.department);
  await page.getByLabel("Product type").selectOption(ids.productType);
  await page.getByLabel("Brand name").fill("New Handwritten Brand");
  await page.getByLabel("Selling price (KES)").fill("125");
  await page.getByLabel("Cost price (KES)").fill("65");
  const pngBytes = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#b88b20";
    context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[aria-label="Upload product photo"]').setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngBytes!, "base64"),
  });
  await expect(page.getByText("Photo preview")).toBeVisible();
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product and opening stock created.")).toBeVisible();

  expect(productBody?.brandId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  expect(productBody?.imageUrl).toMatch(/^data:image\/(?:webp|png|jpeg);base64,/);
});

test("catalog edit can select and update a product variant", async ({ page }) => {
  const variants = [
    ...catalogWithProduct().products[0].variants,
    {
      id: ids.variantTwo,
      sku: "JASMINE-100",
      barcode: null,
      attributes: { size_ml: 100 },
      priceCents: 15_000,
      costCents: 7_500,
      stock: 3,
      mlRemaining: null,
      isBulk: false,
      bulkVolumeMl: null,
      parentBulkVariantId: null,
      mlPerUnit: null,
    },
  ];
  await mockApi(page, catalogWithProduct(variants), adminUser);
  let variantBody: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (request.url().endsWith(`/api/catalog/variants/${ids.variantTwo}`))
      variantBody = request.postDataJSON();
  });

  await page.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:4173"}/admin/catalog`);
  await page.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit product" });
  await dialog.getByLabel("Variant to edit").selectOption(ids.variantTwo);
  await expect(dialog.getByLabel("SKU")).toHaveValue("JASMINE-100");
  await dialog.getByLabel("SKU").fill("JASMINE-100-NEW");
  await dialog.getByLabel("Selling price (KES)").fill("165");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Product details updated.")).toBeVisible();
  expect(variantBody).toMatchObject({
    sku: "JASMINE-100-NEW",
    priceCents: 16_500,
    costCents: 7_500,
  });
});
