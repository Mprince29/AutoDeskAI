"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Header from "@/components/shared/Header";
import { useAuth } from "@/context/AuthContext";
import dynamic from "next/dynamic";


import { useOnboarding } from "@/hooks/useOnboarding";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, preferences, preferencesLoading, updatePreferences } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { resumeOnboarding } = useOnboarding();
  
  // Persistence state
  const hasRestoredRef = useRef(false);
  const lastSavedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      resumeOnboarding();
    }
  }, [user, resumeOnboarding]);

  // 1. Restore last visited page on first load
  useEffect(() => {
    // Wait until auth is initialized AND preferences have been fetched
    if (loading || preferencesLoading || !user) return;

    if (!hasRestoredRef.current) {
      // Define "generic" entry points that should trigger a restoration
      const isEntryPoint = pathname === "/chat";
      
      if (isEntryPoint && preferences?.last_visited_path && preferences.last_visited_path !== pathname) {
        hasRestoredRef.current = true;
        router.replace(preferences.last_visited_path);
      } else {
        // Either not an entry point, or no path to restore, or already on the correct path
        hasRestoredRef.current = true;
      }
    }
  }, [loading, preferencesLoading, user, preferences, pathname, router]);

  // 2. Track current page for session continuation (with debounce)
  useEffect(() => {
    if (!user || !pathname || pathname === "/" || pathname.includes("/auth")) return;
    
    // Don't save if it's the same as what we just restored or saved
    if (pathname === lastSavedPathRef.current) return;

    const timer = setTimeout(() => {
      updatePreferences({ last_visited_path: pathname })
        .then(() => {
          lastSavedPathRef.current = pathname;
        })
        .catch(() => {
          // Silent fail for persistence updates
        });
    }, 2000); // 2 second delay to avoid spamming on rapid navigation

    return () => clearTimeout(timer);
  }, [pathname, user, updatePreferences]);

if (loading) {
  return (
    <div className="relative h-screen overflow-hidden bg-background">
      
      {/* Ambient background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#999_1px,transparent_1px),linear-gradient(to_bottom,#999_1px,transparent_1px)] bg-[size:40px_40px]" />

      {/* Loader */}
      <div className="relative z-10 flex h-full items-center justify-center">
        
        <div className="w-full max-w-sm px-8">
          
          {/* Logo block */}
          <div className="flex flex-col items-center">
            
            <div className="relative flex items-center justify-center">
              
              {/* Rotating ring */}
              <div className="absolute h-24 w-24 rounded-full border border-primary/20 border-t-primary animate-spin" />

              {/* Inner card */}
              <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-2xl">
                
                {/* Pulse orb */}
                <div className="relative">
                  <div className="h-4 w-4 rounded-full bg-primary" />

                  <div className="absolute inset-0 rounded-full bg-primary animate-ping opacity-40" />
                </div>
              </div>
            </div>

            {/* Text */}
            <div className="mt-10 text-center">
              <h2 className="text-xl font-semibold tracking-tight">
                Loading AutoDeskAI
              </h2>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

  if (!user) {
    return null;
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
