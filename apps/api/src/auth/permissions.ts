export type AuthUser = {
  id: string;
  shopId: string;
  name: string;
  username: string;
  email: string | null;
  discountLimitPct: number;
  role: { name: "admin" | "staff"; permissions: { permission: { key: string } }[] };
  permissionOverridesJson: unknown;
};

export function getEffectivePermissions(user: AuthUser): Set<string> {
  const permissions = new Set(user.role.permissions.map(({ permission }) => permission.key));
  if (
    user.role.name === "staff" &&
    user.permissionOverridesJson &&
    typeof user.permissionOverridesJson === "object"
  ) {
    for (const [key, allowed] of Object.entries(user.permissionOverridesJson)) {
      if (allowed === false) permissions.delete(key);
    }
  }
  return permissions;
}

export function canAccess(user: AuthUser, permission: string): boolean {
  return getEffectivePermissions(user).has(permission);
}

export function parsePermissionRemovals(value: unknown): Record<string, false> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Permission overrides must be an object");
  const entries = Object.entries(value);
  if (entries.some(([, allowed]) => allowed !== false)) {
    throw new Error("Staff permission overrides may only remove permissions");
  }
  return Object.fromEntries(entries) as Record<string, false>;
}
