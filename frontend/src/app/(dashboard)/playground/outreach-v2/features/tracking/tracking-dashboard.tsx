"use client";

import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, ArrowUpRight, Download, Flame, Loader2, MailCheck, Send, Target, Users } from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import { cn } from "@/lib/utils";

type EventFilter = "all" | "sent" | "opened" | "replied";

const confidenceLabel: Record<string, string> = {
  verified: "Verified",
  likely: "Likely",
  unknown: "Unknown"
};

const confidenceTone: Record<string, "green" | "amber" | "grey"> = {
  verified: "green",
  likely: "amber",
  unknown: "grey"
};

const eventFilterLabel: Record<EventFilter, string> = {
  all: "All",
  sent: "Sent",
  opened: "Opened",
  replied: "Replied"
};

const eventTypeTone: Record<string, "green" | "amber" | "grey"> = {
  generated: "grey",
  approved: "green",
  queued: "grey",
  sent: "green",
  opened: "amber",
  clicked: "amber",
  replied: "green",
  bounced: "grey"
};

export function TrackingDashboard() {
  const campaign = useOutreachStore((state) => state.campaign);
  const tracking = useOutreachStore((state) => state.tracking);
  const leads = useOutreachStore((state) => state.leads);
  const drafts = useOutreachStore((state) => state.drafts);
  const events = useOutreachStore((state) => state.events);

  const sendQueued = useOutreachStore((state) => state.sendQueued);
  const addAction = useOutreachStore((state) => state.addAction);

  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [expandedEventLeadId, setExpandedEventLeadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const handleSendQueued = async () => {
    setSending(true);
    await sendQueued();
    setSending(false);
  };

  const exportCsv = () => {
    const campaignId = campaign?.id || "";
    const campaignLeads = leads.filter((l) => l.campaignId === campaignId);
    const campaignDrafts = drafts.filter((d) => d.campaignId === campaignId);

    const rows = [
      ["Name", "Company", "Email confidence", "Lead status", "Draft status"],
      ...campaignLeads.map((lead) => {
        const draft = campaignDrafts.find((item) => item.leadId === lead.id);
        return [
          `${lead.firstName} ${lead.lastName}`,
          lead.company,
          lead.emailConfidence,
          lead.status,
          draft?.approvalStatus ?? "none"
        ];
      })
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `autodeskai-${campaign?.projectId || "campaign"}-export.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    addAction("CSV exported");
  };

  const campaignId = campaign?.id || "";
  const campaignLeads = useMemo(() => leads.filter((l) => l.campaignId === campaignId), [leads, campaignId]);
  const campaignDrafts = useMemo(() => drafts.filter((d) => d.campaignId === campaignId), [drafts, campaignId]);
  const campaignLeadIds = useMemo(() => new Set(campaignLeads.map((lead) => lead.id)), [campaignLeads]);

  // Pipeline health calculations
  const approvedLeads = campaignLeads.filter((l) => l.status === "approved").length;
  const rejectedLeads = campaignLeads.filter((l) => l.status === "rejected").length;
  const pendingLeads = campaignLeads.filter((l) => l.status === "pending").length;
  const queuedDrafts = campaignDrafts.filter((d) => d.approvalStatus === "approved" || d.approvalStatus === "edited").length;
  const verifiedEmails = campaignLeads.filter((l) => l.emailConfidence === "verified").length;
  const likelyEmails = campaignLeads.filter((l) => l.emailConfidence === "likely").length;
  const unknownEmails = campaignLeads.filter((l) => l.emailConfidence === "unknown").length;
  const strongFit = campaignLeads.filter((l) => l.qualityScore >= 8).length;
  const moderateFit = campaignLeads.filter((l) => l.qualityScore >= 6 && l.qualityScore < 8).length;
  const weakFit = campaignLeads.filter((l) => l.qualityScore < 6).length;

  const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  // Hot leads filter
  const hotLeads = useMemo(
    () => campaignLeads.filter((l) => tracking.hotLeads.includes(l.id)),
    [campaignLeads, tracking]
  );

  // Event stream filters
  const filteredEvents = useMemo(() => {
    const campaignEvents = events.filter((event) => campaignLeadIds.has(event.leadId));
    if (eventFilter === "all") return campaignEvents;
    return campaignEvents.filter((e) => e.type === eventFilter);
  }, [events, eventFilter, campaignLeadIds]);

  const getLeadEvents = (leadId: string) => events.filter((event) => campaignLeadIds.has(event.leadId) && event.leadId === leadId);
  const getLastEvent = (leadId: string) => {
    const le = events.filter((event) => campaignLeadIds.has(event.leadId) && event.leadId === leadId);
    return le[le.length - 1];
  };

  const heroMetrics = [
    { label: "Sent", value: tracking.sent, icon: MailCheck, format: (v: number) => String(v) },
    { label: "Open rate", value: tracking.openRate, icon: Activity, format: (v: number) => `${v}%` },
    { label: "Reply rate", value: tracking.replyRate, icon: ArrowUpRight, format: (v: number) => `${v}%` },
    { label: "Hot leads", value: tracking.hotLeads.length, icon: Flame, format: (v: number) => String(v) }
  ];

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">Step 4</p>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">{campaign?.name || "Outreach"}</h1>
            <p className="mt-1 text-xs text-muted-dark font-medium leading-relaxed max-w-2xl">{campaign?.brief}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSendQueued}
              disabled={!campaign || !tracking.queued || sending}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white transition-all hover:bg-primary-hover active:scale-95 disabled:opacity-50"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} aria-hidden />}
              Send queued {tracking.queued ? `(${tracking.queued})` : ""}
            </button>
            <button
              onClick={exportCsv}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-xs font-bold text-muted-dark transition hover:border-primary hover:text-foreground"
            >
              <Download size={14} aria-hidden />
              Export CSV
            </button>
          </div>
        </div>

        {/* Hero Metrics Strip */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {heroMetrics.map((metric, index) => {
            const Icon = metric.icon;
            return (
              <FadeUp key={metric.label} delay={index * 0.04}>
                <div className="rounded-xl border border-border bg-surface p-4.5 ">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-muted-dark uppercase tracking-wider">{metric.label}</p>
                    <Icon size={14} className="text-muted-dark" aria-hidden />
                  </div>
                  <p className="mt-3 font-mono text-[30px] font-bold leading-none tabular-nums text-foreground">
                    {metric.format(metric.value)}
                  </p>
                </div>
              </FadeUp>
            );
          })}
        </div>

        {/* Stats and Info Panels */}
        <FadeUp delay={0.1}>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* ICP Parameters Snapshot */}
            <div className="rounded-xl border border-border bg-surface p-5 ">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Target size={15} className="text-primary" aria-hidden />
                ICP Settings
              </div>
              <div className="mt-4 space-y-3 text-xs font-semibold">
                {campaign?.parsedIcp && (
                  <>
                    <div className="flex gap-4">
                      <span className="w-24 shrink-0 text-muted-dark uppercase tracking-wider text-[10px] mt-0.5">Roles</span>
                      <span className="text-foreground leading-relaxed">{campaign.parsedIcp.roles.join(" · ")}</span>
                    </div>
                    <div className="flex gap-4">
                      <span className="w-24 shrink-0 text-muted-dark uppercase tracking-wider text-[10px] mt-0.5">Industries</span>
                      <span className="text-foreground leading-relaxed">{campaign.parsedIcp.industries.slice(0, 2).join(", ")}</span>
                    </div>
                    <div className="flex gap-4">
                      <span className="w-24 shrink-0 text-muted-dark uppercase tracking-wider text-[10px] mt-0.5">Size</span>
                      <span className="text-foreground">{campaign.parsedIcp.companySize}</span>
                    </div>
                    <div className="flex gap-4">
                      <span className="w-24 shrink-0 text-muted-dark uppercase tracking-wider text-[10px] mt-0.5">Send window</span>
                      <span className="text-foreground">{campaign.parsedIcp.sendWindow}</span>
                    </div>
                  </>
                )}
                <div className="flex gap-4 border-t border-border/40 pt-3">
                  <span className="w-24 shrink-0 text-muted-dark uppercase tracking-wider text-[10px]">Suppressed</span>
                  <span className="text-muted-dark">{campaign?.duplicateCount ?? 18} duplicates suppressed</span>
                </div>
              </div>
            </div>

            {/* Pipeline Health */}
            <div className="rounded-xl border border-border bg-surface p-5 ">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Users size={15} className="text-primary" aria-hidden />
                Pipeline Health
              </div>
              <div className="mt-4 space-y-4">
                {/* Leads Approved bar */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-dark">
                    <span>Leads Approved</span>
                    <span className="font-mono text-foreground font-semibold">{approvedLeads} / {campaignLeads.length}</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-border ">
                    {campaignLeads.length > 0 && (
                      <>
                        <div className="h-full bg-success transition-all duration-300" style={{ width: `${(approvedLeads / campaignLeads.length) * 100}%` }} />
                        <div className="h-full bg-primary/60 transition-all duration-300" style={{ width: `${(pendingLeads / campaignLeads.length) * 100}%` }} />
                        <div className="h-full bg-error/60 transition-all duration-300" style={{ width: `${(rejectedLeads / campaignLeads.length) * 100}%` }} />
                      </>
                    )}
                  </div>
                </div>

                {/* Drafts Queued bar */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-dark">
                    <span>Drafts Queued</span>
                    <span className="font-mono text-foreground font-semibold">{pct(queuedDrafts, campaignDrafts.length)}% ({queuedDrafts}/{campaignDrafts.length})</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-border ">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct(queuedDrafts, campaignDrafts.length)}%` }} />
                  </div>
                </div>

                {/* Email Confidence indicator */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-dark">
                    <span>Email Verification</span>
                    <span className="font-mono text-foreground font-semibold">{pct(verifiedEmails, campaignLeads.length)}% verified</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-border ">
                    {campaignLeads.length > 0 && (
                      <>
                        <div className="h-full bg-success transition-all duration-300" style={{ width: `${pct(verifiedEmails, campaignLeads.length)}%` }} />
                        <div className="h-full bg-warning/70 transition-all duration-300" style={{ width: `${pct(likelyEmails, campaignLeads.length)}%` }} />
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex gap-3 text-[10px] font-bold text-muted-dark uppercase tracking-wider">
                    <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" />{pct(verifiedEmails, campaignLeads.length)}% verified</span>
                    <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-warning/70 align-middle" />{pct(likelyEmails, campaignLeads.length)}% likely</span>
                    <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-border align-middle" />{pct(unknownEmails, campaignLeads.length)}% unknown</span>
                  </div>
                </div>

                {/* Fit distribution */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-dark">
                    <span>Fit Distribution</span>
                    <span className="font-mono text-foreground font-semibold">{pct(strongFit, campaignLeads.length)}% strong</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-border ">
                    {campaignLeads.length > 0 && (
                      <>
                        <div className="h-full bg-success transition-all duration-300" style={{ width: `${pct(strongFit, campaignLeads.length)}%` }} />
                        <div className="h-full bg-primary/60 transition-all duration-300" style={{ width: `${pct(moderateFit, campaignLeads.length)}%` }} />
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex gap-3 text-[10px] font-bold text-muted-dark uppercase tracking-wider">
                    <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" />Strong ≥8 ({strongFit})</span>
                    <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary/60 align-middle" />Mod 6-7 ({moderateFit})</span>
                    <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-border align-middle" />Weak &lt;6 ({weakFit})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </FadeUp>

        {/* Hot Leads */}
        {hotLeads.length > 0 && (
          <FadeUp delay={0.14}>
            <div className="mt-4 rounded-xl border border-border bg-surface p-5 ">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Flame size={15} className="text-warning" aria-hidden />
                High-Signal Prospects (Hot Leads)
              </div>
              <p className="mt-1 text-xs text-muted-dark font-medium">Highest-signal contacts in this batch.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {hotLeads.map((lead) => {
                  const lastEvent = getLastEvent(lead.id);
                  return (
                    <div key={lead.id} className="rounded-lg border border-border bg-background p-4 ">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-foreground">{lead.firstName} {lead.lastName}</p>
                          <p className="mt-1 text-[11px] text-muted-dark font-semibold">{lead.title} · {lead.company}</p>
                        </div>
                        <Badge tone={confidenceTone[lead.emailConfidence]}>{confidenceLabel[lead.emailConfidence]}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {lastEvent && (
                          <Badge tone={eventTypeTone[lastEvent.type] ?? "grey"}>{lastEvent.type}</Badge>
                        )}
                        <span className="text-[11px] font-semibold text-muted-dark uppercase tracking-wider">
                          {lead.personalizationMode === "strong" ? "Personalized" : "Fallback"} opener
                        </span>
                      </div>
                      {lastEvent && (
                        <p className="mt-2.5 text-xs leading-relaxed text-muted-dark font-semibold border-t border-border/40 pt-2.5">{lastEvent.detail}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </FadeUp>
        )}

        {/* Event Stream */}
        <FadeUp delay={0.18}>
          <div className="mt-4 rounded-xl border border-border bg-surface p-5 ">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-sm font-bold text-foreground">Event Stream</h2>
              <div className="flex gap-1.5 bg-background p-1 rounded-lg border border-border">
                {(["all", "sent", "opened", "replied"] as EventFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setEventFilter(f)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-bold transition-all duration-200",
                      eventFilter === f
                        ? "bg-surface text-foreground "
                        : "text-muted-dark hover:text-foreground"
                    )}
                  >
                    {eventFilterLabel[f]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 divide-y divide-border/40 max-h-[450px] overflow-y-auto pr-2">
              {filteredEvents.length === 0 && (
                <p className="py-8 text-center text-xs font-semibold text-muted-dark">No {eventFilter} events recorded.</p>
              )}
              {filteredEvents.map((event) => {
                const lead = leads.find((l) => l.id === event.leadId);
                const isExpanded = expandedEventLeadId === event.leadId;
                const leadEvents = getLeadEvents(event.leadId);
                return (
                  <div key={event.id} className="py-2.5 first:pt-0 last:pb-0">
                    <button
                      onClick={() => setExpandedEventLeadId(isExpanded ? null : event.leadId)}
                      className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-hover/50"
                    >
                      <span className="w-[64px] shrink-0 pt-0.5 font-mono text-[11px] text-muted-dark">{event.timestamp}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={eventTypeTone[event.type] ?? "grey"}>{event.type}</Badge>
                          <span className="text-xs font-bold text-foreground">{lead?.firstName} {lead?.lastName}</span>
                          <span className="text-[11px] text-muted-dark font-medium">· {lead?.company}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-dark font-semibold">{event.detail}</p>
                      </div>
                      <Badge tone={event.status === "ok" ? "green" : event.status === "watch" ? "amber" : "grey"}>
                        {event.status}
                      </Badge>
                    </button>

                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                          style={{ overflow: "hidden" }}
                        >
                          <div className="ml-[76px] mb-2.5 mt-2 space-y-3 border-l border-primary/30 pl-4 py-1 bg-background/30 rounded-r-lg">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-dark">Trace Log — {lead?.firstName} {lead?.lastName}</p>
                            {leadEvents.map((le) => (
                              <div key={le.id} className="relative py-1">
                                <span className="absolute -left-[21px] top-3 size-1.5 rounded-full bg-primary" />
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] text-muted-dark">{le.timestamp}</span>
                                  <Badge tone={eventTypeTone[le.type] ?? "grey"}>{le.type}</Badge>
                                  <span className="text-[11px] font-semibold text-muted-dark">{le.latencyMs}ms · {le.service}</span>
                                </div>
                                <p className="mt-1 text-xs text-foreground/80 leading-relaxed font-semibold">{le.detail}</p>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        </FadeUp>
      </div>
    </main>
  );
}
