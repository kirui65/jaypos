import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProductImage, storeProductImage } from "../src/files.js";

describe("per-shop product file storage", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("stores uploaded image bytes below the owning shop prefix", async () => {
    root = await mkdtemp(path.join(tmpdir(), "retail-pos-files-"));
    const key = await storeProductImage("shop-a", "data:image/webp;base64,aGVsbG8=", root);

    expect(key).toMatch(/^shops\/shop-a\/product-images\/.+\.webp$/);
    await expect(readProductImage("shop-a", key!, root)).resolves.toEqual(Buffer.from("hello"));
    await expect(readProductImage("shop-b", key!, root)).rejects.toThrow(
      "File does not belong to this shop",
    );
  });
});
