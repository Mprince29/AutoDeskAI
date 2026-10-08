import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiService } from "@/services/api";
import { ApiClient } from "@/lib/api-client";

describe("API authorization headers", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("access_token", "test.jwt.token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve("{}"),
    }));
  });

  it("preserves Authorization when ApiService callers provide headers", async () => {
    await apiService.updatePreferences("user@example.com", { last_visited_path: "/chat" });

    const [, request] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(request.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test.jwt.token",
    });
  });

  it("preserves Authorization when ApiClient callers provide headers", async () => {
    const client = new ApiClient();
    await client.request("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const [, request] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(request.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test.jwt.token",
    });
  });
});
