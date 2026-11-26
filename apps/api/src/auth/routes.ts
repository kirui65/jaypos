import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  DEFAULT_PERMISSION_KEYS,
  DEFAULT_STAFF_PERMISSION_KEYS,
  isRolePin,
  ROLE_PIN_LENGTHS,
  rolePinLength,
} from "@eminent/shared";
import { prisma } from "../db.js";
import {
  clearSessionCookie,
  requireAuth,
  requirePermission,
  sessionTokenFromRequest,
  setSessionCookie,
  type AuthenticatedRequest,
} from "./middleware.js";
import { parsePermissionRemovals } from "./permissions.js";
import { businessData, businessWhere, shopData, shopWhere } from "../tenant-scope.js";
import { configuredShopId } from "../shop-settings.js";

const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const loginInput = z.object({
  identifier: z.string().trim().min(1).max(254),
  pin: z.string().regex(/^\d{4,8}$/),
  role: z.enum(["admin", "staff"]).optional(),
});
const createStaffInput = z.object({
  name: z.string().trim().min(1).max(120),
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-zA-Z0-9._@+-]+$/),
  email: z.string().email().max(254).optional(),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(12).max(200),
  pin: z.string().regex(new RegExp(`^[0-9]{${ROLE_PIN_LENGTHS.staff}}$`)),
  discountLimitPct: z.number().int().min(0).max(100).default(0),
});
const editStaffInput = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[a-zA-Z0-9._@+-]+$/)
      .optional(),
    newPassword: z.string().min(12).max(200).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().max(254).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    discountLimitPct: z.number().int().min(0).max(100).optional(),
    permissionOverrides: z.record(z.string(), z.literal(false)).optional(),
    active: z.boolean().optional(),
    forceLogout: z.boolean().optional(),
  })
  .strict();
const accountSettingsInput = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[a-zA-Z0-9._@+-]+$/)
      .optional(),
    newPassword: z.string().min(12).max(200).optional(),
  })
  .strict()
  .refine((value) => value.username !== undefined || value.newPassword !== undefined);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function sessionToken(): string {
  return randomBytes(32).toString("base64url");
}
function clientIp(request: AuthenticatedRequest): string {
  return request.ip || "unknown";
}
function safeUser(user: {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: { name: string };
  active?: boolean;
  pinHash: string | null;
  discountLimitPct: number;
  permissionOverridesJson: unknown;
}) {
  const permissions =
    user.role.name === "admin"
      ? [...DEFAULT_PERMISSION_KEYS]
      : DEFAULT_STAFF_PERMISSION_KEYS.filter(
          (key) =>
            !(
              user.permissionOverridesJson &&
              typeof user.permissionOverridesJson === "object" &&
              (user.permissionOverridesJson as Record<string, unknown>)[key] === false
            ),
        );
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role.name,
    active: user.active ?? true,
    hasPin: Boolean(user.pinHash),
    discountLimitPct: user.discountLimitPct,
    permissions: [...permissions],
    permissionOverrides: user.permissionOverridesJson,
  };
}

