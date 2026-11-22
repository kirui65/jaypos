import express from "express";
import { z } from "zod";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("eminent-jay-api"),
});

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_request, response) => {
    response.json(healthResponseSchema.parse({ status: "ok", service: "eminent-jay-api" }));
  });
  return app;
}
