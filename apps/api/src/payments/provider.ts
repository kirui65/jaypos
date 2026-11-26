import { randomUUID } from "node:crypto";

export type ProviderStatus = "pending" | "paid" | "failed";
export type CancelledAttemptStatus = "cancelled" | "unmatched";

export function resolveCancelledAttemptStatus(status: ProviderStatus): CancelledAttemptStatus {
  return status === "paid" ? "unmatched" : "cancelled";
}

export type PaymentSnapshot = {
  status: ProviderStatus;
  amountCents: number | null;
  phone: string | null;
  receipt: string | null;
  transactionId: string | null;
  raw: unknown;
};
export type StkRequest = {
  phone: string;
  amountCents: number;
  reference: string;
  callbackUrl: string;
};
export type StkResponse = {
  providerRequestId: string;
  merchantRequestId: string | null;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: "mock" | "lipwa";
  initiateStk(input: StkRequest): Promise<StkResponse>;
  queryStatus(providerRequestId: string): Promise<PaymentSnapshot>;
}

type FetchLike = typeof fetch;

function amountToCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Math.abs(amount * 100 - cents) < 0.00001 ? cents : null;
}

function statusFromLipwa(value: unknown): ProviderStatus {
  if (value === "payment.success") return "paid";
  if (value === "payment.failed") return "failed";
  if (value === "payment.queued" || value === "pending") return "pending";
  throw new Error("Lipwa returned an unrecognized payment status");
}

export class LipwaProvider implements PaymentProvider {
  readonly name = "lipwa" as const;
  private readonly apiKey: string;
  private readonly channelId: string;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(options?: {
    apiKey?: string;
    channelId?: string;
    baseUrl?: string;
    fetcher?: FetchLike;
  }) {
    this.apiKey = options?.apiKey ?? process.env.LIPWA_API_KEY ?? "";
    this.channelId = options?.channelId ?? process.env.LIPWA_CHANNEL_ID ?? "";
    this.baseUrl = (
      options?.baseUrl ??
      process.env.LIPWA_BASE_URL ??
      "https://pay.lipwa.app"
    ).replace(/\/$/, "");
    this.fetcher = options?.fetcher ?? fetch;
  }

  async initiateStk(input: StkRequest): Promise<StkResponse> {
    if (!this.apiKey || !this.channelId)
      throw new Error("Lipwa API key and channel ID must be configured");
    const response = await this.fetcher(this.baseUrl + "/api/payments", {
      method: "POST",
      headers: { Authorization: "Bearer " + this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: input.amountCents / 100,
        phone_number: input.phone,
        channel_id: this.channelId,
        callback_url: input.callbackUrl,
        api_ref: input.reference,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok || !raw || typeof raw !== "object")
      throw new Error("Lipwa could not start the STK payment");
    const body = raw as Record<string, unknown>;
    if (typeof body.CheckoutRequestID !== "string" || body.ResponseCode !== "0")
      throw new Error("Lipwa rejected the STK payment request");
    return {
      providerRequestId: body.CheckoutRequestID,
      merchantRequestId: typeof body.MerchantRequestID === "string" ? body.MerchantRequestID : null,
      raw,
    };
  }

  async queryStatus(providerRequestId: string): Promise<PaymentSnapshot> {
    if (!this.apiKey) throw new Error("Lipwa API key must be configured");
    const url = this.baseUrl + "/api/status?ref=" + encodeURIComponent(providerRequestId);
    const response = await this.fetcher(url, {
      headers: { Authorization: "Bearer " + this.apiKey },
      signal: AbortSignal.timeout(15000),
    });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok || !raw || typeof raw !== "object")
      throw new Error("Lipwa payment status could not be checked");
    const body = raw as Record<string, unknown>;
    return {
      status: statusFromLipwa(body.status),
      amountCents: amountToCents(body.amount),
      phone:
        typeof body.phone_number === "string"
          ? body.phone_number
          : typeof body.phone === "string"
            ? String(body.phone)
            : null,
      receipt:
        typeof body.receipt === "string"
          ? body.receipt
          : typeof body.mpesa_code === "string"
            ? body.mpesa_code
            : null,
      transactionId: typeof body.transaction_id === "string" ? body.transaction_id : null,
      raw,
    };
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  private readonly statuses = new Map<string, PaymentSnapshot>();

  async initiateStk(input: StkRequest): Promise<StkResponse> {
    const providerRequestId = "MOCK-" + randomUUID();
    this.statuses.set(providerRequestId, {
      status: "pending",
      amountCents: input.amountCents,
      phone: input.phone,
      receipt: null,
      transactionId: null,
      raw: { accepted: true },
    });
    return { providerRequestId, merchantRequestId: null, raw: { accepted: true } };
  }

  async queryStatus(providerRequestId: string): Promise<PaymentSnapshot> {
    return (
      this.statuses.get(providerRequestId) ?? {
        status: "pending",
        amountCents: null,
        phone: null,
        receipt: null,
        transactionId: null,
        raw: { status: "pending" },
      }
    );
  }

  setStatus(providerRequestId: string, snapshot: PaymentSnapshot) {
    this.statuses.set(providerRequestId, snapshot);
  }
}

const mockProvider = new MockPaymentProvider();
export function getPaymentProvider(name = process.env.PAYMENT_PROVIDER ?? "mock"): PaymentProvider {
  if (name === "mock") return mockProvider;
  if (name === "lipwa") return new LipwaProvider();
  throw new Error("PAYMENT_PROVIDER must be mock or lipwa");
}
