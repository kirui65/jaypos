type InvoiceSale = {
  shop: {
    settingsJson: unknown;
  };
  receiptNo: string | null;
  createdAt: Date;
  customer: { name: string | null; phone: string | null; email: string | null } | null;
  seller: { name: string };
  items: {
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
    variant: { sku: string; product: { name: string } };
  }[];
  payments: { method: string; status: string; amountCents: number; bankReference?: string | null }[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
};

type InvoiceHtmlInput = {
  sale: InvoiceSale;
  invoiceNo: string;
  invoiceTerms: string;
  receiptFooter: string;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

const money = (cents: number) =>
  `KES ${(cents / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function shopText(settingsValue: unknown, key: string): string {
  if (!settingsValue || typeof settingsValue !== "object" || Array.isArray(settingsValue)) return "";
  const value = (settingsValue as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function renderInvoiceHtml({
  sale,
  invoiceNo,
  invoiceTerms,
  receiptFooter,
}: InvoiceHtmlInput) {
  const brandName = shopText(sale.shop.settingsJson, "brand_name") || "Shop";
  const time = new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(sale.createdAt);
  const address = [
    shopText(sale.shop.settingsJson, "address"),
    shopText(sale.shop.settingsJson, "phone"),
    shopText(sale.shop.settingsJson, "kra_pin")
      ? `Business PIN: ${shopText(sale.shop.settingsJson, "kra_pin")}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .map(escapeHtml)
    .join("<br>");
  const items = sale.items
    .map(
      (item) => `<tr>
        <td><strong>${escapeHtml(item.variant.product.name)}</strong><small>SKU: ${escapeHtml(item.variant.sku)}</small></td>
        <td class="numeric">${item.qty}</td>
        <td class="numeric">${money(item.unitPriceCents)}</td>
        <td class="numeric strong">${money(item.lineTotalCents)}</td>
      </tr>`,
    )
    .join("");
  const payments = sale.payments
    .map(
      (payment) => `<li>
        <span>${escapeHtml(payment.method.replaceAll("_", " "))} · ${escapeHtml(payment.status.replaceAll("_", " "))}${payment.bankReference ? ` · Ref ${escapeHtml(payment.bankReference)}` : ""}</span>
        <strong>${money(payment.amountCents)}</strong>
      </li>`,
    )
    .join("");
  const customer = sale.customer
    ? [sale.customer.name, sale.customer.phone, sale.customer.email]
        .filter((value): value is string => Boolean(value))
        .map(escapeHtml)
        .join("<br>") || "Customer"
    : "Walk-in customer";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(invoiceNo)} · ${escapeHtml(brandName)}</title>
    <style>
      :root { font-family: Arial, Helvetica, sans-serif; color: #172b46; background: #edf2f8; font-synthesis: none; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 84px 20px 30px; }
      .toolbar { position: fixed; z-index: 2; top: 16px; left: 50%; display: flex; align-items: center; gap: 10px; transform: translateX(-50%); width: min(210mm, calc(100% - 32px)); padding: 10px 14px; border: 1px solid #dbe4ef; border-radius: 12px; background: #fff; box-shadow: 0 8px 24px #172b461a; }
      .toolbar span { margin-right: auto; color: #5d7088; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
      .toolbar button, .toolbar a { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid #245ab8; border-radius: 7px; color: #fff; background: #245ab8; font: 600 13px Arial; text-decoration: none; cursor: pointer; }
      .toolbar a { color: #245ab8; background: #fff; }
      .invoice { width: min(210mm, 100%); min-height: 274mm; margin: 0 auto; padding: 18mm; background: #fff; box-shadow: 0 12px 36px #172b4618; }
      .invoice-head { display: flex; justify-content: space-between; gap: 28px; padding-bottom: 22px; border-bottom: 2px solid #edf1f6; }
      .business { max-width: 58%; }
      .business h1 { margin: 0 0 8px; font-size: 23px; line-height: 1.2; }
      .business p, .meta p { margin: 3px 0; color: #63748a; font-size: 12px; line-height: 1.5; }
      .meta { text-align: right; }
      .meta h2 { margin: 0 0 8px; color: #245ab8; font-size: 25px; letter-spacing: .03em; }
      .meta strong { font-size: 13px; }
      .bill-to { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; padding: 24px 0; }
      .label { display: block; margin-bottom: 7px; color: #718096; font-size: 10px; font-weight: 700; letter-spacing: .12em; }
      .bill-to p { margin: 0; font-size: 13px; line-height: 1.6; }
      .bill-to .seller { text-align: right; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; text-align: left; }
      thead { color: #fff; background: #172b46; }
      th { padding: 11px 10px; font-size: 10px; letter-spacing: .08em; }
      td { padding: 13px 10px; border-bottom: 1px solid #e5ebf2; font-size: 12px; vertical-align: top; }
      td small { display: block; margin-top: 4px; color: #718096; font-size: 10px; }
      .numeric { text-align: right; white-space: nowrap; }
      .strong { font-weight: 700; }
      .summary { display: flex; justify-content: flex-end; margin-top: 22px; }
      .totals { width: min(330px, 100%); }
      .totals div { display: flex; justify-content: space-between; gap: 20px; padding: 7px 0; color: #62738a; font-size: 12px; }
      .totals .grand { margin-top: 5px; padding: 13px 0; border-top: 1px solid #dbe4ef; color: #172b46; font-size: 18px; font-weight: 700; }
      .payment { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5ebf2; }
      .payment h3 { margin: 0 0 10px; font-size: 11px; letter-spacing: .09em; }
      .payment ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
      .payment li { display: flex; justify-content: space-between; gap: 16px; color: #63748a; font-size: 11px; }
      .notes { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5ebf2; color: #63748a; font-size: 11px; line-height: 1.55; }
      .notes p { margin: 6px 0; }
      .legal { margin-top: 16px; color: #8a97a7; font-size: 10px; text-align: center; }
      @media print {
        @page { size: A4; margin: 14mm; }
        :root { background: #fff; }
        .toolbar { display: none; }
        body { padding: 0; background: #fff; }
        .invoice { width: 100%; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
        .table-wrap { overflow: visible; }
        tr { break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <nav class="toolbar">
      <span>INVOICE PREVIEW</span>
      <button type="button" onclick="window.print()">Print invoice</button>
      <a href="?format=pdf&amp;download=1">Download PDF</a>
    </nav>
    <main class="invoice">
      <header class="invoice-head">
        <div class="business"><h1>${escapeHtml(brandName)}</h1><p>${address || "Retail sales"}</p></div>
        <div class="meta"><h2>INVOICE</h2><p><strong>${escapeHtml(invoiceNo)}</strong></p><p>Receipt: ${escapeHtml(sale.receiptNo ?? "—")}</p><p>${escapeHtml(time)} EAT</p></div>
      </header>
      <section class="bill-to">
        <div><span class="label">BILLED TO</span><p>${customer}</p></div>
        <div class="seller"><span class="label">SERVED BY</span><p>${escapeHtml(sale.seller.name)}</p></div>
      </section>
      <div class="table-wrap"><table><thead><tr><th>ITEM</th><th class="numeric">QTY</th><th class="numeric">UNIT PRICE</th><th class="numeric">AMOUNT</th></tr></thead><tbody>${items}</tbody></table></div>
      <section class="summary"><div class="totals">
        <div><span>Subtotal</span><strong>${money(sale.subtotalCents)}</strong></div>
        ${sale.discountCents ? `<div><span>Discount</span><strong>−${money(sale.discountCents)}</strong></div>` : ""}
        <div><span>Recorded tax</span><strong>${money(sale.taxCents)}</strong></div>
        <div class="grand"><span>Total</span><strong>${money(sale.totalCents)}</strong></div>
        <div><span>Paid</span><strong>${money(sale.paidCents)}</strong></div>
        ${sale.totalCents > sale.paidCents ? `<div><span>Balance due</span><strong>${money(sale.totalCents - sale.paidCents)}</strong></div>` : ""}
      </div></section>
      ${payments ? `<section class="payment"><h3>PAYMENT DETAILS</h3><ul>${payments}</ul></section>` : ""}
      <footer class="notes"><p>${escapeHtml(invoiceTerms)}</p><p>${escapeHtml(receiptFooter)}</p><div class="legal">This printable sales invoice is a shop record and is not an eTIMS tax invoice.</div></footer>
    </main>
  </body>
</html>`;
}
