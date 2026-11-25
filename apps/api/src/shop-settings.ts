import { prisma } from "./db.js";

export type ShopSettings = Record<string, unknown>;

export function readShopSettings(value: unknown): ShopSettings {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ShopSettings)
    : {};
}

export function shopSettingText(settingsValue: unknown, key: string): string {
  const value = readShopSettings(settingsValue)[key];
  return typeof value === "string" ? value : "";
}

export async function configuredShopId(): Promise<string | null> {
  const slug = process.env.PUBLIC_SHOP_SLUG;
  if (!slug) return null;
  const shop = await prisma.shop.findUnique({ where: { slug }, select: { id: true } });
  return shop?.id ?? null;
}
