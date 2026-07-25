"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useOutreachStore } from "./state/store";

export default function OutreachV2IndexPage() {
  const router = useRouter();
  const { user } = useAuth();
  const projects = useOutreachStore((state) => state.projects);
  const hydrateWorkspace = useOutreachStore((state) => state.hydrateWorkspace);
  const setUserEmail = useOutreachStore((state) => state.setUserEmail);

  useEffect(() => {
    if (!user?.email) return;
    setUserEmail(user.email);
    void hydrateWorkspace().catch(() => undefined);
  }, [hydrateWorkspace, setUserEmail, user?.email]);

  useEffect(() => {
    if (!projects[0]?.id) return;
    router.replace(`/playground/outreach-v2/${projects[0].id}/brief`);
  }, [projects, router]);

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-sm font-semibold text-muted-dark">
        <Loader2 size={18} className="animate-spin text-primary" />
        Loading outreach workspace...
      </div>
    </div>
  );
}
