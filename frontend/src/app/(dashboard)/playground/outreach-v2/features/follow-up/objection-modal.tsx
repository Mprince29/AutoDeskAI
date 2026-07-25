"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  MessageSquare,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge } from "../../shared/ui-elements";
import type { Lead } from "../../state/types";
import type { ObjectionLog, ObjectionResult } from "@/services/sales.service";

interface ObjectionModalProps {
  lead: Lead | null;
  replyText?: string;
  open: boolean;
  onClose: () => void;
}

function SentimentIcon({ sentiment }: { sentiment?: string }) {
  if (sentiment === "positive") return <ThumbsUp size={13} className="text-success" />;
  if (sentiment === "objection") return <ThumbsDown size={13} className="text-error" />;
  return <MessageSquare size={13} className="text-muted-dark" />;
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  const toneMap: Record<string, "green" | "amber" | "grey"> = {
    positive: "green",
    objection: "grey",
    neutral: "amber",
  };
  return <Badge tone={toneMap[sentiment ?? "neutral"] ?? "grey"}>{sentiment ?? "neutral"}</Badge>;
}

export function ObjectionModal({ lead, replyText: defaultReply, open, onClose }: ObjectionModalProps) {
  const handleObjection = useOutreachStore((s) => s.handleObjection);
  const getObjectionHistory = useOutreachStore((s) => s.getObjectionHistory);

  const [replyText, setReplyText] = useState(defaultReply ?? "");
  const [result, setResult] = useState<ObjectionResult | null>(null);
  const [history, setHistory] = useState<ObjectionLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"analyze" | "history">("analyze");

  useEffect(() => {
    if (!open || !lead) return;
    setReplyText(defaultReply ?? "");
    setResult(null);
    loadHistory();
  }, [open, lead?.id]);

  const loadHistory = async () => {
    if (!lead) return;
    const numId = parseInt(lead.id);
    if (isNaN(numId)) return;
    setHistoryLoading(true);
    try {
      const logs = await getObjectionHistory(numId);
      setHistory(logs);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!lead || !replyText.trim()) return;
    const numId = parseInt(lead.id);
    if (isNaN(numId)) {
      setResult(mockResult(lead, replyText));
      return;
    }
    setLoading(true);
    try {
      const res = await handleObjection(numId, {
        reply_text: replyText,
        contact_name: `${lead.firstName} ${lead.lastName}`,
        company: lead.company,
      });
      setResult(res);
      await loadHistory();
    } catch {
      setResult(mockResult(lead, replyText));
    } finally {
      setLoading(false);
    }
  };

  const copyResponse = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!open || !lead) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface max-h-[88vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-foreground">Objection handler</h2>
            <p className="mt-0.5 text-xs text-muted-dark">
              {lead.firstName} {lead.lastName} · {lead.company}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTab(tab === "analyze" ? "history" : "analyze")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[11px] font-semibold text-muted-dark hover:bg-surface-hover transition-colors"
            >
              <Clock size={11} />
              History {history.length > 0 && `(${history.length})`}
            </button>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-surface-hover transition-colors">
              <X size={14} className="text-muted-dark" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {tab === "analyze" ? (
            <div className="p-6 space-y-5">
              {/* Reply input */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">
                  Their reply
                </label>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Paste the reply you received from this contact..."
                  rows={4}
                  className="mt-1.5 w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>

              <button
                onClick={handleAnalyze}
                disabled={!replyText.trim() || loading}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <AlertCircle size={13} />}
                {loading ? "Analyzing reply..." : "Analyze & suggest response"}
              </button>

              {/* Result */}
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <SentimentIcon sentiment={result.sentiment} />
                    <SentimentBadge sentiment={result.sentiment} />
                    {result.objection_type && (
                      <Badge tone="grey">{result.objection_type}</Badge>
                    )}
                  </div>

                  {result.summary && (
                    <div className="rounded-xl border border-border bg-background p-4">
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-dark">Summary</p>
                      <p className="text-xs text-foreground leading-relaxed">{result.summary}</p>
                    </div>
                  )}

                  {result.suggested_reply && (
                    <div className="space-y-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">
                        Suggested response
                      </p>
                      <div className="group relative rounded-xl border border-border bg-background p-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                            AI recommendation
                          </span>
                          <button
                            onClick={() => copyResponse(result.suggested_reply, "suggested")}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-dark hover:bg-surface-hover hover:text-foreground transition-colors"
                          >
                            {copied === "suggested" ? (
                              <CheckCircle2 size={11} className="text-success" />
                            ) : (
                              <Copy size={11} />
                            )}
                            {copied === "suggested" ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{result.suggested_reply}</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          ) : (
            <div className="p-6">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin text-primary" />
                </div>
              ) : history.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <Clock size={24} className="mx-auto mb-2 text-muted-dark/50" />
                  <p className="text-sm font-bold text-foreground">No history yet</p>
                  <p className="mt-1 text-xs text-muted-dark">Analyzed replies will appear here.</p>
                  <button
                    onClick={() => setTab("analyze")}
                    className="mt-3 text-xs font-semibold text-primary hover:underline"
                  >
                    Go to analyze tab
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-foreground">Past analyses</p>
                    <button onClick={loadHistory} disabled={historyLoading} className="p-1 text-muted-dark hover:text-foreground transition-colors">
                      <RefreshCw size={13} className={historyLoading ? "animate-spin" : ""} />
                    </button>
                  </div>
                  {history.map((log) => (
                    <div key={log.id} className="rounded-xl border border-border bg-background p-4 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <SentimentBadge sentiment={log.sentiment} />
                        {log.objection_type && <Badge tone="grey">{log.objection_type}</Badge>}
                        <span className="text-[11px] text-muted-dark ml-auto">
                          {new Date(log.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-dark italic line-clamp-2">"{log.reply_text}"</p>
                      {log.suggested_reply && (
                        <div className="pt-1 border-t border-border">
                          <p className="text-[11px] font-bold text-muted-dark uppercase tracking-wider mb-1 font-semibold">Suggested response</p>
                          <p className="text-xs text-foreground line-clamp-3">{log.suggested_reply}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function mockResult(lead: Lead, replyText: string): ObjectionResult {
  const isNegative = /not interested|don't need|busy|not the right|no thanks/i.test(replyText);
  return {
    contact_id: parseInt(lead.id) || 0,
    sentiment: isNegative ? "objection" : "neutral",
    objection_type: isNegative ? "not_interested" : "timing",
    summary: isNegative
      ? `${lead.firstName} has expressed they're not interested at this time.`
      : `${lead.firstName}'s response suggests some interest but possibly a timing or priority concern.`,
    suggested_reply: isNegative
      ? `Hi ${lead.firstName}, completely understand — no pressure at all. If timing changes or a relevant signal pops up for ${lead.company}, I'll reach out then.`
      : `Hi ${lead.firstName}, totally fair — happy to keep it brief. If it would be useful, I can send a 2-minute example mapped to ${lead.company}'s workflow?`,
    subject: `Re: ${lead.company}`,
  };
}
