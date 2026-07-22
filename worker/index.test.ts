import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Crisis Mesh Worker", () => {
  it("responds to health checks", async () => {
    const response = await SELF.fetch("https://example.com/health");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
