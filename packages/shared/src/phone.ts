import { z } from "zod";

export const kenyaPhoneSchema = z.string().regex(/^254[17]\d{8}$/, {
  message: "Use a Kenyan mobile number in 2547XXXXXXXX or 2541XXXXXXXX format",
});

export function normalizeKenyanPhone(input: string): string {
  const digits = input.replace(/[\s()+.-]/g, "");
  let normalized: string;

  if (/^0[17]\d{8}$/.test(digits)) normalized = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) normalized = `254${digits}`;
  else if (/^254[17]\d{8}$/.test(digits)) normalized = digits;
  else throw new Error("Enter a valid Kenyan mobile number");

  return kenyaPhoneSchema.parse(normalized);
}
