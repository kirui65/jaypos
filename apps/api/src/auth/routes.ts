import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { DEFAULT_PERMISSION_KEYS, DEFAULT_STAFF_PERMISSION_KEYS } from "@eminent/shared";
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

const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const loginInput = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});
const passwordInput = z.object({
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z.string().min(12).max(200),
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
  temporaryPassword: z.string().min(12).max(200),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional(),
  discountLimitPct: z.number().int().min(0).max(100).default(0),
});
const editStaffInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().max(254).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    discountLimitPct: z.number().int().min(0).max(100).optional(),
    permissionOverrides: z.record(z.string(), z.literal(false)).optional(),
    active: z.boolean().optional(),
    forceLogout: z.boolean().optional(),
  })
  .strict();

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
  mustChangePassword: boolean;
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
    mustChangePassword: user.mustChangePassword,
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
        { email: { equals: identifier, mode: "insensitive" } },
      ],
    },
    include: { shop: true, role: { include: { permissions: { include: { permission: true } } } } },
  });
  const shopId = user?.shopId ?? (await prisma.shop.findFirst({ select: { id: true } }))?.id;
  if (!shopId) return response.status(401).json({ error: "Invalid username or password" });
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const attempts = await prisma.loginAttempt.count({
    where: {
      shopId,
      identifier,
      ip: clientIp(request),
      succeeded: false,
      createdAt: { gte: since },
    },
  });
  if (attempts >= 5)
    return response
      .status(429)
      .json({ error: "Too many failed attempts. Try again in 15 minutes." });
  const valid =
    !!user &&
    user.active &&
    !user.archivedAt &&
    (await bcrypt.compare(parsed.data.password, user.passwordHash));
  await prisma.loginAttempt.create({
    data: { shopId, identifier, ip: clientIp(request), succeeded: valid },
  });
  if (!valid || !user) {
    await prisma.auditLog.create({
      data: {
        shopId,
        userId: user?.id ?? null,
        action: "auth.login_failed",
        entity: "user",
        entityId: user?.id ?? null,
        ip: clientIp(request),
        afterJson: { identifier },
      },
    });
    return response.status(401).json({ error: "Invalid username or password" });
  }
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await prisma.$transaction([
    prisma.authSession.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
    }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        shopId,
        userId: user.id,
        action: "auth.login",
        entity: "user",
        entityId: user.id,
        ip: clientIp(request),
      },
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
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active || session.user.archivedAt) {
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
        where: { id: request.sessionId },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          shopId: request.authUser.shopId,
          userId: request.authUser.id,
          action: "auth.logout",
          entity: "user",
          entityId: request.authUser.id,
          ip: clientIp(request),
        },
      }),
    ]);
  clearSessionCookie(response);
  return response.status(204).end();
});

authRouter.post("/change-password", async (request: AuthenticatedRequest, response) => {
  const parsed = passwordInput.safeParse(request.body);
  if (!parsed.success || !request.authUser)
    return response.status(400).json({ error: "Password must be at least 12 characters" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.authUser.id } });
  if (
    !user.mustChangePassword &&
    (!parsed.data.currentPassword ||
      !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)))
  )
    return response.status(401).json({ error: "Current password is incorrect" });
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    }),
    prisma.authSession.updateMany({
      where: {
        userId: user.id,
        ...(request.sessionId ? { id: { not: request.sessionId } } : {}),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        shopId: user.shopId,
        userId: user.id,
        action: "auth.password_changed",
        entity: "user",
        entityId: user.id,
      },
    }),
  ]);
  return response.json({ ok: true });
});

