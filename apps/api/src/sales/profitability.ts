export function calculateProfitability(input: {
  grossSalesCents: number;
  taxCents: number;
  costCents: number;
  approvedRefundCents: number;
  refundedTaxCents: number;
  restockedCostCents: number;
}) {
  const netRevenueCents =
    input.grossSalesCents - input.taxCents - input.approvedRefundCents + input.refundedTaxCents;
  const profitCents = netRevenueCents - input.costCents + input.restockedCostCents;
  return {
    netRevenueCents,
    profitCents,
    marginPct:
      netRevenueCents > 0 ? Number(((profitCents / netRevenueCents) * 100).toFixed(1)) : null,
  };
}
