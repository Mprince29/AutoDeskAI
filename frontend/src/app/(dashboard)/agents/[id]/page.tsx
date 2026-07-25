"use client";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { ConfirmationModal } from "@/components/shared/ConfirmationModal";
import { toastError, toastSuccess } from "@/lib/friendly-errors";
import { apiService } from "@/services/api";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Bot,
  BookOpen,
  Upload,
  Trash2,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ThumbsUp,
  ThumbsDown,
  FileText,
  FileSpreadsheet,
  X,
  RefreshCw,
  Sparkles,
  Settings,
  Save,
  Paperclip,
  Edit2,
  MessageCircle,
  BarChart2,
  Brain,
  Zap,
  Shield,
  BookMarked,
  Globe,
  Star,
  ArrowRight,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentInfo {
  id: number;
  name: string;
  role: string;
  industry: string;
  status: string;
  has_rag: boolean;
  benchmark_score: number | null;
  quality_score: number | null;
  soul: {
    identity: Record<string, string>;
    personality: Record<string, string>;
    capabilities_count: number;
    workflows_count: number;
    terminology_count: number;
    guardrails_count: number;
    has_custom_instructions: boolean;
  };
  research: { facts_collected: number; quality_passed: boolean | null };
  created_at: string | null;
}

interface KnowledgeDoc {
  id: number;
  filename: string;
  size_bytes: number;
  status: "pending" | "processing" | "indexed" | "failed";
  chunk_count: number | null;
  error_message: string | null;
  indexed_at: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  feedbackGiven?: "up" | "down";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText className="w-4 h-4 text-error" />;
  if (["xls", "xlsx", "csv"].includes(ext || "")) return <FileSpreadsheet className="w-4 h-4 text-success" />;
  return <FileText className="w-4 h-4 text-muted" />;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}


export default function AgentDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = Number(params.id);

  if (isNaN(agentId) && searchParams.get("dep") === "1") {
    return <DepartmentalAgentPage />;
  }

  return <AgentDetailContent agentId={agentId} />;
}