export const authRouter = Router();
authRouter.post("/login", async (request, response) => {
  const parsed = loginInput.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Invalid login details" });
  const identifier = parsed.data.identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: identifier, mode: "insensitive" } },
      ],
    },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  const shopId = user?.shopId ?? (await configuredShopId());
  if (!shopId) return response.status(401).json({ error: "Invalid username or PIN" });
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const attempts = await prisma.loginAttempt.count({
    where: businessWhere(shopId, {
      identifier,
      ip: clientIp(request),
      succeeded: false,
      createdAt: { gte: since },
    }),
  });
  if (attempts >= 5)
    return response
      .status(429)
      .json({ error: "Too many failed attempts. Try again in 15 minutes." });
  const valid =
    !!user &&
    user.active &&
    !user.archivedAt &&
    Boolean(
      user.pinHash &&
        isRolePin(parsed.data.pin, user.role.name) &&
        (await bcrypt.compare(parsed.data.pin, user.pinHash)),
    );
  await prisma.loginAttempt.create({
    data: businessData(shopId, { identifier, ip: clientIp(request), succeeded: valid }),
  });
  if (!valid || !user) {
    await prisma.auditLog.create({
      data: businessData(shopId, {
        userId: user?.id ?? null,
        action: "auth.login_failed",
        entity: "user",
        entityId: user?.id ?? null,
        ip: clientIp(request),
        afterJson: { identifier },
      }),
    });
    return response.status(401).json({ error: "Invalid username or PIN" });
  }
  if (parsed.data.role && user.role.name !== parsed.data.role) {
    await prisma.auditLog.create({
      data: businessData(shopId, {
        userId: user.id,
        action: "auth.login_role_mismatch",
        entity: "user",
        entityId: user.id,
        ip: clientIp(request),
        afterJson: { selectedRole: parsed.data.role, actualRole: user.role.name },
      }),
    });
    const expectedLabel = user.role.name === "admin" ? "Admin" : "Cashier";
    return response.status(403).json({
      error: `This account is registered as ${expectedLabel}. Select ${expectedLabel} to sign in.`,
    });
  }
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await prisma.$transaction([
    prisma.authSession.create({
      data: businessData(shopId, { userId: user.id, tokenHash: hashToken(token), expiresAt }),
    }),
    prisma.user.update({
      where: businessWhere(shopId, { id: user.id }),
      data: { lastLoginAt: new Date() },
    }),
    prisma.auditLog.create({
      data: businessData(shopId, {
        userId: user.id,
        action: "auth.login",
        entity: "user",
        entityId: user.id,
        ip: clientIp(request),
      }),
    }),
  ]);
  setSessionCookie(response, token, sessionLifetimeMs);
  return response.json({ user: safeUser(user), expiresAt });
});

authRouter.get("/me", async (request: AuthenticatedRequest, response) => {
  const token = sessionTokenFromRequest(request);
  if (!token) return response.json({ user: null });
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.shopId !== session.user.shopId || !session.user.active || session.user.archivedAt) {
    clearSessionCookie(response);
    return response.json({ user: null });
  }
  return response.json({ user: safeUser(session.user) });
});
authRouter.use(requireAuth);
authRouter.post("/logout", async (request: AuthenticatedRequest, response) => {
  if (request.sessionId && request.authUser)
    await prisma.$transaction([
      prisma.authSession.update({
        where: shopWhere(request, { id: request.sessionId }),
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: shopData(request, {
          userId: request.authUser.id,
          action: "auth.logout",
          entity: "user",
          entityId: request.authUser.id,
          ip: clientIp(request),
        }),
      }),
    ]);
  clearSessionCookie(response);
  return response.status(204).end();
});

authRouter.post("/pin-unlock", async (request: AuthenticatedRequest, response) => {
  const parsed = z.object({ pin: z.string().regex(/^\d{4,8}$/) }).safeParse(request.body);
  if (!parsed.success || !request.authUser)
    return response.status(400).json({ error: "Invalid PIN" });
  if (!isRolePin(parsed.data.pin, request.authUser.role.name))
    return response.status(400).json({
      error: `PIN must contain exactly ${rolePinLength(request.authUser.role.name)} digits`,
    });
  const user = await prisma.user.findFirst({
    where: shopWhere(request, { id: request.authUser.id }),
  });
  if (!user) return response.status(401).json({ error: "Session expired" });
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const failedAttempts = await prisma.loginAttempt.count({
    where: businessWhere(user.shopId, {
      identifier: `pin:${request.authUser.id}`,
      ip: clientIp(request),
      succeeded: false,
      createdAt: { gte: since },
    }),
  });
  if (failedAttempts >= 5)
    return response
      .status(429)
      .json({ error: "Too many failed PIN attempts. Try again in 15 minutes." });
  if (!user?.pinHash || !(await bcrypt.compare(parsed.data.pin, user.pinHash))) {
    await prisma.loginAttempt.create({
      data: shopData(request, {
        identifier: `pin:${request.authUser.id}`,
        ip: clientIp(request),
        succeeded: false,
      }),
    });
    await prisma.auditLog.create({
      data: shopData(request, {
        userId: request.authUser.id,
        action: "auth.pin_failed",
        entity: "user",
        entityId: request.authUser.id,
        ip: clientIp(request),
      }),
    });
    return response.status(401).json({ error: "Invalid PIN" });
  }
  await prisma.auditLog.create({
    data: shopData(request, {
      userId: user.id,
      action: "auth.pin_unlock",
      entity: "user",
      entityId: user.id,
      ip: clientIp(request),
    }),
  });
  return response.json({ ok: true, user: { id: user.id, name: user.name } });
});

