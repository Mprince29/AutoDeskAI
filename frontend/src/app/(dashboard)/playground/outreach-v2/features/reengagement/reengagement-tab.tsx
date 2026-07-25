"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Loader2, RefreshCw, Send, X } from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import type { ReengagementEntry } from "@/services/sales.service";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

export function ReengagementTab() {
  const getReengagement = useOutreachStore((s) => s.getReengagement);
  const sendReengagementNow = useOutreachStore((s) => s.sendReengagementNow);
  const cancelReengagement = useOutreachStore((s) => s.cancelReengagement);

  const [entries, setEntries] = useState<ReengagementEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "sent" | "cancelled">("all");

  const load = async () => {
    setLoading(true);
    try {
      const data = await getReengagement(filter === "all" ? undefined : filter);
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter]);

  const handleSend = async (id: number) => {
    setPending(id);
    try {
      await sendReengagementNow(id);
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: "sent" } : e)));
    } finally {
      setPending(null);
    }
  };

  const handleCancel = async (id: number) => {
    setPending(id);
    try {
      await cancelReengagement(id);
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: "cancelled" } : e)));
    } finally {
      setPending(null);
    }
  };

  const pendingEntries = entries.filter((e) => e.status === "pending");
  const otherEntries = entries.filter((e) => e.status !== "pending");

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">Global</p>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">Re-engagement</h1>
            <p className="mt-1 text-xs text-muted-dark font-medium">
              Cold leads identified by the system for a re-engagement touch.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(["all", "pending", "sent", "cancelled"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`h-8 rounded-lg border px-3 text-[11px] font-bold transition-all capitalize ${
                  filter === f
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted-dark hover:bg-surface-hover hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[11px] font-bold text-muted-dark hover:bg-surface-hover disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin text-primary" />
          </div>
        ) : (
          <>
            {pendingEntries.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-sm font-bold text-foreground">Pending sends</h2>
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                    {pendingEntries.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {pendingEntries.map((entry, i) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: i * 0.035 }}
                      className="rounded-xl border border-border bg-surface p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-foreground">{entry.contact_name}</p>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-dark">{entry.company}</p>

                          {entry.hook_theme && (
                            <p className="mt-2 text-xs text-foreground leading-relaxed">
                              Theme: <span className="font-bold text-primary">{entry.hook_theme.replace(/_/g, " ")}</span>
                            </p>
                          )}

                          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-dark">
                            {entry.scheduled_at && (
                              <span>Scheduled: {formatDate(entry.scheduled_at)}</span>
                            )}
                          </div>

                          {entry.draft_subject && (
                            <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
                              <p className="text-[11px] font-bold text-muted-dark uppercase tracking-wider mb-1">Draft subject</p>
                              <p className="text-xs text-foreground">{entry.draft_subject}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            onClick={() => handleSend(entry.id)}
                            disabled={pending === entry.id}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-3 text-[11px] font-bold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
                          >
                            {pending === entry.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Send size={11} />
                            )}
                            Send now
                          </button>
                          <button
                            onClick={() => handleCancel(entry.id)}
                            disabled={pending === entry.id}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-error/25 bg-error/5 px-3 text-[11px] font-bold text-error hover:bg-error hover:text-white disabled:opacity-50 transition-colors"
                          >
                            <X size={11} />
                            Ignore
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {pendingEntries.length === 0 && filter === "all" && (
              <FadeUp className="mt-6">
                <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/50">
                  <Send size={26} className="mx-auto mb-3 text-muted-dark/50" />
                  <p className="text-sm font-bold text-foreground">No pending re-engagements</p>
                  <p className="mt-1 text-xs text-muted-dark">
                    The system will surface cold leads here as it detects re-engagement windows.
                  </p>
                </div>
              </FadeUp>
            )}

            {otherEntries.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-sm font-bold text-muted-dark">History ({otherEntries.length})</h2>
                <div className="space-y-2">
                  {otherEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 opacity-60">
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">{entry.contact_name}</p>
                        <p className="text-[11px] text-muted-dark">{entry.company}</p>
                      </div>
                      <Badge tone={entry.status === "sent" ? "green" : "grey"}>{entry.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
