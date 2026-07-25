"use client";
import React from 'react';
import { Inbox, User, FileText, Calendar, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';

export type TabId = 'main_inbox' | 'personal_section' | 'newsletter_section' | 'meeting_section' | 'important_section';

interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ElementType;
  color: string;
}

const TABS: TabConfig[] = [
  { id: 'main_inbox', label: 'Primary', icon: Inbox, color: 'text-primary' },
  { id: 'important_section', label: 'Important', icon: Sparkles, color: 'text-warning' },
  { id: 'personal_section', label: 'Social', icon: User, color: 'text-success' },
  { id: 'newsletter_section', label: 'Promotions', icon: FileText, color: 'text-muted' },
];

interface EmailTabsProps {
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  unseenCounts?: Record<string, number>;
}

export default function EmailTabs({ activeTab, onTabChange, unseenCounts }: EmailTabsProps) {
  return (
    <div className="flex items-center border-b border-border/10 overflow-x-auto no-scrollbar bg-background/50 backdrop-blur-md sticky top-0 z-10 w-full">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={clsx(
              "flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 transition-all relative min-w-fit sm:min-w-[160px] group shrink-0",
              isActive ? tab.color : "text-muted hover:bg-surface/30 hover:text-foreground"
            )}
          >
            <Icon className={clsx("w-4 h-4", isActive ? "fill-current/10" : "")} />
            <div className="flex flex-col items-start min-w-0">
              <span className="text-xs sm:text-[13px] font-bold tracking-tight whitespace-nowrap">{tab.label}</span>
              {unseenCounts?.[tab.id] ? (
                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest opacity-60">
                  {unseenCounts[tab.id]} New
                </span>
              ) : (
                <span className="hidden sm:block text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-40 transition-opacity">
                  View All
                </span>
              )}
            </div>

            {isActive && (
              <motion.div
                layoutId="activeTab"
                className={clsx("absolute bottom-0 left-0 right-0 h-0.5", tab.color.replace('text-', 'bg-'))}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
