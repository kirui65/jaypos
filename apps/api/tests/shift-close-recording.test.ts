import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTransaction } = vi.hoisted(() => {
  const transaction = {
    shift: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), updateMany: vi.fn() },
    payment: { aggregate: vi.fn() },
    cashMovement: { groupBy: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    mockTransaction: transaction,
    mockPrisma: {
      authSession: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../src/db.js", () => ({ prisma: mockPrisma }));

import { createApp } from "../src/app.js";

const shopId = "33333333-3333-4333-8333-333333333333";
const sellerId = "44444444-4444-4444-8444-444444444444";
const shiftId = "55555555-5555-4555-8555-555555555555";

describe("shift close time recording", () => {
  const openShift = {
    id: shiftId,
    shopId,
    sellerId,
    openedAt: new Date("2026-11-27T06:00:00.000Z"),
    closedAt: null,
    openingCashCents: 5_000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.authSession.findUnique.mockResolvedValue({
      id: "session-1",
      shopId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: {
        id: sellerId,
        shopId,
        name: "Cashier",
        username: "cashier",
        email: null,
        active: true,
        archivedAt: null,
        mustChangePassword: false,
        discountLimitPct: 0,
        permissionOverridesJson: null,
        role: { name: "staff", permissions: [{ permission: { key: "sales.create" } }] },
      },
    });
    mockTransaction.shift.findFirst.mockResolvedValue(openShift);
    mockTransaction.payment.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockTransaction.cashMovement.groupBy.mockResolvedValue([]);
    mockTransaction.shift.updateMany.mockResolvedValue({ count: 1 });
    mockTransaction.shift.findFirstOrThrow.mockImplementation(async () => ({
      ...openShift,
      closedAt: mockTransaction.shift.updateMany.mock.calls[0]?.[0].data.closedAt,
      expectedCashCents: 5_000,
      countedCashCents: 5_000,
      varianceCents: 0,
    }));
    mockTransaction.auditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.$transaction.mockImplementation(async (operation: unknown) => {
      if (typeof operation === "function") return operation(mockTransaction);
      return Promise.all(operation as Promise<unknown>[]);
    });
  });

  it("persists and audits the exact shift closing timestamp", async () => {
    const response = await request(createApp())
      .post("/api/shifts/close")
      .set("Cookie", "ej_session=test-session")
      .send({ countedCashCents: 5_000 });

    expect(response.status).toBe(200);
    const closedAt = response.body.shift.closedAt as string;
    expect(Number.isNaN(Date.parse(closedAt))).toBe(false);
    expect(mockTransaction.shift.updateMany.mock.calls[0]?.[0].data.closedAt.toISOString()).toBe(
      closedAt,
    );
    expect(mockTransaction.auditLog.create.mock.calls[0]?.[0].data.afterJson.closedAt).toBe(
      closedAt,
    );
  });
});
