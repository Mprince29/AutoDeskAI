"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiService, AgentBlueprint } from "@/services/api";
import { useRouter } from "next/navigation";
import {
  Terminal, MessageCircle, BarChart2, ShieldAlert, BookOpen, Globe,
  Zap, Loader2, AlertCircle, CheckCircle2, ArrowRight, Sparkles,
  LucideIcon, Lock, Key, ChevronRight,
} from "lucide-react";

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, LucideIcon> = {
  Terminal, MessageCircle, BarChart2, ShieldAlert, BookOpen, Globe,
};

// ── Blueprint card ────────────────────────────────────────────────────────────
function BlueprintCard({
  bp,
  selected,
  onClick,
}: {
  bp: AgentBlueprint;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = ICON_MAP[bp.icon] ?? Sparkles;
  const needsApproval = bp.gating_summary.toLowerCase().includes("approval");
  const needsCreds = bp.requires_credentials.length > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border transition-all duration-200 ${selected
        ? "border-primary bg-primary/8 shadow-[0_0_16px_var(--primary-glow)]"
        : "border-border bg-surface hover:border-primary/40 hover:bg-surface/80"
        }`}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className={`p-2 rounded-md border flex-shrink-0 ${bp.color_class}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground">{bp.archetype_name}</p>
          <p className="text-[11px] text-muted leading-tight mt-0.5 line-clamp-2">{bp.tagline}</p>
        </div>
        {selected && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 ml-auto" />}
      </div>

      {/* Capability pills */}
      <div className="flex flex-wrap gap-1 mb-2">
        {bp.suggested_capabilities.map((c, i) => (
          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-background border border-border text-muted">
            {c}
          </span>
        ))}
      </div>

      {/* Gating badges */}
      <div className="flex gap-1.5 flex-wrap">
        {needsApproval && (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border text-orange-400 border-orange-400/30 bg-orange-400/10">
            <Lock className="w-2.5 h-2.5" /> Needs Approval
          </span>
        )}
        {needsCreds && bp.requires_credentials.map(c => (
          <span key={c} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border text-yellow-400 border-yellow-400/30 bg-yellow-400/10">
            <Key className="w-2.5 h-2.5" /> {c}
          </span>
        ))}
        {!needsApproval && !needsCreds && (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border text-green-400 border-green-400/30 bg-green-400/10">
            <CheckCircle2 className="w-2.5 h-2.5" /> Self-contained
          </span>
        )}
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BuildAgentPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [blueprints, setBlueprints] = useState<AgentBlueprint[]>([]);
  const [loadingBP, setLoadingBP] = useState(true);
  const [selected, setSelected] = useState<AgentBlueprint | null>(null);
  const [prompt, setPrompt] = useState("");
  const [agentName, setAgentName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: number; name: string; capabilities: string[] } | null>(null);

  useEffect(() => {
    apiService.getAgentBlueprints()
      .then(r => setBlueprints(r.blueprints))
      .catch(() => setBlueprints([]))
      .finally(() => setLoadingBP(false));
  }, []);

  const handleSelectBlueprint = (bp: AgentBlueprint) => {
    setSelected(bp);
    if (!prompt || blueprints.some(b => b.sample_prompts.includes(prompt))) {
      setPrompt(bp.sample_prompts[0] ?? "");
    }
    setError("");
  };

  const handleCreate = async () => {
    if (!user || !prompt.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = selected
        ? await apiService.createAgentFromBlueprint(user.email, selected.blueprint_id, prompt, agentName || undefined)
        : await apiService.createAgentFromPrompt(user.email, prompt, agentName || undefined);

      if (res.success && res.agent) {
        setCreated({ id: res.agent.id, name: res.agent.name, capabilities: res.agent.capabilities ?? [] });
      } else {
        setError(res.message || "Creation failed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  if (!user) return null;

  // ── Success screen ──────────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="relative min-h-screen flex items-center justify-center py-12">
        <div className="card max-w-md w-full text-center p-8 space-y-4">
          <div className="mx-auto w-16 h-16 flex items-center justify-center rounded-full bg-success/10 border border-success/30">
            <CheckCircle2 className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Agent Ready!</h2>
          <p className="text-muted text-sm">
            <span className="text-foreground font-semibold">{created.name}</span> has been created.
          </p>
          {created.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center">
              {created.capabilities.slice(0, 5).map((c, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary">{c}</span>
              ))}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => router.push(`/chat?agent=${created.id}`)}
              className="flex-1 btn-primary"
            >
              <Zap className="w-4 h-4" /> Start Chatting
            </button>
            <button
              onClick={() => router.push("/agents")}
              className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted hover:text-foreground hover:border-primary/40 transition-colors"
            >
              View All Agents
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen py-8" style={{ background: 'var(--surface)' }}>
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-primary to-accent rounded-md shadow-lg">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Build an Agent</h1>
            <p className="text-muted text-sm">Pick a quick-start archetype or describe what you need</p>
          </div>
        </div>
        <button
          onClick={() => router.push("/agents/create")}
          className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:text-foreground hover:border-primary/40 transition-colors flex items-center gap-1.5"
        >
          Advanced Builder <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Left: Archetype cards ── */}
        <div className="lg:col-span-2 space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Quick Start Archetypes</p>
          {loadingBP ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : blueprints.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">Could not load blueprints.</p>
          ) : (
            blueprints.map(bp => (
              <BlueprintCard
                key={bp.blueprint_id}
                bp={bp}
                selected={selected?.blueprint_id === bp.blueprint_id}
                onClick={() => handleSelectBlueprint(bp)}
              />
            ))
          )}
        </div>

        {/* ── Right: Creation form ── */}
        <div className="lg:col-span-3">
          <div className="card p-6 space-y-5 sticky top-24">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">Customize & Create</p>

            {/* Selected blueprint badge */}
            {selected && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/8 border border-primary/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span className="text-sm text-primary font-medium">Starting from: {selected.archetype_name}</span>
                </div>
                <button
                  onClick={() => { setSelected(null); setPrompt(""); }}
                  className="text-xs text-muted hover:text-foreground transition-colors"
                >
                  × Clear
                </button>
              </div>
            )}

            {/* Agent name */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Agent Name (optional)</label>
              <input
                className="input-field w-full text-sm"
                placeholder="e.g. My Data Analyst"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
              />
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                What should this agent do? <span className="text-error">*</span>
              </label>
              <textarea
                className="input-field w-full text-sm resize-none"
                rows={5}
                placeholder={
                  selected
                    ? selected.sample_prompts[0]
                    : "Describe the agent's job in plain language…"
                }
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
              />
              {selected && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {selected.sample_prompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setPrompt(p)}
                      className="text-[10px] px-2 py-0.5 rounded bg-surface border border-border text-muted hover:text-foreground hover:border-primary/30 transition-colors"
                    >
                      {p.length > 45 ? p.slice(0, 45) + "…" : p}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Gating warnings */}
            {selected && (selected.gating_summary.toLowerCase().includes("approval") || selected.requires_credentials.length > 0) && (
              <div className="space-y-2">
                {selected.gating_summary.toLowerCase().includes("approval") && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-400/8 border border-orange-400/20 text-orange-400 text-xs">
                    <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {selected.gating_summary}
                  </div>
                )}
                {selected.requires_credentials.length > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-400/8 border border-yellow-400/20 text-yellow-400 text-xs">
                    <Key className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    Requires credentials: {selected.requires_credentials.join(", ")} - configure in Settings → Integrations.
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleCreate}
              disabled={creating || !prompt.trim()}
              className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating agent…</>
              ) : (
                <><Zap className="w-4 h-4" /> Create Agent <ArrowRight className="w-4 h-4 ml-auto" /></>
              )}
            </button>

            <p className="text-center text-[11px] text-muted">
              Need industry-specific depth?{" "}
              <button onClick={() => router.push("/agents/create")} className="text-primary hover:underline">
                Use Advanced Builder
              </button>
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
