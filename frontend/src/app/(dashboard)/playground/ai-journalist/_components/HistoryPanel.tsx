"use client";

import React, { useMemo } from "react";
import { X, FileText, Trash2, Clock, ChevronRight, Search, Layers } from "lucide-react";
import { SessionEntry } from "@/types/journalist.types";
import { format } from "date-fns";

interface HistoryPanelProps {
  sessions: SessionEntry[];
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: number) => void;
  inline?: boolean;
}

export default function HistoryPanel({
  sessions,
  isOpen,
  onClose,
  onSelect,
  onDelete,
  inline = false,
}: HistoryPanelProps) {
  const [searchQuery, setSearchQuery] = React.useState("");

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    return sessions.filter(s =>
      s.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sessions, searchQuery]);

  // Group sessions by date
  const groups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const grouped: { title: string; items: SessionEntry[] }[] = [
      { title: "Today", items: [] },
      { title: "Yesterday", items: [] },
      { title: "Earlier", items: [] },
    ];

    filteredSessions.forEach(session => {
      const date = new Date(session.created_at);
      if (date >= today) grouped[0].items.push(session);
      else if (date >= yesterday) grouped[1].items.push(session);
      else grouped[2].items.push(session);
    });

    return grouped.filter(g => g.items.length > 0);
  }, [filteredSessions]);

  if (!isOpen) return null;

  const content = (
    <div className={`${inline ? "flex-1" : "relative w-full max-w-[400px] h-full"} bg-[var(--bg-primary)] border-border shadow-2xl flex flex-col ${inline ? "" : "border-r animate-in slide-in-from-left duration-500 ease-out"}`}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[var(--bg-secondary)]/30">
        <div>
          <h1 className="text-[20px] font-bold text-[var(--text-primary)] tracking-tight">History</h1>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] transition-all"
        >
          <X size={20} />
        </button>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-border bg-[var(--bg-primary)]">
        <div className="relative group">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] group-focus-within:text-[var(--primary)] transition-colors" />
          <input
            type="text"
            placeholder="Search sessions by topic or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-secondary)] border border-border rounded-xl text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] transition-all placeholder:text-[var(--text-tertiary)]/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {groups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center mb-4">
              <FileText size={24} className="text-[var(--text-tertiary)]" />
            </div>
            <p className="text-[14px] text-[var(--text-secondary)]">No sessions found in archives.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <div key={group.title}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{group.title}</span>
                  <div className="flex-1 h-px bg-border/50" />
                </div>
                <div className="space-y-3">
                  {group.items.map((session) => (
                    <div
                      key={session.session_id || session.latest_report_id}
                      className="group relative bg-(--bg-secondary)/50 border border-border rounded-2xl p-4 hover:border-[var(--primary)]/50 hover:bg-[#F8F7FF] dark:hover:bg-[#1C1844] transition-all cursor-pointer overflow-hidden"
                      onClick={() => onSelect(`report-${session.latest_report_id}`)}
                    >
                      {/* Status bar */}
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-(--primary) opacity-0 group-hover:opacity-100 transition-all" />

                      <div className="flex justify-between items-start gap-3 mb-2">
                        <p className="text-xs text-(--text-primary) leading-snug line-clamp-2">
                          {session.topic}
                        </p>
                        {session.version_count > 1 && (
                          <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--primary)]/10 text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider border border-[var(--primary)]/20">
                            <Layers size={9} />
                            {session.version_count}v
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-auto">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] border border-border text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
                          <Clock size={10} strokeWidth={3} />
                          {format(new Date(session.created_at), 'HH:mm')}
                        </div>
                        <span className="text-[10px] text-(--primary) uppercase">{session.category}</span>
                      </div>

                      <div className="absolute right-4 bottom-4 transition-transform group-hover:translate-x-1">
                        <ChevronRight size={14} className="text-(--text-tertiary) group-hover:text-(--primary)" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div className="fixed inset-0 z-50 flex justify-start">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      {content}
    </div>
  );
}
