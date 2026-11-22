import { describe, expect, it } from "vitest";
import { normalizeKenyanPhone } from "./phone.js";

describe("Kenyan phone normalization", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["+254 712 345678", "254712345678"],
    ["112345678", "254112345678"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it("rejects unsupported or malformed numbers", () => {
    expect(() => normalizeKenyanPhone("0201234567")).toThrow();
  });
});
