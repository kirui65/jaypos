import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { canAccess, type AuthUser } from "./permissions.js";

export type AuthenticatedRequest = Request & { authUser?: AuthUser; sessionId?: string };
const COOKIE = "ej_session";

export function sessionTokenFromRequest(request: Request): string | undefined {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(COOKIE.length + 1)) : undefined;
}

export function setSessionCookie(response: Response, token: string, maxAge: number): void {
  response.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
    maxAge,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
  });
}

export async function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  const token = sessionTokenFromRequest(request);
  if (!token) return response.status(401).json({ error: "Authentication required" });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: {
      user: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.shopId !== session.user.shopId ||
    !session.user.active ||
    session.user.archivedAt
  ) {
    clearSessionCookie(response);
    return response.status(401).json({ error: "Session expired or account inactive" });
  }
  request.authUser = session.user as unknown as AuthUser;
  request.sessionId = session.id;
  const routePath = `${request.baseUrl}${request.path}`;
  if (
    request.authUser.mustChangePassword &&
    !["/api/auth/change-password", "/api/auth/logout", "/api/auth/me"].includes(routePath)
  ) {
    return response
      .status(403)
      .json({ error: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" });
  }
  return next();
}

export function requirePermission(permission: string) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (!request.authUser) return response.status(401).json({ error: "Authentication required" });
    if (!canAccess(request.authUser, permission))
      return response.status(403).json({ error: "Permission denied" });
    return next();
  };
}
