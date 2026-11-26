import express from "express";
import compression from "compression";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { authRouter } from "./auth/routes.js";
import { requireAuth } from "./auth/middleware.js";
import { catalogRouter } from "./catalog/routes.js";
import { stockRouter } from "./stock/routes.js";
import { salesRouter } from "./sales/routes.js";
import { shiftsRouter } from "./shifts/routes.js";
import { createLipwaCallbackRouter, createPaymentsRouter } from "./payments/routes.js";
import { getPaymentProvider } from "./payments/provider.js";
import { refundsRouter } from "./refunds/routes.js";
import { prisma } from "./db.js";
import { customersRouter } from "./customers/routes.js";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("retail-pos-api"),
});

const webDistDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);
const webContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

function getAllowedOrigins(): string[] {
  const configuredOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const developmentOrigins =
    process.env.NODE_ENV === "production" ? [] : ["http://localhost:4173", "http://127.0.0.1:4173"];
  return [...new Set([...configuredOrigins, ...developmentOrigins])];
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.use((request, response, next) => {
    const origin = request.get("origin");
    const allowedOrigins = getAllowedOrigins();
    if (origin && allowedOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins.includes(origin)) return response.status(403).end();
      return response.status(204).end();
    }
    next();
  });
  app.use((request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    const origin = request.get("origin");
    const allowedOrigins = getAllowedOrigins();
    if (origin && !allowedOrigins.includes(origin))
      return response.status(403).json({ error: "Origin not allowed" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_request, response) => {
    response.json(healthResponseSchema.parse({ status: "ok", service: "retail-pos-api" }));
  });
  app.get("/api/brand", async (_request, response) => {
    const publicShopSlug = process.env.PUBLIC_SHOP_SLUG;
    const shop = publicShopSlug
      ? await prisma.shop.findUnique({ where: { slug: publicShopSlug }, select: { settingsJson: true } })
      : null;
    const settings = shop?.settingsJson && typeof shop.settingsJson === "object" && !Array.isArray(shop.settingsJson)
      ? shop.settingsJson as Record<string, unknown>
      : {};
    const savedBrandName = typeof settings.brand_name === "string" ? settings.brand_name.trim() : "";
    response.setHeader("Cache-Control", "public, max-age=60");
    return response.json({
      brandName: savedBrandName && savedBrandName !== "Shop" ? savedBrandName : "Eminent Jay",
      logoUrl: typeof settings.logo_url === "string" ? settings.logo_url : null,
    });
  });
  app.use("/api/auth", authRouter);
  const paymentProvider = getPaymentProvider();
  app.use("/api/payments/lipwa/callback", createLipwaCallbackRouter(paymentProvider));
  app.use("/api", requireAuth);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/stock", stockRouter);
  app.use("/api/sales", salesRouter);
  app.use("/api/shifts", shiftsRouter);
  app.use("/api/refunds", refundsRouter);
  app.use("/api/payments", createPaymentsRouter(paymentProvider));

  if (process.env.NODE_ENV === "production" && existsSync(webDistDirectory)) {
    app.use(express.static(webDistDirectory, {
      setHeaders: (response) => {
        response.setHeader("Content-Security-Policy", webContentSecurityPolicy);
      },
    }));
    app.get("*", (request, response, next) => {
      if (request.path === "/api" || request.path.startsWith("/api/")) return next();
      response.setHeader("Content-Security-Policy", webContentSecurityPolicy);
      return response.sendFile(path.join(webDistDirectory, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  return app;
}
