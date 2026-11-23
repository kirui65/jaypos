import express from "express";
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

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("eminent-jay-api"),
});

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.use((request, response, next) => {
    const origin = request.get("origin");
    const expectedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    if (origin === expectedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", expectedOrigin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      if (origin !== expectedOrigin) return response.status(403).end();
      return response.status(204).end();
    }
    next();
  });
  app.use((request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
    const origin = request.get("origin");
    const expectedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    if (origin && origin !== expectedOrigin)
      return response.status(403).json({ error: "Origin not allowed" });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_request, response) => {
    response.json(healthResponseSchema.parse({ status: "ok", service: "eminent-jay-api" }));
  });
  app.use("/api/auth", authRouter);
  const paymentProvider = getPaymentProvider();
  app.use("/api/payments/lipwa/callback", createLipwaCallbackRouter(paymentProvider));
  app.use("/api", requireAuth);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/stock", stockRouter);
  app.use("/api/sales", salesRouter);
  app.use("/api/shifts", shiftsRouter);
  app.use("/api/refunds", refundsRouter);
  app.use("/api/payments", createPaymentsRouter(paymentProvider));
  return app;
}
