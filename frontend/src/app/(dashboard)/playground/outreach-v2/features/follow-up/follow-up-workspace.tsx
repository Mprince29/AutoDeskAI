"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Archive, CalendarPlus, CheckCircle2, Clock3, Flame, MailOpen, MessageSquareWarning, RefreshCw, Reply, Send, Settings2, UserCheck } from "lucide-react";
import Link from "next/link";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import { cn } from "@/lib/utils";
import type { FollowUpLeadState, FollowUpStrategy, Lead, LeadInterestLevel, MeetingProposal } from "../../state/types";
import { ObjectionModal } from "./objection-modal";

const statusLabel: Record<FollowUpLeadState["status"], string> = {
  responded: "Responded",
  read_no_reply: "Read",
  no_response: "No response",
  converted: "Converted",
  archived_no_response: "Archived"
};

const statusTone: Record<FollowUpLeadState["status"], "green" | "amber" | "grey" | "purple"> = {
  responded: "green",
  read_no_reply: "amber",
  no_response: "grey",
  converted: "purple",
  archived_no_response: "grey"
};

const interestLabel: Record<LeadInterestLevel, string> = {
  hot: "Hot lead",
  medium: "Medium interest",
  low: "Low interest"
};

const interestTone: Record<LeadInterestLevel, "green" | "amber" | "grey"> = {
  hot: "green",
  medium: "amber",
  low: "grey"
};

const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
    : "Not set";

function MetricCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-3 ">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-dark">{label}</p>
        <Icon size={13} className="text-muted-dark" aria-hidden />
      </div>
      <p className="mt-2 font-mono text-lg font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function InlineStrategy({
  state,
  value,
  onChange,
  onSave,
  pending
}: {
  state: FollowUpLeadState;
  value: Pick<FollowUpStrategy, "followUpCount" | "frequencyDays" | "startDate" | "tone" | "autoArchiveAfterFinal">;
  onChange: (value: Pick<FollowUpStrategy, "followUpCount" | "frequencyDays" | "startDate" | "tone" | "autoArchiveAfterFinal">) => void;
  onSave: () => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 ">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Settings2 size={13} className="text-muted-dark" aria-hidden />
          <p className="text-xs font-bold text-foreground uppercase tracking-wider">Lead cadence strategy</p>
        </div>
        <span className="text-[11px] font-semibold text-muted-dark">{state.followUpsSent}/{value.followUpCount} sent</span>
      </div>
      <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Follow-ups</span>
          <input
            type="number"
            min={1}
            max={6}
            value={value.followUpCount}
            onChange={(event) => onChange({ ...value, followUpCount: Number(event.target.value) })}
            className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Frequency</span>
          <select
            value={value.frequencyDays}
            onChange={(event) => onChange({ ...value, frequencyDays: Number(event.target.value) })}
            className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
          >
            <option value={2}>Every 2 days</option>
            <option value={4}>Every 4 days</option>
            <option value={7}>Weekly</option>
            <option value={10}>Every 10 days</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Start date</span>
          <input
            type="date"
            value={value.startDate}
            onChange={(event) => onChange({ ...value, startDate: event.target.value })}
            className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Tone</span>
          <select
            value={value.tone}
            onChange={(event) => onChange({ ...value, tone: event.target.value as FollowUpStrategy["tone"] })}
            className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
          >
            <option value="warm">Warm</option>
            <option value="concise">Concise</option>
            <option value="value-led">Value-led</option>
          </select>
        </label>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-3">
        <label className="flex items-center gap-2 text-xs font-bold text-muted-dark cursor-pointer uppercase tracking-wider">
          <input
            type="checkbox"
            checked={value.autoArchiveAfterFinal}
            onChange={(event) => onChange({ ...value, autoArchiveAfterFinal: event.target.checked })}
            className="accent-primary"
          />
          Archive after final touch
        </label>
        <button
          onClick={onSave}
          disabled={pending}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-hover px-3 text-xs font-bold text-foreground transition hover:bg-border disabled:opacity-45  active:scale-95"
        >
          {pending ? <RefreshCw size={12} className="animate-spin" aria-hidden /> : <CheckCircle2 size={12} aria-hidden />}
          Save settings
        </button>
      </div>
    </div>
  );
}

