import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTransaction } = vi.hoisted(() => {
  const transaction = {
    user: { update: vi.fn() },
    authSession: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    mockTransaction: transaction,
    mockPrisma: {
      authSession: { findUnique: vi.fn() },
      user: { findFirst: vi.fn() },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../src/db.js", () => ({ prisma: mockPrisma }));

import { createApp } from "../src/app.js";

const shopId = "33333333-3333-4333-8333-333333333333";
const adminId = "55555555-5555-4555-8555-555555555555";
const staffId = "44444444-4444-4444-8444-444444444444";
const adminRole = {
  name: "admin",
  permissions: [{ permission: { key: "staff.manage" } }],
};
const staffRole = { name: "staff", permissions: [] };
const admin = {
  id: adminId,
  shopId,
  name: "Shop Owner",
  username: "owner",
  email: "owner@example.test",
  passwordHash: "old-password-hash",
  pinHash: "admin-pin-hash",
  discountLimitPct: 0,
  permissionOverridesJson: null,
  mustChangePassword: false,
  active: true,
  archivedAt: null,
  role: adminRole,
};
const staff = {
  id: staffId,
  shopId,
  name: "Cashier",
  username: "cashier",
  email: null,
  passwordHash: "old-cashier-password-hash",
  pinHash: "cashier-pin-hash",
  discountLimitPct: 0,
  permissionOverridesJson: null,
  mustChangePassword: false,
  active: true,
  archivedAt: null,
  role: staffRole,
};

function setSessionUser(user: typeof admin | typeof staff) {
  mockPrisma.authSession.findUnique.mockResolvedValue({
    id: "session-1",
    shopId,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user,
  });
}

describe("admin account management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionUser(admin);
    mockPrisma.$transaction.mockImplementation((operation: unknown) => {
      if (typeof operation === "function") return operation(mockTransaction);
      return Promise.all(operation as Promise<unknown>[]);
    });
    mockTransaction.authSession.updateMany.mockResolvedValue({ count: 1 });
    mockTransaction.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("lets an admin update their username and password from the account settings endpoint", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(admin).mockResolvedValueOnce(null);
    mockTransaction.user.update.mockImplementation(
      async (input: { data: Record<string, unknown> }) => ({
        ...admin,
        ...input.data,
      }),
    );

    const response = await request(createApp())
      .patch("/api/auth/account")
      .set("Cookie", "ej_session=valid-session")
      .send({ username: "NewOwner", newPassword: "a-strong-account-password" });

    expect(response.status).toBe(200);
    expect(response.body.user.username).toBe("newowner");
    expect(response.body.user).not.toHaveProperty("passwordHash");
    const update = mockTransaction.user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(update.data.username).toBe("newowner");
    expect(
      await bcrypt.compare("a-strong-account-password", String(update.data.passwordHash)),
    ).toBe(true);
    expect(mockTransaction.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: adminId, id: { not: "session-1" } }),
      }),
    );
    const audit = mockTransaction.auditLog.create.mock.calls[0]?.[0] as {
      data: { afterJson: Record<string, unknown> };
    };
    expect(audit.data.afterJson).toEqual({
      username: "newowner",
      passwordChanged: true,
      pinChanged: false,
    });
    expect(JSON.stringify(audit)).not.toContain("a-strong-account-password");
  });

  it("lets an admin replace their sign-in PIN with an eight-digit PIN", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(admin);
    mockTransaction.user.update.mockImplementation(
      async (input: { data: Record<string, unknown> }) => ({
        ...admin,
        ...input.data,
      }),
    );

    const response = await request(createApp())
      .patch("/api/auth/account")
      .set("Cookie", "ej_session=valid-session")
      .send({ newPin: "12345678" });

    expect(response.status).toBe(200);
    const update = mockTransaction.user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(await bcrypt.compare("12345678", String(update.data.pinHash))).toBe(true);
    const audit = mockTransaction.auditLog.create.mock.calls[0]?.[0] as {
      data: { afterJson: Record<string, unknown> };
    };
    expect(audit.data.afterJson).toMatchObject({ pinChanged: true });
    expect(JSON.stringify(audit)).not.toContain("12345678");
  });

  it("lets an admin edit a cashier username and password without clearing their PIN", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(staff).mockResolvedValueOnce(null);
    mockTransaction.user.update.mockImplementation(
      async (input: { data: Record<string, unknown> }) => ({
        ...staff,
        ...input.data,
      }),
    );

    const response = await request(createApp())
      .patch(`/api/auth/staff/${staffId}`)
      .set("Cookie", "ej_session=valid-session")
      .send({ username: "Cashier.One", newPassword: "another-strong-password" });

    expect(response.status).toBe(200);
    expect(response.body.staff.username).toBe("cashier.one");
    const update = mockTransaction.user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(update.data.username).toBe("cashier.one");
    expect(await bcrypt.compare("another-strong-password", String(update.data.passwordHash))).toBe(
      true,
    );
    expect(update.data).not.toHaveProperty("pinHash");
    expect(mockTransaction.authSession.updateMany).toHaveBeenCalled();
  });

  it("does not let a cashier edit account settings", async () => {
    setSessionUser(staff);

    const response = await request(createApp())
      .patch("/api/auth/account")
      .set("Cookie", "ej_session=valid-session")
      .send({ username: "new-cashier" });

    expect(response.status).toBe(403);
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });
});
