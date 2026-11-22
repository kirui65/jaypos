import { z } from "zod";

export const amountCentsSchema = z.number().int().nonnegative();

export function formatKes(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents)) {
    throw new RangeError("KES amount must be a safe integer number of cents");
  }
  const shillings = Math.trunc(amountCents / 100);
  const cents = amountCents % 100;
  const grouped = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(shillings);
  return `KES ${grouped}.${String(cents).padStart(2, "0")}`;
}

export function addCents(...amounts: number[]): number {
  const total = amounts.reduce((sum, amount) => {
    if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer");
    return sum + amount;
  }, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError("KES total exceeds safe integer range");
  return total;
}

export function percentageOfCents(amountCents: number, percentageBasisPoints: number): number {
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(percentageBasisPoints)) {
    throw new RangeError("Amount and basis points must be safe integers");
  }
  if (amountCents < 0 || percentageBasisPoints < 0) {
    throw new RangeError("Amount and basis points cannot be negative");
  }
  return Math.round((amountCents * percentageBasisPoints) / 10_000);
}