function MeetingEditor({
  proposal,
  calendarConnected,
  onConfirm,
  pending
}: {
  proposal: MeetingProposal;
  calendarConnected: boolean;
  onConfirm: (proposal: MeetingProposal) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(proposal);

  useEffect(() => setDraft(proposal), [proposal]);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 ">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-foreground uppercase tracking-wider">Confirm calendar hold</p>
          <p className="mt-1 text-[11px] text-muted-dark leading-relaxed font-semibold">Extracted from Gmail replies with {proposal.confidence}% confidence.</p>
        </div>
        <Badge tone={calendarConnected ? "green" : "amber"}>{calendarConnected ? "Calendar synced" : "Sync needed"}</Badge>
      </div>
      <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Date</span>
          <input type="date" value={draft.suggestedDate} onChange={(event) => setDraft((v) => ({ ...v, suggestedDate: event.target.value }))} className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:border-primary" />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Time</span>
          <input type="time" value={draft.suggestedTime} onChange={(event) => setDraft((v) => ({ ...v, suggestedTime: event.target.value }))} className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:border-primary" />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Duration</span>
          <select value={draft.durationMinutes} onChange={(event) => setDraft((v) => ({ ...v, durationMinutes: Number(event.target.value) }))} className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground focus:outline-none focus:border-primary">
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Timezone</span>
          <input value={draft.timezone} onChange={(event) => setDraft((v) => ({ ...v, timezone: event.target.value }))} className="mt-1.5 h-8.5 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:border-primary" />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Notes</span>
        <textarea value={draft.notes} onChange={(event) => setDraft((v) => ({ ...v, notes: event.target.value }))} className="mt-2 min-h-[60px] w-full resize-y rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-foreground focus:outline-none focus:border-primary font-semibold" />
      </label>
      {!calendarConnected && (
        <p className="mt-3 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs font-semibold text-warning">
          Sync Google Calendar from Workspace Integration settings before confirming calendar blocks.
        </p>
      )}
      <button
        onClick={() => onConfirm(draft)}
        disabled={!calendarConnected || pending}
        className="mt-3.5 inline-flex h-9.5 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45 active:scale-95 "
      >
        {pending ? <RefreshCw size={13} className="animate-spin" /> : <CalendarPlus size={14} aria-hidden />}
        Book Google Meet Hold
      </button>
    </div>
  );
}

