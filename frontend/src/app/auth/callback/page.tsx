"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    const userJson = searchParams.get("user");

    if (!token || !userJson) {
      router.push("/auth");
      return;
    }

    try {
      const user = JSON.parse(userJson);
      // Always persist the callback token. A stale user object may already be
      // in memory while its access token is missing or expired.
      localStorage.setItem("access_token", token);
      localStorage.setItem("user_info", JSON.stringify(user));
      login(user, token);
      // Force a clean provider initialization so the first API request reads
      // the newly stored bearer token instead of racing the client transition.
      window.location.replace("/chat");
    } catch (e) {
      console.error("Failed to parse user during SSO:", e);
      router.push("/auth?error=sso_failed");
    }
  }, [searchParams, login, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-dark/60 font-medium tracking-tight">
          Completing secure sign-in...
        </p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
