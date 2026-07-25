"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, RefreshCw, Shuffle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOutreachStore } from "../../state/store";
import { DraftCard } from "./draft-card";
import { FadeUp } from "../../shared/ui-elements";

const easing = [0.22, 1, 0.36, 1] as const;

export function ApprovalWorkspace() {
  const router = useRouter();
  const campaign = useOutreachStore((state) => state.campaign);
  const leads = useOutreachStore((state) => state.leads);
  const drafts = useOutreachStore((state) => state.drafts);
  const activeIndex = useOutreachStore((state) => state.activeIndex);
  const projectId = useOutreachStore((state) => state.projectId);

  const reviewDraft = useOutreachStore((state) => state.reviewDraft);
  const approveAllDrafts = useOutreachStore((state) => state.approveAllDrafts);
  const setActiveIndex = useOutreachStore((state) => state.setActiveIndex);
  const addAction = useOutreachStore((state) => state.addAction);

  const [spotCheckIds, setSpotCheckIds] = useState<string[]>([]);
  const [showKeyboardFocus, setShowKeyboardFocus] = useState(false);

  // Broadcast state
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastSubject, setBroadcastSubject] = useState("");
  const [broadcastOpener, setBroadcastOpener] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastSent, setBroadcastSent] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const approvedLeadIds = useMemo(() => {
    const campaignId = campaign?.id || "";
    return new Set(leads.filter((lead) => lead.campaignId === campaignId && lead.status === "approved").map((lead) => lead.id));
  }, [leads, campaign]);

  const readyDrafts = useMemo(() => {
    const campaignId = campaign?.id || "";
    return drafts.filter((draft) => draft.campaignId === campaignId && approvedLeadIds.has(draft.leadId));
  }, [approvedLeadIds, drafts, campaign]);

  const spotCheckDrafts = useMemo(() => readyDrafts.filter((draft) => spotCheckIds.includes(draft.id)), [readyDrafts, spotCheckIds]);
  const approvedCount = useMemo(() => readyDrafts.filter((draft) => draft.approvalStatus === "approved" || draft.approvalStatus === "edited").length, [readyDrafts]);

  // Seed broadcast fields from the first ready draft when opening
  const seedBroadcast = () => {
    const first = readyDrafts[0];
    if (!first) return;
    setBroadcastSubject(first.subject);
    setBroadcastOpener("Hi {{firstName}},");
    setBroadcastBody(first.body);
    setBroadcastSent(false);
    setShowBroadcast(true);
  };

  const handleBroadcastSend = async () => {
    setBroadcasting(true);
    // Loop through each ready draft and update it
    for (const draft of readyDrafts) {
      await reviewDraft(draft.id, "edited", {
        subject: broadcastSubject,
        opener: broadcastOpener,
        body: broadcastBody
      });
    }
    addAction(`Broadcast sent to ${readyDrafts.length} leads`);
    setBroadcastSent(true);
    setBroadcasting(false);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
      if (event.key.toLowerCase() === "j") {
        setShowKeyboardFocus(true);
        setActiveIndex(Math.min(activeIndex + 1, readyDrafts.length - 1));
      }
      if (event.key.toLowerCase() === "k") {
        setShowKeyboardFocus(true);
        setActiveIndex(Math.max(activeIndex - 1, 0));
      }
      if (event.key.toLowerCase() === "e" && readyDrafts[activeIndex]) {
        reviewDraft(readyDrafts[activeIndex].id, "approved");
      }
      if (event.key.toLowerCase() === "r" && readyDrafts[activeIndex]) {
        reviewDraft(readyDrafts[activeIndex].id, "rejected");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, readyDrafts, reviewDraft, setActiveIndex]);

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        <section className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">Step 3</p>
              <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">Draft & Validate</h1>
              <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-dark font-medium">
                Edit approved-lead drafts, validate personalization, then queue the emails.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const sampleSize = Math.max(1, Math.ceil(readyDrafts.length * 0.1));
                  const sample = readyDrafts.filter((draft) => draft.approvalStatus === "pending").slice(0, sampleSize);
                  setSpotCheckIds(sample.map((draft) => draft.id));
                  const sampleIndex = readyDrafts.findIndex((draft) => draft.id === sample[0]?.id);
                  if (sampleIndex >= 0) setActiveIndex(sampleIndex);
                  addAction(sample.length > 0 ? `Spot-check opened ${sample.length} drafts` : "No pending drafts to spot-check");
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-muted-dark transition hover:border-primary hover:text-foreground"
              >
                <Shuffle size={14} aria-hidden />
                Spot-check
              </button>
              <button
                onClick={seedBroadcast}
                disabled={readyDrafts.length === 0}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-muted-dark transition hover:border-primary hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw size={14} aria-hidden />
                Broadcast email
              </button>
              <button
                onClick={() => approveAllDrafts()}
                disabled={!campaign || readyDrafts.length === 0}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white transition-all hover:bg-primary-hover active:scale-95 disabled:opacity-50"
              >
                Queue all
              </button>
              <button
                onClick={() => {
                  if (!projectId) return;
                  router.push(`/playground/outreach-v2/${projectId}/tracking`);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-muted-dark transition hover:border-primary hover:text-foreground"
              >
                Queue
                <ArrowRight size={14} aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-muted-dark font-semibold">
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5">{approvedCount}/{readyDrafts.length} queued</span>
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5">{readyDrafts.length}/{drafts.filter(d => d.campaignId === (campaign?.id || "")).length} lead-approved</span>
            {spotCheckDrafts.length > 0 ? (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-primary">
                Spot-check: {spotCheckDrafts.length} draft{spotCheckDrafts.length !== 1 ? "s" : ""}
              </span>
            ) : null}
          </div>

          {/* Broadcast email panel */}
          <AnimatePresence initial={false}>
            {showBroadcast && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                style={{ overflow: "hidden" }}
              >
                <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4.5 ">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">Broadcast email</p>
                      <p className="mt-1 text-[12px] text-muted-dark font-medium">
                        This single email will be sent to all {readyDrafts.length} approved lead{readyDrafts.length !== 1 ? "s" : ""}. Edit before sending.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowBroadcast(false)}
                      className="text-muted-dark hover:text-foreground transition-colors"
                      aria-label="Close broadcast panel"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3.5 rounded-lg border border-border bg-background p-4">
                    <label className="block">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Subject</span>
                      <input
                        value={broadcastSubject}
                        onChange={(e) => setBroadcastSubject(e.target.value)}
                        className="mt-2 h-9 w-full rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-foreground focus:outline-none focus:border-primary"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Opener</span>
                      <p className="text-[11px] text-muted-dark font-medium mt-0.5">Use {"{{"} firstName {"}}"}  — it will be personalised per recipient.</p>
                      <textarea
                        value={broadcastOpener}
                        onChange={(e) => setBroadcastOpener(e.target.value)}
                        className="mt-2 min-h-[60px] w-full resize-y rounded-md border border-primary/20 bg-primary/5 p-3 text-[12px] leading-relaxed text-primary focus:outline-none focus:border-primary font-semibold"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Body</span>
                      <textarea
                        value={broadcastBody}
                        onChange={(e) => setBroadcastBody(e.target.value)}
                        className="mt-2 min-h-[140px] w-full resize-y rounded-md border border-border bg-surface p-3 text-[12px] leading-relaxed text-foreground focus:outline-none focus:border-primary font-semibold"
                      />
                    </label>
                  </div>

                  <div className="mt-3.5 flex items-center gap-3">
                    {broadcastSent ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-success">
                        <Check size={14} aria-hidden />
                        Queued for {readyDrafts.length} leads
                      </span>
                    ) : (
                      <button
                        onClick={handleBroadcastSend}
                        disabled={!broadcastSubject.trim() || !broadcastBody.trim() || broadcasting}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white transition-all hover:bg-primary-hover active:scale-95 disabled:opacity-40"
                      >
                        {broadcasting ? <RefreshCw size={12} className="animate-spin" /> : null}
                        Send to {readyDrafts.length} lead{readyDrafts.length !== 1 ? "s" : ""}
                      </button>
                    )}
                    <button onClick={() => setShowBroadcast(false)} className="text-xs font-bold text-muted-dark transition hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-4 space-y-3.5 animate-fade-in">
            {readyDrafts.length > 0 ? (
              readyDrafts.map((draft, index) => (
                <motion.div
                  key={draft.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
                >
                  <DraftCard
                    draft={draft}
                    lead={leads.find((lead) => lead.id === draft.leadId)}
                    active={showKeyboardFocus && index === activeIndex}
                    onReview={(draftId, status, updates) => reviewDraft(draftId, status, updates)}
                  />
                </motion.div>
              ))
            ) : (
              <FadeUp delay={0.05}>
                <div className="rounded-xl border border-dashed border-border bg-surface/50 p-6 text-xs text-muted-dark font-semibold text-center">
                  Approve lead cards first. Their drafts will appear here for editing, validation, and queueing.
                </div>
              </FadeUp>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
