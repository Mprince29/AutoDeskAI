"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import type {
  Sequence,
  SequenceEnrollment,
  SequenceStep,
} from "@/services/sales.service";

// ── Sequence Builder Modal ─────────────────────────────────────────────────────

function SequenceBuilderModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, steps: SequenceStep[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<SequenceStep[]>([
    { step_number: 1, delay_days: 0, subject_template: "", html_template: "", stop_on: "reply" },
    { step_number: 2, delay_days: 3, subject_template: "", html_template: "", stop_on: "reply" },
  ]);
  const [saving, setSaving] = useState(false);

  const addStep = () =>
    setSteps((prev) => [
      ...prev,
      {
        step_number: prev.length + 1,
        delay_days: (prev[prev.length - 1]?.delay_days ?? 0) + 3,
        subject_template: "",
        html_template: "",
        stop_on: "reply",
      },
    ]);

  const removeStep = (i: number) =>
    setSteps((prev) =>
      prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, step_number: idx + 1 }))
    );

  const updateStep = (i: number, field: keyof SequenceStep, value: string | number) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));

  const handleCreate = async () => {
    if (!name.trim() || steps.some((s) => !s.subject_template.trim())) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), steps);
      setName("");
      setSteps([
        { step_number: 1, delay_days: 0, subject_template: "", html_template: "", stop_on: "reply" },
        { step_number: 2, delay_days: 3, subject_template: "", html_template: "", stop_on: "reply" },
      ]);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface p-6  max-h-[85vh] overflow-y-auto mx-4"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-surface-hover p-1.5 hover:bg-border transition-colors"
        >
          <X size={14} className="text-muted-dark" />
        </button>

        <div className="mb-5">
          <h2 className="text-base font-bold text-foreground">Create sequence</h2>
          <p className="mt-1 text-xs text-muted-dark">Build a multi-step follow-up cadence. Stops on first reply.</p>
        </div>

        <div className="mb-4">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Sequence name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. eBic follow-up 3-step"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="rounded-xl border border-border bg-background p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <span className="text-xs font-bold text-foreground">
                    {i === 0 ? "Day 0 — Initial send" : `Day ${step.delay_days} — Follow-up`}
                  </span>
                </div>
                {steps.length > 1 && (
                  <button
                    onClick={() => removeStep(i)}
                    className="rounded-md p-1 text-muted-dark hover:bg-error/10 hover:text-error transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {i > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-semibold text-muted-dark w-20 shrink-0">Delay (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={step.delay_days}
                    onChange={(e) => updateStep(i, "delay_days", Number(e.target.value))}
                    className="h-8 w-20 rounded-lg border border-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold text-muted-dark">Subject line</label>
                <input
                  value={step.subject_template}
                  onChange={(e) => updateStep(i, "subject_template", e.target.value)}
                  placeholder="Follow-up: {{company}} x eBic"
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-muted-dark">Email body (HTML or plain text)</label>
                <textarea
                  value={step.html_template}
                  onChange={(e) => updateStep(i, "html_template", e.target.value)}
                  placeholder="Hi {{firstName}}, just following up on my previous note..."
                  rows={3}
                  className="mt-1 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-muted-dark w-20 shrink-0">Stop on</label>
                <select
                  value={step.stop_on ?? "reply"}
                  onChange={(e) => updateStep(i, "stop_on", e.target.value)}
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="reply">Reply</option>
                  <option value="click">Click</option>
                  <option value="open">Open</option>
                  <option value="none">Never</option>
                </select>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addStep}
          className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-semibold text-muted-dark hover:border-primary hover:text-primary transition-colors"
        >
          <Plus size={13} />
          Add step
        </button>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-border bg-background px-4 text-xs font-semibold text-foreground hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || steps.some((s) => !s.subject_template.trim()) || saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? "Creating..." : "Create sequence"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Enrollment Drawer ──────────────────────────────────────────────────────────

function EnrollmentDrawer({
  seqId,
  seqName,
  open,
  onClose,
  getEnrollments,
}: {
  seqId: number;
  seqName: string;
  open: boolean;
  onClose: () => void;
  getEnrollments: (seqId: number) => Promise<SequenceEnrollment[]>;
}) {
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getEnrollments(seqId)
      .then(setEnrollments)
      .catch(() => setEnrollments([]))
      .finally(() => setLoading(false));
  }, [open, seqId, getEnrollments]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ x: 360 }}
        animate={{ x: 0 }}
        exit={{ x: 360 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="h-full w-full max-w-sm border-l border-border bg-surface  overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-foreground">{seqName}</h3>
            <p className="text-[11px] text-muted-dark">Enrollments</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-surface-hover transition-colors">
            <X size={14} className="text-muted-dark" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          ) : enrollments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-dark">
              No enrollments found.
            </div>
          ) : (
            <div className="space-y-2">
              {enrollments.map((e) => (
                <div key={e.id} className="rounded-xl border border-border bg-background p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-foreground">{e.recipient_name || "Unknown"}</p>
                      <p className="truncate text-[11px] text-muted-dark">{e.recipient_email}</p>
                    </div>
                    <Badge tone={e.status === "active" ? "green" : e.status === "completed" ? "grey" : "amber"}>
                      {e.status}
                    </Badge>
                  </div>
                  <div className="mt-2 flex gap-3 text-[11px] text-muted-dark">
                    <span>Step {e.current_step + 1}</span>
                    {e.opened && <span>Opened</span>}
                    {e.clicked && <span>Clicked</span>}
                    {e.replied && <span className="text-success font-semibold">Replied</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Main SequencesTab ──────────────────────────────────────────────────────────

export function SequencesTab() {
  const createSequence = useOutreachStore((s) => s.createSequence);
  const deleteSequence = useOutreachStore((s) => s.deleteSequence);
  const pauseSequence = useOutreachStore((s) => s.pauseSequence);
  const getSequenceEnrollments = useOutreachStore((s) => s.getSequenceEnrollments);

  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [enrollmentDrawer, setEnrollmentDrawer] = useState<{ id: number; name: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<number | null>(null);

  const loadSequences = async () => {
    setLoading(true);
    try {
      const email = (() => {
        try { return JSON.parse(localStorage.getItem("user_info") ?? "{}").email ?? ""; } catch { return ""; }
      })();
      if (!email) { setLoading(false); return; }
      const { salesService } = await import("@/services/sales.service");
      const data = await salesService.getSequences(email);
      setSequences(data);
    } catch {
      setSequences([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSequences(); }, []);

  const handleCreate = async (name: string, steps: SequenceStep[]) => {
    await createSequence(name, steps);
    await loadSequences();
  };

  const handlePauseResume = async (seq: Sequence) => {
    setPendingAction(seq.id);
    try {
      const email = (() => { try { return JSON.parse(localStorage.getItem("user_info") ?? "{}").email ?? ""; } catch { return ""; } })();
      const { salesService } = await import("@/services/sales.service");
      if (seq.status === "active") {
        await pauseSequence(seq.id);
      } else {
        await salesService.resumeSequence(seq.id, email);
      }
      await loadSequences();
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (seqId: number) => {
    if (!confirm("Delete this sequence? This cannot be undone.")) return;
    setPendingAction(seqId);
    try {
      await deleteSequence(seqId);
      setSequences((prev) => prev.filter((s) => s.id !== seqId));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">Global</p>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">Sequences</h1>
            <p className="mt-1 text-xs text-muted-dark font-medium">
              Multi-step follow-up cadences that stop on first reply.
            </p>
          </div>
          <button
            onClick={() => setBuilderOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-hover active:scale-95 transition-all "
          >
            <Plus size={14} />
            New sequence
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={22} className="animate-spin text-primary" />
            </div>
          ) : sequences.length === 0 ? (
            <FadeUp>
              <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/50">
                <GitBranch size={28} className="mx-auto mb-3 text-muted-dark/50" />
                <p className="text-sm font-bold text-foreground">No sequences yet</p>
                <p className="mt-1 text-xs text-muted-dark">Create your first follow-up sequence to automate cadences.</p>
                <button
                  onClick={() => setBuilderOpen(true)}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-hover"
                >
                  <Plus size={13} />
                  New sequence
                </button>
              </div>
            </FadeUp>
          ) : (
            sequences.map((seq, i) => {
              const totalEnrollments = seq.stats
                ? seq.stats.active + seq.stats.completed + seq.stats.stopped
                : 0;
              return (
                <motion.div
                  key={seq.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="rounded-xl border border-border bg-surface ">
                    <div className="flex items-center gap-3 p-4">
                      <button
                        onClick={() => setExpandedId(expandedId === seq.id ? null : seq.id)}
                        className="rounded-md p-0.5 text-muted-dark hover:text-foreground transition-colors"
                      >
                        {expandedId === seq.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{seq.name}</p>
                        <p className="text-[11px] text-muted-dark">
                          {seq.steps?.length ?? 0} steps · {totalEnrollments} enrolled
                        </p>
                      </div>

                      <Badge tone={seq.status === "active" ? "green" : "amber"}>
                        {seq.status}
                      </Badge>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEnrollmentDrawer({ id: seq.id, name: seq.name })}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-dark hover:bg-surface-hover hover:text-foreground transition-colors"
                          title="View enrollments"
                        >
                          <Users size={11} />
                          {totalEnrollments}
                        </button>

                      <button
                        onClick={() => handlePauseResume(seq)}
                        disabled={pendingAction === seq.id}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-dark hover:bg-surface-hover hover:text-foreground disabled:opacity-50 transition-colors"
                      >
                        {pendingAction === seq.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : seq.status === "active" ? (
                          <Pause size={11} />
                        ) : (
                          <Play size={11} />
                        )}
                        {seq.status === "active" ? "Pause" : "Resume"}
                      </button>

                      <button
                        onClick={() => handleDelete(seq.id)}
                        disabled={pendingAction === seq.id}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-error/20 bg-error/5 px-2.5 text-[11px] font-semibold text-error hover:bg-error hover:text-white disabled:opacity-50 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {expandedId === seq.id && seq.steps && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden border-t border-border"
                      >
                        <div className="p-4 space-y-2">
                          {seq.steps.map((step, si) => (
                            <div key={si} className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
                              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mt-0.5">
                                {si + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-foreground truncate">{step.subject_template}</p>
                                <p className="text-[11px] text-muted-dark mt-0.5">
                                  {si === 0 ? "Day 0" : `+${step.delay_days}d`} · stop on {step.stop_on ?? "reply"}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })
          )}
        </div>
      </div>

      <AnimatePresence>
        {builderOpen && (
          <SequenceBuilderModal
            open={builderOpen}
            onClose={() => setBuilderOpen(false)}
            onCreate={handleCreate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {enrollmentDrawer && (
          <EnrollmentDrawer
            seqId={enrollmentDrawer.id}
            seqName={enrollmentDrawer.name}
            open={!!enrollmentDrawer}
            onClose={() => setEnrollmentDrawer(null)}
            getEnrollments={getSequenceEnrollments}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
