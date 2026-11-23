import { describe, expect, it, vi } from "vitest";
import { LipwaProvider, MockPaymentProvider } from "../src/payments/provider.js";

describe("Lipwa payment adapter", () => {
  it("sends the documented STK request and converts KES to cents", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          CheckoutRequestID: "checkout-1",
          MerchantRequestID: "merchant-1",
          ResponseCode: "0",
        }),
        { status: 200 },
      ),
    );
    const provider = new LipwaProvider({
      apiKey: "test-key",
      channelId: "channel",
      baseUrl: "https://lipwa.test",
      fetcher,
    });
    const result = await provider.initiateStk({
      phone: "254712345678",
      amountCents: 12500,
      reference: "EJ-123",
      callbackUrl: "https://shop.test/callback",
    });
    expect(result.providerRequestId).toBe("checkout-1");
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://lipwa.test/api/payments");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(options?.body))).toEqual({
      amount: 125,
      phone_number: "254712345678",
      channel_id: "channel",
      callback_url: "https://shop.test/callback",
      api_ref: "EJ-123",
    });
  });

  it("authenticates status lookups and normalizes a successful result", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "payment.success",
          amount: "125",
          receipt: "QWE123",
          phone_number: "254712345678",
        }),
        { status: 200 },
      ),
    );
    const provider = new LipwaProvider({
      apiKey: "test-key",
      channelId: "channel",
      baseUrl: "https://lipwa.test",
      fetcher,
    });
    await expect(provider.queryStatus("checkout id")).resolves.toMatchObject({
      status: "paid",
      amountCents: 12500,
      receipt: "QWE123",
    });
    expect(fetcher.mock.calls[0]![0]).toBe("https://lipwa.test/api/status?ref=checkout%20id");
  });

  it("supports deterministic mock STK initiation", async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.initiateStk({
      phone: "254712345678",
      amountCents: 1000,
      reference: "EJ-1",
      callbackUrl: "",
    });
    await expect(provider.queryStatus(result.providerRequestId)).resolves.toMatchObject({
      status: "pending",
      amountCents: 1000,
    });
  });
});
