"use client";
import { toastError, toastSuccess } from "@/lib/friendly-errors";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiService, FollowUp } from "@/services/api";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import {
  RefreshCw, CheckCircle2, XCircle, Edit3, Clock,
  Mail, Send, Loader2, AlertCircle, X, Save,
} from "lucide-react";

export default function FollowUpsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [fetching, setFetching] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editedDraft, setEditedDraft] = useState("");

  useEffect(() => {
    if (!loading && !user) router.push("/auth");
  }, [user, loading, router]);

  const loadPending = useCallback(async () => {
    if (!user?.email) return;
    setFetching(true);
    try {
      const res = await apiService.getPendingFollowUps(user.email);
      setFollowUps(res.follow_ups);
    } catch {
      toastError("Failed to load follow-ups");
    } finally {
      setFetching(false);
    }
  }, [user?.email]);

  useEffect(() => { if (user) loadPending(); }, [user, loadPending]);

  const handleScan = async () => {
    if (!user?.email) return;
    setScanning(true);
    try {
      const res = await apiService.getFollowUps(user.email, 14);
      setFollowUps(res.follow_ups);
      toastSuccess(`Scan complete - ${res.total} pending follow-ups`);
    } catch {
      toastError("Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (fu: FollowUp) => {
    if (!user?.email) return;
    setActionId(fu.id);
    try {
      const draft = editingId === fu.id ? editedDraft : undefined;
      await apiService.approveFollowUp(user.email, fu.id, draft);
      toastSuccess("Follow-up sent!");
      setEditingId(null);
      setFollowUps(prev => prev.filter(f => f.id !== fu.id));
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setActionId(null);
    }
  };

  const handleCancel = async (id: number) => {
    if (!user?.email) return;
    setActionId(id);
    try {
      await apiService.cancelFollowUp(user.email, id);
      toastSuccess("Follow-up dismissed");
      setFollowUps(prev => prev.filter(f => f.id !== id));
    } catch {
      toastError("Failed to dismiss");
    } finally {
      setActionId(null);
    }
  };

  const startEdit = (fu: FollowUp) => {
    setEditingId(fu.id);
    setEditedDraft(fu.draft_content ?? "");
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden p-6 gap-6">

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold" style={{ color: 'var(--foreground)' }}>Follow-Up Hunter</h1>
            <p className="text-[11px] text-muted/50 mt-0.5">AI-detected commitments awaiting your approval</p>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="btn-primary w-fit"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Scan Sent Mail
          </button>
        </div>

        {/* Stats pill */}
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted/50">
          <AlertCircle className="w-3.5 h-3.5" />
          {followUps.length} pending approval
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {fetching ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-primary/40" />
            </div>
          ) : followUps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-20">
              <CheckCircle2 className="w-12 h-12" />
              <span className="text-[10px] font-black uppercase tracking-widest">All clear - no pending follow-ups</span>
              <p className="text-[11px]">Click &quot;Scan Sent Mail&quot; to check for commitments</p>
            </div>
          ) : (
            followUps.map(fu => (
              <div key={fu.id} className="card-os !p-5 flex flex-col gap-4">
                <div className="glass-shine" />

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-primary/60 shrink-0" />
                      <span className="font-bold text-[13px] text-foreground/90 break-words line-clamp-2">{fu.subject}</span>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] text-muted/50 flex-wrap">
                      <span className="flex items-center gap-1"><Send className="w-3 h-3" /> To: {fu.recipient}</span>
                      {fu.created_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(fu.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 w-fit px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[9px] font-black uppercase tracking-widest">
                    Awaiting Approval
                  </span>
                </div>

                {/* Commitment */}
                <div className="bg-surface/50 border border-border/50 rounded-xl p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted/50 mb-1">Detected Commitment</p>
                  <p className="text-[12px] text-foreground/80 italic">&quot;{fu.commitment}&quot;</p>
                </div>

                {/* Draft */}
                {fu.draft_content && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted/50">AI Draft</p>
                    {editingId === fu.id ? (
                      <textarea
                        rows={6}
                        value={editedDraft}
                        onChange={e => setEditedDraft(e.target.value)}
                        className="w-full px-3 py-2.5 bg-background border border-primary/30 rounded-xl text-[12px] outline-none focus:ring-1 focus:ring-primary/30 resize-none font-mono"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-dark bg-surface/50 border border-border/30 rounded-xl p-3 max-h-40 overflow-y-auto custom-scrollbar">
                        {fu.draft_content}
                      </pre>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleApprove(fu)}
                    disabled={actionId === fu.id}
                    className="flex-1 btn-primary !rounded-xl !py-2.5 !text-[10px]"
                  >
                    {actionId === fu.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <CheckCircle2 className="w-4 h-4" />}
                    {editingId === fu.id ? "Send Edited Draft" : "Approve & Send"}
                  </button>

                  {fu.draft_content && editingId !== fu.id && (
                    <button
                      onClick={() => startEdit(fu)}
                      className="px-3 py-2.5 bg-surface border border-border rounded-xl text-foreground/70 hover:bg-surface-hover transition"
                      title="Edit draft before sending"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}

                  {editingId === fu.id && (
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-2.5 bg-surface border border-border rounded-xl text-muted/60 hover:bg-surface-hover transition"
                      title="Cancel edit"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => handleCancel(fu.id)}
                    disabled={actionId === fu.id}
                    className="px-3 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-xl transition"
                    title="Dismiss"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
