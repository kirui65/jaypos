export const APP_NAME = "Eminent Jay";
export const DEFAULT_TIME_ZONE = "Africa/Nairobi";
export const ROLES = ["admin", "staff"] as const;
export type RoleName = (typeof ROLES)[number];

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
