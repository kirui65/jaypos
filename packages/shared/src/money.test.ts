import { describe, expect, it } from "vitest";
import { addCents, formatKes, percentageOfCents } from "./money.js";

describe("integer KES money helpers", () => {
  it("formats cents without converting money to floats", () => {
    expect(formatKes(125_050)).toBe("KES 1,250.50");
    expect(formatKes(5)).toBe("KES 0.05");
  });

  it("adds cents and calculates a rounded percentage in basis points", () => {
    expect(addCents(100, 250)).toBe(350);
    expect(percentageOfCents(1_001, 1_250)).toBe(125);
  });

  it("rejects unsafe integers", () => {
    expect(() => addCents(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => formatKes(1.5)).toThrow(RangeError);
  });
});
