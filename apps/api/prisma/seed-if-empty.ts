import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const shop = await prisma.shop.findUnique({ where: { slug: "main" }, select: { id: true } });
  if (shop) {
    process.stdout.write("Shop data already exists; skipping the initial seed.\n");
    return;
  }

  await prisma.$disconnect();
  const result = spawnSync("corepack", ["pnpm", "db:seed"], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Initial database seed exited with status ${result.status}`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
