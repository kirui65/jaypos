import { describe, expect, it } from "vitest";
import { calculateExpectedCash } from "../src/shifts/routes.js";

describe("shift cash reconciliation", () => {
  it("includes opening float and net cash movements and sales", () => {
    expect(calculateExpectedCash(5000, 12400, 1000, 450)).toBe(17950);
  });
});
