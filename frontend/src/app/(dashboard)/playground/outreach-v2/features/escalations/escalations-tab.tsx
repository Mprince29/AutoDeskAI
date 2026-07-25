"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import type { EscalationEvent } from "@/services/sales.service";

interface EscalationUiEvent extends EscalationEvent {
  status: "open" | "resolved" | "cancelled";
}

export function EscalationsTab() {
  const getEscalations = useOutreachStore((s) => s.getEscalations);
  const resolveEscalation = useOutreachStore((s) => s.resolveEscalation);

  const [escalations, setEscalations] = useState<EscalationUiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getEscalations();
      const mapped = data.map((e) => ({
        ...e,
        status: (e.human_took_over ? "resolved" : "open") as "open" | "resolved"
      }));
      setEscalations(mapped);
    } catch {
      setEscalations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleResolve = async (id: number, action: "resume" | "cancel") => {
    setPending(id);
    try {
      await resolveEscalation(id, action);
      setEscalations((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: action === "resume" ? "resolved" as const : "cancelled" as const } : e))
      );
    } finally {
      setPending(null);
    }
  };

  const open = escalations.filter((e) => e.status === "open");
  const resolved = escalations.filter((e) => e.status !== "open");

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">Global</p>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">Escalations</h1>
            <p className="mt-1 text-xs text-muted-dark font-medium">
              High-intent leads flagged for human review before the sequence continues.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-xs font-bold text-muted-dark hover:bg-surface-hover disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Open escalations */}
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-bold text-foreground">Needs action</h2>
                {open.length > 0 && (
                  <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[11px] font-bold text-warning">
                    {open.length}
                  </span>
                )}
              </div>

              {open.length === 0 ? (
                <FadeUp>
                  <div className="rounded-xl border border-dashed border-border p-10 text-center bg-surface/50">
                    <CheckCircle size={26} className="mx-auto mb-2 text-success/60" />
                    <p className="text-sm font-bold text-foreground">All clear</p>
                    <p className="mt-1 text-xs text-muted-dark">No open escalations right now.</p>
                  </div>
                </FadeUp>
              ) : (
                <div className="space-y-3">
                  {open.map((esc, i) => (
                    <motion.div
                      key={esc.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: i * 0.04 }}
                      className="rounded-xl border border-warning/25 bg-warning/5 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-foreground">{esc.contact_name}</p>
                          </div>
                          <p className="mt-1 text-xs text-muted-dark">{esc.company}</p>
                          <p className="mt-2 text-xs text-foreground leading-relaxed">{esc.context_brief}</p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            onClick={() => handleResolve(esc.id, "resume")}
                            disabled={pending === esc.id}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-3 text-[11px] font-bold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
                          >
                            {pending === esc.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                            Resume
                          </button>
                          <button
                            onClick={() => handleResolve(esc.id, "cancel")}
                            disabled={pending === esc.id}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-error/25 bg-error/5 px-3 text-[11px] font-bold text-error hover:bg-error hover:text-white disabled:opacity-50 transition-colors"
                          >
                            <XCircle size={11} />
                            Cancel
                          </button>
                        </div>
                      </div>

                      {esc.intent_score_at_escalation !== undefined && (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-[11px] text-muted-dark">Intent score</span>
                          <div className="h-1.5 flex-1 max-w-32 rounded-full bg-border overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${(esc.intent_score_at_escalation / 10) * 100}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-bold text-foreground font-mono">{esc.intent_score_at_escalation}/10</span>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Resolved escalations */}
            {resolved.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-sm font-bold text-muted-dark">Resolved ({resolved.length})</h2>
                <div className="space-y-2">
                  {resolved.map((esc) => (
                    <div key={esc.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 opacity-60">
                      {esc.status === "resolved" ? (
                        <CheckCircle size={14} className="shrink-0 text-success" />
                      ) : (
                        <XCircle size={14} className="shrink-0 text-error" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">{esc.contact_name}</p>
                        <p className="text-[11px] text-muted-dark">{esc.company}</p>
                      </div>
                      <Badge tone={esc.status === "resolved" ? "green" : "grey"}>{esc.status}</Badge>
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