export function FollowUpWorkspace() {
  const leads = useOutreachStore((state) => state.leads);
  const board = useOutreachStore((state) => state.followUpBoard);

  const readCampaignReplies = useOutreachStore((state) => state.readCampaignReplies);
  const simulateFollowUpRun = useOutreachStore((state) => state.simulateFollowUpRun);
  const saveFollowUpStrategy = useOutreachStore((state) => state.saveFollowUpStrategy);
  const confirmCalendarMeeting = useOutreachStore((state) => state.confirmCalendarMeeting);
  const markLeadConverted = useOutreachStore((state) => state.markLeadConverted);
  const archiveFollowUpLead = useOutreachStore((state) => state.archiveFollowUpLead);

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [strategyDraft, setStrategyDraft] = useState<Pick<FollowUpStrategy, "followUpCount" | "frequencyDays" | "startDate" | "tone" | "autoArchiveAfterFinal"> | null>(null);

  const [reading, setReading] = useState(false);
  const [runningFollowUps, setRunningFollowUps] = useState(false);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [confirmingMeeting, setConfirmingMeeting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [objectionLead, setObjectionLead] = useState<Lead | null>(null);
  const [objectionReplyText, setObjectionReplyText] = useState("");

  const activeLeads = useMemo(() => board?.leads.filter((state) => state.status !== "converted" && state.status !== "archived_no_response") ?? [], [board]);
  const converted = useMemo(() => board?.leads.filter((state) => state.status === "converted") ?? [], [board]);
  const archived = useMemo(() => board?.leads.filter((state) => state.status === "archived_no_response") ?? [], [board]);
  const selectedState = board?.leads.find((state) => state.leadId === selectedLeadId) ?? activeLeads[0];
  const selectedLead = selectedState ? leads.find((l) => l.id === selectedState.leadId) : undefined;

  useEffect(() => {
    if (!board) return;
    const nextState = board.leads.find((state) => state.leadId === selectedLeadId) ?? board.leads[0];
    if (!selectedLeadId && nextState) setSelectedLeadId(nextState.leadId);
    if (nextState) {
      setStrategyDraft({
        followUpCount: nextState.strategy.followUpCount,
        frequencyDays: nextState.strategy.frequencyDays,
        startDate: nextState.strategy.startDate,
        tone: nextState.strategy.tone,
        autoArchiveAfterFinal: nextState.strategy.autoArchiveAfterFinal
      });
    }
  }, [board, selectedLeadId, leads]);

  const handleReadReplies = async () => {
    setReading(true);
    await readCampaignReplies();
    setReading(false);
  };

  const handleRunFollowUps = async () => {
    setRunningFollowUps(true);
    await simulateFollowUpRun();
    setRunningFollowUps(false);
  };

  const handleSaveStrategy = async () => {
    if (!selectedState || !strategyDraft) return;
    setSavingStrategy(true);
    await saveFollowUpStrategy(selectedState.leadId, strategyDraft);
    setSavingStrategy(false);
  };

  const handleConfirmMeeting = async (proposal: MeetingProposal) => {
    setConfirmingMeeting(true);
    await confirmCalendarMeeting(proposal);
    setConfirmingMeeting(false);
  };

  const handleConvert = async (leadId: string) => {
    setConverting(true);
    await markLeadConverted(leadId, {
      stage: "demo_booked",
      value: 12000,
      notes: "Demo confirmed from follow-up email thread."
    });
    setConverting(false);
  };

  const handleArchive = async (leadId: string) => {
    setArchiving(true);
    await archiveFollowUpLead(leadId, "Completed follow-up sequence with no signal.");
    setArchiving(false);
  };

  const grouped = useMemo(() => ({
    responded: activeLeads.filter((state) => state.status === "responded"),
    read_no_reply: activeLeads.filter((state) => state.status === "read_no_reply"),
    no_response: activeLeads.filter((state) => state.status === "no_response")
  }), [activeLeads]);

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">Step 5</p>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">Follow Up</h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-dark font-medium">Read replies, tune each lead&apos;s cadence, confirm meetings, and archive outcomes.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleReadReplies}
              disabled={!board?.workspace.gmail || reading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-muted-dark transition hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              {reading ? <RefreshCw size={13} className="animate-spin" /> : <MailOpen size={13} aria-hidden />}
              Read replies
            </button>
            <button
              onClick={handleRunFollowUps}
              disabled={!board || runningFollowUps}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white transition-all hover:bg-primary-hover active:scale-95 disabled:opacity-45"
            >
              {runningFollowUps ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} aria-hidden />}
              Run follow-ups
            </button>
          </div>
        </div>

        {board && (!board.workspace.gmail || !board.workspace.calendar) && (
          <div className="mt-4 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-xs font-semibold leading-relaxed text-warning ">
            {!board.workspace.gmail ? (
              <span className="block">
                Gmail accounts are not connected. Click "Workspace Integration" below to sync replies.
              </span>
            ) : null}
            {!board.workspace.calendar ? (
              <span className="block mt-0.5">
                Calendar feeds are not linked. Connect Google Calendar to schedule calendar holds.
              </span>
            ) : null}
            <Link href="/settings/integrations" className="mt-2 inline-flex items-center gap-1.5 underline decoration-warning/45 hover:decoration-warning text-[11px] uppercase tracking-wider font-bold">
              Workspace integration settings
            </Link>
          </div>
        )}

        <div className="mt-5 grid gap-2.5 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 font-bold">
          <MetricCard label="Sent" value={board?.summary.sent ?? 0} icon={Send} />
          <MetricCard label="Responded" value={board?.summary.responded ?? 0} icon={Reply} />
          <MetricCard label="Read" value={board?.summary.readNoReply ?? 0} icon={MailOpen} />
          <MetricCard label="Silent" value={board?.summary.noResponse ?? 0} icon={Clock3} />
          <MetricCard label="Meetings" value={board?.summary.meetingsProposed ?? 0} icon={CalendarPlus} />
          <MetricCard label="Converted" value={board?.summary.converted ?? 0} icon={UserCheck} />
          <MetricCard label="Archived" value={board?.summary.archived ?? 0} icon={Archive} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <FadeUp delay={0.06} className="min-w-0">
            <section className="rounded-xl border border-border bg-surface p-4.5 ">
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <h2 className="text-sm font-bold text-foreground">Reply Inbox</h2>
                <span className="rounded-full bg-background border border-border px-2.5 py-0.5 text-[11px] font-bold text-muted-dark">{activeLeads.length} active</span>
              </div>
              <div className="mt-4 grid gap-3.5 xl:grid-cols-3">
                {(["responded", "read_no_reply", "no_response"] as const).map((key) => (
                  <div key={key} className="min-w-0">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-dark">{statusLabel[key]}</p>
                      <Badge tone={statusTone[key]}>{grouped[key].length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {grouped[key].map((leadState) => {
                        const lead = leads.find((l) => l.id === leadState.leadId);
                        const selected = selectedState?.leadId === leadState.leadId;
                        return (
                          <button
                            key={leadState.leadId}
                            onClick={() => setSelectedLeadId(leadState.leadId)}
                            className={cn(
                              "w-full rounded-xl border p-3.5 text-left transition-all duration-200 hover:border-primary/50 hover:bg-surface-hover/30 ",
                              selected ? "border-primary bg-primary/5" : "border-border bg-background"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-foreground">{lead?.firstName} {lead?.lastName}</p>
                                <p className="mt-1 truncate text-[11px] text-muted-dark font-semibold">{lead?.company}</p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <Badge tone={interestTone[leadState.interestLevel]}>{interestLabel[leadState.interestLevel]}</Badge>
                                <span className="font-mono text-[10px] text-muted-dark font-bold">{leadState.followUpsSent}/{leadState.strategy.followUpCount}</span>
                              </div>
                            </div>
                            <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-muted-dark font-medium border-t border-border/40 pt-2.5">
                              {leadState.reply?.snippet ?? (leadState.status === "read_no_reply" ? "Prospect read the message but has not replied yet." : "No signals received from prospects.")}
                            </p>
                          </button>
                        );
                      })}
                      {grouped[key].length === 0 && (
                        <p className="rounded-xl border border-dashed border-border p-4 text-[11px] font-medium text-center text-muted-dark bg-background/30">
                          Empty.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </FadeUp>

          <FadeUp delay={0.1}>
            <aside className="space-y-3.5">
              <section className="rounded-xl border border-border bg-surface p-4.5 ">
                {selectedState && selectedLead && strategyDraft ? (
                  <div className="space-y-4 animate-fade-in">
                    <div className="flex items-start justify-between gap-3 border-b border-border/40 pb-3.5">
                      <div>
                        <h2 className="text-sm font-bold text-foreground">{selectedLead.firstName} {selectedLead.lastName}</h2>
                        <p className="mt-1 text-[11px] text-muted-dark font-semibold">{selectedLead.title} · {selectedLead.company}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge tone={interestTone[selectedState.interestLevel]}>{interestLabel[selectedState.interestLevel]}</Badge>
                        <Badge tone={statusTone[selectedState.status]}>{statusLabel[selectedState.status]}</Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 text-center">
                      <div className="rounded-lg border border-border bg-background p-2.5 ">
                        <p className="font-mono text-base font-bold text-foreground">{selectedState.openedCount}</p>
                        <p className="text-[10px] font-bold text-muted-dark uppercase tracking-wider mt-0.5">opens</p>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-2.5 ">
                        <p className="font-mono text-base font-bold text-foreground">{selectedState.repliedCount}</p>
                        <p className="text-[10px] font-bold text-muted-dark uppercase tracking-wider mt-0.5">replies</p>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-2.5 ">
                        <p className="font-mono text-base font-bold text-foreground">{selectedState.followUpsSent}</p>
                        <p className="text-[10px] font-bold text-muted-dark uppercase tracking-wider mt-0.5">touches</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-3.5  text-xs font-semibold">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-dark mb-2">Cadence Timeline</p>
                      <p className="text-foreground">Last touch: <span className="font-mono text-muted-dark">{formatDate(selectedState.lastTouchAt)}</span></p>
                      <p className="mt-1 text-foreground">Next follow-up: <span className="font-mono text-muted-dark">{selectedState.nextFollowUpAt || "Cadence paused"}</span></p>
                      {selectedState.reply && (
                        <p className="mt-2.5 text-muted-dark leading-relaxed border-t border-border/40 pt-2 bg-surface/20 p-2 rounded-md">
                          <span className="text-foreground font-bold">Inbox reply:</span> "{selectedState.reply.snippet}"
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border border-border bg-background p-3.5 ">
                      <div className="flex items-center gap-1.5">
                        <Flame size={14} className={cn(selectedState.interestLevel === "hot" ? "text-success" : selectedState.interestLevel === "medium" ? "text-warning" : "text-muted-dark")} aria-hidden />
                        <p className="text-xs font-bold text-foreground uppercase tracking-wider">{interestLabel[selectedState.interestLevel]}</p>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-dark font-medium">{selectedState.interestReason}</p>
                    </div>

                    {selectedState.reply && (
                      <button
                        onClick={() => {
                          setObjectionLead(selectedLead!);
                          setObjectionReplyText(selectedState.reply!.snippet);
                        }}
                        className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-xs font-semibold text-muted-dark hover:border-primary/40 hover:text-primary transition-colors"
                      >
                        <MessageSquareWarning size={13} />
                        Objection handler
                      </button>
                    )}

                    <InlineStrategy state={selectedState} value={strategyDraft} onChange={setStrategyDraft} onSave={handleSaveStrategy} pending={savingStrategy} />

                    {selectedState.scheduledMeeting && (
                      <div className="rounded-lg border border-success/30 bg-success/10 p-3.5 text-xs font-semibold  leading-relaxed">
                        <p className="font-bold text-success">Calendar Hold Confirmed</p>
                        <p className="mt-1 text-muted-dark">{selectedState.scheduledMeeting.suggestedDate} at {selectedState.scheduledMeeting.suggestedTime} · {selectedState.scheduledMeeting.calendarName}</p>
                        <a href={selectedState.scheduledMeeting.meetingUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex break-all text-primary hover:underline font-bold">{selectedState.scheduledMeeting.meetingUrl}</a>
                      </div>
                    )}

                    {selectedState.meetingProposal && !selectedState.scheduledMeeting && (
                      <MeetingEditor proposal={selectedState.meetingProposal} calendarConnected={Boolean(board?.workspace.calendar)} pending={confirmingMeeting} onConfirm={handleConfirmMeeting} />
                    )}

                    <div className="grid gap-2 sm:grid-cols-2 pt-2">
                      <button
                        onClick={() => handleConvert(selectedState.leadId)}
                        disabled={converting || selectedState.status === "converted"}
                        className="inline-flex h-9.5 items-center justify-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 text-xs font-bold text-success transition-all hover:bg-success hover:text-white disabled:opacity-45 active:scale-95 "
                      >
                        <UserCheck size={14} aria-hidden />
                        Mark converted
                      </button>
                      <button
                        onClick={() => handleArchive(selectedState.leadId)}
                        disabled={archiving || selectedState.status === "archived_no_response"}
                        className="inline-flex h-9.5 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-bold text-muted-dark transition-all hover:border-error/45 hover:text-error disabled:opacity-45 active:scale-95 "
                      >
                        <Archive size={14} aria-hidden />
                        Archive lead
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-muted-dark text-center py-6">Select active inbox replies to tune cadences.</p>
                )}
              </section>
            </aside>
          </FadeUp>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ArchiveSection title="Converted Leads Archive" states={converted} leads={leads} />
          <ArchiveSection title="No-Response Archive" states={archived} leads={leads} />
        </div>
      </div>

      <ObjectionModal
        lead={objectionLead}
        replyText={objectionReplyText}
        open={!!objectionLead}
        onClose={() => { setObjectionLead(null); setObjectionReplyText(""); }}
      />
    </main>
  );
}

function ArchiveSection({ title, states, leads }: { title: string; states: FollowUpLeadState[]; leads: Lead[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4.5 ">
      <div className="flex items-center justify-between border-b border-border/40 pb-3 mb-3">
        <h2 className="text-xs font-bold text-foreground uppercase tracking-wider">{title}</h2>
        <Badge tone="grey">{states.length}</Badge>
      </div>
      <div className="space-y-3.5">
        {states.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-5 text-xs font-semibold text-muted-dark text-center bg-background/20">
            No contacts archived here.
          </p>
        ) : (
          states.map((state) => {
            const lead = leads.find((l) => l.id === state.leadId);
            return (
              <div key={state.leadId} className="rounded-lg border border-border bg-background p-3.5 ">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-foreground">{lead?.firstName} {lead?.lastName}</p>
                    <p className="mt-1 text-[11px] text-muted-dark font-semibold">{lead?.company} · {state.conversion?.stage || state.archiveReason}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={interestTone[state.interestLevel]}>{interestLabel[state.interestLevel]}</Badge>
                    <Badge tone={statusTone[state.status]}>{statusLabel[state.status]}</Badge>
                  </div>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-muted-dark font-medium border-t border-border/40 pt-2.5">
                  {state.conversion?.notes ?? `Archived ${formatDate(state.archivedAt)}.`} {state.interestReason}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
export default FollowUpWorkspace;