function DocStatusBadge({ status }: { status: KnowledgeDoc["status"] }) {
  const map = {
    pending: "text-muted border-muted/30 bg-muted/10",
    processing: "text-warning border-warning/30 bg-warning/10",
    indexed: "text-success border-success/30 bg-success/10",
    failed: "text-error border-error/30 bg-error/10",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${map[status]}`}>
      {status}
    </span>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

// ── Departmental Agent Customize Page ─────────────────────────────────────────

function DepartmentalAgentPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const agentId = params.id as string;
  const name = searchParams.get("name") || agentId;
  const department = searchParams.get("dept") || "";
  const description = searchParams.get("desc") || "";
  const tools = (searchParams.get("tools") || "").split(",").filter(Boolean);
  const defaultPrompt = searchParams.get("prompt") || "";

  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [customPrompt, setCustomPrompt] = useState(defaultPrompt);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<{ id: string; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const result = await apiService.uploadDocument(user.email, file);
      setUploadedDoc({ id: result.id, filename: result.filename });
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const all = JSON.parse(localStorage.getItem("agent_customizations") || "{}");
      all[agentId] = { name: editName, description: editDesc, customPrompt, docId: uploadedDoc?.id };
      localStorage.setItem("agent_customizations", JSON.stringify(all));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  // Load any previously saved customization on mount
  useEffect(() => {
    const all = JSON.parse(localStorage.getItem("agent_customizations") || "{}");
    const saved = all[agentId];
    if (saved) {
      if (saved.name) setEditName(saved.name);
      if (saved.description) setEditDesc(saved.description);
      if (saved.customPrompt) setCustomPrompt(saved.customPrompt);
      if (saved.docId) setUploadedDoc({ id: saved.docId, filename: "Previously attached doc" });
    }
  }, [agentId]);

  if (!user) return null;

  return (
    <div className="relative min-h-screen max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/agents")} className="p-1.5 hover:bg-surface rounded transition-colors">
          <ChevronLeft className="w-5 h-5 text-muted" />
        </button>
        <div className="p-2 bg-primary/10 border border-primary/20 rounded-md">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-bold text-foreground">{name}</h1>
          <p className="text-[11px] text-muted">{department} · Department Assistant</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto space-y-5">
        {/* Tools */}
        {tools.length > 0 && (
          <div className="card">
            <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Configured Tools</p>
            <div className="flex flex-wrap gap-1.5">
              {tools.map(t => (
                <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary">{t}</span>
              ))}
            </div>
          </div>
        )}

        {/* Customize form */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <Settings className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Assistant Settings</h2>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Assistant Name</label>
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="input-field w-full" />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Description</label>
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} className="input-field w-full resize-none" />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Work Instructions</label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              rows={5}
              className="input-field w-full resize-none"
              placeholder="Override the default behavior - add team-specific tone, focus areas, constraints, etc."
            />
          </div>

          {/* Context doc */}
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Training Document</label>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.docx,.xlsx,.csv,.txt" />
            {uploadedDoc ? (
              <div className="flex items-center gap-2 p-2 rounded-lg border border-success/30 bg-success/5 text-xs text-success">
                <Paperclip className="w-3.5 h-3.5" />
                {uploadedDoc.filename}
                <button onClick={() => setUploadedDoc(null)} className="ml-auto text-muted hover:text-error">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted hover:border-primary/40 hover:text-primary transition-colors"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                {uploading ? "Uploading…" : "Attach procedures or guides (PDF, DOCX, CSV, TXT)"}
              </button>
            )}
          </div>

          <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "Saved!" : "Save Customization"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

function AgentDetailContent({ agentId }: { agentId: number }) {
  const { user } = useAuth();
  const router = useRouter();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loadingAgent, setLoadingAgent] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [agentError, setAgentError] = useState("");

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Upload
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [deletingDoc, setDeletingDoc] = useState<number | null>(null);
  const [docToDelete, setDocToDelete] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active panel
  const [panel, setPanel] = useState<"chat" | "docs" | "info" | "settings">("chat");

  // Inline settings editing
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadAgent = useCallback(async () => {
    if (!user) return;
    setLoadingAgent(true);
    try {
      const data = await apiService.getAgentStatus(user.email, agentId);
      setAgent(data);
    } catch {
      setAgentError("Failed to load agent.");
    } finally {
      setLoadingAgent(false);
    }
  }, [user, agentId]);

  const loadDocs = useCallback(async () => {
    if (!user) return;
    setLoadingDocs(true);
    try {
      const data = await apiService.listKnowledgeDocs(user.email, agentId);
      setDocs(data.documents);
    } catch {
      // non-fatal
    } finally {
      setLoadingDocs(false);
    }
  }, [user, agentId]);

  useEffect(() => {
    if (user && agentId) {
      loadAgent();
      loadDocs();
    }
  }, [user, agentId, loadAgent, loadDocs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Populate edit fields when agent loads
  useEffect(() => {
    if (agent) {
      setEditName(agent.name);
      setEditRole(agent.role);
      setEditIndustry(agent.industry);
      setEditInstructions(agent.soul.has_custom_instructions ? "Custom instructions configured." : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.name]);

  const sendMessage = async () => {
    if (!user || !input.trim() || isSending) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };
    const streamingId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: streamingId,
      role: "assistant",
      content: "Thinking...",
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsSending(true);

    try {
      let currentContent = "";
      await apiService.chatWithAgentStream(
        user.email,
        { message: userMsg.content, agent_id: agentId },
        (event) => {
          setMessages(prev => prev.map(m => {
            if (m.id !== streamingId) return m;

            const ev = event as { type: string; text?: string; message?: string };
            if (ev.type === 'status') {
              return { ...m, content: ev.message || m.content };
            } else if (ev.type === 'result') {
              return { ...m, content: ev.text || "No response." };
            } else if (ev.type === 'error') {
              return { ...m, content: `Error: ${ev.message || "An error occurred."}` };
            } else if (ev.type === 'chunk') {
              currentContent += ev.text || "";
              return { ...m, content: currentContent };
            }
            return m;
          }));
        }
      );
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === streamingId
          ? { ...m, content: `Error: ${err instanceof Error ? err.message : "Request failed"}` }
          : m
      ));
    } finally {
      setIsSending(false);
    }
  };

  const handleFeedback = async (msgId: string, quality: "up" | "down") => {
    if (!user) return;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedbackGiven: quality } : m));
    await apiService.submitAgentFeedback(
      user.email,
      agentId,
      quality === "up" ? 5 : 1,
      undefined,
      undefined
    ).catch(() => { });
  };

  const handleUpload = async (file: File) => {
    if (!user) return;
    setIsUploading(true);
    setUploadError("");
    try {
      await apiService.uploadKnowledgeDoc(user.email, agentId, file);
      await loadDocs();
      if (agent) setAgent({ ...agent, has_rag: true });
      toastSuccess("Document uploaded successfully.");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      toastError("Failed to upload document.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDoc = async (docId: number) => {
    if (!user) return;
    setDeletingDoc(docId);
    try {
      await apiService.deleteKnowledgeDoc(user.email, agentId, docId);
      setDocs(prev => prev.filter(d => d.id !== docId));
      toastSuccess("Document deleted.");
    } catch {
      toastError("Failed to delete document.");
    } finally {
      setDeletingDoc(null);
      setDocToDelete(null);
    }
  };

  const totalBytes = docs.reduce((s, d) => s + d.size_bytes, 0);
  const storageUsedPct = Math.min((totalBytes / (100 * 1024 * 1024)) * 100, 100);

  if (!user) return null;

  if (loadingAgent) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (agentError || !agent) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-md text-error text-sm">
          <AlertCircle className="w-4 h-4" /> {agentError || "Agent not found"}
        </div>
        <button onClick={() => router.push("/agents")} className="btn-secondary mt-4">
          <ChevronLeft className="w-4 h-4" /> Back to Agents
        </button>
      </div>
    );
  }


  const handleSaveSettings = async () => {
    if (!user) return;
    setIsSavingSettings(true);
    try {
      await apiService.updateUserAgent(user.email, agentId, {
        name: editName, role: editRole, industry: editIndustry,
      });
      setAgent(prev => prev ? { ...prev, name: editName, role: editRole, industry: editIndustry } : prev);
      setEditMode(false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
    } catch {
      // non-fatal - keep form open
    } finally {
      setIsSavingSettings(false);
    }
  };

  const TABS = [
    { id: "chat", label: "Chat", Icon: MessageCircle },
    { id: "docs", label: `Docs (${docs.length})`, Icon: FileText },
    { id: "info", label: "Analytics", Icon: BarChart2 },
    { id: "settings", label: "Settings", Icon: Settings },
  ] as const;

  const SOUL_STATS = [
    { label: "Capabilities", value: agent.soul.capabilities_count, Icon: Zap, color: "text-primary" },
    { label: "Workflows", value: agent.soul.workflows_count, Icon: Globe, color: "text-accent" },
    { label: "Terminology", value: agent.soul.terminology_count, Icon: BookMarked, color: "text-warning" },
    { label: "Safety Rules", value: agent.soul.guardrails_count, Icon: Shield, color: "text-success" },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      {/* ── Hero header ── */}
      <div className="border-b border-border/30 bg-background/60 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <button onClick={() => router.push("/agents")}
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* Avatar */}
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0
            bg-gradient-to-br from-primary/80 to-accent/60 shadow-[0_4px_12px_rgba(var(--primary-rgb),0.35)]">
            <Bot className="w-5 h-5 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-foreground truncate">{agent.name}</h1>
              {agent.has_rag && (
                <span className="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded-full flex items-center gap-1 shrink-0">
                  <BookOpen className="w-2.5 h-2.5" /> RAG
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted truncate">{agent.role} · {agent.industry}</p>
          </div>

          {/* Score pill - desktop only (mobile: see Analytics tab) */}
          {agent.benchmark_score != null && (
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold shrink-0
              ${agent.benchmark_score >= 0.8 ? "bg-success/10 text-success border-success/30" :
                agent.benchmark_score >= 0.6 ? "bg-warning/10 text-warning border-warning/30" :
                  "bg-error/10 text-error border-error/30"}`}>
              <Star className="w-3 h-3" />
              {Math.round(agent.benchmark_score * 100)}% Skill
            </div>
          )}

          <button
            onClick={() => { setPanel("settings"); setEditMode(true); }}
            className="p-2 rounded-lg border border-border text-muted hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all shrink-0">
            <Edit2 className="w-4 h-4" />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="max-w-5xl mx-auto px-3 sm:px-4 lg:px-8 flex gap-0.5 sm:gap-1 pb-0 overflow-x-auto scrollbar-hide">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setPanel(id)}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2.5 text-[10px] sm:text-[11px] font-semibold border-b-2 transition-all whitespace-nowrap
                ${panel === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-foreground"}`}
            >
              <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ── Chat panel ── */}
        {panel === "chat" && (
          <div className="flex flex-col h-[calc(100vh-240px)] min-h-[400px] rounded-2xl border border-border/40 bg-background/60 overflow-hidden shadow-sm">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4
                    bg-gradient-to-br from-primary/20 to-accent/10 border border-primary/20">
                    <Sparkles className="w-8 h-8 text-primary/60" />
                  </div>
                  <p className="text-base font-semibold text-foreground mb-1">Chat with {agent.name}</p>
                  <p className="text-xs text-muted max-w-xs leading-relaxed">
                    This assistant has deep knowledge of <strong>{agent.industry}</strong>.
                    {agent.has_rag ? " It references your uploaded documents for answers." : ""}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2 justify-center">
                    {["What can you help me with?", "Summarise your expertise", "Give me your best tip"].map(q => (
                      <button key={q} onClick={() => { setInput(q); }}
                        className="text-[11px] px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5
                          text-primary hover:bg-primary/10 transition-colors flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Brain className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div className="max-w-[78%]">
                    <div className={msg.role === "user"
                      ? "bg-primary text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                      : "bg-surface border border-border/60 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-foreground"}>
                      {msg.content}
                    </div>
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mt-1.5 ml-1">
                        <span className="text-[10px] text-muted">
                          {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {!msg.feedbackGiven ? (
                          <>
                            <button onClick={() => handleFeedback(msg.id, "up")}
                              className="p-0.5 text-muted hover:text-success transition-colors rounded">
                              <ThumbsUp className="w-3 h-3" />
                            </button>
                            <button onClick={() => handleFeedback(msg.id, "down")}
                              className="p-0.5 text-muted hover:text-error transition-colors rounded">
                              <ThumbsDown className="w-3 h-3" />
                            </button>
                          </>
                        ) : (
                          <span className={`text-[10px] font-medium ${msg.feedbackGiven === "up" ? "text-success" : "text-error"}`}>
                            {msg.feedbackGiven === "up" ? "👍 Helpful!" : "👎 Noted"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isSending && (
                <div className="flex gap-3 justify-start">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <Brain className="w-3.5 h-3.5 text-primary animate-pulse" />
                  </div>
                  <div className="bg-surface border border-border/60 px-4 py-3 rounded-2xl rounded-tl-sm">
                    <div className="flex gap-1.5 items-center">
                      {[0, 150, 300].map(delay => (
                        <div key={delay} className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce"
                          style={{ animationDelay: `${delay}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <div className="p-3 border-t border-border/40 bg-surface/80 flex gap-2 items-end">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={`Ask ${agent.name} anything...`}
                disabled={isSending}
                className="input-field flex-1 py-2.5"
              />
              <button onClick={sendMessage} disabled={!input.trim() || isSending}
                className="btn-primary py-2.5 px-4 shrink-0">
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {/* ── Docs panel ── */}
        {panel === "docs" && (
          <div className="space-y-4">
            <div
              className="rounded-2xl border-2 border-dashed border-border bg-background/40 text-center py-10 cursor-pointer
                hover:border-primary/50 hover:bg-primary/5 transition-all group"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.csv,.xlsx,.xls,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted">Uploading & indexing...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center
                    group-hover:bg-primary/15 transition-colors mb-1">
                    <Upload className="w-6 h-6 text-primary/60" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Drop files or click to upload</p>
                  <p className="text-xs text-muted">PDF · DOCX · CSV · XLSX · TXT &mdash; max 25 MB</p>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" /> {uploadError}
              </div>
            )}

            {/* Storage bar */}
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Storage Used</span>
                <span className="text-[11px] font-bold text-foreground">{formatBytes(totalBytes)} / 100 MB</span>
              </div>
              <div className="w-full h-2 bg-background rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500
                  ${storageUsedPct > 80 ? "bg-error" : storageUsedPct > 60 ? "bg-warning" : "bg-primary"}`}
                  style={{ width: `${storageUsedPct}%` }} />
              </div>
              <p className="text-[10px] text-muted mt-1.5">{docs.length}/10 documents · {10 - docs.length} slots free</p>
            </div>

            {loadingDocs ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-primary animate-spin" /></div>
            ) : docs.length === 0 ? (
              <div className="text-center py-10 text-muted text-sm border border-dashed border-border rounded-2xl">
                No documents yet. Upload to give this assistant custom knowledge.
              </div>
            ) : (
              <div className="space-y-2">
                {docs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-background/40 hover:bg-surface/60 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center shrink-0">
                      {fileIcon(doc.filename)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{doc.filename}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-muted">{formatBytes(doc.size_bytes)}</span>
                        {doc.chunk_count != null && <span className="text-[10px] text-muted">{doc.chunk_count} chunks</span>}
                        <DocStatusBadge status={doc.status} />
                        {doc.status === "processing" && <Loader2 className="w-3 h-3 text-warning animate-spin" />}
                      </div>
                      {doc.error_message && <p className="text-[10px] text-error mt-0.5 truncate">{doc.error_message}</p>}
                    </div>
                    <button onClick={() => setDocToDelete(doc.id)} disabled={deletingDoc === doc.id}
                      className="p-1.5 text-muted hover:text-error hover:bg-error/10 rounded-lg transition-colors">
                      {deletingDoc === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {docs.some(d => d.status === "processing" || d.status === "pending") && (
              <button onClick={loadDocs} className="btn-secondary w-full text-xs">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh Status
              </button>
            )}
          </div>
        )}

        {/* ── Analytics panel ── */}
        {panel === "info" && (
          <div className="space-y-5">
            {/* Score cards */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Skill Level", score: agent.benchmark_score, Icon: Star, primary: "text-primary" },
                { label: "Accuracy", score: agent.quality_score, Icon: CheckCircle2, primary: "text-success" },
              ].map(({ label, score, Icon: Ic, primary }) => {
                if (score == null) return null;
                const pct = Math.round(score * 100);
                const ring = pct >= 80 ? "stroke-success" : pct >= 60 ? "stroke-warning" : "stroke-error";
                const r = 28, circ = 2 * Math.PI * r;
                return (
                  <div key={label} className="card flex items-center gap-4">
                    <svg width="72" height="72" className="-rotate-90">
                      <circle cx="36" cy="36" r={r} fill="none" strokeWidth="5" className="stroke-border" />
                      <circle cx="36" cy="36" r={r} fill="none" strokeWidth="5" className={ring}
                        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
                        strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
                    </svg>
                    <div>
                      <div className={`text-2xl font-black ${primary}`}>{pct}%</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Ic className={`w-3.5 h-3.5 ${primary}`} />
                        <span className="text-[11px] text-muted font-semibold">{label}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Soul stats grid */}
            <div className="card">
              <h3 className="text-[10px] font-bold text-muted uppercase tracking-widest mb-4">Knowledge Depth</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SOUL_STATS.map(({ label, value, Icon: Ic, color }) => (
                  <div key={label} className="flex flex-col items-center p-4 bg-background rounded-xl border border-border/50 text-center gap-1">
                    <div className={`p-2 rounded-lg bg-surface border border-border mb-1`}>
                      <Ic className={`w-4 h-4 ${color}`} />
                    </div>
                    <div className="text-2xl font-black text-foreground">{value}</div>
                    <div className="text-[10px] text-muted leading-tight">{label}</div>
                  </div>
                ))}
              </div>
              {agent.soul.has_custom_instructions && (
                <div className="flex items-center gap-2 mt-4 p-2.5 rounded-lg bg-success/5 border border-success/20 text-[11px] text-success">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Custom master instructions are active
                </div>
              )}
            </div>

            {/* Identity */}
            {Object.keys(agent.soul.identity).length > 0 && (
              <div className="card">
                <h3 className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Identity Profile</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(agent.soul.identity).map(([k, v]) => (
                    <div key={k} className="flex gap-2 p-2.5 bg-background rounded-lg border border-border/40 text-xs">
                      <span className="text-muted capitalize font-semibold w-20 shrink-0">{k}</span>
                      <span className="text-foreground">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Research */}
            <div className="card">
              <h3 className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Research Summary</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-background rounded-xl border border-border/40 text-center">
                  <div className="text-2xl font-black text-primary">{agent.research.facts_collected}</div>
                  <div className="text-[10px] text-muted mt-0.5">Facts Collected</div>
                </div>
                <div className={`p-3 bg-background rounded-xl border text-center
                  ${agent.research.quality_passed ? "border-success/30" : "border-warning/30"}`}>
                  <div className={`text-2xl font-black ${agent.research.quality_passed ? "text-success" : "text-warning"}`}>
                    {agent.research.quality_passed ? "✓" : "~"}
                  </div>
                  <div className="text-[10px] text-muted mt-0.5">
                    {agent.research.quality_passed ? "Quality Passed" : "Partial Quality"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Settings panel ── */}
        {panel === "settings" && (
          <div className="space-y-5 max-w-2xl">
            {/* Basic info */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <div className="flex items-center gap-2">
                  <Edit2 className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-bold text-foreground">Basic Information</h2>
                </div>
                {!editMode && (
                  <button onClick={() => setEditMode(true)}
                    className="text-[11px] px-3 py-1 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors">
                    Edit
                  </button>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Assistant Name</label>
                {editMode
                  ? <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="input-field w-full" />
                  : <p className="text-sm font-medium text-foreground py-2">{agent.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Role</label>
                  {editMode
                    ? <input type="text" value={editRole} onChange={e => setEditRole(e.target.value)} className="input-field w-full" />
                    : <p className="text-sm text-foreground py-2">{agent.role || "-"}</p>}
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Industry</label>
                  {editMode
                    ? <input type="text" value={editIndustry} onChange={e => setEditIndustry(e.target.value)} className="input-field w-full" />
                    : <p className="text-sm text-foreground py-2">{agent.industry || "-"}</p>}
                </div>
              </div>

              {editMode && (
                <div className="flex gap-3 pt-1">
                  <button onClick={handleSaveSettings} disabled={isSavingSettings} className="btn-primary flex-1">
                    {isSavingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> :
                      settingsSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {settingsSaved ? "Saved!" : "Save Changes"}
                  </button>
                  <button onClick={() => { setEditMode(false); setEditName(agent.name); setEditRole(agent.role); setEditIndustry(agent.industry); }}
                    className="btn-secondary">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Custom instructions */}
            <div className="card space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-border/40">
                <Brain className="w-4 h-4 text-accent" />
                <h2 className="text-sm font-bold text-foreground">Behaviour Instructions</h2>
              </div>
              <p className="text-xs text-muted">
                Override how this assistant thinks and responds. Use specific language, tone rules, or workflow constraints.
              </p>
              <textarea
                value={editInstructions}
                onChange={e => setEditInstructions(e.target.value)}
                rows={5}
                placeholder="e.g. Always respond in bullet points. Never mention competitors. Prioritise brevity over detail..."
                className="input-field w-full resize-none text-xs leading-relaxed"
              />
              <button onClick={handleSaveSettings} disabled={isSavingSettings} className="btn-primary w-full">
                {isSavingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Instructions
              </button>
            </div>

            {/* Quick actions */}
            <div className="card space-y-2">
              <h2 className="text-[10px] font-bold text-muted uppercase tracking-wider pb-2 border-b border-border/40">Quick Actions</h2>
              <button onClick={() => setPanel("docs")}
                className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-surface transition-colors text-sm text-foreground group">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-muted group-hover:text-primary transition-colors" />
                  Add training documents
                </div>
                <ArrowRight className="w-4 h-4 text-muted" />
              </button>
              <button onClick={() => { setPanel("chat"); }}
                className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-surface transition-colors text-sm text-foreground group">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-muted group-hover:text-primary transition-colors" />
                  Test in chat
                </div>
                <ArrowRight className="w-4 h-4 text-muted" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={docToDelete !== null}
        onClose={() => setDocToDelete(null)}
        onConfirm={() => docToDelete && handleDeleteDoc(docToDelete)}
        title="Remove Document"
        description="Are you sure you want to remove this document? This will remove its knowledge from the assistant."
        confirmText="Remove"
        variant="destructive"
        isLoading={deletingDoc !== null}
      />
    </div>
  );
}
