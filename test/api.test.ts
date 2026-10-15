import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("API contracts", () => {
  it("exposes health and public source/news wrappers", async () => {
    const health = await request(app).get("/api/health"); expect(health.status).toBe(200); expect(health.body.ok).toBe(true);
    const sources = await request(app).get("/api/sources"); expect(sources.status).toBe(200); expect(Array.isArray(sources.body.sources)).toBe(true); expect(sources.body.sources.some((s: { telegramHandle?: string }) => s.telegramHandle === "@example_public_channel")).toBe(true);
    const news = await request(app).get("/api/news"); expect(news.status).toBe(200); expect(Array.isArray(news.body.items)).toBe(true); expect(typeof news.body.total).toBe("number");
  });
  it("protects admin session endpoint", async () => { const response = await request(app).get("/api/admin/session"); expect(response.status).toBe(401); expect(response.body.authenticated).toBe(false); });
  it("logs in and creates a source through the documented contract", async () => {
    const login = await request(app).post("/api/admin/login").send({ password: "test-password-only" });
    expect(login.status).toBe(200); expect(login.body.authenticated).toBe(true); expect(typeof login.body.token).toBe("string");
    const created = await request(app).post("/api/admin/sources").set("X-Admin-Token", login.body.token).send({
      name: "Test Telegram", type: "telegram_mtproto", telegramHandle: "@test_contract", originalLanguage: "fa", credibilityTier: "C", enabled: true, pollingIntervalMinutes: 5
    });
    expect(created.status).toBe(201); expect(created.body.source.telegramHandle).toBe("@test_contract");
  });
});