authRouter.post("/pin", async (request: AuthenticatedRequest, response) => {
  const parsed = z
    .object({
      pin: z.string().regex(/^\d{4,8}$/),
      currentPassword: z.string().min(1).max(200).optional(),
      currentPin: z
        .string()
        .regex(/^\d{4,8}$/)
        .optional(),
    })
    .safeParse(request.body);
  if (!parsed.success || !request.authUser)
    return response.status(400).json({ error: "PIN must contain only digits" });
  const user = await prisma.user.findFirstOrThrow({
    where: shopWhere(request, { id: request.authUser.id }),
  });
  if (
    !isRolePin(parsed.data.pin, request.authUser.role.name) ||
    (parsed.data.currentPin && !isRolePin(parsed.data.currentPin, request.authUser.role.name))
  )
    return response.status(400).json({
      error: `PIN must contain exactly ${rolePinLength(request.authUser.role.name)} digits`,
    });
  const passwordValid = parsed.data.currentPassword
    ? await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)
    : false;
  const pinValid =
    parsed.data.currentPin && user.pinHash
      ? await bcrypt.compare(parsed.data.currentPin, user.pinHash)
      : false;
  if (user.pinHash ? !passwordValid && !pinValid : !passwordValid)
    return response.status(401).json({ error: "Current password or PIN is incorrect" });
  await prisma.user.update({
    where: shopWhere(request, { id: user.id }),
    data: { pinHash: await bcrypt.hash(parsed.data.pin, 12) },
  });
  await prisma.auditLog.create({
    data: shopData(request, {
      userId: user.id,
      action: "auth.pin_changed",
      entity: "user",
      entityId: user.id,
    }),
  });
  return response.json({ ok: true });
});

const adminOnly = requirePermission("staff.manage");
authRouter.patch("/account", adminOnly, async (request: AuthenticatedRequest, response) => {
  const parsed = accountSettingsInput.safeParse(request.body);
  if (!parsed.success || !request.authUser)
    return response.status(400).json({ error: "Provide a valid username or a password of at least 12 characters" });
  const actor = request.authUser;
  if (actor.role.name !== "admin") return response.status(403).json({ error: "Permission denied" });
  const existing = await prisma.user.findFirst({
    where: shopWhere(request, { id: actor.id, role: { name: "admin" } }),
    include: { role: true },
  });
  if (!existing) return response.status(404).json({ error: "Admin account not found" });
  const normalizedUsername = parsed.data.username?.toLowerCase();
  if (normalizedUsername) {
    const duplicate = await prisma.user.findFirst({
      where: {
        username: { equals: normalizedUsername, mode: "insensitive" },
        id: { not: existing.id },
      },
    });
    if (duplicate) return response.status(409).json({ error: "Username is already in use" });
  }
  const passwordChanged = parsed.data.newPassword !== undefined;
  const updated = await prisma.$transaction(async (transaction) => {
    const saved = await transaction.user.update({
      where: shopWhere(request, { id: existing.id }),
      data: {
        ...(normalizedUsername ? { username: normalizedUsername } : {}),
        ...(parsed.data.newPassword
          ? { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) }
          : {}),
        mustChangePassword: false,
      },
      include: { role: true },
    });
    await transaction.authSession.updateMany({
      where: shopWhere(request, {
        userId: existing.id,
        ...(request.sessionId ? { id: { not: request.sessionId } } : {}),
        revokedAt: null,
      }),
      data: { revokedAt: new Date() },
    });
    await transaction.auditLog.create({
      data: shopData(request, {
        userId: actor.id,
        action: "auth.account_updated",
        entity: "user",
        entityId: saved.id,
        beforeJson: { username: existing.username },
        afterJson: { username: saved.username, passwordChanged },
      }),
    });
    return saved;
  });
  return response.json({ user: safeUser(updated) });
});

