"use client";

import React, { useState } from "react";
import { Plus, Edit, Trash2, Loader2, Zap, Bot, ChevronDown, ArrowRight, Search, Filter, Clock, Users, Sidebar, PanelLeft, ChevronLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const AGENT_COLORS = [
  '#10B981', // emerald
  '#3B82F6', // blue
  '#F59E0B', // amber
  '#8B5CF6', // purple
  '#F43F5E', // rose
];

import { Agent } from "@/types/agent.types";

import { TOOLS, type Tool } from "@/constants/tools-list";

type AgentFilter = 'all' | 'system' | 'custom' | 'tools';

const FILTER_OPTIONS: { value: AgentFilter; label: string }[] = [
  { value: 'all', label: 'All Assistants' },
  { value: 'system', label: 'Built-in Assistants' },
  { value: 'custom', label: 'My Assistants' },
  { value: 'tools', label: 'Tools' },
];


function AgentCard({
  agent,
  color,
  isSelected,
  deletingId,
  onSelect,
  onEdit,
  onDelete,
}: {
  agent: Agent;
  color: string;
  isSelected?: boolean;
  deletingId: string | null;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isActive = hovered || isSelected;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 12px', borderRadius: 10,
        border: `0.5px solid ${isActive ? color + '40' : 'var(--border-light)'}`,
        background: isSelected ? color + '15' : (hovered ? color + '08' : 'var(--surface)'),
        boxShadow: isSelected ? `0 0 0 1px ${color}20` : 'none',
        cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <div style={{
            width: isSelected ? 8 : 7,
            height: isSelected ? 8 : 7,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
            boxShadow: isSelected ? `0 0 8px ${color}` : 'none',
            transition: 'all 0.2s'
          }} />
          <span style={{
            fontSize: 13,
            fontWeight: isSelected ? 600 : 500,
            color: isSelected ? color : 'var(--foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            transition: 'color 0.2s'
          }}>
            {agent.name}
          </span>
        </div>

        {/* Edit / delete - only for custom agents, shown on hover */}
        {!agent.is_default && hovered && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onEdit(); }}
              title="Edit"
              style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
            >
              <Edit style={{ width: 11, height: 11 }} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              title="Remove"
              style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#F87171')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
            >
              {deletingId === agent.id ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Trash2 style={{ width: 11, height: 11 }} />}
            </button>
          </div>
        )}
      </div>

      {agent.description && (
        <p className="line-clamp-3" style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8, overflow: 'hidden' }}>
          {agent.description}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
        <span style={{ fontSize: 11, color: isSelected ? color + '90' : 'var(--muted)' }}>
          {agent.is_default ? 'Built-in' : 'Custom'}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color, display: 'flex', alignItems: 'center', gap: 3 }}>
          <Zap style={{ width: 10, height: 10, fill: isSelected ? color : 'none' }} /> {isSelected ? 'Active' : 'Chat'}
        </span>
      </div>
    </div>
  );
}

