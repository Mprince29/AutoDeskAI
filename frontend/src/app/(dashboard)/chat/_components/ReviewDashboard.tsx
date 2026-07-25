import React, { useState, useEffect, memo, useCallback } from 'react';
import { toastError, toastSuccess, toastInfo } from '@/lib/friendly-errors';
import { apiService, Workflow } from '@/services/api';
import {
  CheckCircle2,
  XCircle,
  Edit3,
  Clock,
  AlertCircle,
  ShieldCheck,
  UserCheck,
  Bot,
  X,
  Save,
  ChevronRight,
  PartyPopper,
} from 'lucide-react';

type WorkflowInstance = Workflow;

// ── Edit Modal ────────────────────────────────────────────────────────────────

interface EditModalProps {
  stepDescription: string;
  initialJson: Record<string, unknown>;
  onSave: (updated: Record<string, unknown>) => void;
  onClose: () => void;
}

const EditModal: React.FC<EditModalProps> = ({ stepDescription, initialJson, onSave, onClose }) => {
  const [text, setText] = useState(() => JSON.stringify(initialJson, null, 2));
  const [error, setError] = useState('');

  const handleSave = () => {
    try {
      const parsed = JSON.parse(text);
      onSave(parsed);
    } catch {
      setError('Invalid JSON - please fix the syntax before saving.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Edit3 className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-[14px] text-foreground">Edit Step Input</h3>
              <p className="text-[11px] text-muted mt-0.5 line-clamp-1">{stepDescription}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 p-5 min-h-0 overflow-y-auto">
          <p className="text-[11px] text-muted mb-3">
            Edit the JSON input below. Changes apply only to this execution - the stored plan is unchanged.
          </p>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setError(''); }}
            className="w-full h-72 font-mono text-[12px] bg-black/40 border border-border rounded-xl p-4 text-foreground resize-none focus:outline-none focus:border-primary/50 custom-scrollbar"
            spellCheck={false}
          />
          {error && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-border text-[12px] font-bold text-muted hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 btn-primary !rounded-xl !py-2.5 !text-[12px]"
          >
            <Save className="w-4 h-4" />
            Save & Authorize
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Human-readable step input summary ────────────────────────────────────────

function StepInputSummary({ input, toolName }: { input: Record<string, unknown>; toolName: string }) {
  const rows: { label: string; value: string }[] = [];
  const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const truncate = (s: string, max = 120) => s.length > max ? s.slice(0, max) + '…' : s;

  if (toolName === 'send_email' || toolName === 'create_draft') {
    if (input.to) rows.push({ label: 'To', value: str(input.to) });
    if (input.subject) rows.push({ label: 'Subject', value: str(input.subject) });
    if (input.body) rows.push({ label: 'Body', value: truncate(str(input.body)) });
    const att = input.attachment_doc_ids as string[] | undefined;
    if (att && att.length > 0 && !att[0].startsWith('__'))
      rows.push({ label: 'Attachment', value: `Google Doc PDF (${att.length})` });
    else if (att && att.length > 0 && att[0].startsWith('__'))
      rows.push({ label: 'Attachment', value: 'PDF (resolved from previous step)' });
  } else if (toolName === 'create_document') {
    if (input.title) rows.push({ label: 'Title', value: str(input.title) });
    if (input.content) rows.push({ label: 'Content', value: truncate(str(input.content), 80) });
  } else if (toolName === 'create_calendar_event') {
    if (input.summary) rows.push({ label: 'Event', value: str(input.summary) });
    if (input.start_time) rows.push({ label: 'Start', value: str(input.start_time) });
    if (input.end_time) rows.push({ label: 'End', value: str(input.end_time) });
    const att = input.attendees as string[] | undefined;
    if (att) rows.push({ label: 'Attendees', value: att.join(', ') });
  } else if (toolName === 'web_search') {
    if (input.query) rows.push({ label: 'Query', value: str(input.query) });
  } else if (toolName === 'slack_invite_to_workspace') {
    if (input.invitee_email) rows.push({ label: 'Invite', value: str(input.invitee_email) });
    const ch = input.channels as string[] | undefined;
    if (ch) rows.push({ label: 'Channels', value: ch.join(', ') });
  } else if (toolName === 'add_contact') {
    if (input.name) rows.push({ label: 'Name', value: str(input.name) });
    if (input.email) rows.push({ label: 'Email', value: str(input.email) });
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
    <div className="bg-surface/50 dark:bg-black/40 border border-border dark:border-white/5 rounded-xl px-3 py-2 relative overflow-hidden">
      <div className="noise-texture rounded-xl" />
      <div className="relative z-10 space-y-1.5">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex gap-3 text-[11px] leading-snug">
            <span className="shrink-0 font-black uppercase tracking-wider text-muted/50 w-20">{label}</span>
            <span className="text-muted-dark break-words min-w-0">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

const stepStatusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: 'PENDING', className: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
  approved: { label: 'APPROVED', className: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
  executing: { label: 'RUNNING', className: 'border-primary/30 bg-primary/10 text-primary animate-pulse' },
  completed: { label: 'DONE', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
  failed: { label: 'FAILED', className: 'border-red-500/30 bg-red-500/10 text-red-400' },
  rejected: { label: 'SKIPPED', className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400' },
  cancelled: { label: 'CANCELLED', className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400' },
};

// ── Main Component ────────────────────────────────────────────────────────────

const ReviewDashboardInner: React.FC<{ userEmail: string }> = ({ userEmail }) => {
  const [workflows, setWorkflows] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowInstance | null>(null);
  const [editingStep, setEditingStep] = useState<{ id: number; description: string; input: Record<string, unknown> } | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiService.listWorkflows(userEmail);
      setWorkflows(data);
    } catch (err) {
      console.error('Failed to fetch workflows', err);
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  // Silently refresh the selected workflow details (no loading spinner)
  const refreshSelected = useCallback(async (id: number) => {
    try {
      const details = await apiService.getWorkflowDetails(userEmail, id);
      setSelectedWorkflow(details);
      setWorkflows(prev => prev.map(w => w.id === id ? { ...w, status: details.status } : w));
    } catch { /* silent */ }
  }, [userEmail]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Auto-poll while any step is executing
  useEffect(() => {
    if (!selectedWorkflow) return;
    const hasExecuting = selectedWorkflow.steps.some(s => s.status === 'executing' || s.status === 'approved');
    if (!hasExecuting) return;
    const timer = setInterval(() => refreshSelected(selectedWorkflow.id), 2500);
    return () => clearInterval(timer);
  }, [selectedWorkflow, refreshSelected]);

  const selectWorkflow = async (id: number) => {
    try {
      const details = await apiService.getWorkflowDetails(userEmail, id);
      setSelectedWorkflow(details);
    } catch (err) {
      console.error('Failed to fetch details', err);
    }
  };

  const handleStepAction = async (
    stepId: number,
    status: 'approved' | 'rejected' | 'modified',
    modifiedInput?: Record<string, unknown>,
  ) => {
    if (!selectedWorkflow) return;
    setActionLoading(stepId);
    try {
      await apiService.approveWorkflowStep(userEmail, selectedWorkflow.id, stepId, status, modifiedInput);
      const details = await apiService.getWorkflowDetails(userEmail, selectedWorkflow.id);
      setSelectedWorkflow(details);
      await fetchWorkflows();
      if (status === 'approved' || status === 'modified') {
        toastSuccess('Step authorized - executing in background');
      } else {
        toastInfo('Step skipped');
      }
    } catch (err) {
      toastError('Failed to update step: ' + err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const pendingCount = workflows.filter(w => w.status === 'pending' || w.status === 'awaiting_review').length;
  const completedWorkflow = selectedWorkflow?.status === 'completed';

  return (
    <>
      {/* Edit Modal */}
      {editingStep && (
        <EditModal
          stepDescription={editingStep.description}
          initialJson={editingStep.input}
          onSave={updated => {
            setEditingStep(null);
            handleStepAction(editingStep.id, 'modified', updated);
          }}
          onClose={() => setEditingStep(null)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 h-full overflow-hidden bg-transparent">

        {/* ── Sidebar: Workflow List ──────────────────────────────────────── */}
        <div className="lg:col-span-1 flex flex-col min-h-0 border-r border-border/50 dark:border-white/5 bg-surface/20 dark:bg-white/[0.01]">
          <div className="p-5 border-b border-border/50 dark:border-white/5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                <ShieldCheck className="text-primary w-4 h-4" />
              </div>
              <h2 className="text-[13px] font-black uppercase tracking-widest text-foreground/90">Workflows</h2>
            </div>
            {pendingCount > 0 && (
              <span className="text-[10px] font-black tabular-nums bg-amber-500/10 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded-lg">
                {pendingCount} PENDING
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {workflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-20">
                <Clock className="w-8 h-8" />
                <span className="text-[9px] font-black uppercase tracking-[0.3em]">No Workflows Yet</span>
              </div>
            ) : (
              workflows.map(wf => (
                <button
                  key={wf.id}
                  onClick={() => selectWorkflow(wf.id)}
                  className={`w-full text-left p-4 rounded-xl transition-all duration-300 relative overflow-hidden group ${selectedWorkflow?.id === wf.id
                      ? 'bg-primary/5 border border-primary/30 ring-1 ring-primary/20'
                      : 'border border-border/60 hover:border-border dark:border-white/5 bg-surface/30 dark:bg-white/[0.02] hover:bg-surface-hover/50 dark:hover:bg-white/[0.05]'
                    }`}
                >
                  <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className={`text-[8px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-md border ${wf.status === 'completed'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : wf.status === 'cancelled'
                            ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                        }`}>
                        {wf.status}
                      </span>
                      <span className="text-[9px] text-muted/40 uppercase tabular-nums">
                        {new Date(wf.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <h3 className="font-bold text-[12px] leading-snug text-foreground/90 line-clamp-2">{wf.goal}</h3>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-muted/60">{wf.step_count || 0} STEPS</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Main Content: Workflow Steps ────────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col min-h-0 bg-transparent overflow-hidden">
          {!selectedWorkflow ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 opacity-20">
              <Bot className="w-16 h-16 mb-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.4em]">Select a workflow</span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 animate-fade-in">

              {/* Header */}
              <div className="p-5 border-b border-border/50 dark:border-white/5 bg-surface/10 dark:bg-white/[0.01] flex items-start gap-4 shrink-0">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <UserCheck className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[14px] font-black text-foreground/90 leading-tight uppercase tracking-tight truncate">{selectedWorkflow.goal}</h2>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted/40">#{selectedWorkflow.id}</span>
                    <div className="w-px h-2.5 bg-border dark:bg-white/10" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted/40">
                      {new Date(selectedWorkflow.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    <div className="w-px h-2.5 bg-border dark:bg-white/10" />
                    <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md border ${selectedWorkflow.status === 'completed'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      }`}>{selectedWorkflow.status}</span>
                  </div>
                </div>
              </div>

              {/* Completion Banner */}
              {completedWorkflow && (
                <div className="mx-5 mt-5 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3 shrink-0">
                  <PartyPopper className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] font-bold text-emerald-400">Workflow Complete</p>
                    <p className="text-[11px] text-emerald-400/70 mt-0.5">
                      All steps have been executed. Check your email, calendar, and Drive for results.
                    </p>
                  </div>
                </div>
              )}

              {/* Steps List */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                {selectedWorkflow.steps.map((step, idx) => {
                  const statusKey = step.status as string;
                  const isActive = step.status === 'pending';
                  const isExecuting = step.status === 'executing';
                  const isDone = step.status === 'completed';
                  const isRejected = step.status === 'rejected' || step.status === 'cancelled';
                  const statusInfo = stepStatusConfig[statusKey] ?? { label: statusKey.toUpperCase(), className: 'border-border bg-surface text-muted' };
                  const isLoadingThis = actionLoading === step.id;

                  return (
                    <div key={step.id} className="relative pl-11">
                      {/* Connector line */}
                      {idx < selectedWorkflow.steps.length - 1 && (
                        <div className="absolute left-[19px] top-9 bottom-[-24px] w-px bg-gradient-to-b from-border dark:from-white/10 to-transparent" />
                      )}

                      {/* Step node */}
                      <div className={`absolute left-0 top-1 w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black z-10 border transition-all duration-500 ${isDone ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                          isExecuting ? 'bg-primary/10 border-primary/30 text-primary animate-pulse' :
                            isActive ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' :
                              isRejected ? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-500 opacity-50' :
                                'bg-surface/50 border-border dark:bg-white/5 dark:border-white/10 text-muted/40'
                        }`}>
                        {isDone ? <CheckCircle2 className="w-4 h-4" /> : isRejected ? <XCircle className="w-4 h-4" /> : step.step_number}
                      </div>

                      <div className={`card-os group !p-4 transition-opacity ${isRejected ? 'opacity-40' : ''} ${isActive ? 'border-amber-500/20' : ''}`}>
                        <div className="glass-shine" />

                        <div className="flex flex-col gap-3">
                          {/* Title row */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <h4 className="font-bold text-[13px] text-foreground/90 leading-snug">{step.description}</h4>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-dark bg-surface border border-border px-2 py-0.5 rounded-lg">
                                  {step.tool_name}
                                </span>
                                <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md border ${statusInfo.className}`}>
                                  {statusInfo.label}
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted/30 shrink-0 mt-1" />
                          </div>

                          {/* Tool Input Preview */}
                          <StepInputSummary
                            input={step.tool_input as Record<string, unknown> ?? {}}
                            toolName={step.tool_name ?? ''}
                          />

                          {/* Result Preview */}
                          {isDone && step.result && step.result !== 'Done' && (
                            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-3 py-2">
                              <p className="text-[10px] text-emerald-400/80 font-mono leading-relaxed line-clamp-3">
                                {typeof step.result === 'string' ? step.result : JSON.stringify(step.result)}
                              </p>
                            </div>
                          )}

                          {/* Action Buttons (only for pending steps) */}
                          {isActive && step.requires_approval && (
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => handleStepAction(step.id, 'approved')}
                                disabled={isLoadingThis}
                                className="flex-1 btn-primary !rounded-xl !py-2 !text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isLoadingThis ? (
                                  <span className="animate-spin rounded-full w-3.5 h-3.5 border-b border-white" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                Authorize
                              </button>
                              <button
                                onClick={() => setEditingStep({ id: step.id, description: step.description, input: step.tool_input as Record<string, unknown> })}
                                disabled={isLoadingThis}
                                className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                                title="Edit input before authorizing"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                onClick={() => handleStepAction(step.id, 'rejected')}
                                disabled={isLoadingThis}
                                className="px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all disabled:opacity-50"
                                title="Skip this step"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          {isExecuting && (
                            <div className="flex items-center gap-2 text-[11px] text-primary/80">
                              <span className="animate-spin rounded-full w-3 h-3 border-b border-primary" />
                              Executing...
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export const ReviewDashboard = memo(ReviewDashboardInner);