authRouter.get("/staff", adminOnly, async (request: AuthenticatedRequest, response) => {
  const staff = await prisma.user.findMany({
    where: shopWhere(request, { role: { name: "staff" }, archivedAt: null }),
    include: { role: true },
    orderBy: { name: "asc" },
  });
  return response.json({ staff: staff.map(safeUser) });
});

authRouter.post("/staff", adminOnly, async (request: AuthenticatedRequest, response) => {
  const parsed = createStaffInput.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
  const role = await prisma.role.findUnique({ where: { name: "staff" } });
  if (!role) return response.status(500).json({ error: "Staff role is not configured" });
  const actor = request.authUser!;
  const normalizedUsername = parsed.data.username.toLowerCase();
  const normalizedEmail = parsed.data.email?.toLowerCase() ?? null;
  const identifiers = [normalizedUsername, ...(normalizedEmail ? [normalizedEmail] : [])];
  const duplicateIdentifier = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { in: identifiers } },
        { email: { in: identifiers } },
      ],
    },
  });
  if (duplicateIdentifier)
    return response.status(409).json({ error: "Username or email is already in use" });
  try {
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: shopData(request, {
          roleId: role.id,
          name: parsed.data.name,
          username: normalizedUsername,
          email: normalizedEmail,
          phone: parsed.data.phone ?? null,
          passwordHash: await bcrypt.hash(parsed.data.password, 12),
          pinHash: await bcrypt.hash(parsed.data.pin, 12),
          mustChangePassword: false,
          discountLimitPct: parsed.data.discountLimitPct,
          createdBy: actor.id,
        }),
        include: { role: true },
      });
      await transaction.auditLog.create({
        data: shopData(request, {
          userId: actor.id,
          action: "staff.created",
          entity: "user",
          entityId: created.id,
          afterJson: {
            name: created.name,
            username: created.username,
            discountLimitPct: created.discountLimitPct,
          },
        }),
      });
      return created;
    });
    return response.status(201).json({ staff: safeUser(user) });
  } catch {
    return response.status(409).json({ error: "Username or email is already in use" });
  }
});

authRouter.patch("/staff/:id", adminOnly, async (request: AuthenticatedRequest, response) => {
  const parsed = editStaffInput.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
  const actor = request.authUser!;
  const existing = await prisma.user.findFirst({
    where: shopWhere(request, {
      id: request.params.id ?? "",
      role: { name: "staff" },
      archivedAt: null,
    }),
  });
  if (!existing) return response.status(404).json({ error: "Staff account not found" });
  const normalizedUsername = parsed.data.username?.toLowerCase();
  if (normalizedUsername) {
    const duplicate = await prisma.user.findFirst({
      where: {
        username: { equals: normalizedUsername, mode: "insensitive" },
        id: { not: existing.id },
      },
    });
    if (duplicate) return response.status(409).json({ error: "Username is already in use" });
  }
  if (parsed.data.email !== undefined && parsed.data.email !== null) {
    const email = parsed.data.email.toLowerCase();
    const duplicate = await prisma.user.findFirst({
      where: { email, id: { not: existing.id } },
    });
    if (duplicate) return response.status(409).json({ error: "Email is already in use" });
  }
  const { newPassword, permissionOverrides, forceLogout, ...fields } = parsed.data;
  delete fields.username;
  const changes: Record<string, unknown> = {
    ...fields,
    ...(normalizedUsername ? { username: normalizedUsername } : {}),
    ...(parsed.data.email !== undefined
      ? { email: parsed.data.email?.toLowerCase() ?? null }
      : {}),
    ...(newPassword ? { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } : {}),
  };
  if (permissionOverrides !== undefined)
    changes.permissionOverridesJson = parsePermissionRemovals(permissionOverrides);
  const updated = await prisma.$transaction(async (transaction) => {
    if (parsed.data.active === false || forceLogout || normalizedUsername || newPassword)
      await transaction.authSession.updateMany({
        where: shopWhere(request, { userId: existing.id, revokedAt: null }),
        data: { revokedAt: new Date() },
      });
    const saved = await transaction.user.update({
      where: shopWhere(request, { id: existing.id }),
      data: changes,
      include: { role: true },
    });
    await transaction.auditLog.create({
      data: shopData(request, {
        userId: actor.id,
        action: "staff.updated",
        entity: "user",
        entityId: saved.id,
        beforeJson: {
          name: existing.name,
          username: existing.username,
          email: existing.email,
          phone: existing.phone,
          active: existing.active,
          discountLimitPct: existing.discountLimitPct,
          permissionOverrides: existing.permissionOverridesJson,
        },
        afterJson: {
          name: saved.name,
          username: saved.username,
          email: saved.email,
          phone: saved.phone,
          active: saved.active,
          discountLimitPct: saved.discountLimitPct,
          permissionOverrides: saved.permissionOverridesJson,
          passwordChanged: Boolean(newPassword),
          forceLogout: forceLogout ?? false,
        },
      }),
    });
    return saved;
  });
  return response.json({ staff: safeUser(updated) });
});

