import { describe, expect, it } from "vitest";
import { isRolePin, rolePinLength } from "./constants.js";

describe("role PIN rules", () => {
  it("requires four digits for staff and eight digits for admins", () => {
    expect(rolePinLength("staff")).toBe(4);
    expect(rolePinLength("admin")).toBe(8);
    expect(isRolePin("2468", "staff")).toBe(true);
    expect(isRolePin("12345678", "admin")).toBe(true);
  });

  it("rejects incorrect lengths, non-digits, and unknown roles", () => {
    expect(isRolePin("12345", "staff")).toBe(false);
    expect(isRolePin("1234567", "admin")).toBe(false);
    expect(isRolePin("123a", "staff")).toBe(false);
    expect(isRolePin("12345678", "cashier")).toBe(false);
    expect(rolePinLength("cashier")).toBeNull();
  });
});
