"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { User, Building2, Sparkles } from "lucide-react";

const NAV_TABS = [
  { id: "profile", label: "My Profile", href: "/settings", icon: User },
  { id: "integrations", label: "Connected Apps", href: "/settings/integrations", icon: Building2 },
  { id: "ai", label: "AI Settings", href: "/settings/ai", icon: Sparkles },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col md:flex-row h-full w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="md:w-[260px] border-r border-border/40 md:flex-shrink-0 md:h-full flex flex-col bg-surface/30 backdrop-blur-sm">
        {/* Header - desktop only */}
        <div className="hidden md:flex items-center px-4 h-[50px] border-b border-border/20">
          <span className="text-[11px] font-extrabold tracking-[0.15em] text-foreground/50 uppercase">Settings</span>
        </div>
        
        {/* Nav - horizontal scroll on mobile, vertical on md+ */}
        <nav className="flex md:flex-col p-3 gap-1 overflow-x-auto md:overflow-x-visible">
          {NAV_TABS.map(tab => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.id}
                id={tab.id === 'integrations' ? 'connected-apps-tab' : tab.id === 'ai' ? 'ai-settings-tab' : undefined}
                href={tab.href}
                className={`
                  group flex items-center whitespace-nowrap gap-3.5 px-3.5 py-2.5 rounded-xl transition-all duration-200 no-underline
                  ${active 
                    ? "bg-primary/10 text-primary shadow-[0_2px_12px_rgba(var(--primary-rgb),0.08)]" 
                    : "text-muted-dark hover:bg-surface/60 hover:text-foreground"
                  }
                `}
              >
                <div className={`
                  flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200
                  ${active 
                    ? "bg-primary text-white shadow-sm shadow-primary/20 scale-105" 
                    : "bg-surface group-hover:bg-surface-hover text-muted group-hover:text-foreground"
                  }
                `}>
                  <tab.icon size={14} />
                </div>
                <span className={`text-[13px] tracking-tight ${active ? "font-bold" : "font-medium"}`}>
                  {tab.label}
                </span>
                
                {active && (
                   <div className="ml-auto w-1 h-1 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 h-full overflow-y-auto bg-background/50 custom-scrollbar p-4">
        {/* Section title & description */}
        <header className="mb-8 animate-fade-in">
          <div className="flex items-center gap-4 mb-2">
             <div className="w-1.5 h-6 rounded-full bg-primary/80 shadow-[0_0_12px_var(--primary)]" />
             <h2 className="text-2xl font-black tracking-tighter text-foreground">
               {NAV_TABS.find(t => pathname === t.href)?.label || "Settings"}
             </h2>
          </div>
          <p className="text-[13px] text-muted-dark max-w-2xl leading-relaxed ml-5 font-medium opacity-80">
             {pathname === "/settings" && "Customise your personal identity, communication tone, and account preferences."}
             {pathname === "/settings/integrations" && "Connect your digital workspace. Authorise Slack, Notion, and Google integrations."}
             {pathname === "/settings/ai" && "Power your agents with premium models. Manage API keys and cost optimisation."}
          </p>
        </header>
        
        <div className="w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
