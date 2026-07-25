import React, { useRef, useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Paperclip, X, Brain, Users, Calendar, ChevronDown, Clock, ExternalLink, Mic, Plus, ArrowRight, PanelLeftOpen, History, Trash2, MessageSquare, Copy, Pencil, RefreshCcw, Check, ThumbsUp, ThumbsDown, Volume2, Square, VolumeX, Mail, Search, NotebookText } from "lucide-react";
import Link from "next/link";
import { getDynamicContent } from "@/lib/dynamic-prompts";
import { MarkdownRenderer } from "./MarkdownRenderer";
import dynamic from "next/dynamic";
import { apiService, CalendarEvent } from "@/services/api";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { StatusLoader } from "@/components/shared/StatusLoader";


const VoiceMic = dynamic(() => import("./VoiceMic"), { ssr: false });

interface ISpeechRecognitionEvent {
  results: { length: number;[i: number]: { isFinal: boolean;[j: number]: { transcript: string } } };
}
interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => ISpeechRecognition;
  webkitSpeechRecognition?: new () => ISpeechRecognition;
};


export interface Message {
  id: string;
  type: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  error?: boolean;
  steps?: { kind: string; label?: string; name?: string }[];
  workflowId?: number;
  workflowGoal?: string;
  workflowSteps?: unknown[];
  attachments?: { id: string; filename: string }[];
}