authRouter.post(
  "/staff/:id/reset-pin",
  adminOnly,
  async (request: AuthenticatedRequest, response) => {
    const parsed = z
      .object({
        pin: z
          .string()
          .regex(new RegExp(`^[0-9]{${ROLE_PIN_LENGTHS.staff}}$`)),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Cashier PIN must contain exactly 4 digits" });
    const actor = request.authUser!;
    const target = await prisma.user.findFirst({
      where: shopWhere(request, {
        id: request.params.id ?? "",
        role: { name: "staff" },
        archivedAt: null,
      }),
    });
    if (!target) return response.status(404).json({ error: "Staff account not found" });
    await prisma.$transaction([
      prisma.user.update({
        where: shopWhere(request, { id: target.id }),
        data: { pinHash: await bcrypt.hash(parsed.data.pin, 12) },
      }),
      prisma.auditLog.create({
        data: shopData(request, {
          userId: actor.id,
          action: "staff.pin_reset",
          entity: "user",
          entityId: target.id,
        }),
      }),
    ]);
    return response.json({ ok: true });
  },
);

authRouter.delete("/staff/:id", adminOnly, async (request: AuthenticatedRequest, response) => {
  const actor = request.authUser!;
  if (actor.id === request.params.id)
    return response.status(400).json({ error: "You cannot delete your own account" });
  const target = await prisma.user.findFirst({
    where: shopWhere(request, {
      id: request.params.id ?? "",
      role: { name: "staff" },
      archivedAt: null,
    }),
  });
  if (!target) return response.status(404).json({ error: "Staff account not found" });
  const [sales, shifts, auditEntries, requestedRefunds, approvedRefunds, stockMovements] =
    await Promise.all([
      prisma.sale.count({ where: shopWhere(request, { sellerId: target.id }) }),
      prisma.shift.count({ where: shopWhere(request, { sellerId: target.id }) }),
      prisma.auditLog.count({ where: shopWhere(request, { userId: target.id }) }),
      prisma.refund.count({ where: shopWhere(request, { requestedBy: target.id }) }),
      prisma.refund.count({ where: shopWhere(request, { approvedBy: target.id }) }),
      prisma.stockMovement.count({ where: shopWhere(request, { userId: target.id }) }),
    ]);
  const hasHistory =
    sales + shifts + auditEntries + requestedRefunds + approvedRefunds + stockMovements > 0;
  await prisma.$transaction([
    ...(hasHistory
      ? [
          prisma.user.update({
            where: shopWhere(request, { id: target.id }),
            data: { active: false, archivedAt: new Date() },
          }),
        ]
      : [prisma.user.delete({ where: shopWhere(request, { id: target.id }) })]),
    prisma.authSession.updateMany({
      where: shopWhere(request, { userId: target.id, revokedAt: null }),
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: shopData(request, {
        userId: actor.id,
        action: hasHistory ? "staff.archived" : "staff.deleted",
        entity: "user",
        entityId: target.id,
        beforeJson: { name: target.name },
      }),
    }),
  ]);
  return response.json({ ok: true, archived: hasHistory });
});