authRouter.post("/pin-unlock", async (request: AuthenticatedRequest, response) => {
  const parsed = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).safeParse(request.body);
  if (!parsed.success || !request.authUser)
    return response.status(400).json({ error: "Invalid PIN" });
  const user = await prisma.user.findUnique({ where: { id: request.authUser.id } });
  if (!user) return response.status(401).json({ error: "Session expired" });
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const failedAttempts = await prisma.loginAttempt.count({
    where: {
      shopId: user.shopId,
      identifier: `pin:${request.authUser.id}`,
      ip: clientIp(request),
      succeeded: false,
      createdAt: { gte: since },
    },
  });
  if (failedAttempts >= 5)
    return response
      .status(429)
      .json({ error: "Too many failed PIN attempts. Try again in 15 minutes." });
  if (!user?.pinHash || !(await bcrypt.compare(parsed.data.pin, user.pinHash))) {
    await prisma.loginAttempt.create({
      data: {
        shopId: request.authUser.shopId,
        identifier: `pin:${request.authUser.id}`,
        ip: clientIp(request),
        succeeded: false,
      },
    });
    await prisma.auditLog.create({
      data: {
        shopId: request.authUser.shopId,
        userId: request.authUser.id,
        action: "auth.pin_failed",
        entity: "user",
        entityId: request.authUser.id,
        ip: clientIp(request),
      },
    });
    return response.status(401).json({ error: "Invalid PIN" });
  }
  await prisma.auditLog.create({
    data: {
      shopId: user.shopId,
      userId: user.id,
      action: "auth.pin_unlock",
      entity: "user",
      entityId: user.id,
      ip: clientIp(request),
    },
  });
  return response.json({ ok: true, user: { id: user.id, name: user.name } });
});

authRouter.post("/pin", async (request: AuthenticatedRequest, response) => {
  const parsed = z
    .object({
      pin: z.string().regex(/^\d{4,6}$/),
      currentPassword: z.string().min(1).max(200).optional(),
      currentPin: z
        .string()
        .regex(/^\d{4,6}$/)
        .optional(),
    })
    .safeParse(request.body);
  if (!parsed.success || !request.authUser)
    return response.status(400).json({ error: "PIN must contain 4 to 6 digits" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.authUser.id } });
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
    where: { id: user.id },
    data: { pinHash: await bcrypt.hash(parsed.data.pin, 12) },
  });
  await prisma.auditLog.create({
    data: {
      shopId: user.shopId,
      userId: user.id,
      action: "auth.pin_changed",
      entity: "user",
      entityId: user.id,
    },
  });
  return response.json({ ok: true });
});

const adminOnly = requirePermission("staff.manage");
authRouter.get("/staff", adminOnly, async (request: AuthenticatedRequest, response) => {
  const staff = await prisma.user.findMany({
    where: { shopId: request.authUser!.shopId, role: { name: "staff" }, archivedAt: null },
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
  try {
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          shopId: actor.shopId,
          roleId: role.id,
          name: parsed.data.name,
          username: parsed.data.username.toLowerCase(),
          email: parsed.data.email?.toLowerCase() ?? null,
          phone: parsed.data.phone ?? null,
          passwordHash: await bcrypt.hash(parsed.data.temporaryPassword, 12),
          pinHash: parsed.data.pin ? await bcrypt.hash(parsed.data.pin, 12) : null,
          discountLimitPct: parsed.data.discountLimitPct,
          createdBy: actor.id,
        },
        include: { role: true },
      });
      await transaction.auditLog.create({
        data: {
          shopId: actor.shopId,
          userId: actor.id,
          action: "staff.created",
          entity: "user",
          entityId: created.id,
          afterJson: {
            name: created.name,
            username: created.username,
            discountLimitPct: created.discountLimitPct,
          },
        },
      });
      return created;
    });
    return response.status(201).json({ staff: safeUser(user) });
  } catch {
    return response.status(409).json({ error: "Username is already in use" });
  }
});

authRouter.patch("/staff/:id", adminOnly, async (request: AuthenticatedRequest, response) => {
  const parsed = editStaffInput.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
  const actor = request.authUser!;
  const existing = await prisma.user.findFirst({
    where: {
      id: request.params.id ?? "",
      shopId: actor.shopId,
      role: { name: "staff" },
      archivedAt: null,
    },
  });
  if (!existing) return response.status(404).json({ error: "Staff account not found" });
  const changes: Record<string, unknown> = { ...parsed.data };
  delete changes.permissionOverrides;
  delete changes.forceLogout;
  if (parsed.data.permissionOverrides !== undefined)
    changes.permissionOverridesJson = parsePermissionRemovals(parsed.data.permissionOverrides);
  const updated = await prisma.$transaction(async (transaction) => {
    if (parsed.data.active === false || parsed.data.forceLogout)
      await transaction.authSession.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    const saved = await transaction.user.update({
      where: { id: existing.id },
      data: changes,
      include: { role: true },
    });
    await transaction.auditLog.create({
      data: {
        shopId: actor.shopId,
        userId: actor.id,
        action: "staff.updated",
        entity: "user",
        entityId: saved.id,
        beforeJson: {
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          active: existing.active,
          discountLimitPct: existing.discountLimitPct,
          permissionOverrides: existing.permissionOverridesJson,
        },
        afterJson: {
          name: saved.name,
          email: saved.email,
          phone: saved.phone,
          active: saved.active,
          discountLimitPct: saved.discountLimitPct,
          permissionOverrides: saved.permissionOverridesJson,
          forceLogout: parsed.data.forceLogout ?? false,
        },
      },
    });
    return saved;
  });
  return response.json({ staff: safeUser(updated) });
});

