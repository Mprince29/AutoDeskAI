"use client";
import React, { useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiService } from "@/services/api";
import { useRouter } from "next/navigation";
import {
  Brain,
  Sparkles,
  Globe,
  Building2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  X,
  ShieldCheck,
  FlaskConical,
  Circle,
  FileUp,
  Paperclip,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface FormData {
  task: string;
  industry: string;
  role: string;
  job_title: string;
  company_website: string;
  company_name: string;
  agent_name: string;
}

interface ProgressEvent {
  stage: string;
  progress: number;
  message: string;
  agent?: {
    id: number;
    name: string;
    role: string;
    industry: string;
    benchmark_score: number;
    quality_score: number;
    capabilities: string[];
  };
  error?: string;
}


// ── Quality preview bar (animates as optional fields are filled) ───────────────

function QualityPreview({ form }: { form: FormData }) {
  const score =
    (form.task ? 0.25 : 0) +
    (form.industry ? 0.25 : 0) +
    (form.role ? 0.12 : 0) +
    (form.job_title ? 0.08 : 0) +
    (form.company_website ? 0.18 : 0) +
    (form.company_name ? 0.12 : 0);
  const pct = Math.round(score * 100);
  const color = pct >= 75 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-primary";
  const label = pct >= 75 ? "Excellent" : pct >= 50 ? "Good" : pct >= 30 ? "Basic" : "Minimal";
  return (
    <div className="p-3 bg-surface border border-border rounded-md">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Predicted Accuracy</span>
        <span className="text-[10px] font-bold text-foreground">{label} - {pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-muted mt-1">Each optional field increases research depth and agent quality</p>
    </div>
  );
}

// ── DAG Pipeline Flow ──────────────────────────────────────────────────────────

type NodeState = "pending" | "active" | "done" | "error";

interface DagNode {
  id: string;
  label: string;
  icon: React.ElementType;
  minProgress: number;
  maxProgress: number;
  subStages?: { id: string; label: string; minProgress: number }[];
}

const DAG_NODES: DagNode[] = [
  {
    id: "research",
    label: "Searching Information",
    icon: Globe,
    minProgress: 0.05,
    maxProgress: 0.29,
  },
  {
    id: "brain",
    label: "Creating Assistant...",
    icon: Brain,
    minProgress: 0.30,
    maxProgress: 0.79,
    subStages: [
      { id: "brain.fuse", label: "Organizing Knowledge", minProgress: 0.30 },
      { id: "brain.rank", label: "Sorting Facts", minProgress: 0.40 },
      { id: "brain.compile", label: "Learning Roles", minProgress: 0.52 },
      { id: "brain.validate", label: "Checking Work", minProgress: 0.65 },
      { id: "brain.soul", label: "Finalizing Personality", minProgress: 0.78 },
    ],
  },
  {
    id: "quality",
    label: "Quality Gate",
    icon: ShieldCheck,
    minProgress: 0.80,
    maxProgress: 0.93,
  },
  {
    id: "benchmark",
    label: "Skill Test",
    icon: FlaskConical,
    minProgress: 0.94,
    maxProgress: 0.99,
  },
  {
    id: "done",
    label: "Assistant Ready",
    icon: CheckCircle2,
    minProgress: 1.0,
    maxProgress: 1.0,
  },
];

function nodeState(node: DagNode, progress: number, hasError: boolean): NodeState {
  if (hasError) return progress >= node.minProgress ? "error" : "pending";
  if (progress >= node.maxProgress + 0.01) return "done";
  if (progress >= node.minProgress) return "active";
  return "pending";
}

function subStageState(sub: { minProgress: number }, nextMinProgress: number, progress: number): NodeState {
  if (progress >= nextMinProgress) return "done";
  if (progress >= sub.minProgress) return "active";
  return "pending";
}

function NodeDot({ state }: { state: NodeState }) {
  if (state === "done") return <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />;
  if (state === "error") return <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />;
  if (state === "active") return <Loader2 className="w-4 h-4 text-primary flex-shrink-0 animate-spin" />;
  return <Circle className="w-4 h-4 text-border flex-shrink-0" />;
}

function SubDot({ state }: { state: NodeState }) {
  if (state === "done") return <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />;
  if (state === "active") return <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 animate-pulse" />;
  return <div className="w-2 h-2 rounded-full bg-border flex-shrink-0" />;
}

function PipelineDAG({ progress, events, hasError }: { progress: number; events: ProgressEvent[]; hasError: boolean }) {
  // Get last message for each stage group
  const lastMsg = (ids: string[]) => {
    const matches = events.filter(e => ids.some(id => e.stage === id || e.stage.startsWith(id)));
    return matches.length > 0 ? matches[matches.length - 1].message : null;
  };

  return (
    <div className="space-y-0">
      {DAG_NODES.map((node, idx) => {
        const state = nodeState(node, progress, hasError);
        const Icon = node.icon;
        const isLast = idx === DAG_NODES.length - 1;
        const stageIds = node.subStages ? node.subStages.map(s => s.id) : [node.id];
        const msg = lastMsg(stageIds);
        const isActive = state === "active";

        return (
          <div key={node.id} className="flex gap-3">
            {/* Connector column */}
            <div className="flex flex-col items-center w-6 flex-shrink-0">
              <div className={`mt-1 transition-colors ${state === "done" ? "text-success" :
                  state === "active" ? "text-primary" :
                    state === "error" ? "text-error" : "text-border"
                }`}>
                {state === "active"
                  ? <div className="w-6 h-6 rounded-full flex items-center justify-center bg-primary/10 border border-primary/30 shadow-[0_0_8px_rgba(99,102,241,0.3)]">
                    <Icon className="w-3 h-3 text-primary" />
                  </div>
                  : state === "done"
                    ? <div className="w-6 h-6 rounded-full flex items-center justify-center bg-success/10 border border-success/30">
                      <Icon className="w-3 h-3 text-success" />
                    </div>
                    : state === "error"
                      ? <div className="w-6 h-6 rounded-full flex items-center justify-center bg-error/10 border border-error/30">
                        <Icon className="w-3 h-3 text-error" />
                      </div>
                      : <div className="w-6 h-6 rounded-full flex items-center justify-center bg-surface border border-border">
                        <Icon className="w-3 h-3 text-muted" />
                      </div>
                }
              </div>
              {!isLast && (
                <div className={`w-px flex-1 min-h-[16px] mt-1 transition-colors ${state === "done" ? "bg-success/40" : state === "active" ? "bg-primary/30" : "bg-border"
                  }`} />
              )}
            </div>

            {/* Content */}
            <div className={`pb-4 flex-1 min-w-0 ${isLast ? "pb-0" : ""}`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-xs font-semibold ${state === "done" ? "text-success" :
                    state === "active" ? "text-foreground" :
                      state === "error" ? "text-error" : "text-muted"
                  }`}>{node.label}</span>
                {isActive && <NodeDot state="active" />}
                {state === "done" && <span className="text-[10px] text-success/70">✓</span>}
              </div>

              {msg && (state === "active" || state === "done") && (
                <p className="text-[10px] text-muted leading-snug mb-2 line-clamp-2">{msg}</p>
              )}

              {/* Sub-stages for Brain node */}
              {node.subStages && (state === "active" || state === "done") && (
                <div className="space-y-1.5 pl-2 border-l border-border ml-1">
                  {node.subStages.map((sub, si) => {
                    const nextMin = node.subStages![si + 1]?.minProgress ?? (node.maxProgress + 0.01);
                    const ss = subStageState(sub, nextMin, progress);
                    return (
                      <div key={sub.id} className="flex items-center gap-2">
                        <SubDot state={ss} />
                        <span className={`text-[10px] ${ss === "done" ? "text-muted" : ss === "active" ? "text-foreground" : "text-border"}`}>
                          {sub.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function AgentCreatePage() {
  const { user } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<FormData>({
    task: "", industry: "", role: "", job_title: "",
    company_website: "", company_name: "", agent_name: "",
  });
  const [knowledgeFiles, setKnowledgeFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Progress state
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [createdAgent, setCreatedAgent] = useState<ProgressEvent["agent"] | null>(null);
  const [createError, setCreateError] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  const set = (key: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const canProceedStep1 = form.task.trim().length >= 5 && form.industry.trim().length >= 2;

  const startCreation = async () => {
    if (!user) return;
    setIsCreating(true);
    setEvents([]);
    setCurrentProgress(0);
    setCreateError("");
    setCreatedAgent(null);
    setStep(3);

    try {
      await apiService.createAgentV2Stream(
        user.email,
        {
          task: form.task,
          industry: form.industry,
          role: form.role || undefined,
          job_title: form.job_title || undefined,
          company_website: form.company_website || undefined,
          company_name: form.company_name || undefined,
          agent_name: form.agent_name || undefined,
        },
        async (rawEvent) => {
          const event = rawEvent as ProgressEvent;
          setEvents(prev => [...prev, event]);
          setCurrentProgress(event.progress);

          if (event.stage === "done" && event.agent) {
            const agentId = event.agent.id;
            if (knowledgeFiles.length > 0) {
              setEvents(prev => [...prev, { stage: "uploading_docs", progress: 0.99, message: `Uploading ${knowledgeFiles.length} training documents...` }]);
              try {
                for (const file of knowledgeFiles) {
                  await apiService.uploadKnowledgeDoc(user.email, agentId, file);
                }
                setEvents(prev => [...prev, { stage: "done", progress: 1.0, message: `Assistant '${event.agent?.name}' is ready with knowledge base!`, agent: event.agent }]);
                setCreatedAgent(event.agent);
              } catch (e) {
                console.error("Failed to upload knowledge files:", e);
                setCreateError("Agent created, but failed to upload some knowledge documents.");
                setCreatedAgent(event.agent);
              }
            } else {
              setCreatedAgent(event.agent);
            }
          }
          if (event.stage === "error") {
            setCreateError(event.message || "Agent creation failed");
          }
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      );
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Creation failed");
      setEvents(prev => [...prev, { stage: "error", progress: 0, message: err instanceof Error ? err.message : "Creation failed" }]);
    } finally {
      setIsCreating(false);
    }
  };

  if (!user) return null;

  // ── Step 3: Progress view ─────────────────────────────────────────────────

  if (step === 3) {
    const progressPct = Math.round(currentProgress * 100);
    const isDone = !!createdAgent;
    const isError = !!createError;

    return (
      <div className="relative min-h-screen max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex items-start justify-center" style={{ background: 'var(--surface)' }}>
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-gradient-to-br from-primary to-accent rounded-md">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {isDone ? "Assistant Ready!" : isError ? "Creation Failed" : "Building Your Assistant"}
              </h1>
              <p className="text-xs text-muted">
                {isDone ? "Your AI assistant has been created" : isError ? "Something went wrong" : "Processing request..."}
              </p>
            </div>
            {(isDone || isError) && (
              <button onClick={() => router.push("/agents")} className="ml-auto p-1.5 hover:bg-background rounded transition-colors">
                <X className="w-4 h-4 text-muted" />
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted">
                {isDone ? "Complete" : isError ? "Failed" : "Creating assistant..."}
              </span>
              <span className="text-xs font-bold text-foreground">{progressPct}%</span>
            </div>
            <div className="w-full h-2 bg-background rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${isDone ? "bg-success" : isError ? "bg-error" : "bg-primary"}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* DAG Pipeline Flow */}
          <div className="card mb-6">
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-4">Pipeline Flow</h3>
            {events.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Connecting to system...
              </div>
            ) : (
              <PipelineDAG
                progress={currentProgress}
                events={events}
                hasError={isError}
              />
            )}
            <div ref={logEndRef} />
          </div>

          {/* Done: agent summary card */}
          {isDone && createdAgent && (
            <div className="card border-success/30 bg-success/5 mb-6 animate-fade-in">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-5 h-5 text-success" />
                <h3 className="font-semibold text-foreground">{createdAgent.name}</h3>
                <span className="text-[10px] text-muted ml-auto">{createdAgent.industry}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {createdAgent.benchmark_score != null && (
                  <div>
                    <div className="text-[10px] text-muted mb-1">Benchmark Score</div>
                    <div className="text-lg font-bold text-success">{Math.round(createdAgent.benchmark_score * 100)}%</div>
                    <div className="w-full h-1 bg-background rounded-full mt-1">
                      <div className="h-full bg-success rounded-full" style={{ width: `${Math.round(createdAgent.benchmark_score * 100)}%` }} />
                    </div>
                  </div>
                )}
                {createdAgent.quality_score != null && (
                  <div>
                    <div className="text-[10px] text-muted mb-1">Accuracy Score</div>
                    <div className="text-lg font-bold text-primary">{Math.round(createdAgent.quality_score * 100)}%</div>
                    <div className="w-full h-1 bg-background rounded-full mt-1">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(createdAgent.quality_score * 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
              {createdAgent.capabilities && createdAgent.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {createdAgent.capabilities.slice(0, 5).map((cap, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded">
                      {cap}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error card */}
          {isError && (
            <div className="card border-error/30 bg-error/5 mb-6 animate-fade-in">
              <div className="flex items-center gap-2 text-error text-sm">
                <AlertCircle className="w-4 h-4" />
                {createError}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {isDone && createdAgent && (
              <>
                <button
                  onClick={() => router.push(`/chat?agent=${createdAgent.id}`)}
                  className="btn-primary flex-1"
                >
                  <Sparkles className="w-4 h-4" />
                  Chat with Assistant
                </button>
                <button
                  onClick={() => router.push("/agents")}
                  className="btn-secondary"
                >
                  View All Assistants
                </button>
              </>
            )}
            {isError && (
              <>
                <button onClick={() => { setStep(1); setCreateError(""); setEvents([]); }} className="btn-secondary flex-1">
                  <ChevronLeft className="w-4 h-4" /> Back to Form
                </button>
                <button onClick={startCreation} className="btn-primary flex-1">
                  <Zap className="w-4 h-4" /> Retry
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Steps 1 & 2: Form ──────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex items-start justify-center" style={{ background: 'var(--surface)' }}>
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => router.push("/agents")} className="p-1.5 hover:bg-surface rounded transition-colors">
            <ChevronLeft className="w-5 h-5 text-muted" />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-primary to-accent rounded-md">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Create New Assistant</h1>
              <p className="text-xs text-muted">AI searches the internet and builds a specialized helper for you</p>
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2].map(s => (
            <React.Fragment key={s}>
              <button
                onClick={() => s < step || (s === 2 && canProceedStep1) ? setStep(s as 1 | 2) : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                  ${step === s ? "bg-primary text-white" : s < step ? "bg-success/20 text-success border border-success/30" : "bg-surface text-muted border border-border"}`}
              >
                {s < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span>{s}</span>}
                {s === 1 ? "Core Intent" : "Identity & Company"}
              </button>
              {s < 2 && <ChevronRight className="w-3.5 h-3.5 text-muted" />}
            </React.Fragment>
          ))}
        </div>

        <div className="card space-y-5">

          {/* ── Step 1 ── */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  What should this assistant do? <span className="text-error">*</span>
                </label>
                <textarea
                  value={form.task}
                  onChange={set("task")}
                  rows={3}
                  placeholder="e.g. Write cold outreach emails to enterprise SaaS prospects, handle objections, and follow up sequences"
                  className="input-field w-full resize-none"
                />
                <p className="text-[10px] text-muted mt-1">Be specific - the AI researches exactly this task</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Industry <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={form.industry}
                  onChange={set("industry")}
                  placeholder="e.g. B2B SaaS, Healthcare, E-commerce, Legal..."
                  className="input-field w-full"
                />
                <p className="text-[10px] text-muted mt-1">Describe your industry freely - the AI adapts its research to exactly what you write</p>
              </div>

              <QualityPreview form={form} />

              <button
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="btn-primary w-full"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <>
              <div className="bg-surface/50 border border-border/10 rounded-xl p-4 text-[13px] text-muted-dark font-medium mb-6">
                These fields are <strong className="text-foreground">optional</strong> but each one increases the depth of research and the quality of the assistant.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Role
                  </label>
                  <input
                    type="text" value={form.role} onChange={set("role")}
                    placeholder="e.g. Sales Development Rep"
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Job Title
                  </label>
                  <input
                    type="text" value={form.job_title} onChange={set("job_title")}
                    placeholder="e.g. Senior Account Executive"
                    className="input-field w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Company Website</span>
                </label>
                <input
                  type="url" value={form.company_website} onChange={set("company_website")}
                  placeholder="https://yourcompany.com - unlocks deep company intelligence"
                  className="input-field w-full"
                />
                <p className="text-[10px] text-muted mt-1">The AI searches products, team, customers, pricing, and cases...</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                    <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Company Name</span>
                  </label>
                  <input
                    type="text" value={form.company_name} onChange={set("company_name")}
                    placeholder="Acme Inc"
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Assistant Name
                  </label>
                  <input
                    type="text" value={form.agent_name} onChange={set("agent_name")}
                    placeholder="Auto-generated if blank"
                    className="input-field w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Training Documents
                </label>
                <div
                  className="p-4 border border-dashed border-border rounded-md hover:bg-surface/50 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="w-6 h-6 text-muted" />
                  <span className="text-sm font-medium text-foreground text-center">
                    Click to upload documents (PDF, DOCX, CSV, TXT)
                  </span>
                  <span className="text-xs text-muted">Inject custom facts into your assistant immediately.</span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) {
                        setKnowledgeFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                      }
                      e.target.value = '';
                    }}
                    accept=".pdf,.docx,.csv,.xlsx,.txt"
                  />
                </div>
                {knowledgeFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {knowledgeFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-surface rounded border border-border">
                        <div className="flex items-center gap-2 text-xs truncate">
                          <Paperclip className="w-3.5 h-3.5 text-muted shrink-0" />
                          <span>{f.name}</span>
                        </div>
                        <button
                          onClick={() => setKnowledgeFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-muted hover:text-error"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <QualityPreview form={form} />

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="btn-secondary">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button onClick={startCreation} className="btn-primary flex-1">
                  {isCreating
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing...</>
                    : <><Sparkles className="w-4 h-4" /> Create Assistant</>
                  }
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
