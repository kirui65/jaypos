import { describe, expect, it } from "vitest";
import type { AuthenticatedRequest } from "../src/auth/middleware.js";
import { sessionShopId, shopData, shopRowWhere, shopWhere } from "../src/tenant-scope.js";

function requestFor(shopId: string): AuthenticatedRequest {
  return { authUser: { shopId } } as AuthenticatedRequest;
}

describe("session shop scope", () => {
  it("always takes query scope from the authenticated session", () => {
    expect(shopWhere(requestFor("shop-a"), { id: "row-a", shopId: "shop-b" })).toEqual({
      id: "row-a",
      shopId: "shop-a",
    });
  });

  it("uses the session shop for the shop root and inserted rows", () => {
    expect(shopRowWhere(requestFor("shop-a"), {})).toEqual({ id: "shop-a" });
    expect(shopData(requestFor("shop-a"), { name: "row", shopId: "shop-b" })).toEqual({
      name: "row",
      shopId: "shop-a",
    });
  });

  it("rejects missing tenant context", () => {
    expect(() => sessionShopId({} as AuthenticatedRequest)).toThrow(
      "An authenticated shop session is required",
    );
  });
});
