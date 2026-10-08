import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import { apiService } from "@/services/api";

// AuthContext's login/logout are the client-side half of the JWT auth fix:
// the backend now issues a real signed token instead of the literal string
// "mock-jwt-token", and this context is what stores/clears it for every
// subsequent request (via services/api.ts reading localStorage).

function Probe() {
  const { user, token, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="token">{token ?? "none"}</span>
      <span data-testid="email">{user?.email ?? "none"}</span>
      <button onClick={() => login({ email: "user@example.com", name: "Test" } as any, "real.jwt.token")}>
        login
      </button>
      <button onClick={() => login({ email: "new@example.com", name: "New" } as any, "new.jwt.token")}>
        login-new
      </button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
  });

  it("stores the token and user in localStorage on login", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText("login").click();
    });

    expect(screen.getByTestId("token").textContent).toBe("real.jwt.token");
    expect(screen.getByTestId("email").textContent).toBe("user@example.com");
    expect(localStorage.getItem("access_token")).toBe("real.jwt.token");
    expect(JSON.parse(localStorage.getItem("user_info")!).email).toBe("user@example.com");
  });

  it("clears the token and user from localStorage on logout", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText("login").click();
    });
    await act(async () => {
      screen.getByText("logout").click();
    });

    expect(screen.getByTestId("token").textContent).toBe("none");
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(localStorage.getItem("user_info")).toBeNull();
  });

  it("does not let a stale preferences 401 log out a newer session", async () => {
    let rejectOldRequest!: (error: Error) => void;
    const oldRequest = new Promise<never>((_, reject) => {
      rejectOldRequest = reject;
    });
    const getPreferences = vi.spyOn(apiService, "getPreferences")
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValue({} as any);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText("login").click();
    });
    await act(async () => {
      screen.getByText("login-new").click();
    });

    await act(async () => {
      rejectOldRequest(new Error("Bearer authentication required"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("email").textContent).toBe("new@example.com");
    expect(localStorage.getItem("access_token")).toBe("new.jwt.token");
    getPreferences.mockRestore();
  });
});
