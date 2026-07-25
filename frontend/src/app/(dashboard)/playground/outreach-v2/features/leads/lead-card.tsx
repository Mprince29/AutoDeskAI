"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Newspaper, UserRound, Zap } from "lucide-react";
import type { Lead, ReviewStatus } from "../../state/types";
import { cn } from "@/lib/utils";

const teamMembers = ["Ranu", "Lisa", "Amani", "Prashant"];

const geographyLabel: Record<Lead["geography"], string> = {
  US: "United States",
  UK: "United Kingdom",
  India: "India",
  Europe: "Europe",
  Other: "Other"
};

const recentNews: Record<string, string[]> = {
  "lead-sarah": [
    "Mint PR announced a dedicated AI communications practice.",
    "Agency leadership published new positioning on human-led AI media monitoring."
  ],
  "lead-marcus": [
    "Marcus posted about clients asking for clearer AI disclosure language.",
    "Northline Comms has been advising regulated B2B teams on communications policy."
  ],
  "lead-jenna": [
    "Harbor & Field announced a new advisory partnership after its Series A.",
    "The company is expanding its technology client roster."
  ],
  "lead-owen": [
    "No strong recent news mention found in the current scan.",
    "Signal House continues to position around emerging B2B brand communications."
  ]
};

export function LeadCard({
  lead,
  active,
  expanded,
  assigning,
  onReview,
  onAssign,
  onToggle
}: {
  lead: Lead;
  active: boolean;
  expanded: boolean;
  assigning?: boolean;
  onReview: (leadId: string, status: ReviewStatus) => void;
  onAssign: (leadId: string, owner: string) => void;
  onToggle: (leadId: string) => void;
}) {
  const scorePercent = Math.max(0, Math.min(100, lead.qualityScore * 10));
  const isApproved = lead.status === "approved";
  const isRejected = lead.status === "rejected";
  const personSummary = `${lead.title} based in ${geographyLabel[lead.geography]}, with expertise in ${lead.context.toLowerCase()}`;
  const buyingTriggers = [lead.triggerReason, lead.context];
  const newsMentions = recentNews[lead.id] ?? [
    `${lead.company} matched the current campaign scan.`,
    "No additional recent news mention found in the mock dataset."
  ];

  return (
    <article
      tabIndex={0}
      aria-label={`${lead.firstName} ${lead.lastName}, ${lead.company}, fit score ${lead.qualityScore} out of 10`}
      onClick={() => onToggle(lead.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(lead.id);
        }
      }}
      className={cn(
        "cursor-pointer rounded-xl border border-border bg-surface/95 p-4 transition-all duration-200 hover:border-primary/50 ",
        active && "border-primary ring-2 ring-primary/20",
        isApproved && "border-success/35 bg-success/5",
        isRejected && "border-error/25 bg-error/5 opacity-70"
      )}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0 max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-bold text-foreground">
              {lead.firstName} {lead.lastName}
            </h2>
            <span className="text-[12px] font-semibold text-muted-dark">{lead.company}</span>
            <ChevronDown
              size={14}
              className={cn("text-muted-dark transition-transform", expanded && "rotate-180 text-foreground")}
              aria-hidden
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-dark font-medium">{personSummary}</p>
        </div>

        <div className="flex items-center gap-5">
          {/* Fit Score */}
          <div className="flex w-[110px] shrink-0 flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-muted-dark">Fit</span>
              <span className="font-mono text-foreground">{lead.qualityScore}/10</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
              <div
                className={cn("h-full rounded-full transition-all duration-300", lead.qualityScore >= 8 ? "bg-success" : "bg-primary")}
                style={{ width: `${scorePercent}%` }}
              />
            </div>
          </div>

          {/* Owner Assignment */}
          <label className="block flex-1" onClick={(event) => event.stopPropagation()}>
            <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-muted-dark uppercase tracking-wider leading-none">
              <UserRound size={11} aria-hidden />
              Outreach rep
            </span>
            <select
              value={lead.owner}
              onChange={(event) => onAssign(lead.id, event.target.value)}
              onClick={(event) => event.stopPropagation()}
              disabled={assigning}
              className="h-8.5 w-full rounded-lg border border-border bg-background px-2.5 text-[12px] font-semibold text-foreground transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {teamMembers.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>

          {/* Review Switch Toggle */}
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              role="switch"
              aria-checked={isApproved}
              aria-label={`${isApproved ? "Approved" : isRejected ? "Rejected" : "Pending"} ${lead.firstName}`}
              onClick={(event) => {
                event.stopPropagation();
                onReview(lead.id, isApproved ? "rejected" : "approved");
              }}
              className={cn(
                "relative inline-flex h-[24px] w-[42px] items-center rounded-full border p-0.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30",
                isApproved && "border-success/45 bg-success/20",
                isRejected && "border-error/45 bg-error/20",
                lead.status === "pending" && "border-border bg-background"
              )}
            >
              <span
                className={cn(
                  "h-[16px] w-[16px] rounded-full transition-transform duration-200 ease-out ",
                  isApproved && "translate-x-[18px] bg-success",
                  isRejected && "translate-x-0 bg-error",
                  lead.status === "pending" && "translate-x-0 bg-muted"
                )}
                aria-hidden
              />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="mt-4 border-t border-border pt-4">
              <div className="grid gap-5 md:grid-cols-2">
                <section aria-label={`${lead.firstName} buying triggers`}>
                  <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-dark">
                    <Zap size={12} className="text-success" aria-hidden />
                    Buying triggers
                  </h3>
                  <ul className="mt-2.5 space-y-2">
                    {buyingTriggers.map((trigger) => (
                      <li key={trigger} className="border-l border-success/35 pl-3 text-xs leading-relaxed text-foreground/80 font-semibold">
                        {trigger}
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-label={`${lead.firstName} recent news mentions`}>
                  <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-dark">
                    <Newspaper size={12} className="text-primary" aria-hidden />
                    Recent news
                  </h3>
                  <ul className="mt-2.5 space-y-2">
                    {newsMentions.map((mention) => (
                      <li key={mention} className="border-l border-primary/40 pl-3 text-xs leading-relaxed text-foreground/80 font-semibold">
                        {mention}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}
