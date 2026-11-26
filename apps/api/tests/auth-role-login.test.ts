import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    loginAttempt: {
      count: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    authSession: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../src/db.js", () => ({ prisma: mockPrisma }));
vi.mock("../src/shop-settings.js", () => ({
  configuredShopId: vi.fn().mockResolvedValue("shop-1"),
  getShopSettings: vi.fn().mockResolvedValue({}),
}));

import { createApp } from "../src/app.js";

describe("POST /api/auth/login role selection", () => {
  const passwordHash = "account-password-is-not-a-sign-in-credential";

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.loginAttempt.count.mockResolvedValue(0);
    mockPrisma.loginAttempt.create.mockResolvedValue({ id: "attempt-1" });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.authSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.user.update.mockResolvedValue({ id: "user-1" });
    mockPrisma.$transaction.mockResolvedValue([]);
  });

  function mockUser(
    roleName: "admin" | "staff",
    pinHash: string | null = null,
    savedPasswordHash = passwordHash,
  ) {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: `user-${roleName}`,
      shopId: "shop-1",
      name: roleName === "admin" ? "Owner" : "Cashier",
      username: roleName,
      email: `${roleName}@shop.local`,
      passwordHash: savedPasswordHash,
      pinHash,
      active: true,
      archivedAt: null,
      mustChangePassword: false,
      discountLimitPct: 0,
      permissionOverridesJson: null,
      role: { name: roleName, permissions: [] },
    });
  }

  it("allows login with the selected role's saved PIN", async () => {
    mockUser("admin", await bcrypt.hash("87654321", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "admin", pin: "87654321", role: "admin" });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("admin");
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("rejects login when Admin is selected for a Cashier account", async () => {
    mockUser("staff", await bcrypt.hash("2468", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", pin: "2468", role: "admin" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Cashier");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects login when Cashier is selected for an Admin account", async () => {
    mockUser("admin", await bcrypt.hash("87654321", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "admin", pin: "87654321", role: "staff" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Admin");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not leak role mismatch when the PIN is wrong", async () => {
    mockUser("staff", await bcrypt.hash("2468", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", pin: "1357", role: "admin" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid username or PIN");
  });

  it("allows the role to be omitted when the saved PIN matches", async () => {
    mockUser("staff", await bcrypt.hash("2468", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", pin: "2468" });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("staff");
  });

  it("uses the saved PIN when an account has one", async () => {
    mockUser("staff", await bcrypt.hash("2468", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", pin: "2468", role: "staff" });

    expect(response.status).toBe(200);
    expect(response.body.user.hasPin).toBe(true);
  });

  it("does not use the account password when no PIN has been set", async () => {
    mockUser("staff", null, await bcrypt.hash("1234", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", pin: "1234", role: "staff" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid username or PIN");
  });

  it("rejects password text in the PIN field", async () => {
    mockUser("staff");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", pin: "correct-password-123", role: "staff" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid login details");
  });

  it("requires an eight-digit numeric PIN for admin accounts", async () => {
    mockUser("admin", await bcrypt.hash("12345678", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "admin", pin: "12345678", role: "admin" });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("admin");
  });

  it("rejects a cashier PIN that is not exactly four digits", async () => {
    mockUser("staff", await bcrypt.hash("12345678", 4));
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", pin: "12345678", role: "staff" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid username or PIN");
  });
});
