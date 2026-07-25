"use client";
import React, { useState, useEffect, useRef, Suspense } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSearchParams } from "next/navigation";
import { getFriendlyErrorText, toastError, toastSuccess } from "@/lib/friendly-errors";
import { Bot, X } from "lucide-react";

// Components
import { AgentFleetList } from "./_components/AgentFleetList";
import { CentralCommand } from "./_components/CentralCommand";
import { EditAgentModal } from "./_components/EditAgentModal";
import { NoAgentModal } from "./_components/AgentModals";
import { ContactsMiniPanel } from "./_components/ContactsMiniPanel";
import { WelcomeModal } from "./_components/WelcomeModal";
import { ConfirmationModal } from "@/components/shared/ConfirmationModal";
import { useOnboarding } from "@/hooks/useOnboarding";


// Utils & Services
import { isTaskRequest, detectAgentSuggestion, AgentSuggestion } from "./_components/utils";

// Injects the agent's primary task context when user's message doesn't already describe an action.
// e.g. Presentation Agent + "how to make chai" → "Create a presentation about: how to make chai"
function injectAgentContext(agent: Agent | null, userMessage: string, isFirstMessage: boolean): string {
  // Only inject context on the very first message of a conversation.
  // Follow-up messages (confirmations, edits, "save it", "looks good", etc.)
  // must reach the agent as-is so the LLM can interpret them in context.
  if (!agent || !isFirstMessage) return userMessage;

  const msg = userMessage.toLowerCase().trim();
  const roleDesc = `${agent.name} ${agent.role} ${agent.description}`.toLowerCase();

  // If the user already gave an explicit instruction, don't wrap it.
  const hasExplicitAction = /\b(create|make|write|send|draft|schedule|find|search|generate|build|compose|book|add|delete|update|edit|summarise|summarize|analyze|analyse|show|list|get|fetch|download|upload|reply|forward|translate|explain|check|save|open|read|view|share|export|import|convert|move|copy|rename|archive|restore)\b/.test(msg);
  if (hasExplicitAction) return userMessage;

  // Map role keywords → action prefix (only applied on first message)
  const actionMap: { keywords: string[]; prefix: string }[] = [
    { keywords: ['presentation', 'slide', 'deck', 'powerpoint', 'ppt'], prefix: 'Create a presentation about' },
    { keywords: ['document', 'doc', 'report', 'word', 'pdf', 'write'], prefix: 'Write a document about' },
    { keywords: ['spreadsheet', 'sheet', 'excel', 'csv', 'data'], prefix: 'Create a spreadsheet for' },
    { keywords: ['email', 'gmail', 'mail', 'inbox', 'draft'], prefix: 'Draft an email about' },
    { keywords: ['calendar', 'meeting', 'schedule', 'event', 'appointment'], prefix: 'Schedule a meeting for' },
    { keywords: ['research', 'analyst', 'analysis', 'investigate'], prefix: 'Research and summarise' },
    { keywords: ['content', 'marketing', 'social', 'blog', 'post'], prefix: 'Create content about' },
    { keywords: ['contact', 'crm', 'lead'], prefix: 'Find contact information for' },
  ];

  for (const { keywords, prefix } of actionMap) {
    if (keywords.some(k => roleDesc.includes(k))) {
      return `${prefix}: ${userMessage}`;
    }
  }

  return userMessage;
}
import { agentService } from "@/services/agent.service";
import { proactiveService } from "@/services/proactive.service";
import { apiService } from "@/services/api";
import { appendTokenLog } from "@/components/shared/CostWidget";
import { useAgentStore } from "@/store/agentStore";
import { Agent, Message } from "@/types/agent.types";
import { cn } from "@/lib/utils";


