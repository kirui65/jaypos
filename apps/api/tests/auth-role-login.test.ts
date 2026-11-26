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
  const password = "correct-password-123";
  let passwordHash = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    passwordHash = passwordHash || (await bcrypt.hash(password, 4));
    mockPrisma.loginAttempt.count.mockResolvedValue(0);
    mockPrisma.loginAttempt.create.mockResolvedValue({ id: "attempt-1" });
    mockPrisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
    mockPrisma.authSession.create.mockResolvedValue({ id: "session-1" });
    mockPrisma.user.update.mockResolvedValue({ id: "user-1" });
    mockPrisma.$transaction.mockResolvedValue([]);
  });

  function mockUser(roleName: "admin" | "staff") {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: `user-${roleName}`,
      shopId: "shop-1",
      name: roleName === "admin" ? "Owner" : "Cashier",
      username: roleName,
      email: `${roleName}@shop.local`,
      passwordHash,
      active: true,
      archivedAt: null,
      mustChangePassword: false,
      discountLimitPct: 0,
      permissionOverridesJson: null,
      role: { name: roleName, permissions: [] },
    });
  }

  it("allows login when the selected role matches the account role", async () => {
    mockUser("admin");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "admin", password, role: "admin" });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("admin");
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("rejects login when Admin is selected for a Cashier account", async () => {
    mockUser("staff");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", password, role: "admin" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Cashier");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects login when Cashier is selected for an Admin account", async () => {
    mockUser("admin");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "admin", password, role: "staff" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Admin");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not leak role mismatch when the password is wrong", async () => {
    mockUser("staff");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", password: "wrong-password", role: "admin" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid username or password");
  });

  it("remains backwards compatible when role is omitted", async () => {
    mockUser("staff");
    const response = await request(createApp())
      .post("/api/auth/login")
      .send({ identifier: "staff", password });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("staff");
  });
});
