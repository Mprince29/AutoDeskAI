import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  Edit
} from "lucide-react";
import { workflowService } from "@/services/workflow.service";
import { WorkflowStep } from "@/types/workflow.types";

const STEP_STATUS_STYLE: Record<string, { dot: string; badge: string; label: string }> = {
  pending: { dot: 'bg-amber-400', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400', label: 'Awaiting' },
  approved: { dot: 'bg-primary', badge: 'border-primary/30 bg-primary/10 text-primary', label: 'Approved' },
  in_progress: { dot: 'bg-cyan-400 animate-pulse', badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400', label: 'Running…' },
  completed: { dot: 'bg-emerald-400', badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', label: 'Done' },
  rejected: { dot: 'bg-red-500', badge: 'border-red-500/30 bg-red-500/10 text-red-400', label: 'Rejected' },
  failed: { dot: 'bg-red-500', badge: 'border-red-500/30 bg-red-500/10 text-red-400', label: 'Failed' },
  modified: { dot: 'bg-violet-400', badge: 'border-violet-500/30 bg-violet-500/10 text-violet-400', label: 'Modified' },
};

function ResultWithLinks({ text }: { text: string }) {
  const URL_RE = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-300 hover:text-white break-all transition-colors"
            onClick={e => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function StepInputSummary({ input, toolName }: { input: Record<string, unknown>; toolName: string }) {
  const rows: { label: string; value: string }[] = [];
  const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const truncate = (s: string, max = 120) => s.length > max ? s.slice(0, max) + '…' : s;

  if (toolName === 'send_email' || toolName === 'create_draft') {
    if (input.to) rows.push({ label: 'To', value: str(input.to) });
    if (input.subject) rows.push({ label: 'Subject', value: str(input.subject) });
    if (input.body) rows.push({ label: 'Body', value: truncate(str(input.body)) });
  } else if (toolName === 'create_document') {
    if (input.title) rows.push({ label: 'Title', value: str(input.title) });
    if (input.content) rows.push({ label: 'Content', value: truncate(str(input.content), 80) });
  } else if (toolName === 'create_calendar_event') {
    if (input.summary) rows.push({ label: 'Event', value: str(input.summary) });
    if (input.start_time) rows.push({ label: 'Start', value: str(input.start_time) });
  } else if (toolName === 'web_search') {
    if (input.query) rows.push({ label: 'Query', value: str(input.query) });
  } else {
    let shown = 0;
    for (const [k, v] of Object.entries(input)) {
      if (k.startsWith('_') || shown >= 3) continue;
      rows.push({ label: k.replace(/_/g, ' '), value: truncate(str(v), 80) });
      shown++;
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="bg-black/20 rounded-lg px-3 py-2 mb-2 space-y-1">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex gap-2 text-[10px] leading-snug">
          <span className="shrink-0 font-black uppercase tracking-wider text-muted/50 w-16">{label}</span>
          <span className="text-muted/80 break-words min-w-0">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function InlineChatWorkflow({
  workflowId,
  goal,
  initialSteps,
  userEmail,
}: {
  workflowId: number;
  goal: string;
  initialSteps: WorkflowStep[];
  userEmail: string;
}) {
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [loadingStep, setLoadingStep] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<{ id: number; value: string } | null>(null);
  const [resultMap, setResultMap] = useState<Record<number, string>>({});
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    const hasRunning = steps.some(s => s.status === 'approved' || s.status === 'executing');
    if (!hasRunning || allDone) return;
    const timer = setInterval(async () => {
      try {
        const wf = await workflowService.getWorkflowDetails(userEmail, workflowId);
        setSteps(wf.steps);
        const newResultMap: Record<number, string> = {};
        wf.steps.forEach(s => { if (s.result && typeof s.result === 'string' && s.result !== 'Done') newResultMap[s.id] = s.result; });
        if (Object.keys(newResultMap).length) setResultMap(prev => ({ ...prev, ...newResultMap }));
        if (wf.status === 'completed') setAllDone(true);
      } catch { /* silent */ }
    }, 2500);
    return () => clearInterval(timer);
  }, [steps, workflowId, userEmail, allDone]);

  const act = async (
    stepId: number,
    status: 'approved' | 'rejected' | 'modified',
    modifiedInput?: Record<string, unknown>,
  ) => {
    setLoadingStep(stepId);
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: 'approved' } : s));
    try {
      const res = await workflowService.approveWorkflowStep(userEmail, workflowId, stepId, status, modifiedInput);
      const nextStatus = (res.new_status ?? (status === 'rejected' ? 'rejected' : 'completed')) as WorkflowStep['status'];
      setSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: nextStatus } : s));
      if (res.result && typeof res.result === 'string') setResultMap(prev => ({ ...prev, [stepId]: res.result as string }));
    } catch {
      setSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: 'pending' } : s));
    } finally {
      setLoadingStep(null);
      setEditingStep(null);
    }
  };

  const doneCount = steps.filter(s => ['completed', 'rejected', 'failed'].includes(s.status)).length;

  return (
    <div className="mt-4 rounded-2xl border border-amber-500/15 bg-amber-500/[0.03] overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-foreground/80 leading-none">{goal}</p>
            <p className="text-[9px] font-bold text-muted/50 uppercase tracking-widest mt-0.5">
              Human-in-the-Loop · {doneCount}/{steps.length} steps complete
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          {steps.map((s, i) => {
            const style = STEP_STATUS_STYLE[s?.status ?? 'pending'] || STEP_STATUS_STYLE.pending;
            return <div key={i} className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />;
          })}
        </div>
      </div>

      <div className="p-3 space-y-2.5">
        {steps.map((step, idx) => {
          const style = STEP_STATUS_STYLE[step.status] ?? STEP_STATUS_STYLE.pending;
          const isPending = step.status === 'pending';
          const isRunning = loadingStep === step.id;
          const isEditing = editingStep?.id === step.id;
          const result = resultMap[step.id];

          return (
            <div key={step.id} className="relative pl-9">
              {idx < steps.length - 1 && (
                <div className="absolute left-[14px] top-8 bottom-[-10px] w-px bg-gradient-to-b from-border/40 to-transparent" />
              )}
              <div className={`absolute left-0 top-1.5 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black border transition-all
                ${isPending ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                  step.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                    step.status === 'rejected' || step.status === 'failed' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                      'bg-primary/10 border-primary/30 text-primary'}`}>
                {step.status === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                  step.status === 'rejected' || step.status === 'failed' ? <XCircle className="w-3.5 h-3.5" /> :
                    step.step_number ?? idx + 1}
              </div>

              <div className={`rounded-xl border p-3 transition-all ${isPending ? 'border-amber-500/15 bg-surface/40' : 'border-border/30 bg-surface/20 opacity-80'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-[12px] font-semibold text-foreground/90 leading-snug">{step.description}</p>
                  <span className={`shrink-0 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${style.badge}`}>
                    {isRunning ? 'Running…' : style.label}
                  </span>
                </div>

                {step.tool_name && (
                  <span className="inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg bg-surface border border-border/50 text-muted mb-2">
                    {step.tool_name}
                  </span>
                )}

                {step.tool_input && Object.keys(step.tool_input).length > 0 && !isEditing && (
                  <StepInputSummary input={step.tool_input} toolName={step.tool_name ?? ''} />
                )}

                {isEditing && (
                  <textarea
                    className="w-full text-[11px] font-mono bg-black/30 border border-primary/30 rounded-lg px-3 py-2 text-foreground resize-none mb-2 focus:outline-none focus:border-primary/60"
                    rows={5}
                    value={editingStep.value}
                    onChange={e => setEditingStep({ id: step.id, value: e.target.value })}
                  />
                )}

                {result && (
                  <p className="text-[10px] text-emerald-400/80 font-medium bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-2 py-1.5 mt-1 mb-2">
                    ✓ <ResultWithLinks text={result} />
                  </p>
                )}

                {isPending && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => {
                            try {
                              const parsed = JSON.parse(editingStep.value);
                              act(step.id, 'modified', parsed);
                            } catch { alert('Invalid JSON'); }
                          }}
                          disabled={isRunning}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Save & Run
                        </button>
                        <button
                          onClick={() => setEditingStep(null)}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-border/50 text-muted hover:bg-surface transition-all"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => act(step.id, 'approved')}
                          disabled={isRunning}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                        >
                          {isRunning
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <CheckCircle2 className="w-3 h-3" />}
                          {isRunning ? 'Running…' : 'Authorize'}
                        </button>
                        <button
                          onClick={() => setEditingStep({ id: step.id, value: JSON.stringify(step.tool_input ?? {}, null, 2) })}
                          disabled={isRunning}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-surface border border-border/50 text-muted/80 hover:bg-surface-hover hover:text-foreground transition-all disabled:opacity-50"
                          title="Edit input before running"
                        >
                          <Edit className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => act(step.id, 'rejected')}
                          disabled={isRunning}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
                          title="Reject this step"
                        >
                          <XCircle className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {allDone && (
        <div className="px-4 py-3 border-t border-emerald-500/20 bg-emerald-500/5 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <p className="text-[11px] font-bold text-emerald-400">Workflow complete</p>
            <p className="text-[10px] text-emerald-400/60">All steps executed - check your email, calendar & Drive for results.</p>
          </div>
        </div>
      )}
    </div>
  );
}
