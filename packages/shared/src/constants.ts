export const APP_NAME = "Eminent Jay";
export const DEFAULT_TIME_ZONE = "Africa/Nairobi";
export const MAX_DISCOUNT_PERCENT = 20;
export const ROLES = ["admin", "staff"] as const;
export type RoleName = (typeof ROLES)[number];
export const ROLE_PIN_LENGTHS: Record<RoleName, number> = { admin: 8, staff: 4 };

export function rolePinLength(role: string): number | null {
  return role === "admin" || role === "staff" ? ROLE_PIN_LENGTHS[role] : null;
}

export function isRolePin(pin: string, role: string): boolean {
  const length = rolePinLength(role);
  return length !== null && new RegExp(`^[0-9]{${length}}$`).test(pin);
}

export const DEFAULT_PERMISSION_KEYS = [
  "sales.create",
  "sales.read.own",
  "sales.read.all",
  "sales.void",
  "stock.read",
  "stock.write",
  "stock.report",
  "catalog.manage",
  "customers.write",
  "customers.delete",
  "refunds.request",
  "refunds.approve",
  "staff.manage",
  "settings.manage",
  "audit.read",
] as const;

export const DEFAULT_STAFF_PERMISSION_KEYS = [
  "sales.create",
  "sales.read.own",
  "stock.read",
  "stock.report",
  "customers.write",
  "refunds.request",
] as const;
