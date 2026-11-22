import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns the API health status", async () => {
    const response = await request(createApp()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "eminent-jay-api" });
  });
});

describe("protected API routes", () => {
  it("requires an authenticated session for API requests", async () => {
    const response = await request(createApp()).get("/api/auth/staff");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Authentication required" });
  });

  it("allows credentialed browser requests only from the configured web origin", async () => {
    const allowed = await request(createApp())
      .options("/api/auth/login")
      .set("Origin", "http://localhost:5173");
    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const rejected = await request(createApp())
      .options("/api/auth/login")
      .set("Origin", "https://untrusted.example");
    expect(rejected.status).toBe(403);
  });
});
