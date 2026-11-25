import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataUrlPrefix = "data:image/webp;base64,";

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
  if (!imageUrl.startsWith(dataUrlPrefix)) return imageUrl;
  const key = `shops/${shopId}/product-images/${randomUUID()}.webp`;
  const filePath = shopFilePath(shopId, key, root);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(imageUrl.slice(dataUrlPrefix.length), "base64"), { flag: "wx" });
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
