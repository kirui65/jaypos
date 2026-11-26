export type DiscountCartItem = { variantId: string; quantity: number };

export function normalizedCartItems(items: DiscountCartItem[]): DiscountCartItem[] {
  return items
    .map(({ variantId, quantity }) => ({ variantId, quantity }))
    .sort((left, right) => left.variantId.localeCompare(right.variantId));
}

export function cartItemsMatch(saved: unknown, requested: DiscountCartItem[]): boolean {
  if (!Array.isArray(saved)) return false;
  const normalizedSaved = saved.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.variantId === "string" && typeof row.quantity === "number"
      ? [{ variantId: row.variantId, quantity: row.quantity }]
      : [];
  });
  return (
    JSON.stringify(normalizedCartItems(normalizedSaved)) ===
    JSON.stringify(normalizedCartItems(requested))
  );
}

export function discountExceedsLimit(
  subtotalCents: number,
  discountCents: number,
  limitPct: number,
): boolean {
  return subtotalCents > 0 && discountCents * 100 > subtotalCents * limitPct;
}