function DashboardContent() {
  const { user, preferences } = useAuth();
  const searchParams = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    agents,
    agentsLoading,
    loadAgents,
    messages,
    setMessages,
    selectedAgent,
    setSelectedAgent
  } = useAgentStore();

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentTab, setAgentTab] = useState<'all' | 'system' | 'custom' | 'tools'>('all');
  const [contactsOpen, setContactsOpen] = useState(false);
  const [messagesCache, setMessagesCache] = useState<Record<string | number, Message[]>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [attachedDocs, setAttachedDocs] = useState<{ id: string; filename: string; uploading?: boolean }[]>([]);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; filename: string; text: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [, setSteps] = useState<unknown[]>([]);
  const [streamingStatuses, setStreamingStatuses] = useState<string[]>([]);

  // Mobile agent sidebar drawer state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Tab-return notifications - shown when user comes back after being away
  const [returnNotifs, setReturnNotifs] = useState<{ id: number; task_title: string; result_summary: string | null; created_at: string }[]>([]);
  const hiddenAtRef = useRef<number | null>(null); // timestamp (ms) when tab became hidden

  // Modals
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', role: '', industry: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadedDoc, setUploadedDoc] = useState<{ id: string; filename: string } | null>(null);
  const [noAgentModal, setNoAgentModal] = useState<AgentSuggestion | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);
  const dashboardFileRef = useRef<HTMLInputElement>(null);

  const { startOnboarding } = useOnboarding();
  const [showWelcome, setShowWelcome] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Session list state (shared) ───────────────────────────────────────────
  type ChatSession = { id: number; title: string; updated_at: string | null; message_count: number };
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const sessionsLastFetchRef = useRef<number>(0);
  const sessionsInflightRef = useRef(false);
  const SESSIONS_TTL_MS = 60_000; // 60 s TTL

  const loadSessions = async (force = false) => {
    if (!user?.email) return;
    const now = Date.now();
    if (!force && hasLoadedSessions && (now - sessionsLastFetchRef.current) < SESSIONS_TTL_MS) return;
    if (sessionsInflightRef.current) return; // deduplicate concurrent calls (React StrictMode double-invoke)

    sessionsInflightRef.current = true;
    const showSpinner = sessions.length === 0;
    if (showSpinner) setSessionsLoading(true);

    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL;
      const res = await fetch(
        `${API_BASE}/api/agents/chat/sessions?email=${encodeURIComponent(user.email)}`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setHasLoadedSessions(true);
      sessionsLastFetchRef.current = Date.now();
    } catch { /* non-critical */ } finally {
      setSessionsLoading(false);
      sessionsInflightRef.current = false;
    }
  };

  const deleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.email) return;
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL;
      await fetch(
        `${API_BASE}/api/agents/chat/sessions/${sessionId}?email=${encodeURIComponent(user.email)}`,
        { method: 'DELETE', credentials: 'include' }
      );
    } catch { /* non-critical */ }
  };

  useEffect(() => {
    if (user?.email) loadSessions();
  }, [user?.email]);

  useEffect(() => {
    if (historyOpen) loadSessions(true);
  }, [historyOpen]);

  useEffect(() => {
    if (!user?.email) return;
    const localKey = `onboarding_completed_${user.email}`;
    // Fast path: localStorage cache hit
    if (localStorage.getItem(localKey)) return;
    // Authoritative check: ask the DB
    const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${BACKEND_URL}/api/user/onboarding-status?email=${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.onboarding_completed) {
          // Sync back to localStorage so future loads skip the fetch
          localStorage.setItem(localKey, 'true');
        } else {
          setShowWelcome(true);
        }
      })
      .catch(() => setShowWelcome(true));
  }, [user?.email]);

  const handleStartSetup = () => {
    setShowWelcome(false);
    if (user?.email) {
      localStorage.setItem(`onboarding_completed_${user.email}`, 'true');
    }
    startOnboarding();
  };


  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const handleToggle = () => setContactsOpen(prev => {
      if (!prev) setHistoryOpen(false);
      return !prev;
    });
    window.addEventListener('toggle-contacts', handleToggle);
    return () => window.removeEventListener('toggle-contacts', handleToggle);
  }, []);

  // Tab-return notification: track when user leaves, check on return
  useEffect(() => {
    if (!user?.email || (!preferences?.gmail_connected && !preferences?.calendar_connected)) return;
    const email = user.email;
    const API_BASE = process.env.NEXT_PUBLIC_API_URL;

    const handleVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      // Respect user preference
      try { if (localStorage.getItem('mc_task_notif') === 'false') return; } catch { /* ignore */ }
      // User came back - only query if they were actually away
      if (hiddenAtRef.current === null) return;
      hiddenAtRef.current = null;

      try {
        const res = await fetch(
          `${API_BASE}/api/notifications/pending?email=${encodeURIComponent(email)}`,
          { credentials: 'include' }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.notifications?.length) {
          setReturnNotifs(data.notifications);
        }
      } catch {
        // non-critical
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.email]);

  // Load agents on mount
  useEffect(() => {
    if (user?.email) {
      loadAgents(user.email);
    }
  }, [user?.email]);

  const loadChatHistory = async (email: string, sessionId: number | null = null) => {
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL;
      const url = sessionId
        ? `${API_BASE}/api/agents/chat/history?email=${encodeURIComponent(email)}&session_id=${sessionId}`
        : `${API_BASE}/api/agents/chat/history?email=${encodeURIComponent(email)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.messages?.length) { setMessages([]); return; }
      type HistoryRow = { role: string; content: string; attachments?: { id: string; filename: string }[] };
      const hydrated = data.messages.map((m: HistoryRow, i: number) => ({
        id: `history-${i}`,
        type: m.role === 'assistant' ? 'agent' : 'user',
        content: m.content,
        attachments: m.attachments,
        timestamp: new Date(),
      }));
      setMessages(hydrated);
      // Cache messages in memory
      setMessagesCache(prev => ({ ...prev, [sessionId || 'global']: hydrated }));
    } catch {
      // history is non-critical - silently ignore
    }
  };

  const handleLoadSession = async (sessionId: number) => {
    setCurrentSessionId(sessionId);
    setHistoryOpen(false);
    setMobileSidebarOpen(false);

    // Check in-memory cache first
    if (messagesCache[sessionId]) {
      setMessages(messagesCache[sessionId]);
      return;
    }

    if (user?.email) await loadChatHistory(user.email, sessionId);
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setHistoryOpen(false);
    setMobileSidebarOpen(false);
  };

  // Login briefing — once per session per user
  useEffect(() => {
    if (!user?.email || (!preferences?.gmail_connected && !preferences?.calendar_connected)) return;
    const key = `mc_briefing_session_${user.email}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    const showBriefing = async () => {
      try {
        const res = await proactiveService.getBriefing(user.email);
        const rawNarrative = res?.narrative ?? '';
        // Show only the widget card — strip the text portion before [BRIEFING_DATA:...]
        const widgetMatch = rawNarrative.match(/(\[BRIEFING_DATA:[\s\S]*)/);
        const content = widgetMatch ? widgetMatch[1] : rawNarrative;

        if (content) {
          setMessages(prev => [
            ...prev,
            { id: 'briefing', type: 'agent', content, timestamp: new Date() },
          ]);
        }
      } catch {
        /* briefing is optional */
      }
    };
    showBriefing();
  }, [user?.email]);

  // Voice command bridge
  useEffect(() => {
    let pendingTranscript = '';

    const onExecuting = (e: Event) => {
      const { transcript } = (e as CustomEvent).detail;
      pendingTranscript = transcript;
      setIsLoading(true);
    };
    const onStep = (e: Event) => {
      const { message, tool } = (e as CustomEvent).detail;
      if (message) setSteps(prev => [...prev, { kind: 'thinking', label: message }]);
      if (tool) setSteps(prev => [...prev, { kind: 'tool', name: tool }]);
    };
    const onDone = (e: Event) => {
      const { result } = (e as CustomEvent).detail;
      const userMsg = pendingTranscript
        ? [{ id: `voice-${Date.now()}`, type: 'user' as const, content: `🎙 ${pendingTranscript}`, timestamp: new Date() }]
        : [];
      pendingTranscript = '';
      setMessages(prev => [...prev, ...userMsg, {
        id: `voice-res-${Date.now()}`, type: 'agent' as const,
        content: result || 'Done.', timestamp: new Date(),
      }]);
      setIsLoading(false);
    };
    const onError = (e: Event) => {
      const { message } = (e as CustomEvent).detail;
      const userMsg = pendingTranscript
        ? [{ id: `voice-${Date.now()}`, type: 'user' as const, content: `🎙 ${pendingTranscript}`, timestamp: new Date() }]
        : [];
      pendingTranscript = '';
      setMessages(prev => [...prev, ...userMsg, {
        id: `voice-err-${Date.now()}`, type: 'agent' as const,
        content: `⚠️ ${message || 'Voice command failed.'}`, timestamp: new Date(),
      }]);
      setIsLoading(false);
    };

    window.addEventListener('voice:executing', onExecuting);
    window.addEventListener('voice:step', onStep);
    window.addEventListener('voice:done', onDone);
    window.addEventListener('voice:error', onError);
    return () => {
      window.removeEventListener('voice:executing', onExecuting);
      window.removeEventListener('voice:step', onStep);
      window.removeEventListener('voice:done', onDone);
      window.removeEventListener('voice:error', onError);
    };
  }, [setMessages]);


  const handleDashboardFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.email) return;
    const tempId = `uploading-${Date.now()}`;
    setAttachedDocs(prev => [...prev, { id: tempId, filename: file.name, uploading: true }]);
    try {
      const res = await apiService.uploadDocument(user.email, file);
      setAttachedDocs(prev => prev.map(d => d.id === tempId ? { id: res.id, filename: res.filename } : d));
      toastSuccess("File attached");
    } catch (err: unknown) {
      setAttachedDocs(prev => prev.filter(d => d.id !== tempId));
      toastError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      if (dashboardFileRef.current) dashboardFileRef.current.value = "";
    }
  };

  const handlePreviewDoc = async (docId: string, filename: string) => {
    if (!user?.email) return;
    setPreviewLoading(true);
    setPreviewDoc({ id: docId, filename, text: "" });
    try {
      const res = await apiService.parseDocument(user.email, docId);
      setPreviewDoc({ id: docId, filename: res.filename || filename, text: res.text });
    } catch {
      toastError("Could not load document preview");
      setPreviewDoc(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSendMessage = async (overrideMsg?: string, overrideAttachments?: { id: string; filename: string }[]) => {
    const safeOverrideMsg = typeof overrideMsg === "string" ? overrideMsg : undefined;
    const safeOverrideAttachments = Array.isArray(overrideAttachments) ? overrideAttachments : undefined;
    const finalInput = safeOverrideMsg ?? input.trim();
    if ((!finalInput && attachedDocs.length === 0 && !safeOverrideAttachments) || !user?.email) return;

    if (finalInput && isTaskRequest(finalInput) && agents.length === 0) {
      setNoAgentModal(detectAgentSuggestion(finalInput));
      return;
    }

    const currentAttachments = safeOverrideAttachments || attachedDocs.map(d => ({ id: d.id, filename: d.filename }));
    const msgContent = finalInput || `[Attached: ${currentAttachments.map(d => d.filename).join(', ')}]`;

    const userMsg: Message = {
      id: Date.now().toString(), type: 'user',
      content: selectedAgent ? `[${selectedAgent.name}] ${msgContent}` : msgContent,
      timestamp: new Date(),
      attachments: currentAttachments
    };

    // If it's an override (edit/regenerate), we've already truncated the messages.
    // Otherwise, we just append.
    if (!safeOverrideMsg) {
      setMessages(prev => [...prev, userMsg]);
    }

    setSteps([]);
    setStreamingStatuses([]);
    setInput("");
    setAttachedDocs([]);
    setIsLoading(true);

    const isFirstMessage = messages.length === 0;
    const backendMessage = injectAgentContext(selectedAgent, msgContent, isFirstMessage);

    try {
      const { session_id: returnedSessionId } = await agentService.streamAgentChat(user.email, {
        message: backendMessage,
        doc_ids: currentAttachments.map(d => d.id),
        agent_id: selectedAgent?.id ? parseInt(selectedAgent.id) || undefined : undefined,
        session_id: currentSessionId,
      }, (event) => {
        if (event.type === 'agent') {
          // Agent selection announced
        }
        if (event.type === 'cache_hit') {
          // Show cache hit indicator if desired
        }
        if (event.type === 'status' || event.type === 'tool_call') {
          const label = event.message || event.display || (event.tool ? `Using ${(event.tool as string).replace(/_/g, ' ')}` : 'Thinking');
          setStreamingStatuses(prev => [...prev, label]);
        }
        if (event.type === 'chunk' || event.type === 'text') {
          const chunk = event.content || event.text || "";
          if (!chunk) return;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.type === 'agent' && last.isStreaming) {
              return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
            }
            return [...prev, { id: 'stream', type: 'agent', content: chunk, isStreaming: true, timestamp: new Date() }];
          });
        } else if (event.type === 'result' || event.type === 'done') {
          setIsLoading(false);
          setStreamingStatuses([]);
          const text = event.text || event.content || event.result || "";

          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.type === 'agent' && last.isStreaming) {
              return [...prev.slice(0, -1), { ...last, content: text || last.content, isStreaming: false, id: `msg-${Date.now()}` }];
            }
            if (text) {
              return [...prev, { id: `msg-${Date.now()}`, type: 'agent', content: text, isStreaming: false, timestamp: new Date() }];
            }
            return prev;
          });
        } else if (event.type === 'error') {
          const errMsg = event.error || event.message || "Something went wrong.";
          const displayMsg = errMsg.startsWith('⚠️') ? errMsg : `⚠️ ${errMsg}`;
          setMessages(prev => [...prev, { id: `err-${Date.now()}`, type: 'agent', content: displayMsg, timestamp: new Date() }]);
        }
      });
      if (returnedSessionId && currentSessionId === null) {
        setCurrentSessionId(returnedSessionId);
      }
    } catch (err: unknown) {
      const friendlyMessage = getFriendlyErrorText(err, "agent_chat");
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        type: 'agent',
        content: friendlyMessage,
        timestamp: new Date(),
      }]);
      toastError(err, "agent_chat");
    } finally {
      setIsLoading(false);
      setStreamingStatuses([]);
      setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
    }
  };

  const handleEditMessage = (index: number, newContent: string) => {
    const oldMsg = messages[index];
    // 1. Truncate messages up to the index
    const truncated = messages.slice(0, index);
    const updatedUserMsg: Message = {
      ...oldMsg,
      content: newContent,
      id: Date.now().toString(),
      timestamp: new Date(),
    };
    setMessages([...truncated, updatedUserMsg]);
    // 2. Trigger send with the new content and OLD attachments
    handleSendMessage(newContent, oldMsg.attachments);
  };

  const handleRegenerate = () => {
    // Find the last user message
    const lastUserMsgIdx = [...messages].reverse().findIndex(m => m.type === 'user');
    if (lastUserMsgIdx === -1) return;

    const actualIdx = messages.length - 1 - lastUserMsgIdx;
    const lastUserMsg = messages[actualIdx];

    // Truncate everything after that user message
    setMessages(messages.slice(0, actualIdx + 1));

    // Trigger send
    handleSendMessage(lastUserMsg.content, lastUserMsg.attachments);
  };

  const handleFeedback = async (messageId: string, rating: number, content: string) => {
    if (!user?.email) return;
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL;
      await fetch(`${API_BASE}/api/agents/chat/feedback?email=${encodeURIComponent(user.email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          rating: rating,
          message_content: content,
          agent_id: selectedAgent?.id ? parseInt(selectedAgent.id) : undefined
        }),
        credentials: 'include'
      });
    } catch (err) {
      console.error("Feedback failed:", err);
    }
  };

  const handleSaveAgent = async () => {
    if (!user?.email || !editingAgent) return;
    setIsSavingEdit(true);
    try {
      let agentId: number;
      if (editingAgent.id === 'new') {
        const res = await agentService.createAgentFromBlueprint(user.email, 'researcher', editForm.description || `A custom assistant named ${editForm.name}`, editForm.name);
        if (!res.agent?.id) throw new Error("Creation failed");
        agentId = res.agent.id;
      } else {
        agentId = parseInt(editingAgent.id);
      }
      if (pendingFile) await agentService.uploadKnowledgeDoc(user.email, agentId, pendingFile);
      toastSuccess("Assistant saved");
      setEditingAgent(null);
      setPendingFile(null);
      setUploadedDoc(null);
      loadAgents(user.email, true);
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "Could not save assistant");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const dismissReturnNotifs = async () => {
    if (!user?.email || returnNotifs.length === 0) return;
    const API_BASE = process.env.NEXT_PUBLIC_API_URL;
    try {
      await fetch(
        `${API_BASE}/api/notifications/seen-all?email=${encodeURIComponent(user.email)}`,
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } }
      );
    } catch { /* non-critical */ }
    setReturnNotifs([]);
  };

  if (!user) return null;

  // ── Agent fleet panel (shared between desktop sidebar and mobile drawer) ────
  const agentFleetPanel = (
    <AgentFleetList
      agents={agents}
      isLoading={agentsLoading}
      agentTab={agentTab}
      onTabChange={setAgentTab}
      onEditAgent={a => {
        setEditingAgent(a);
        setEditForm(a);
        setMobileSidebarOpen(false);
      }}
      onDeleteAgent={id => {
        setDeleteConfirmId(id);
      }}
      onSelectAgent={(name) => {
        const agent = agents.find(a => a.name === name);
        if (agent) {
          setSelectedAgent(agent);
          setMobileSidebarOpen(false); // close drawer on mobile after selecting
        }
      }}
      selectedAgentId={selectedAgent?.id}
      deletingId={null}
      onNewChat={handleNewChat}
      sessions={sessions}
      onLoadSession={handleLoadSession}
      currentSessionId={currentSessionId}
      onDeleteSession={deleteSession}
      sessionsLoading={sessionsLoading}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
    />
  );

  return (
    <>
      <ConfirmationModal
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={async () => {
          if (!deleteConfirmId || !user?.email) return;
          setIsDeletingAgent(true);
          try {
            // Optimistic / Real-time update
            const { removeAgent } = useAgentStore.getState();
            removeAgent(deleteConfirmId);
            
            await agentService.deleteUserAgent(user.email, parseInt(deleteConfirmId));
            loadAgents(user.email, true);
            setDeleteConfirmId(null);
          } catch {
            toastError("Failed to remove assistant.");
          } finally {
            setIsDeletingAgent(false);
          }
        }}
        title="Remove Assistant"
        description="Are you sure you want to remove this assistant? This cannot be undone."
        confirmText="Remove"
        variant="destructive"
        isLoading={isDeletingAgent}
      />

      {/* ── Main layout ── */}
      <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', background: 'var(--background)' }}>

        {/* ── Left panel: Assistants - DESKTOP only (hidden on mobile) ── */}
        <div
          className={cn(
            "hidden md:block transition-all duration-300 ease-in-out overflow-hidden",
            sidebarCollapsed ? "w-0 opacity-0" : "w-[260px] opacity-100"
          )}
        >
          {agentFleetPanel}
        </div>

        {/* ── Chat ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <CentralCommand
            messages={messages}
            isLoading={isLoading}
            input={input}
            setInput={setInput}
            sendMessage={() => {
              void handleSendMessage();
            }}
            onAttachFile={() => dashboardFileRef.current?.click()}
            onDirectFileUpload={async (file) => {
              const tempId = `uploading-${Date.now()}`;
              setAttachedDocs(prev => [...prev, { id: tempId, filename: file.name, uploading: true }]);
              try {
                const res = await apiService.uploadDocument(user.email, file);
                setAttachedDocs(prev => prev.map(d => d.id === tempId ? { id: res.id, filename: res.filename } : d));
              } catch {
                setAttachedDocs(prev => prev.filter(d => d.id !== tempId));
              }
            }}
            attachedDocs={attachedDocs}
            onRemoveDoc={id => setAttachedDocs(prev => prev.filter(d => d.id !== id))}
            onPreviewDoc={handlePreviewDoc}
            userEmail={user.email}
            userName={user.name}
            messagesEndRef={messagesEndRef}
            contactsOpen={contactsOpen}
            onToggleContacts={() => setContactsOpen(o => !o)}
            onNewChat={handleNewChat}
            currentSessionId={currentSessionId}
            selectedAgent={selectedAgent}
            onClearAgent={() => setSelectedAgent(null)}
            streamingStatuses={streamingStatuses}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            onEditMessage={handleEditMessage}
            onRegenerate={handleRegenerate}
            onFeedback={handleFeedback}
            hasAgents={agents.length > 0}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>

        {/* ── Contacts slide-in panel - DESKTOP only ── */}
        {contactsOpen && (
          <div
            className="hidden md:flex"
            style={{
              width: 260, flexShrink: 0, height: '100%',
              borderLeft: '0.5px solid var(--border-light)',
              background: 'var(--background)',
              flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{
              height: 46, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 14px', borderBottom: '0.5px solid var(--border-light)', flexShrink: 0,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>Contacts</span>
              <button
                onClick={() => setContactsOpen(false)}
                style={{
                  width: 22, height: 22, borderRadius: 6, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--muted)', fontSize: 16, lineHeight: 1,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                ×
              </button>
            </div>
            <ContactsMiniPanel userEmail={user.email} />
          </div>
        )}

        {/* ── Document preview modal ── */}
        {previewDoc && (
          <div
            onClick={() => setPreviewDoc(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 720, maxHeight: '80vh', background: 'var(--background)', borderRadius: 14, border: '0.5px solid var(--border-light)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}
            >
              <div style={{ padding: '14px 18px', borderBottom: '0.5px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{previewDoc.filename}</p>
                  {previewDoc.text && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)' }}>{previewDoc.text.length.toLocaleString()} characters extracted</p>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {!attachedDocs.find(d => d.id === previewDoc.id) && (
                    <button
                      onClick={() => { setAttachedDocs(prev => [...prev, { id: previewDoc.id, filename: previewDoc.filename }]); toastSuccess("Attached to chat"); }}
                      style={{ fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer' }}
                    >
                      Attach to chat
                    </button>
                  )}
                  <button onClick={() => setPreviewDoc(null)} style={{ width: 28, height: 28, borderRadius: 7, border: '0.5px solid var(--border-light)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 16 }}>×</button>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
                {previewLoading
                  ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span style={{ fontSize: 12, color: 'var(--muted)' }}>Loading preview…</span></div>
                  : previewDoc.text
                    ? <pre style={{ margin: 0, fontSize: 12, color: 'var(--foreground)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>{previewDoc.text}</pre>
                    : <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', paddingTop: 40 }}>No text could be extracted from this file.</p>
                }
              </div>
            </div>
          </div>
        )}

        {/* Modals */}
        {noAgentModal && (
          <NoAgentModal
            suggestion={noAgentModal}
            onClose={() => setNoAgentModal(null)}
            onCreateAgent={() => { setNoAgentModal(null); setEditingAgent({ id: 'new', name: '', role: '', description: '', industry: '', status: '', isActive: true }); }}
          />
        )}
        {editingAgent && (
          <EditAgentModal
            editingAgent={editingAgent}
            editForm={editForm}
            setEditForm={setEditForm}
            customInstructions={customInstructions}
            setCustomInstructions={setCustomInstructions}
            uploadedDoc={uploadedDoc}
            onUpload={e => {
              const file = e.target.files?.[0];
              if (file) { setPendingFile(file); setUploadedDoc({ id: 'pending', filename: file.name }); }
            }}
            onRemoveDoc={() => { setPendingFile(null); setUploadedDoc(null); }}
            onSave={handleSaveAgent}
            onClose={() => setEditingAgent(null)}
            isSaving={isSavingEdit}
            fileInputRef={editFileRef}
          />
        )}

        <input type="file" ref={dashboardFileRef} onChange={handleDashboardFileUpload} className="hidden" accept=".pdf,.docx,.doc,.txt,.csv,.xlsx,.xls" />
      </div>

      {/* ── Mobile Agent Sidebar Drawer (bottom sheet) ── */}
      {mobileSidebarOpen && (
        <div className="md:hidden" style={{ position: 'fixed', inset: 0, zIndex: 120 }}>
          {/* Backdrop */}
          <div
            onClick={() => setMobileSidebarOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          />
          {/* Drawer panel */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: '80vh',
            background: 'var(--background)',
            borderRadius: '20px 20px 0 0',
            border: '0.5px solid var(--border-light)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 -16px 60px rgba(0,0,0,0.3)',
          }}>
            {/* Drawer handle */}
            <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-light)', margin: '0 auto 12px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '0.5px solid var(--border-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Bot style={{ width: 16, height: 16, color: 'var(--primary)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>My Assistants</span>
                </div>
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
            {/* Agent list inside drawer */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {agentFleetPanel}
            </div>
          </div>
        </div>
      )}

      {/* ── Return-to-tab task completion popup ── */}
      {returnNotifs.length > 0 && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 300,
            width: 340, background: 'var(--background)',
            border: '0.5px solid var(--border-light)',
            borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '12px 14px', borderBottom: '0.5px solid var(--border-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15 }}></span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
                {returnNotifs.length === 1 ? 'Task completed while you were away' : `${returnNotifs.length} tasks completed while you were away`}
              </span>
            </div>
            <button
              onClick={dismissReturnNotifs}
              style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ×
            </button>
          </div>
          {/* Notification list */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {returnNotifs.map((n, i) => (
              <div
                key={n.id}
                style={{
                  padding: '10px 14px',
                  borderBottom: i < returnNotifs.length - 1 ? '0.5px solid var(--border-light)' : 'none',
                }}
              >
                <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--foreground)', marginBottom: 3 }}>
                  {n.task_title}
                </p>
                {n.result_summary && (
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                    {n.result_summary.length > 140 ? n.result_summary.slice(0, 140) + '…' : n.result_summary}
                  </p>
                )}
              </div>
            ))}
          </div>
          {/* Footer */}
          <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={dismissReturnNotifs}
              style={{ fontSize: 11, fontWeight: 500, padding: '5px 14px', borderRadius: 7, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile Contacts Modal ── */}
      {contactsOpen && (
        <div className="md:hidden" style={{ position: 'fixed', inset: 0, zIndex: 120 }}>
          <div
            onClick={() => setContactsOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: '80vh', background: 'var(--background)',
            borderRadius: '20px 20px 0 0', border: '0.5px solid var(--border-light)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 -16px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-light)', margin: '0 auto 12px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '0.5px solid var(--border-light)' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>Contacts</span>
                <button
                  onClick={() => setContactsOpen(false)}
                  style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ContactsMiniPanel userEmail={user.email} />
            </div>
          </div>
        </div>
      )}
      {/* ── Welcome Modal ── */}
      <WelcomeModal
        isOpen={showWelcome}
        onClose={() => setShowWelcome(false)}
        onStart={handleStartSetup}
      />
    </>
  );
}


export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>}>
      <DashboardContent />
    </Suspense>
  );
}
