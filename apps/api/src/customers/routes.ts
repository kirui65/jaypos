import { Router } from "express";
import { requirePermission, type AuthenticatedRequest } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { shopWhere } from "../tenant-scope.js";

export const customersRouter = Router();

customersRouter.get(
  "/",
  requirePermission("customers.write"),
  async (request: AuthenticatedRequest, response) => {
    const customers = await prisma.customer.findMany({
      where: shopWhere(request, {}),
      include: { preferences: true },
      orderBy: [{ name: "asc" }, { phone: "asc" }],
    });
    return response.json({ customers });
  },
);
