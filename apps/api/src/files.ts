import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataUrlPrefix = "data:image/webp;base64,";
const productImageDataUrl = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

export function isProductImageDataUrl(value: string): boolean {
  return productImageDataUrl.test(value);
}

export function decodeProductImageDataUrl(value: string): { contentType: string; bytes: Buffer } {
  const match = productImageDataUrl.exec(value);
  if (!match) throw new Error("Unsupported product image format");
  return { contentType: match[1]!, bytes: Buffer.from(match[2]!, "base64") };
}

export function productImageContentType(key: string): string {
  if (key.endsWith(".jpeg") || key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  return "image/webp";
}

function rootDirectory(root = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads")) {
  return path.resolve(root);
}

function shopFilePath(shopId: string, key: string, root?: string): string {
  const prefix = `shops/${shopId}/product-images/`;
  if (!key.startsWith(prefix)) throw new Error("File does not belong to this shop");
  const base = rootDirectory(root);
  const filePath = path.resolve(base, ...key.split("/"));
  if (!filePath.startsWith(base + path.sep)) throw new Error("Invalid shop file path");
  return filePath;
}

export async function storeProductImage(
  shopId: string,
  imageUrl: string | null | undefined,
  root?: string,
): Promise<string | null | undefined> {
  if (imageUrl === undefined || imageUrl === null || imageUrl === "") return imageUrl;
  if (!isProductImageDataUrl(imageUrl)) return imageUrl;
  const { contentType, bytes } = decodeProductImageDataUrl(imageUrl);
  const extension = contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);
  const key = `shops/${shopId}/product-images/${randomUUID()}.${extension}`;
  const filePath = shopFilePath(shopId, key, root);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes, { flag: "wx" });
  return key;
}

export async function readProductImage(
  shopId: string,
  key: string,
  root?: string,
): Promise<Buffer> {
  return readFile(shopFilePath(shopId, key, root));
}

export function isShopProductImage(shopId: string, value: string): boolean {
  return value.startsWith(`shops/${shopId}/product-images/`);
}

export { dataUrlPrefix };
