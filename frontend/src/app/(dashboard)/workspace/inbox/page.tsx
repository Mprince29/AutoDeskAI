"use client";
import { toastError, toastSuccess } from "@/lib/friendly-errors";
import AIAgentPanel from "@/components/shared/AIAgentPanel";
import AIReplyModal from "./_components/AIReplyModal";
import EmailComposeModal from "./_components/EmailComposeModal";
import EmailDetailModal from "./_components/EmailDetailModal";
import EmailNotificationPanel from "./_components/EmailNotificationPanel";
import EmailSections from "./_components/EmailSections";
import { useAuth } from "@/context/AuthContext";
import { Email, apiService } from "@/services/api";
import {
  Mail,
  Search,
  Sparkles,
  X,
  Bell,
  Loader2,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { SiGmail } from "react-icons/si";
import { AppLogo } from "@/components/shared/AppLogo";

export default function InboxPage() {
  const { user, loading, preferences } = useAuth();
  const router = useRouter();
  const {
    emails,
    setEmails,
    isMonitoring,
    setIsMonitoring,
    monitoringLoading,
    setMonitoringLoading,
    notificationsCount,
    setNotificationsCount,
    autoReplyEnabled,
    setAutoReplyEnabled,
    fetchInboxOnly,
    fetchMonitoringStatus,
    fetchNotifications,
    fetchAutoReplySettings,
  } = useWorkspaceStore();

  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [isReplyModalOpen, setIsReplyModalOpen] = useState(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const [isEmailDetailModalOpen, setIsEmailDetailModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [, setAgentStatus] = useState<{ enabled: boolean; status: string } | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);

  // ── Auto-reply state (local) ────────────────────────────────────────────────
  const [autoReplyLoading, setAutoReplyLoading] = useState(false);
  const [showAutoReplyGate, setShowAutoReplyGate] = useState(false);
  const [pendingAutoReply, setPendingAutoReply] = useState<{
    id: number; sender: string; subject: string; draft: string; deadline: string;
  } | null>(null);
  const [autoReplyCountdown, setAutoReplyCountdown] = useState(120);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/auth");
  }, [user, loading, router]);

  // Fetch initial data
  useEffect(() => {
    if (user?.email && preferences?.gmail_connected) {
      fetchInboxOnly(user.email);
      fetchMonitoringStatus(user.email);
      fetchNotifications(user.email);
      fetchAutoReplySettings(user.email);
    }
  }, [user?.email, preferences?.gmail_connected, fetchInboxOnly, fetchMonitoringStatus, fetchNotifications, fetchAutoReplySettings]);

  useEffect(() => {
    if (!user?.email) return;
    const base = process.env.NEXT_PUBLIC_API_URL;
    const es = new EventSource(`${base}/api/automated/updates?email=${encodeURIComponent(user.email)}`);
    const onUpdated = () => {
      if (!preferences?.gmail_connected) return;
      fetchNotifications(user.email);
      fetchInboxOnly(user.email, true);
    };
    const onAutoReplyPending = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const deadlineSec = Math.max(
          10,
          Math.round((new Date(data.deadline).getTime() - Date.now()) / 1000)
        );
        // Reset counter BEFORE setting pendingAutoReply so the interval effect
        // picks up the fresh value when it starts
        setAutoReplyCountdown(deadlineSec);
        setPendingAutoReply(data);
      } catch { /* ignore malformed payload */ }
    };
    es.addEventListener('updated', onUpdated);
    es.addEventListener('auto_reply_pending', onAutoReplyPending);
    es.onerror = () => { try { es.close(); } catch { } };
    return () => {
      try { es.removeEventListener('updated', onUpdated); } catch { }
      try { es.removeEventListener('auto_reply_pending', onAutoReplyPending); } catch { }
      try { es.close(); } catch { }
    };
  }, [user?.email, fetchNotifications, fetchInboxOnly]);


  // Countdown ticker - starts/clears with the modal, never re-registers per-tick
  useEffect(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (!pendingAutoReply) return;

    countdownIntervalRef.current = setInterval(() => {
      setAutoReplyCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownIntervalRef.current!);
          countdownIntervalRef.current = null;
          setPendingAutoReply(null); // backend sent it - dismiss modal
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [pendingAutoReply]); // only re-run when a new pending reply arrives or clears

  const _toggleMonitoring = async () => {
    if (!user?.email) return;
    setMonitoringLoading(true);
    // Optimistic toggle
    const next = !isMonitoring;
    setIsMonitoring(next);
    try {
      if (!next) {
        await apiService.stopEmailMonitoring(user.email);
      } else {
        await apiService.startEmailMonitoring(user.email);
        // Fire inbox + notifications refresh in parallel
        Promise.allSettled([fetchInboxOnly(user.email, true), fetchNotifications(user.email)]);
      }
    } catch {
      setIsMonitoring(!next); // roll back
      toastError("Failed to toggle monitoring.");
    } finally { setMonitoringLoading(false); }
  };

  // ── Auto-reply helpers ────────────────────────────────────────────────────

  const _enableAutoReply = async () => {
    if (!user?.email) return;
    setAutoReplyLoading(true);
    const base = process.env.NEXT_PUBLIC_API_URL;
    try {
      const res = await fetch(
        `${base}/api/proactive/auto-reply/settings?email=${encodeURIComponent(user.email)}`,
        { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) }
      );
      if (res.ok) { setAutoReplyEnabled(true); toastSuccess("Auto-reply enabled."); }
      else toastError("Failed to enable auto-reply.");
    } catch { toastError("Failed to enable auto-reply."); }
    finally { setAutoReplyLoading(false); setShowAutoReplyGate(false); }
  };

  const _disableAutoReply = async () => {
    if (!user?.email) return;
    setAutoReplyLoading(true);
    const base = process.env.NEXT_PUBLIC_API_URL;
    try {
      const res = await fetch(
        `${base}/api/proactive/auto-reply/settings?email=${encodeURIComponent(user.email)}`,
        { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) }
      );
      if (res.ok) { setAutoReplyEnabled(false); toastSuccess("Auto-reply disabled."); }
    } catch { /* ignore */ }
    finally { setAutoReplyLoading(false); }
  };

  const _cancelAutoReply = async (id: number) => {
    if (!user?.email) return;
    const base = process.env.NEXT_PUBLIC_API_URL;
    try {
      await fetch(
        `${base}/api/proactive/auto-reply/${id}?email=${encodeURIComponent(user.email)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      setPendingAutoReply(null);
      toastSuccess("Auto-reply cancelled.");
    } catch { toastError("Could not cancel auto-reply."); }
  };

  const checkAgentStatus = useCallback(async () => {
    if (!user) return;
    try {
      const status = await apiService.getLegacyAgentStatus(user.email);
      setAgentStatus(status);
    } catch (error) { console.error('Error checking agent status:', error); }
  }, [user]);

  useEffect(() => { if (user) checkAgentStatus(); }, [user, checkAgentStatus]);

  const handleReply = (emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (email) { setSelectedEmail(email); setIsReplyModalOpen(true); }
  };

  const handleSchedule = async (emailId: string) => {
    if (!user?.email) return;
    try {
      await apiService.scheduleMeeting(user.email, emailId);
      await fetchInboxOnly(user.email, true);
      toastSuccess("Meeting scheduled successfully.");
    }
    catch { toastError("Schedule protocol failed."); }
  };

  const handleModifyLabels = async (emailId: string, add?: string[], remove?: string[]) => {
    if (!user) return;
    // Optimistic: update labels locally without waiting for re-fetch
    setEmails(prev => prev.map(e => {
      if (e.id !== emailId) return e;
      const current = e.labelIds ?? [];
      const next = [...new Set([...current, ...(add ?? [])].filter(l => !(remove ?? []).includes(l)))];
      return { ...e, labelIds: next };
    }));
    try {
      await apiService.modifyLabels(user.email, emailId, add, remove);
    } catch {
      toastError("Metadata modification failed.");
      fetchInboxOnly(user.email, true); // restore on failure
    }
  };

  const handleEmailClick = (email: Email) => { setSelectedEmail(email); setIsEmailDetailModalOpen(true); };

  const filteredEmails = useMemo(() => emails.filter(email => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return email.subject?.toLowerCase().includes(s) || email.from?.toLowerCase().includes(s) || email.snippet?.toLowerCase().includes(s);
  }), [emails, searchTerm]);

  return (
    <div className="relative h-full w-full flex flex-col text-foreground overflow-hidden bg-background">
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* COMMAND BAR - responsive two-row on mobile */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 bg-background/50 backdrop-blur-xl gap-2 sm:gap-0">
          {/* Row 1 on mobile: icon + title + action buttons */}
          <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                <SiGmail className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-sm font-black text-foreground tracking-tight leading-none uppercase">Smart Inbox</h1>
                <p className="text-[10px] text-muted mt-1" style={{ maxWidth: 260, lineHeight: 1.4 }}>
                  Auto-sorts, monitors & replies to your emails.
                </p>
              </div>
            </div>

            {/* Action buttons - moved next to title on mobile */}
            <div className="flex sm:hidden items-center gap-2">
              <div className="flex items-center bg-surface/40 p-1 rounded-xl border border-border/10">
                {/* <button
                  onClick={_toggleMonitoring}
                  disabled={monitoringLoading}
                  className={clsx("p-2 rounded-lg transition-all", isMonitoring ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-muted hover:text-foreground")}
                  title={isMonitoring ? "Auto-Sync Active" : "Start Auto-Sync"}
                >
                  {monitoringLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                </button> */}
                {/* Auto-reply toggle - mobile */}
                <button
                  onClick={() => autoReplyEnabled ? _disableAutoReply() : setShowAutoReplyGate(true)}
                  disabled={autoReplyLoading}
                  className={clsx("p-1.5 rounded-lg transition-all", autoReplyEnabled ? "bg-red-500/15 text-red-400" : "text-muted hover:text-foreground")}
                  title={autoReplyEnabled ? "Auto-Reply ON - click to disable" : "Enable Auto-Reply"}
                >
                  {autoReplyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="text-xs leading-none">🤖</span>}
                </button>
                <button onClick={() => fetchInboxOnly(user?.email || "", true)} disabled={monitoringLoading} className="p-2 text-muted hover:text-foreground hover:bg-surface/60 rounded-lg transition-all" title="Force Refresh">
                  <RefreshCw className={clsx("w-3.5 h-3.5", monitoringLoading && "animate-spin")} />
                </button>
              </div>
            </div>
          </div>

          {/* Row 2 on mobile: search bar */}
          <div className="flex-1 sm:max-w-2xl sm:px-8">
            <div className="relative group">
              <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted group-focus-within:text-primary transition-colors" />
              <input
                type="text"
                placeholder="Search emails..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-surface/50 border border-border/40 hover:border-border-light focus:border-primary/40 focus:bg-background rounded-2xl pl-9 sm:pl-12 pr-4 py-2.5 text-sm transition-all focus:ring-4 focus:ring-primary/5 outline-none"
              />
            </div>
          </div>

          {/* Action buttons - desktop only */}
          <div className="hidden sm:flex items-center gap-3">
            <div className="flex items-center bg-surface/40 p-1 rounded-xl border border-border/10">
              <button onClick={() => fetchInboxOnly(user?.email || "", true)} disabled={monitoringLoading} className="p-2 text-muted hover:text-foreground hover:bg-surface/60 rounded-lg transition-all" title="Force Refresh">
                <RefreshCw className={clsx("w-4 h-4", monitoringLoading && "animate-spin")} />
              </button>
            </div>

            {/* Auto-reply toggle - desktop */}
            <button
              onClick={() => autoReplyEnabled ? _disableAutoReply() : setShowAutoReplyGate(true)}
              disabled={autoReplyLoading}
              className={clsx(
                "flex items-center gap-1.5 p-3 rounded-xl text-xs font-semibold border transition-all",
                autoReplyEnabled
                  ? "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15"
                  : "bg-surface/40 border-border/10 text-muted hover:text-foreground hover:bg-surface/60"
              )}
              title={autoReplyEnabled ? "Auto-Reply is ON - click to disable" : "Enable Auto-Reply"}
            >
              {autoReplyLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <span className="text-sm leading-none">{autoReplyEnabled ? '🤖' : '💤'}</span>}
              Auto-Reply
              <span className={clsx("text-[10px] font-bold", autoReplyEnabled ? "text-red-400" : "text-muted")}>
                {autoReplyEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>

        {/* MAIN BODY */}
        <div className="flex-1 flex overflow-hidden min-h-0 bg-surface/20">
          {preferences && preferences.gmail_connected === false && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
              <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6 border border-primary/20">
                <Mail className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-black text-foreground mb-3">Connect your Gmail</h2>
              <p className="text-muted text-sm max-w-sm mb-8 leading-relaxed">
                Unlock the full power of AutoDeskAI. Connect your Google account to start monitoring, classifying, and auto-replying to your emails.
              </p>
              <button
                onClick={() => {
                  if (user?.email) {
                    window.location.href = apiService.getGmailAuthUrl(user.email);
                  }
                }}
                className="btn-primary px-8 py-3 rounded-2xl shadow-xl shadow-primary/20 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Link Google Account</span>
              </button>
            </div>
          ) : (
            <EmailSections
              emails={filteredEmails}
              isLoading={(monitoringLoading && filteredEmails.length === 0) || loading || !preferences}
              onRefresh={() => fetchInboxOnly(user?.email || "", true)}
              onReply={handleReply}
              onSchedule={handleSchedule}
              onMarkImportant={(id) => handleModifyLabels(id, ['IMPORTANT'])}
              onMarkSpam={(id) => handleModifyLabels(id, ['SPAM'])}
              onArchive={(id) => {
                const target = emails.find(e => e.id === id);
                if (!target) return;
                
                const hasInbox = target.labelIds?.includes('INBOX');
                if (hasInbox) {
                  // Archiving: Remove INBOX label
                  setEmails(prev => prev.map(e => e.id === id ? { ...e, labelIds: (e.labelIds || []).filter(l => l !== 'INBOX') } : e));
                  apiService.modifyLabels(user?.email || "", id, undefined, ['INBOX']).catch(() => fetchInboxOnly(user?.email || "", true));
                } else {
                  // Unarchiving: Add INBOX label
                  setEmails(prev => prev.map(e => e.id === id ? { ...e, labelIds: [...(e.labelIds || []), 'INBOX'] } : e));
                  apiService.modifyLabels(user?.email || "", id, ['INBOX'], undefined).catch(() => fetchInboxOnly(user?.email || "", true));
                }
              }}
              onDelete={(id) => {
                // Optimistic: remove immediately, restore on failure
                setEmails(prev => prev.filter(e => e.id !== id));
                apiService.deleteEmail(user?.email || "", id).catch(() => fetchInboxOnly(user?.email || "", true));
              }}
              onMoveToTrash={(id) => {
                setEmails(prev => prev.filter(e => e.id !== id));
                apiService.moveToTrash(user?.email || "", id).catch(() => fetchInboxOnly(user?.email || "", true));
              }}
              onEmailClick={handleEmailClick}
              onCompose={() => setIsComposeModalOpen(true)}
              onMarkRead={(id) => {
                // Optimistic: mark as read locally
                setEmails(prev => prev.map(e => e.id === id ? { ...e, read: true } : e));
                apiService.modifyLabels(user?.email || "", id, undefined, ['UNREAD']).catch(() => fetchInboxOnly(user?.email || "", true));
              }}
              onMarkUnread={(id) => {
                // Optimistic: mark as unread locally
                setEmails(prev => prev.map(e => e.id === id ? { ...e, read: false } : e));
                apiService.modifyLabels(user?.email || "", id, ['UNREAD'], undefined).catch(() => fetchInboxOnly(user?.email || "", true));
              }}
            />
          )}
        </div>
      </main>

      {/* MODALS & PANELS */}
      <EmailDetailModal email={selectedEmail} isOpen={isEmailDetailModalOpen} onClose={() => { setIsEmailDetailModalOpen(false); setSelectedEmail(null); }} onReply={handleReply} onSchedule={handleSchedule} onModifyLabels={handleModifyLabels} />
      {selectedEmail && <AIReplyModal email={selectedEmail} isOpen={isReplyModalOpen} onClose={() => setIsReplyModalOpen(false)} onReplySent={() => { setIsReplyModalOpen(false); fetchInboxOnly(user?.email || "", true); }} />}
      <EmailComposeModal isOpen={isComposeModalOpen} onClose={() => setIsComposeModalOpen(false)} onEmailSent={() => fetchInboxOnly(user?.email || "", true)} />
      <EmailNotificationPanel userEmail={user?.email || ""} isVisible={showNotifications} onToggleVisibility={() => setShowNotifications(false)} onNotificationClick={(id) => { const e = emails.find(x => x.id === id); if (e) { setSelectedEmail(e); setIsEmailDetailModalOpen(true); } }} onRefreshEmails={() => fetchInboxOnly(user?.email || "", true)} />

      {/* ── AI AGENT FAB ── */}
      {/* {isAgentOpen ? "" : <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setIsAgentOpen(!isAgentOpen)}
        className="fixed bottom-8 right-8 z-120 flex items-center justify-center"
        title="Open AI Agent"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
            <AppLogo width={32} height={32} alt="" className="w-8 h-8" />
          </motion.span>
        </AnimatePresence>
      </motion.button>} */}

      {/* ── AI AGENT RIGHT DRAWER ── */}
      <AnimatePresence>
        {isAgentOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="agent-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAgentOpen(false)}
              className="fixed inset-0 z-[115] bg-background/30 backdrop-blur-sm cursor-alias"
            />
            {/* Drawer */}
            <motion.div
              key="agent-drawer"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed top-0 right-0 h-full z-[116] w-full max-w-[420px] flex flex-col bg-surface/80 backdrop-blur-3xl border-l border-border/40 shadow-[-32px_0_80px_-20px_rgba(0,0,0,0.25)]"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-border/30 bg-background/30">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl flex items-center justify-center">
                    <AppLogo width={28} height={28} alt="" className="w-7 h-7" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-foreground tracking-tight">AI Assistant</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary/60">Email Co-Pilot</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAgentOpen(false)}
                  className="p-2 rounded-xl bg-surface/60 hover:bg-surface-hover border border-border/30 text-muted hover:text-foreground transition-all group"
                >
                  <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
                </button>
              </div>

              {/* Drawer content */}
              <div className="flex-1 overflow-y-auto">
                <AIAgentPanel
                  userEmail={user?.email || ""}
                  isExpanded={isAgentOpen}
                  onToggleExpanded={() => setIsAgentOpen(false)}
                  onProcessEmails={() => fetchInboxOnly(user?.email || "", true)}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Auto-reply DANGER GATE modal ── */}
      {showAutoReplyGate && (
        <div
          onClick={() => setShowAutoReplyGate(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 420, background: 'var(--background)',
              borderRadius: 16, border: '1.5px solid rgba(239,68,68,0.4)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
              overflow: 'hidden',
            }}
          >
            {/* Red header bar */}
            <div style={{ background: 'rgba(239,68,68,0.1)', padding: '16px 20px', borderBottom: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#ef4444' }}>Automatic Replies - Important Warning</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)' }}>AutoDeskAI will send emails for you automatically</p>
              </div>
            </div>
            {/* Body */}
            <div style={{ padding: '18px 20px' }}>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Once turned on, the AI will write and send responses to your emails for you.',
                  'We\'ll show you a popup 2 minutes before any email goes out so you can stop it.',
                  'If you don\'t stop the popup in time, the email will be sent and you can\'t take it back.',
                  'Turn this off if you\'re not at your computer or if you\'re expecting a very sensitive email.',
                  'Only use this if you\'re happy with how your AI assistant is currently working.',
                ].map((line, i) => (
                  <li key={i} style={{ fontSize: 11, color: 'var(--foreground)', lineHeight: 1.6 }}>{line}</li>
                ))}
              </ul>
            </div>
            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '0.5px solid var(--border-light)', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <button
                onClick={() => setShowAutoReplyGate(false)}
                style={{ padding: '8px 18px', borderRadius: 9, border: '0.5px solid var(--border-light)', background: 'transparent', color: 'var(--muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={_enableAutoReply}
                disabled={autoReplyLoading}
                style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: '#ef4444', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                I understand - Turn on Auto-Reply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Auto-reply COUNTDOWN modal ── */}
      {pendingAutoReply && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 300,
            width: 360, background: 'var(--background)',
            border: '1.5px solid rgba(239,68,68,0.35)',
            borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ background: 'rgba(239,68,68,0.08)', padding: '12px 14px', borderBottom: '0.5px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#ef4444' }}>Auto-reply sending in {autoReplyCountdown}s</p>
              <p style={{ margin: '1px 0 0', fontSize: 10, color: 'var(--muted)' }}>From: {pendingAutoReply.sender}</p>
            </div>
            {/* Countdown ring - simple progress bar */}
            <div style={{ fontSize: 18, fontWeight: 700, color: autoReplyCountdown <= 30 ? '#ef4444' : 'var(--muted)', minWidth: 36, textAlign: 'center' }}>
              {autoReplyCountdown}
            </div>
          </div>
          {/* Subject */}
          <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border-light)' }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--foreground)' }}>Re: {pendingAutoReply.subject}</p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              {pendingAutoReply.draft.length > 180 ? pendingAutoReply.draft.slice(0, 180) + '…' : pendingAutoReply.draft}
            </p>
          </div>
          {/* Actions */}
          <div style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
            <button
              onClick={() => _cancelAutoReply(pendingAutoReply.id)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              Stop & cancel
            </button>
            <button
              onClick={() => setPendingAutoReply(null)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', background: 'var(--surface)', color: 'var(--muted)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
            >
              Let it send
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