authRouter.post(
  "/staff/:id/reset-password",
  adminOnly,
  async (request: AuthenticatedRequest, response) => {
    const parsed = z
      .object({ temporaryPassword: z.string().min(12).max(200) })
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Temporary password must be at least 12 characters" });
    const actor = request.authUser!;
    const target = await prisma.user.findFirst({
      where: {
        id: request.params.id ?? "",
        shopId: actor.shopId,
        role: { name: "staff" },
        archivedAt: null,
      },
    });
    if (!target) return response.status(404).json({ error: "Staff account not found" });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: target.id },
        data: {
          passwordHash: await bcrypt.hash(parsed.data.temporaryPassword, 12),
          mustChangePassword: true,
          pinHash: null,
        },
      }),
      prisma.authSession.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          shopId: actor.shopId,
          userId: actor.id,
          action: "staff.password_reset",
          entity: "user",
          entityId: target.id,
        },
      }),
    ]);
    return response.json({ ok: true });
  },
);

authRouter.post(
  "/staff/:id/reset-pin",
  adminOnly,
  async (request: AuthenticatedRequest, response) => {
    const parsed = z
      .object({
        pin: z
          .string()
          .regex(/^\d{4,6}$/)
          .nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "PIN must contain 4 to 6 digits, or null to clear it" });
    const actor = request.authUser!;
    const target = await prisma.user.findFirst({
      where: {
        id: request.params.id ?? "",
        shopId: actor.shopId,
        role: { name: "staff" },
        archivedAt: null,
      },
    });
    if (!target) return response.status(404).json({ error: "Staff account not found" });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: target.id },
        data: { pinHash: parsed.data.pin ? await bcrypt.hash(parsed.data.pin, 12) : null },
      }),
      prisma.auditLog.create({
        data: {
          shopId: actor.shopId,
          userId: actor.id,
          action: "staff.pin_reset",
          entity: "user",
          entityId: target.id,
        },
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
    where: {
      id: request.params.id ?? "",
      shopId: actor.shopId,
      role: { name: "staff" },
      archivedAt: null,
    },
  });
  if (!target) return response.status(404).json({ error: "Staff account not found" });
  const [sales, shifts, auditEntries, requestedRefunds, approvedRefunds, stockMovements] =
    await Promise.all([
      prisma.sale.count({ where: { sellerId: target.id } }),
      prisma.shift.count({ where: { sellerId: target.id } }),
      prisma.auditLog.count({ where: { userId: target.id } }),
      prisma.refund.count({ where: { requestedBy: target.id } }),
      prisma.refund.count({ where: { approvedBy: target.id } }),
      prisma.stockMovement.count({ where: { userId: target.id } }),
    ]);
  const hasHistory =
    sales + shifts + auditEntries + requestedRefunds + approvedRefunds + stockMovements > 0;
  await prisma.$transaction([
    ...(hasHistory
      ? [
          prisma.user.update({
            where: { id: target.id },
            data: { active: false, archivedAt: new Date() },
          }),
        ]
      : [prisma.user.delete({ where: { id: target.id } })]),
    prisma.authSession.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        shopId: actor.shopId,
        userId: actor.id,
        action: hasHistory ? "staff.archived" : "staff.deleted",
        entity: "user",
        entityId: target.id,
        beforeJson: { name: target.name },
      },
    }),
  ]);
  return response.json({ ok: true, archived: hasHistory });
});
