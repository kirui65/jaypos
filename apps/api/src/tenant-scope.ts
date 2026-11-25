import type { AuthenticatedRequest } from "./auth/middleware.js";

export function sessionShopId(request: AuthenticatedRequest): string {
  const shopId = request.authUser?.shopId;
  if (!shopId) throw new Error("An authenticated shop session is required");
  return shopId;
}

export function businessWhere<T extends object>(shopId: string, where: T): T & { shopId: string } {
  return { ...where, shopId } as T & { shopId: string };
}

export function shopWhere<T extends object>(
  request: AuthenticatedRequest,
  where: T,
): T & { shopId: string } {
  return businessWhere(sessionShopId(request), where);
}

export function businessShopRowWhere<T extends object>(
  shopId: string,
  where: T,
): T & { id: string } {
  return { ...where, id: shopId } as T & { id: string };
}

export function shopRowWhere<T extends object>(
  request: AuthenticatedRequest,
  where: T,
): T & { id: string } {
  return businessShopRowWhere(sessionShopId(request), where);
}

export function shopData<T extends object>(request: AuthenticatedRequest, data: T): T & { shopId: string } {
  return { ...data, shopId: sessionShopId(request) } as T & { shopId: string };
}

export function businessData<T extends object>(shopId: string, data: T): T & { shopId: string } {
  return { ...data, shopId } as T & { shopId: string };
}