interface CommandInputProps {
  input: string;
  setInput: (val: string) => void;
  sendMessage: () => void;
  onAttachFile: () => void;
  attachedDocs: { id: string; filename: string; uploading?: boolean }[];
  onRemoveDoc: (id: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
  setIsDragOver: (val: boolean) => void;
  toggleVoiceListening: () => void;
  isListening: boolean;
  isLoading: boolean;
  placeholder: string;
  userEmail: string;
  selectedAgent?: { name: string } | null;
  onClearAgent?: () => void;
}

const CommandInput = ({
  input,
  setInput,
  sendMessage,
  onAttachFile,
  attachedDocs,
  onRemoveDoc,
  textareaRef,
  handlePaste,
  handleDrop,
  isDragOver,
  setIsDragOver,
  toggleVoiceListening,
  isListening,
  isLoading,
  placeholder,
  userEmail,
  selectedAgent,
  onClearAgent
}: CommandInputProps) => {
  return (
    <div className="relative flex flex-col items-stretch gap-2 rounded-2xl border border-border/50 bg-surface/70 backdrop-blur-xl transition-all p-3 sm:p-4"
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      style={{ borderColor: isDragOver ? 'var(--primary)' : 'var(--border-light)', background: isDragOver ? 'color-mix(in srgb, var(--primary) 4%, var(--surface))' : 'var(--surface)' }}
    >
      {selectedAgent && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 mb-2 self-start group transition-all hover:bg-primary/15">
          <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_5px_rgba(var(--primary-rgb),0.5)]" />
          <span className="text-[11px] font-semibold text-primary/90">
            {selectedAgent.name}
          </span>
          <button
            onClick={onClearAgent}
            className="ml-1 p-0.5 rounded-md hover:bg-primary/20 text-primary/40 hover:text-primary transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {attachedDocs.length > 0 && (
        <div className="w-full flex flex-wrap gap-2 mb-3">
          {attachedDocs.map(doc => (
            <div
              key={doc.id}
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs"
            >
              <Paperclip className="w-3 h-3" />
              {doc.filename}
              <button onClick={() => onRemoveDoc(doc.id)}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        }}
        onPaste={handlePaste}
        placeholder={placeholder}
        className="w-full bg-transparent resize-none outline-none focus:ring-0 text-sm placeholder:text-muted/40"
        style={{ padding: 0, lineHeight: '1.5' }}
      />

      <div className="w-full flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onAttachFile}
              className="text-muted hover:text-primary transition"
            >
              <Plus className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-white">Attach files</TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleVoiceListening}
                title={isListening ? "Stop listening" : "Start voice typing"}
                className={`flex items-center w-6 h-6 justify-center rounded-full transition ${isListening
                  ? "bg-red-500/20 text-red-500 border border-red-500/30"
                  : "text-muted hover:text-primary hover:bg-primary/10"
                  }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="text-white">{isListening ? "Stop listening" : "Voice typing"}</TooltipContent>
          </Tooltip>

          {input.trim() ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={sendMessage}
                  disabled={isLoading}
                  className={`flex items-center justify-center w-6 h-6 rounded-full transition
            ${isLoading
                      ? "bg-muted/20 text-muted/40"
                      : "bg-primary text-white hover:scale-105 active:scale-90 shadow-sm hover:shadow-md"
                    }`}
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="text-white">Send message</TooltipContent>
            </Tooltip>
          ) : (
            <VoiceMic userEmail={userEmail} />
          )}
        </div>
      </div>
    </div>
  );
};

// ── Live clock (center) ───────────────────────────────────────────────────────
function DateTimeDisplay() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex items-center gap-1.5">
      <Clock className="w-3 h-3 text-muted/60" />
      <span className="text-[10px] font-semibold text-muted/70">{dateStr}</span>
      <span className="text-[10px] font-bold text-muted">{timeStr}</span>
    </div>
  );
}

// ── Upcoming meetings pill (right) ────────────────────────────────────────────
function UpcomingMeetings({ userEmail }: { userEmail: string }) {
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userEmail) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    apiService
      .getEvents(userEmail, start.toISOString(), end.toISOString(), 10)
      .then(res => {
        const upcoming = (res?.events || [])
          .filter(e => new Date(e.start) >= new Date())
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        setMeetings(upcoming);
      })
      .catch(() => {/* calendar optional */ });
  }, [userEmail]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const next = meetings[0];
  if (!next) return null;

  // Prefer the direct video join link; fall back to calendar event page
  const joinHref = (m: CalendarEvent) => m.meetLink || m.htmlLink || '/workspace/calendar';
  const isExternal = (m: CalendarEvent) => !!(m.meetLink || m.htmlLink);

  return (
    <div ref={dropdownRef} className="relative flex items-center">
      <div className="flex items-center rounded-md border border-primary/20">
        {/* Main pill - opens the join link directly */}
        <Link
          href={joinHref(next)}
          target={isExternal(next) ? '_blank' : '_self'}
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 p-1.5 group transition-colors"
        >
          <Calendar className="w-3 h-3 text-primary/70 group-hover:text-primary shrink-0" />
          <span className="text-[10px] font-semibold text-primary/80 group-hover:text-primary max-w-[160px] truncate">
            {fmt(next.start)} · {next.summary || 'Meeting'}
          </span>
          <ExternalLink className="w-2.5 h-2.5 text-primary/40 group-hover:text-primary shrink-0" />
        </Link>

        {/* Chevron - only when there are more meetings */}
        {meetings.length > 1 && (
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className="flex items-center gap-0.5 rounded-r-md p-2 bg-primary/10 hover:bg-primary/15 transition-colors"
          >
            <span className="text-[9px] font-bold text-primary/60">+{meetings.length - 1}</span>
            <ChevronDown
              className={`w-2.5 h-2.5 text-primary/50 transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Dropdown - all upcoming meetings, each linking to their join page */}
      {dropdownOpen && (
        <div className="absolute top-full right-0 mt-2 w-[calc(100vw-32px)] max-w-72 rounded-xl border border-border/30 bg-background shadow-xl z-50 py-1.5 overflow-hidden">
          <p className="px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-muted/50 border-b border-border/10">
            Today&apos;s meetings
          </p>
          {meetings.map(m => (
            <Link
              key={m.id}
              href={joinHref(m)}
              target={isExternal(m) ? '_blank' : '_self'}
              rel="noopener noreferrer"
              onClick={() => setDropdownOpen(false)}
              className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-surface/60 transition-colors group"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0 mt-1" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                  {m.summary || 'Meeting'}
                </p>
                <p className="text-[10px] text-muted mt-0.5">
                  {fmt(m.start)}{m.end && ` – ${fmt(m.end)}`}
                </p>
                {m.meetLink && (
                  <p className="text-[9px] text-primary/50 mt-0.5 font-semibold uppercase tracking-wide">
                    Join link ready
                  </p>
                )}
              </div>
              <ExternalLink className="w-3 h-3 text-muted/30 group-hover:text-primary/50 transition-colors shrink-0 mt-0.5" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mobile Schedule Modal (bottom sheet) ─────────────────────────────────────────
function MobileScheduleModal({ userEmail, onClose }: { userEmail: string; onClose: () => void }) {
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  useEffect(() => {
    if (!userEmail) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    apiService.getEvents(userEmail, start.toISOString(), end.toISOString(), 10)
      .then(res => {
        const upcoming = (res?.events || []).filter(e => new Date(e.start) >= new Date()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        setMeetings(upcoming);
      }).catch(() => { });
  }, [userEmail]);

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const joinHref = (m: CalendarEvent) => m.meetLink || m.htmlLink || '/workspace/calendar';
  const isExternal = (m: CalendarEvent) => !!(m.meetLink || m.htmlLink);

  return (
    <div className="md:hidden" style={{ position: 'fixed', inset: 0, zIndex: 120 }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      />
      {/* Drawer panel */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 'auto', maxHeight: '80vh',
        background: 'var(--background)',
        borderRadius: '20px 20px 0 0',
        border: '0.5px solid var(--border-light)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 -16px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Handle & Header */}
        <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-light)', margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '0.5px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar className="w-4 h-4 text-primary" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>Today&apos;s Schedule</span>
            </div>
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Current Date & Time block */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-surface/50 border border-border/60">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">Current Time</span>
            <DateTimeDisplay />
          </div>

          <div>
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 block">Upcoming Meetings</span>
            {meetings.length === 0 ? (
              <p className="text-[12px] text-muted/70 text-center py-6 bg-surface/30 rounded-xl border border-border/20 border-dashed">No upcoming meetings today.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {meetings.map(m => (
                  <Link
                    key={m.id}
                    href={joinHref(m)}
                    target={isExternal(m) ? '_blank' : '_self'}
                    rel="noopener noreferrer"
                    onClick={onClose}
                    className="flex flex-col gap-1 p-3 rounded-xl border border-border/60 hover:bg-surface/50 transition-colors bg-surface/20"
                  >
                    <p className="text-[13px] font-semibold text-foreground leading-snug">{m.summary || 'Meeting'}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[11px] font-medium text-primary/80">{fmt(m.start)}{m.end && ` - ${fmt(m.end)}`}</p>
                      <ExternalLink className="w-3.5 h-3.5 text-muted/40" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CentralCommand({
  messages,
  isLoading,
  input,
  setInput,
  sendMessage,
  onAttachFile,
  onDirectFileUpload,
  attachedDocs,
  onRemoveDoc,
  onPreviewDoc,
  userEmail,
  messagesEndRef,
  contactsOpen,
  onToggleContacts,
  selectedAgent,
  onClearAgent,
  onOpenMobileSidebar,
  onNewChat,
  streamingStatuses,
  onEditMessage,
  onRegenerate,
  onFeedback,
  hasAgents = true,
  sidebarCollapsed,
  onToggleSidebar,
  userName,
}: {
  messages: any[];
  isLoading: boolean;
  input: string;
  setInput: (val: string) => void;
  sendMessage: () => void;
  onAttachFile: () => void;
  onDirectFileUpload?: (file: File) => Promise<void>;
  attachedDocs: { id: string; filename: string; uploading?: boolean }[];
  onRemoveDoc: (id: string) => void;
  onPreviewDoc?: (id: string, filename: string) => void;
  userEmail: string;
  userName?: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  contactsOpen?: boolean;
  onToggleContacts?: () => void;
  onNewChat?: () => void;
  currentSessionId?: number | null;
  selectedAgent?: { name: string } | null;
  onClearAgent?: () => void;
  streamingStatuses?: string[];
  onOpenMobileSidebar?: () => void;
  onEditMessage?: (index: number, newContent: string) => void;
  onRegenerate?: () => void;
  onFeedback?: (messageId: string, rating: number, content: string) => void;
  hasAgents?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editAreaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const [readingMessageId, setReadingMessageId] = useState<string | null>(null);
  const [feedbackState, setFeedbackState] = useState<Record<string, 'up' | 'down'>>({});

  const handleReadAloud = (messageId: string, text: string) => {
    if (readingMessageId === messageId) {
      window.speechSynthesis.cancel();
      setReadingMessageId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setReadingMessageId(null);
    utterance.onerror = () => setReadingMessageId(null);
    setReadingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  };
  const [isDragOver, setIsDragOver] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showDayName, setShowDayName] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowDayName(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleFileDrop = (file: File) => {
    if (onDirectFileUpload) onDirectFileUpload(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(i => i.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) handleFileDrop(new File([file], `pasted-image-${Date.now()}.${file.type.split('/')[1] || 'png'}`, { type: file.type }));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => handleFileDrop(f));
  };
  const [isListening, setIsListening] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);

  const dynamicContent = useMemo(() => getDynamicContent(userName || "there"), [userName]);

  const hasMessages = messages.length > 0 || isLoading;
  const suggestedPrompts = dynamicContent.prompts;



  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const w = window as WindowWithSpeech;
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (SR) {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;

        rec.onresult = (event: ISpeechRecognitionEvent) => {
          let sessionTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            sessionTranscript += event.results[i][0].transcript;
          }

          const baseText = textareaRef.current?.dataset.baseText || '';
          const isFinal = event.results[event.results.length - 1].isFinal;

          const newText = baseText.trim()
            ? `${baseText.trim()} ${sessionTranscript}`
            : sessionTranscript;

          setInput(newText + (isFinal ? '' : ' (listening...)'));
        };

        rec.onend = () => {
          setIsListening(false);
          setInput(input.replace(/\s*\(listening...\)$/i, ''));
        };

        recognitionRef.current = rec;
      }
    }
  }, [input, setInput]);

  // Toggle voice listening
  const toggleVoiceListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      if (textareaRef.current) {
        textareaRef.current.dataset.baseText = input;
      }
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    if (editAreaRef.current) {
      editAreaRef.current.style.height = 'auto';
      editAreaRef.current.style.height = `${editAreaRef.current.scrollHeight}px`;
    }
  }, [editValue, editingIndex]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, messagesEndRef]);

  return (
    <TooltipProvider>
      <div className="flex h-full w-full bg-background text-foreground relative overflow-hidden">
        {/* ── MAIN CHAT AREA ── */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Mobile Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 md:hidden bg-background/50 backdrop-blur-xl sticky top-0 z-[20]">
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenMobileSidebar}
                className="p-1.5 rounded-lg border border-border/40 bg-surface/40 text-muted active:scale-95 transition-all"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
              <div className="flex flex-col">
                <span className="text-[13px] font-bold tracking-tight">Assistant Fleet</span>
                <span className="text-[10px] text-muted leading-none">Chat & Tasks</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMobileCalendarOpen(true)}
                className="p-1.5 rounded-lg border border-border/40 bg-surface/40 text-muted active:scale-95 transition-all"
              >
                <Calendar className="w-4 h-4" />
              </button>
              <button
                onClick={onNewChat}
                className="p-1.5 rounded-lg border border-border/40 bg-surface/40 text-muted active:scale-95 transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Desktop Sidebar Toggle (when collapsed) */}
          {sidebarCollapsed && (
            <div className="items-center p-2 md:flex hidden">
              <button
                onClick={onToggleSidebar}
                title="Expand Sidebar"
                className="p-1.5 rounded-lg border border-border/40 hover:bg-surface transition-colors"
              >
                <PanelLeftOpen className="w-5 h-5 text-muted hover:text-primary" />
              </button>
            </div>
          )}


          {/* ── CONTENT AREA ── */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-6 custom-scrollbar">
            {!hasMessages ? (
              <div className="flex h-full flex-col items-center justify-center text-center px-4">
                
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                >
                  <h1 className="text-3xl sm:text-5xl font-medium tracking-tight text-foreground/90 font-serif mb-2 h-[1.2em] flex items-center justify-center">
                    <AnimatePresence mode="wait">
                      {showDayName ? (
                        <motion.span
                          key="day"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                        >
                          {dynamicContent.dayGreeting}
                        </motion.span>
                      ) : (
                        <motion.span
                          key="greeting"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                        >
                          {dynamicContent.greeting}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </h1>

                  <p className="mt-2 text-base sm:text-lg text-muted/60 font-medium">
                    {dynamicContent.subtitle}
                  </p>
                </motion.div>

                <div className="w-full max-w-3xl mt-8">
                  <CommandInput
                    input={input}
                    setInput={setInput}
                    sendMessage={sendMessage}
                    onAttachFile={onAttachFile}
                    attachedDocs={attachedDocs}
                    onRemoveDoc={onRemoveDoc}
                    textareaRef={textareaRef}
                    handlePaste={handlePaste}
                    handleDrop={handleDrop}
                    isDragOver={isDragOver}
                    setIsDragOver={setIsDragOver}
                    toggleVoiceListening={toggleVoiceListening}
                    isListening={isListening}
                    isLoading={isLoading}
                    placeholder="Ask anything - or paste / drop an image"
                    userEmail={userEmail}
                    selectedAgent={selectedAgent}
                    onClearAgent={onClearAgent}
                  />

                  {/* Suggested Prompts */}
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    {suggestedPrompts.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setInput(s.prompt);
                          if (textareaRef.current) {
                            textareaRef.current.focus();
                            // Trigger auto-expand
                            textareaRef.current.style.height = 'auto';
                            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
                          }
                        }}
                        className="flex flex-col items-start gap-1 p-2 rounded-xl border border-border/40 bg-surface/40 hover:bg-surface-hover hover:border-primary/30 transition-all text-left group"
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="transition-colors">
                            {React.cloneElement(s.icon as React.ReactElement<any>, { className: "w-3.5 h-3.5 text-primary" })}
                          </div>
                          <span className="text-xs font-medium text-foreground">{s.title}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto p-1 md:p-6">
                {messages.map((message, idx) => (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut", delay: idx * 0.05 }}
                    key={message.id}
                    className={`flex ${message.type === "user" ? "justify-end" : "justify-start"} w-full group/message py-2`}
                  >
                    <div className={`${message.type === "user" && editingIndex !== idx ? "max-w-[85%] sm:max-w-[70%]" : "w-[100%]"} relative ${editingIndex === idx ? "w-full" : ""}`}>
                      {message.type === "agent" ? (
                        <div className="flex flex-col gap-3 group relative pt-1">
                          <div className="text-[14px] leading-7 text-foreground/80">
                            <MarkdownRenderer
                              content={message.content}
                              isStreaming={message.isStreaming}
                              userEmail={userEmail}
                            />
                          </div>

                          {!message.isStreaming && (
                            <div className="flex items-center gap-1 opacity-0 group-hover/message:opacity-100 transition-opacity">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleReadAloud(message.id, message.content)}
                                    className={`p-1.5 rounded-lg hover:bg-surface-dark transition-all ${readingMessageId === message.id ? 'text-primary' : 'text-muted/50 hover:text-foreground'}`}
                                  >
                                    {readingMessageId === message.id ? <VolumeX className="w-4 h-4 fill-current" /> : <Volume2 className="w-4 h-4" />}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="text-white">{readingMessageId === message.id ? "Stop reading" : "Read aloud"}</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => navigator.clipboard.writeText(message.content)}
                                    className="p-1.5 rounded-lg hover:bg-surface-dark text-muted/50 hover:text-foreground transition-all"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="text-white">Copy message</TooltipContent>
                              </Tooltip>

                              {idx === messages.length - 1 && onRegenerate && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={onRegenerate}
                                      className="p-1.5 rounded-lg hover:bg-surface-dark text-muted/50 hover:text-foreground transition-all"
                                    >
                                      <RefreshCcw className="w-3.5 h-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-white">Regenerate response</TooltipContent>
                                </Tooltip>
                              )}

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => {
                                      setFeedbackState(prev => ({ ...prev, [message.id]: 'up' }));
                                      onFeedback?.(message.id, 5, message.content);
                                    }}
                                    className={`p-1.5 rounded-lg hover:bg-surface-dark transition-all ${feedbackState[message.id] === 'up' ? 'text-green-500' : 'text-muted/50 hover:text-foreground'}`}
                                  >
                                    <ThumbsUp className={`w-3.5 h-3.5 ${feedbackState[message.id] === 'up' ? 'fill-current' : ''}`} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="text-white">Good response</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => {
                                      setFeedbackState(prev => ({ ...prev, [message.id]: 'down' }));
                                      onFeedback?.(message.id, 1, message.content);
                                    }}
                                    className={`p-1.5 rounded-lg hover:bg-surface-dark transition-all ${feedbackState[message.id] === 'down' ? 'text-red-500' : 'text-muted/50 hover:text-foreground'}`}
                                  >
                                    <ThumbsDown className={`w-3.5 h-3.5 ${feedbackState[message.id] === 'down' ? 'fill-current' : ''}`} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="text-white">Bad response</TooltipContent>
                              </Tooltip>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="group/user flex flex-col items-end gap-2">
                          {editingIndex === idx ? (
                            <div className="w-full bg-gradient-to-br from-primary/95 to-primary/80 border border-white/10 rounded-3xl p-5 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                              <textarea
                                ref={editAreaRef}
                                value={editValue}
                                onChange={e => {
                                  setEditValue(e.target.value);
                                  e.target.style.height = 'auto';
                                  e.target.style.height = e.target.scrollHeight + 'px';
                                }}
                                className="w-full min-h-[40px] max-h-[300px] bg-transparent text-white text-[15px] leading-relaxed outline-none resize-none placeholder:text-white/30 mb-4"
                                placeholder="Edit your message..."
                                autoFocus
                                style={{ height: 'auto' }}
                              />
                              <div className="flex justify-end items-center gap-3">
                                <button
                                  onClick={() => setEditingIndex(null)}
                                  className="px-5 py-2 rounded-full text-sm font-medium bg-white/10 text-white/90 hover:bg-white/20 transition-all active:scale-95 border border-white/5"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => {
                                    if (onEditMessage) onEditMessage(idx, editValue);
                                    setEditingIndex(null);
                                  }}
                                  className="px-6 py-2 rounded-full text-sm font-bold bg-white text-primary hover:bg-gray-50 transition-all active:scale-95 shadow-lg"
                                >
                                  Send
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="bg-primary text-white px-6 py-3.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap shadow-sm hover:bg-primary/80 transition-colors">
                                {message.attachments && message.attachments.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mb-3">
                                    {message.attachments.map((file: { id: string; filename: string }) => (
                                      <button
                                        key={file.id}
                                        onClick={() => onPreviewDoc?.(file.id, file.filename)}
                                        className="truncate max-w-[150px] flex items-center gap-1.5 px-2.5 py-1.5 bg-primary border border-white/10 rounded-xl text-xs text-white/70 hover:bg-white/10 transition-colors"
                                      >
                                        {file.filename}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {message.content}
                              </div>

                              {!isLoading && (
                                <div className="flex items-center gap-2 pr-2 opacity-0 group-hover/user:opacity-100 transition-opacity">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={() => navigator.clipboard.writeText(message.content)}
                                        className="p-1.5 rounded-lg hover:bg-surface text-muted/40 hover:text-foreground transition-all"
                                      >
                                        <Copy className="w-4 h-4" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className='text-white'>Copy message</TooltipContent>
                                  </Tooltip>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={() => {
                                          setEditingIndex(idx);
                                          setEditValue(message.content);
                                        }}
                                        className="p-1.5 rounded-lg hover:bg-surface text-muted/40 hover:text-foreground transition-all"
                                      >
                                        <Pencil className="w-4 h-4" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className='text-white'>Edit prompt</TooltipContent>
                                  </Tooltip>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}

                {isLoading && !(messages.length > 0 && messages[messages.length - 1].type === 'agent' && !messages[messages.length - 1].isStreaming) && (
                  <div className="flex justify-start">
                    <StatusLoader statuses={streamingStatuses || []} />
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* ── BOTTOM INPUT (ONLY IN CHAT MODE) ── */}
          {hasMessages && (
            <div className="w-full max-w-3xl mx-auto my-3 sm:my-4 px-4">
              <CommandInput
                input={input}
                setInput={setInput}
                sendMessage={sendMessage}
                onAttachFile={onAttachFile}
                attachedDocs={attachedDocs}
                onRemoveDoc={onRemoveDoc}
                textareaRef={textareaRef}
                handlePaste={handlePaste}
                handleDrop={handleDrop}
                isDragOver={isDragOver}
                setIsDragOver={setIsDragOver}
                toggleVoiceListening={toggleVoiceListening}
                isListening={isListening}
                isLoading={isLoading}
                placeholder="Ask anything or attach or drag/drop an image or files..."
                userEmail={userEmail}
                selectedAgent={selectedAgent}
                onClearAgent={onClearAgent}
              />
            </div>
          )}
        </div>
      </div>

      {mobileCalendarOpen && (
        <MobileScheduleModal
          userEmail={userEmail}
          onClose={() => setMobileCalendarOpen(false)}
        />
      )}
    </TooltipProvider>
  );
}
