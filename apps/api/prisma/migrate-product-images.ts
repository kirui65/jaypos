import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { dataUrlPrefix, storeProductImage } from "../src/files.js";

const prisma = new PrismaClient();

async function migrate() {
  const products = await prisma.product.findMany({
    where: { imageUrl: { startsWith: dataUrlPrefix } },
    select: { id: true, shopId: true, imageUrl: true },
  });
  const variants = await prisma.productVariant.findMany({
    where: { imageUrl: { startsWith: dataUrlPrefix } },
    select: { id: true, shopId: true, imageUrl: true },
  });
  for (const product of products) {
    const imageUrl = await storeProductImage(product.shopId, product.imageUrl);
    await prisma.product.update({
      where: { id: product.id, shopId: product.shopId },
      data: { imageUrl: imageUrl ?? null },
    });
  }
  for (const variant of variants) {
    const imageUrl = await storeProductImage(variant.shopId, variant.imageUrl);
    await prisma.productVariant.update({
      where: { id: variant.id, shopId: variant.shopId },
      data: { imageUrl: imageUrl ?? null },
    });
  }
  process.stdout.write(`Moved ${products.length + variants.length} product image(s) to shop-prefixed storage.\n`);
}

migrate()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
