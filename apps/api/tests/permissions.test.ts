import { describe, expect, it } from "vitest";
import {
  canAccess,
  getEffectivePermissions,
  parsePermissionRemovals,
  type AuthUser,
} from "../src/auth/permissions.js";

const staff: AuthUser = {
  id: "staff-1",
  shopId: "shop-1",
  name: "Staff Member",
  username: "staff",
  email: null,
  discountLimitPct: 5,
  role: {
    name: "staff",
    permissions: [
      { permission: { key: "sales.create" } },
      { permission: { key: "customers.write" } },
    ],
  },
  permissionOverridesJson: { "customers.write": false, "stock.write": true },
  mustChangePassword: false,
};

describe("server permission evaluation", () => {
  it("allows role permissions unless a staff override removes them", () => {
    expect(canAccess(staff, "sales.create")).toBe(true);
    expect(canAccess(staff, "customers.write")).toBe(false);
    expect(canAccess(staff, "stock.write")).toBe(false);
  });

  it("accepts only permission-removal overrides", () => {
    expect(parsePermissionRemovals({ "sales.create": false })).toEqual({ "sales.create": false });
    expect(() => parsePermissionRemovals({ "stock.write": true })).toThrow(/only remove/);
    expect(() => parsePermissionRemovals(["sales.create"])).toThrow(/object/);
  });

  it("returns a defensive effective permission set", () => {
    const effective = getEffectivePermissions(staff);
    effective.clear();
    expect(canAccess(staff, "sales.create")).toBe(true);
  });
});
