"use client";
import { toastError } from "@/lib/friendly-errors";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiService, AgentBlueprint } from "@/services/api";
import { useRouter } from "next/navigation";
import { useAgentStore } from "@/store/agentStore";
import { ConfirmationModal } from "@/components/shared/ConfirmationModal";
import {
  Bot,
  Plus,
  Trash2,
  MessageSquare,
  Loader2,
  BookOpen,
  Zap,
  AlertCircle,
  Brain,
  Sparkles,
  Lock,
  Key,
  Edit,
  Settings,
  XCircle,
  Terminal,
  MessageCircle,
  BarChart2,
  ShieldAlert,
  Globe,
} from "lucide-react";
import { toast } from "react-hot-toast";

// Status dot colors cycling
const DOT_COLORS = ['var(--primary)', '#7F77DD', '#BA7517', '#378ADD', '#E11D48'];

interface AgentItem {
  id: number;
  name: string;
  role: string;
  description: string;
  industry?: string;
  benchmark_score?: number | null;
  quality_score?: number | null;
  has_rag?: boolean;
  created_at?: string | null;
  gating_policy?: { requires_approval?: boolean; required_credentials?: string[] } | null;
  is_default?: boolean;
}

function ScoreBar({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--error)';
  return (
    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function AgentsGalleryPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [blueprints, setBlueprints] = useState<AgentBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [editingAgent, setEditingAgent] = useState<AgentItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", role: "", industry: "" });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const loadAgents = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [result, bpRes] = await Promise.all([
        apiService.getUserCreatedAgents(user.email),
        apiService.getAgentBlueprints().catch(() => ({ blueprints: [] }))
      ]);
      const HIDDEN_AGENT_NAMES = new Set([
        "file manager", "task manager", "communication simulator",
        "negotiation advisor", "meeting intelligence",
      ]);
      const list: AgentItem[] = (result.agents || []).filter((a: { name: string }) =>
        !HIDDEN_AGENT_NAMES.has(a.name.toLowerCase())
      ).map((a: { id: number; name: string; role: string; description: string; industry?: string; benchmark_score?: number | null; research_context?: { quality_score?: number }; has_rag?: boolean; agent_config?: { gating_policy?: { requires_approval?: boolean; required_credentials?: string[] } | null }; created_at?: string | null; is_default?: boolean }) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        description: a.description,
        industry: a.industry,
        benchmark_score: a.benchmark_score ?? null,
        quality_score: a.research_context?.quality_score ?? null,
        has_rag: a.has_rag ?? false,
        gating_policy: a.agent_config?.gating_policy ?? null,
        created_at: a.created_at ?? null,
        is_default: a.is_default ?? false,
      }));
      setAgents(list);
      setBlueprints(bpRes.blueprints || []);
    } catch {
      setError("Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) loadAgents();
  }, [user, loadAgents]);

  const handleDelete = async (agentId: number, isDefault?: boolean) => {
    if (isDefault) return;
    if (!user) return;
    setDeleting(agentId);
    try {
      await apiService.deleteUserAgent(user.email, agentId);
      // Update local state
      setAgents(prev => prev.filter(a => a.id !== agentId));
      // Sync with global store (sidebar)
      useAgentStore.getState().removeAgent(agentId);
    } catch {
      setError("Failed to delete agent.");
    } finally {
      setDeleting(null);
      setDeleteConfirmId(null);
    }
  };

  const handleEditSave = async () => {
    if (!user || !editingAgent) return;
    setIsSavingEdit(true);
    try {
      const result = await apiService.updateUserAgent(user.email, editingAgent.id, editForm);
      if (result?.cloned) {
        await loadAgents();
      } else {
        setAgents(prev => prev.map(a => a.id === editingAgent.id ? { ...a, ...editForm } : a));
      }
      setEditingAgent(null);
    } catch {
      toastError("Failed to update agent.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (!user) return null;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar" style={{ background: 'var(--surface)' }}>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* Page header */}
        <div className="flex items-start sm:items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-[18px] font-semibold" style={{ color: 'var(--foreground)' }}>My AI Team</h1>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>Specialized AI assistants for your business.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => router.push("/agents/agent-build")} className="btn-secondary flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" />
              Fast Create
            </button>
            <button onClick={() => router.push("/agents/create")} className="btn-primary">
              <Plus className="w-3.5 h-3.5" />
              Add Assistant
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 mb-5 rounded-lg text-[12px]" style={{ background: 'rgba(220,38,38,0.06)', border: '0.5px solid var(--error)', color: 'var(--error)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--background)', border: '0.5px dashed var(--border-light)' }}>
              <Bot className="w-7 h-7" style={{ color: 'var(--muted)' }} />
            </div>
            <h2 className="text-[16px] font-medium mb-2" style={{ color: 'var(--foreground)' }}>No assistants yet</h2>
            <p className="text-[12px] max-w-sm mb-6" style={{ color: 'var(--muted)' }}>
              Create your first specialized assistant. The AI researches and builds a specialist for you.
            </p>
            <div className="flex gap-3">
              <button onClick={() => router.push("/agents/agent-build")} className="btn-secondary flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" />
                Fast Create
              </button>
              <button onClick={() => router.push("/agents/create")} className="btn-primary">
                <Zap className="w-3.5 h-3.5" />
                Custom Create
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent, i) => {
              const dotColor = DOT_COLORS[i % DOT_COLORS.length];
              const bp = blueprints.find(b => b.blueprint_id === agent.role || agent.role.includes(b.archetype_name));
              const AgentIcon = bp?.icon === "Terminal" ? Terminal : bp?.icon === "MessageCircle" ? MessageCircle : bp?.icon === "BarChart2" ? BarChart2 : bp?.icon === "ShieldAlert" ? ShieldAlert : bp?.icon === "BookOpen" ? BookOpen : bp?.icon === "Globe" ? Globe : Bot;

              return (
                <div
                  key={agent.id}
                  className="agent-card flex flex-col gap-3 group"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: dotColor }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-[13px] font-medium truncate" style={{ color: 'var(--foreground)' }}>{agent.name}</h3>
                          <span className="badge-neutral flex-shrink-0">{agent.is_default ? 'Default' : 'Custom'}</span>
                        </div>
                        {agent.industry && (
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{agent.industry}</p>
                        )}
                      </div>
                    </div>
                    {!agent.is_default && (
                      <button
                        onClick={() => setDeleteConfirmId(agent.id)}
                        disabled={deleting === agent.id}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        style={{ color: 'var(--muted)' }}
                      >
                        {deleting === agent.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>

                  {/* Description */}
                  {agent.description && (
                    <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: 'var(--muted-dark)' }}>
                      {agent.description}
                    </p>
                  )}

                  {/* Scores */}
                  {(agent.benchmark_score != null || agent.quality_score != null) && (
                    <div className="space-y-1.5">
                      {agent.benchmark_score != null && (
                        <div>
                          <div className="flex justify-between mb-0.5">
                            <span className="text-[10px]" style={{ color: 'var(--muted)' }}>Skill Level</span>
                            <span className="text-[10px] font-medium" style={{ color: 'var(--foreground)' }}>{Math.round(agent.benchmark_score * 100)}%</span>
                          </div>
                          <ScoreBar score={agent.benchmark_score} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 mt-auto pt-2" style={{ borderTop: '0.5px solid var(--border)' }}>
                    {agent.has_rag && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded badge-green">
                        <BookOpen className="w-2.5 h-2.5" /> Linked Files
                      </span>
                    )}
                    {agent.gating_policy?.requires_approval && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded badge-warn">
                        <Lock className="w-2.5 h-2.5" /> Approval
                      </span>
                    )}
                    {agent.gating_policy?.required_credentials?.map(c => (
                      <span key={c} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded badge-neutral">
                        <Key className="w-2.5 h-2.5" /> {c}
                      </span>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/chat?agent=${agent.id}`)}
                      className="btn-primary flex-1 py-1.5 text-[12px]"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Chat
                    </button>
                    {!agent.is_default && (
                      <button
                        onClick={() => router.push(`/agents/${agent.id}`)}
                        className="btn-secondary flex-1 py-1.5 text-[12px]"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Manage
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Create new card */}
            <button
              onClick={() => router.push("/agents/create")}
              className="flex flex-col items-center justify-center gap-3 rounded-xl cursor-pointer transition-all"
              style={{
                minHeight: 200, background: 'transparent',
                border: '0.5px dashed var(--border-light)',
                color: 'var(--muted)',
              }}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ border: '0.5px dashed var(--border-light)' }}>
                <Plus className="w-5 h-5" />
              </div>
              <span className="text-[12px] font-medium">Add New Assistant</span>
            </button>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingAgent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-xl flex flex-col max-h-[90vh] overflow-hidden" style={{ background: 'var(--background)', border: '0.5px solid var(--border-light)' }}>
            <div className="flex items-center justify-between p-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <Edit className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                <h2 className="text-[14px] font-medium" style={{ color: 'var(--foreground)' }}>Edit Agent</h2>
              </div>
              <button onClick={() => setEditingAgent(null)} style={{ color: 'var(--muted)' }}>
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {(['name', 'industry', 'role'] as const).map(field => (
                <div key={field}>
                  <label className="block text-[11px] font-medium mb-1.5 capitalize" style={{ color: 'var(--muted)' }}>{field}</label>
                  <input
                    type="text"
                    value={editForm[field]}
                    onChange={e => setEditForm(prev => ({ ...prev, [field]: e.target.value }))}
                    className="input-os"
                  />
                </div>
              ))}
              <div>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Description</label>
                <textarea
                  value={editForm.description}
                  onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  className="input-os resize-none"
                  rows={4}
                />
              </div>
            </div>

            <div className="p-4 flex justify-end gap-3" style={{ borderTop: '0.5px solid var(--border)' }}>
              <button onClick={() => setEditingAgent(null)} className="btn-secondary" disabled={isSavingEdit}>Cancel</button>
              <button onClick={handleEditSave} className="btn-primary" disabled={isSavingEdit || !editForm.name.trim()}>
                {isSavingEdit ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        title="Delete Assistant"
        description="Are you sure you want to delete this assistant? This action cannot be undone and all associated knowledge will be removed."
        confirmText="Delete"
        variant="destructive"
        isLoading={deleting !== null}
      />
    </div>
  );
}
