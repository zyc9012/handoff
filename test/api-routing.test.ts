import { describe, expect, it } from "vitest";
import { api } from "../worker/api";

describe("API routing", () => {
  it("serves the health endpoint", async () => {
    const response = await api.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const response = await api.request("/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("does not dispatch unsupported methods to a controller", async () => {
    const response = await api.request("/tabs", { method: "PUT" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("returns controller validation errors as JSON", async () => {
    const response = await api.request("/auth/login", { method: "POST" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
  });
});
