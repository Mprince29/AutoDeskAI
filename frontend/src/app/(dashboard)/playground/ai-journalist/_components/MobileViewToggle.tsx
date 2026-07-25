"use client";

import React from "react";
import { ChevronLeft, History, Plus } from "lucide-react";
import Link from "next/link";

interface MobileViewToggleProps {
  view: "chat" | "editor";
  setView: (v: "chat" | "editor") => void;
  onNewChat: () => void;
  onHistoryOpen: () => void;
}

export function MobileViewToggle({ view, setView, onNewChat, onHistoryOpen }: MobileViewToggleProps) {
  return (
    <div className="md:hidden w-full flex items-center justify-between border-b border-border/10 bg-background/60 backdrop-blur-2xl px-3 py-2 gap-2">
      {/* Back Button */}
      <Link
        href="/playground"
        className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-surface/50 border border-border/40 text-muted hover:text-foreground transition-all active:scale-95"
      >
        <ChevronLeft size={18} />
      </Link>

      {/* Center Toggle */}
      <div className="relative flex bg-surface/30 p-1 rounded-xl flex-1 max-w-[200px] items-center border border-border/40 overflow-hidden shadow-inner shadow-black/5">
        <div 
          className={`absolute top-1 bottom-1 w-[calc(50%-2px)] bg-primary rounded-lg transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-lg shadow-primary/20 ${
            view === "chat" ? "left-1" : "left-[calc(50%+1px)]"
          }`} 
        />
        {(["chat", "editor"] as const).map((v) => (
          <button 
            key={v} 
            onClick={() => setView(v)} 
            className={`relative z-10 flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all duration-500 ${
              view === v ? "text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {v === "chat" ? "Chat" : "Editor"}
          </button>
        ))}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onHistoryOpen}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface/50 border border-border/40 text-muted hover:text-foreground transition-all active:scale-95"
        >
          <History size={16} />
        </button>
        <button
          onClick={onNewChat}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-primary text-white transition-all active:scale-95"
        >
          <Plus size={16} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
