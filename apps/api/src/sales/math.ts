export type PricedLine = { unitPriceCents: number; quantity: number; discountCents: number };
export type SalePayment =
  | { method: "cash"; amountCents: number }
  | { method: "bank"; amountCents: number; bankReference?: string | undefined }
  | { method: "mpesa_stk"; amountCents: number; phone: string }
  | { method: "mpesa_manual"; amountCents: number; mpesaReceipt: string }
  | { method: "card"; amountCents: number };

export function calculateSaleTotals(lines: PricedLine[], cartDiscountCents: number) {
  const subtotalCents = lines.reduce(
    (total, line) => total + line.unitPriceCents * line.quantity,
    0,
  );
  const lineDiscountCents = lines.reduce((total, line) => total + line.discountCents, 0);
  const discountCents = lineDiscountCents + cartDiscountCents;
  if (discountCents > subtotalCents) throw new Error("Discount cannot exceed the subtotal");
  return {
    subtotalCents,
    lineDiscountCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

export function calculateTaxCents(
  taxableCents: number,
  enabled: boolean,
  rateBps: number,
  inclusive: boolean,
): number {
  if (!enabled || taxableCents <= 0 || !Number.isInteger(rateBps) || rateBps <= 0) return 0;
  const safeRateBps = Math.min(10000, rateBps);
  return Math.round((taxableCents * safeRateBps) / (inclusive ? 10000 + safeRateBps : 10000));
}

export function allocateSalePayments(payments: SalePayment[], totalCents: number) {
  const cashPayments = payments.filter((payment) => payment.method === "cash");
  if (cashPayments.length > 1) throw new Error("Use one cash payment per sale");
  const cashTenderedCents = cashPayments[0]?.amountCents ?? 0;
  const nonCashCents = payments.reduce(
    (sum, payment) => sum + (payment.method === "cash" ? 0 : payment.amountCents),
    0,
  );
  const tenderedCents = cashTenderedCents + nonCashCents;
  if (tenderedCents < totalCents) throw new Error("Payments do not cover the sale total");
  const changeCents = tenderedCents - totalCents;
  if (changeCents > cashTenderedCents)
    throw new Error("Change can only be given from cash tendered");
  if (changeCents > 0 && cashPayments.length === 0)
    throw new Error("Non-cash payments cannot exceed the sale total");
  return {
    paidCents: totalCents,
    changeCents,
    applied: payments.map((payment) => ({
      ...payment,
      appliedCents:
        payment.method === "cash" ? cashTenderedCents - changeCents : payment.amountCents,
    })),
  };
}
