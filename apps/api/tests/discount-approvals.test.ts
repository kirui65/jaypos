import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTransaction } = vi.hoisted(() => {
  const transaction = {
    discountApprovalRequest: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  return {
    mockTransaction: transaction,
    mockPrisma: {
      authSession: { findUnique: vi.fn() },
      productVariant: { findMany: vi.fn() },
      discountApprovalRequest: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
      user: { findFirst: vi.fn() },
      loginAttempt: { count: vi.fn(), create: vi.fn() },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../src/db.js", () => ({ prisma: mockPrisma }));

import { createApp } from "../src/app.js";

const variantId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const shopId = "33333333-3333-4333-8333-333333333333";
const staffId = "44444444-4444-4444-8444-444444444444";
const adminId = "55555555-5555-4555-8555-555555555555";
const cart = [{ variantId, quantity: 1 }];

describe("cart discount approval", () => {
  let adminPinHash = "";
  const pendingRequest = {
    id: requestId,
    requesterId: staffId,
    approverId: null,
    status: "requested",
    discountCents: 1_000,
    reason: "Customer promotion",
    cartItemsJson: cart,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const staff = {
    id: staffId,
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
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    adminPinHash = adminPinHash || (await bcrypt.hash("2468", 4));
    mockPrisma.authSession.findUnique.mockResolvedValue({
      id: "session-1",
      shopId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: staff,
    });
    mockPrisma.productVariant.findMany.mockResolvedValue([
      { id: variantId, priceCents: 10_000, active: true, product: { active: true } },
    ]);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: adminId,
      shopId,
      name: "Owner",
      username: "owner",
      active: true,
      archivedAt: null,
      pinHash: adminPinHash,
      role: { name: "admin" },
    });
    mockPrisma.loginAttempt.count.mockResolvedValue(0);
    mockPrisma.loginAttempt.create.mockResolvedValue({ id: "attempt-1" });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
    mockTransaction.auditLog.create.mockResolvedValue({ id: "audit-2" });
    mockTransaction.discountApprovalRequest.create.mockResolvedValue({
      id: requestId,
      status: "requested",
      expiresAt: pendingRequest.expiresAt,
      discountCents: 1_000,
      reason: "Customer promotion",
    });
    mockTransaction.discountApprovalRequest.findFirst.mockResolvedValue(pendingRequest);
    mockTransaction.discountApprovalRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockImplementation(async (operation: unknown) => {
      if (typeof operation === "function") return operation(mockTransaction);
      return Promise.all(operation as Promise<unknown>[]);
    });
  });

  it("creates an audited request for a cart discount above the staff limit", async () => {
    const response = await request(createApp())
      .post("/api/sales/discount-requests")
      .set("Cookie", "ej_session=test-session")
      .send({ items: cart, discountCents: 1_000, reason: "Customer promotion" });

    expect(response.status).toBe(201);
    expect(response.body.request).toMatchObject({ id: requestId, status: "requested" });
    expect(mockTransaction.discountApprovalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requesterId: staffId,
          discountCents: 1_000,
          reason: "Customer promotion",
        }),
      }),
    );
  });

  it("requires an administrator PIN and records who approved the request", async () => {
    const response = await request(createApp())
      .post(`/api/sales/discount-requests/${requestId}/approve`)
      .set("Cookie", "ej_session=test-session")
      .send({ username: "owner", pin: "2468" });

    expect(response.status).toBe(200);
    expect(response.body.request).toMatchObject({ status: "approved", approvedBy: "Owner" });
    expect(mockTransaction.discountApprovalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "approved", approverId: adminId }),
      }),
    );
  });

  it("rejects a bad manager PIN", async () => {
    const response = await request(createApp())
      .post(`/api/sales/discount-requests/${requestId}/approve`)
      .set("Cookie", "ej_session=test-session")
      .send({ username: "owner", pin: "9999" });

    expect(response.status).toBe(401);
    expect(mockTransaction.discountApprovalRequest.updateMany).not.toHaveBeenCalled();
  });
});