export function AgentFleetList({
  agents,
  onEditAgent,
  onDeleteAgent,
  onSelectAgent,
  selectedAgentId,
  deletingId,
  contactsOpen,
  onToggleContacts,
  isLoading = false,
  onNewChat,
  sessions,
  onLoadSession,
  currentSessionId,
  onDeleteSession,
  sessionsLoading = false,
  onToggleSidebar,
}: {
  agents: Agent[];
  agentTab: AgentFilter;
  onTabChange: (tab: AgentFilter) => void;
  onEditAgent: (agent: Agent) => void;
  onDeleteAgent: (id: string) => void;
  onSelectAgent: (name: string) => void;
  selectedAgentId?: string | null;
  deletingId: string | null;
  contactsOpen?: boolean;
  onToggleContacts?: () => void;
  isLoading?: boolean;
  onNewChat?: () => void;
  sessions?: { id: number; title: string; updated_at: string | null; message_count: number }[];
  onLoadSession?: (sessionId: number) => void;
  currentSessionId?: number | null;
  onDeleteSession?: (sessionId: number, e: React.MouseEvent) => void;
  sessionsLoading?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}) {
  const router = useRouter();
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    history: false,
    system: true,
    custom: false,
    tools: false
  });

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      system: cat === 'system' ? !prev.system : false,
      custom: cat === 'custom' ? !prev.custom : false,
      tools: cat === 'tools' ? !prev.tools : false
    }));
  };

  const systemAgents = agents.filter(a => a.is_default || a.role === 'Default' || a.role === 'System');
  const customAgents = agents.filter(a => !(a.is_default || a.role === 'Default' || a.role === 'System'));

  return (
    <div className="lg:col-span-1 flex flex-col h-full overflow-hidden border-r border-border/60 bg-background">
      <div className="p-3 pb-0 flex items-center justify-between gap-3">
        <button
          onClick={onNewChat}
          title="New Chat"
          className="flex items-center gap-1.5 h-8 px-2 rounded-lg text-xs font-semibold transition-all border bg-surface/50 border-border/40 text-muted hover:border-primary/40 hover:text-foreground hover:bg-surface-hover group w-full justify-center"
        >
          <Plus className="w-3.5 h-3.5 group-hover:text-primary transition-colors" />
          <span>New Chat</span>
        </button>

        <button title={expandedCategories ? "Close Sidebar" : "Open Sidebar"} onClick={onToggleSidebar} className="md:flex hidden border border-border/40 p-1 rounded-lg">
          <ChevronLeft strokeWidth={1} className="w-5 h-5 text-muted hover:text-primary " />
        </button>
      </div>

      <div className="flex-1 mt-2 overflow-y-auto hide-scrollbar">
        {/* Built-in Accordion */}
        <div className="px-3 py-1">
          <button
            onClick={() => toggleCategory('system')}
            className="flex items-center justify-between w-full py-2 hover:bg-surface-dark rounded-lg px-2 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Bot className="w-3.5 h-3.5 text-muted group-hover:text-primary transition-colors" />
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Built-in Assistants</span>
            </div>
            <ChevronDown className={cn(
              "w-3 h-3 text-muted/60 transition-transform duration-200",
              expandedCategories.system ? "rotate-0" : "-rotate-90"
            )} />
          </button>
          <AnimatePresence>
            {expandedCategories.system && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 py-2 max-h-[350px] overflow-y-auto hide-scrollbar pr-1">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="animate-pulse"
                        style={{
                          padding: '10px 12px', borderRadius: 10,
                          border: '0.5px solid var(--border-light)',
                          background: 'var(--surface)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--muted)', opacity: 0.3 }} />
                            <div style={{ height: 10, width: 80, background: 'var(--muted)', opacity: 0.2, borderRadius: 4 }} />
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ height: 8, width: '100%', background: 'var(--muted)', opacity: 0.1, borderRadius: 3, marginBottom: 4 }} />
                          <div style={{ height: 8, width: '60%', background: 'var(--muted)', opacity: 0.1, borderRadius: 3 }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                          <div style={{ height: 8, width: 40, background: 'var(--muted)', opacity: 0.1, borderRadius: 3 }} />
                          <div style={{ height: 8, width: 30, background: 'var(--muted)', opacity: 0.1, borderRadius: 3 }} />
                        </div>
                      </div>
                    ))
                  ) : (
                    systemAgents.map((agent, i) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        color={AGENT_COLORS[i % AGENT_COLORS.length]}
                        isSelected={selectedAgentId === agent.id}
                        deletingId={deletingId}
                        onSelect={() => onSelectAgent(agent.name)}
                        onEdit={() => onEditAgent(agent)}
                        onDelete={() => onDeleteAgent(agent.id)}
                      />
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Custom Assistants Accordion */}
        <div className="px-3 py-1">
          <div className="flex items-center justify-between">
            <button
              onClick={() => toggleCategory('custom')}
              className="flex items-center justify-between flex-1 py-2 hover:bg-surface-dark rounded-lg px-2 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted group-hover:text-primary transition-colors" />
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">My Assistants</span>
              </div>
              <ChevronDown className={cn(
                "w-3 h-3 text-muted/60 transition-transform duration-200",
                expandedCategories.custom ? "rotate-0" : "-rotate-90"
              )} />
            </button>
            <button
              onClick={() => onEditAgent({ id: 'new', name: '', description: '', role: '', industry: '', status: 'idle', isActive: true })}
              className="p-1.5 rounded-md bg-primary text-white hover:text-primary transition-all ml-1"
              title="Add New"
            >
              <Plus strokeWidth={3} className="w-3 h-3" />
            </button>
          </div>
          <AnimatePresence>
            {expandedCategories.custom && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 py-2">
                  {isLoading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div
                        key={i}
                        className="animate-pulse"
                        style={{
                          padding: '10px 12px', borderRadius: 10,
                          border: '0.5px solid var(--border-light)',
                          background: 'var(--surface)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--muted)', opacity: 0.3 }} />
                            <div style={{ height: 10, width: 80, background: 'var(--muted)', opacity: 0.2, borderRadius: 4 }} />
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ height: 8, width: '100%', background: 'var(--muted)', opacity: 0.1, borderRadius: 3, marginBottom: 4 }} />
                          <div style={{ height: 8, width: '60%', background: 'var(--muted)', opacity: 0.1, borderRadius: 3 }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                          <div style={{ height: 8, width: 40, background: 'var(--muted)', opacity: 0.1, borderRadius: 3 }} />
                          <div style={{ height: 8, width: 30, background: 'var(--muted)', opacity: 0.1, borderRadius: 3 }} />
                        </div>
                      </div>
                    ))
                  ) : customAgents.length === 0 ? (
                    <span className="text-[10px] text-muted text-center py-2 italic">No custom assistants yet</span>
                  ) : (
                    customAgents.map((agent, i) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        color={AGENT_COLORS[(i + 2) % AGENT_COLORS.length]}
                        isSelected={selectedAgentId === agent.id}
                        deletingId={deletingId}
                        onSelect={() => onSelectAgent(agent.name)}
                        onEdit={() => onEditAgent(agent)}
                        onDelete={() => onDeleteAgent(agent.id)}
                      />
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Tools Accordion */}
        <div className="px-3 py-1">
          <button
            onClick={() => toggleCategory('tools')}
            className="flex items-center justify-between w-full py-2 hover:bg-surface-dark rounded-lg px-2 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-muted group-hover:text-primary transition-colors" />
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Tools</span>
            </div>
            <ChevronDown className={cn(
              "w-3 h-3 text-muted/60 transition-transform duration-200",
              expandedCategories.tools ? "rotate-0" : "-rotate-90"
            )} />
          </button>
          <AnimatePresence>
            {expandedCategories.tools && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 py-2">
                  {TOOLS.map(tool => {
                    const Icon = tool.icon;
                    return (
                      <div
                        key={tool.id}
                        onClick={() => router.push(tool.href)}
                        className="flex flex-col gap-1 p-2.5 rounded-lg border border-border/40 bg-surface/30 cursor-pointer hover:border-primary/30 hover:bg-surface/50 transition-all"
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="w-3 h-3" style={{ color: tool.color }} />
                          <span className="text-[11px] font-semibold">{tool.label}</span>
                        </div>
                        <p className="text-[10px] text-muted leading-relaxed">{tool.description}</p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            Built-in
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: tool.color, display: 'flex', alignItems: 'center', gap: 3 }}>
                            Open <ArrowRight style={{ width: 10, height: 10 }} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Recent History List - Always Open */}
        <div className="px-3 py-2 flex flex-col gap-1 bg-surface/5">
          <div className="flex items-center gap-2 px-2 py-1">
            <Clock className="w-3.5 h-3.5 text-muted" />
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Recent Activity</span>
          </div>
          {sessionsLoading ? (
            <div className="flex flex-col gap-0.5 px-2 py-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-2 rounded-lg bg-surface/10 animate-pulse">
                  <div className="h-5 w-full max-w-[200px] bg-muted/20 rounded" />
                </div>
              ))}
            </div>
          ) : sessions && sessions.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {sessions.slice(0, 10).map(session => {
                const isActive = session.id === currentSessionId;
                return (
                  <div
                    key={session.id}
                    onClick={() => onLoadSession?.(session.id)}
                    className={cn(
                      "group flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all",
                      isActive
                        ? "bg-primary/10 border border-primary/20 text-primary"
                        : "hover:bg-surface border border-transparent text-muted hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-xs font-medium">
                        {session.title || "Untitled Chat"}
                      </span>
                    </div>
                    <button
                      onClick={(e) => onDeleteSession?.(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/10 text-muted hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

