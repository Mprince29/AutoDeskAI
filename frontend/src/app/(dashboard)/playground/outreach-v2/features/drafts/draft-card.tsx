"use client";

import React, { useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import type { EmailDraft, Lead, ReviewStatus } from "../../state/types";
import { Badge } from "../../shared/ui-elements";
import { cn } from "@/lib/utils";

const redraftOptions = [
  { label: "More concise", prompt: "Make it shorter and punchier — cut anything that doesn't earn its place." },
  { label: "More personal", prompt: "Lean harder into the specific trigger reason. Make it feel like I actually read their work." },
  { label: "Softer CTA", prompt: "Replace the direct ask with something lighter — a question, not a pitch." },
  { label: "More direct", prompt: "Get to the point faster. Cut the warm-up." }
];

export function DraftCard({
  draft,
  lead,
  active,
  onReview
}: {
  draft: EmailDraft;
  lead?: Lead;
  active: boolean;
  onReview: (draftId: string, status: ReviewStatus | "edited", updates?: { subject?: string; opener?: string; body?: string }) => void;
}) {
  const [body, setBody] = useState(draft.body);
  const [subject, setSubject] = useState(draft.subject);
  const [opener, setOpener] = useState(draft.opener);
  const [showRedraft, setShowRedraft] = useState(false);
  const [redrafting, setRedrafting] = useState(false);
  const [redraftNote, setRedraftNote] = useState("");

  const handleRedraft = (prompt?: string) => {
    setRedrafting(true);
    // Simulate a redraft — in production this calls the AI endpoint
    setTimeout(() => {
      const instruction = prompt ?? redraftNote;
      if (instruction.toLowerCase().includes("concise") || instruction.toLowerCase().includes("short")) {
        setBody(body.split("\n\n")[0] + "\n\nWould a quick look be useful?");
      } else if (instruction.toLowerCase().includes("personal")) {
        setOpener(`Hi ${lead?.firstName ?? "there"} — ${lead?.triggerReason ?? opener}`);
      } else if (instruction.toLowerCase().includes("softer") || instruction.toLowerCase().includes("cta")) {
        setBody(body.replace(/Would .+\?/, "Curious if this is something worth a look for your team?"));
      } else if (instruction.toLowerCase().includes("direct")) {
        setBody(body.split(".")[0] + ". Worth a quick call?");
      } else {
        // Generic redraft — shuffle body slightly
        setBody(body + "\n\n[Redrafted based on: " + instruction + "]");
      }
      setRedrafting(false);
      setShowRedraft(false);
      setRedraftNote("");
      onReview(draft.id, "edited", { subject, opener, body });
    }, 900);
  };

  return (
    <article className={cn("rounded-xl border border-border bg-surface p-4.5 transition-all duration-200", active && "border-primary ring-2 ring-primary/25")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">{lead ? `${lead.firstName} ${lead.lastName}` : "Draft"}</h2>
            {draft.approvalStatus !== "pending" ? (
              <Badge tone={draft.approvalStatus === "rejected" ? "grey" : "green"}>{draft.approvalStatus}</Badge>
            ) : null}
            {lead?.personalizationMode === "fallback" ? (
              <Badge tone="grey">Safe fallback</Badge>
            ) : (
              <Badge tone="purple">Personalized opener</Badge>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-muted-dark font-medium">{lead?.title} · {lead?.company} · Outreach rep {lead?.owner}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowRedraft((v) => !v)}
            className={cn(
              "inline-flex h-8.5 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition-all duration-200",
              showRedraft
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-dark hover:border-primary hover:text-foreground"
            )}
          >
            <RefreshCw size={13} className={cn(redrafting && "animate-spin")} aria-hidden />
            Redraft
          </button>
          <button
            onClick={() => onReview(draft.id, "edited", { subject, opener, body })}
            className="inline-flex h-8.5 items-center gap-1.5 justify-center rounded-lg border border-success/30 bg-success/10 px-3 text-xs font-bold text-success transition-all hover:bg-success hover:text-white"
            aria-label="Save and queue draft"
          >
            <Check size={14} aria-hidden />
            Save and queue
          </button>
          <button
            onClick={() => onReview(draft.id, "rejected", { subject, opener, body })}
            className="inline-flex h-8.5 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-bold text-muted-dark transition-all hover:border-error/45 hover:text-error"
            aria-label="Reject draft"
          >
            <X size={14} aria-hidden />
            Reject
          </button>
        </div>
      </div>

      {/* Redraft panel */}
      {showRedraft && (
        <div className="mt-3.5 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-dark mb-2">Quick redraft</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {redraftOptions.map((opt) => (
              <button
                key={opt.label}
                onClick={() => handleRedraft(opt.prompt)}
                disabled={redrafting}
                className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-muted-dark transition hover:border-primary hover:text-foreground disabled:opacity-40"
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={redraftNote}
              onChange={(e) => setRedraftNote(e.target.value)}
              placeholder="Or describe what to change…"
              onKeyDown={(e) => { if (e.key === "Enter" && redraftNote.trim()) handleRedraft(); }}
              className="h-8.5 flex-1 rounded-lg border border-border bg-background px-3 text-[12px] text-foreground placeholder:text-muted-dark focus:outline-none focus:border-primary"
            />
            <button
              onClick={() => handleRedraft()}
              disabled={!redraftNote.trim() || redrafting}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white transition hover:bg-primary-hover disabled:opacity-40"
            >
              {redrafting ? <RefreshCw size={12} className="animate-spin" aria-hidden /> : null}
              {redrafting ? "Redrafting…" : "Go"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 rounded-lg border border-border bg-background p-4">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Subject</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-2 h-9 w-full rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Personalized opener</span>
          <textarea
            value={opener}
            onChange={(event) => setOpener(event.target.value)}
            className="mt-2 min-h-[72px] w-full resize-y rounded-md border border-primary/20 bg-primary/5 p-3 text-[12px] leading-relaxed text-primary focus:outline-none focus:border-primary font-semibold"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Email body</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="mt-2 min-h-[160px] w-full resize-y rounded-md border border-border bg-surface p-3 text-[12px] leading-relaxed text-foreground focus:outline-none focus:border-primary font-semibold"
          />
        </label>
      </div>
    </article>
  );
}
