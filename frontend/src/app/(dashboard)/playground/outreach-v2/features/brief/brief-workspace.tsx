"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, RotateCcw, Sparkles, Clock3 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useOutreachStore } from "../../state/store";
import { PipelineProgress, PromptInputBox, FadeUp } from "../../shared/ui-elements";

const stageOrder = ["parse", "discover", "enrich", "deduplicate", "draft"] as const;
const companySizeOptions = ["1-10 employees", "11-25 employees", "25-250 employees", "250-1,000 employees", "1,000+ employees"];
const templateOptions = ["eBic founder outreach", "Retail IO operator intro", "AI Innovation Lab consultative", "Custom uploaded template"];
const sendWindowOptions = ["Monday 9:00-11:30 AM EST", "Tuesday 10:00 AM-12:00 PM EST", "Wednesday 2:00-4:00 PM GMT", "Next business day 9:00 AM local"];
const easing = [0.22, 1, 0.36, 1] as const;

export function BriefWorkspace() {
  const router = useRouter();
  const commandRegionRef = useRef<HTMLDivElement>(null);
  const [brief, setBrief] = useState("");
  const [roles, setRoles] = useState("");
  const [industries, setIndustries] = useState("");
  const [geography, setGeography] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [signals, setSignals] = useState("");
  const [template, setTemplate] = useState("");
  const [sendWindow, setSendWindow] = useState("");
  const [stageIndex, setStageIndex] = useState(0);

  // Zustand Store Hooks
  const campaign = useOutreachStore((state) => state.campaign);
  const stages = useOutreachStore((state) => state.pipelineStages);
  const briefSubmitted = useOutreachStore((state) => state.briefSubmitted);
  const pipelineStarted = useOutreachStore((state) => state.pipelineStarted);
  const pipelineComplete = useOutreachStore((state) => state.pipelineComplete);
  const projectId = useOutreachStore((state) => state.projectId);

  const setBriefSubmitted = useOutreachStore((state) => state.setBriefSubmitted);
  const startPipeline = useOutreachStore((state) => state.startPipeline);
  const completePipeline = useOutreachStore((state) => state.completePipeline);
  const addAction = useOutreachStore((state) => state.addAction);

  const activeStage = stageOrder[stageIndex];

  useEffect(() => {
    if (!campaign) return;
    setRoles((value) => value || campaign.parsedIcp.roles.join(", "));
    setIndustries((value) => value || campaign.parsedIcp.industries.join(", "));
    setGeography((value) => value || campaign.parsedIcp.geographies.join(", "));
    setCompanySize((value) => value || campaign.parsedIcp.companySize);
    setSignals((value) => value || campaign.parsedIcp.intentSignals.join(", "));
    setTemplate((value) => value || campaign.parsedIcp.template);
    setSendWindow((value) => value || campaign.parsedIcp.sendWindow);
  }, [campaign]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !commandRegionRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        commandRegionRef.current?.querySelector("textarea")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!pipelineStarted || pipelineComplete) return;
    if (stageIndex >= stageOrder.length - 1) {
      const done = window.setTimeout(() => completePipeline(), 900);
      return () => window.clearTimeout(done);
    }
    const timer = window.setTimeout(() => setStageIndex((index) => index + 1), 950);
    return () => window.clearTimeout(timer);
  }, [completePipeline, pipelineComplete, pipelineStarted, stageIndex]);

  const icpFields = useMemo(
    () => [
      { label: "Roles", value: roles, onChange: setRoles, type: "text" as const, placeholder: "Founder, VP Communications" },
      { label: "Industries", value: industries, onChange: setIndustries, type: "text" as const, placeholder: "Public relations, agencies" },
      { label: "Geography", value: geography, onChange: setGeography, type: "text" as const, placeholder: "United States, New York" },
      { label: "Company size", value: companySize, onChange: setCompanySize, type: "select" as const, options: companySizeOptions },
      { label: "Signals", value: signals, onChange: setSignals, type: "text" as const, placeholder: "AI commentary, hiring" },
      { label: "Template", value: template, onChange: setTemplate, type: "select" as const, options: templateOptions },
      { label: "Send window", value: sendWindow, onChange: setSendWindow, type: "select" as const, options: sendWindowOptions }
    ],
    [companySize, geography, industries, roles, sendWindow, signals, template]
  );

  return (
    <main className="min-w-0 flex-1 p-4 md:p-6 bg-background text-foreground">
      <div
        className={
          briefSubmitted || pipelineStarted
            ? "mx-auto max-w-3xl"
            : "mx-auto flex min-h-[calc(100vh-13rem)] max-w-3xl items-center"
        }
      >
        <section className="w-full">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                <Sparkles size={14} aria-hidden />
                Step 1
              </p>
              <h1 className="mt-2 max-w-2xl text-[24px] font-extrabold tracking-tight md:text-[30px] text-foreground">
                Create a campaign brief
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-dark font-normal">
                Describe who to reach. Confirm the parsed ICP. Run the pipeline.
              </p>
            </div>
          </div>

          <FadeUp delay={0.05}>
            <div ref={commandRegionRef} className="relative mt-6">
              <PromptInputBox
                value={brief}
                onValueChange={setBrief}
                placeholder="Find 40 VP-level PR leads at mid-tier US agencies..."
                onSend={(message) => {
                  setBriefSubmitted(true);
                  addAction(message.startsWith("[") ? "Brief parsed with agent mode" : "Brief parsed from prompt box");
                }}
                className="border-border bg-surface"
              />
            </div>
          </FadeUp>
        </section>
      </div>

      <AnimatePresence>
        {briefSubmitted ? (
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.34, ease: easing }}
            className="mx-auto mt-4 max-w-3xl rounded-xl border border-border bg-surface p-4 md:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-muted-dark uppercase tracking-wider">Parsed ICP confirmation</p>
                <h2 className="mt-1 text-sm font-bold text-foreground">The agent understood this brief as:</h2>
              </div>
              <button
                onClick={() => {
                  setStageIndex(0);
                  startPipeline();
                  addAction("Pipeline run with edited ICP");
                }}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-hover px-4 text-xs font-bold text-foreground transition-all hover:bg-border active:scale-95"
              >
                {pipelineStarted ? <RotateCcw size={15} aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
                {pipelineStarted ? "Run again" : "Confirm and run"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {icpFields.map((field, index) => (
                <motion.label
                  key={field.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: index * 0.035, ease: easing }}
                  className="rounded-lg border border-border bg-background p-3.5 transition focus-within:border-primary "
                >
                  <span className="text-[11px] font-bold text-muted-dark uppercase tracking-wider">{field.label}</span>
                  {field.type === "select" ? (
                    <select
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                      className="mt-2 h-9 w-full rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-foreground focus:outline-none focus:border-primary"
                    >
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                      placeholder={field.placeholder}
                      className="mt-2 h-9 w-full rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-foreground placeholder:text-muted-dark focus:outline-none focus:border-primary"
                    />
                  )}
                </motion.label>
              ))}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {pipelineStarted ? (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: easing }}
            className="mt-4"
          >
            <div className="mx-auto max-w-5xl">
              <PipelineProgress stages={stages} activeStage={activeStage} complete={pipelineComplete} />
            </div>
            {pipelineComplete ? (
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.34, ease: easing }}
                className="mx-auto max-w-5xl mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/5 p-4 "
              >
                <div className="flex items-start gap-3">
                  <Clock3 size={18} className="mt-0.5 text-success shrink-0" aria-hidden />
                  <div>
                    <p className="text-sm font-bold text-success">Lead batch is ready</p>
                    <p className="mt-1 text-[12px] text-muted-dark font-medium">18 duplicates suppressed. Approve lead cards before editing drafts.</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!projectId) return;
                    router.push(`/playground/outreach-v2/${projectId}/leads`);
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-success px-4 text-xs font-bold text-white hover:bg-success/90 transition  active:scale-95"
                >
                  Review leads
                  <ArrowRight size={15} aria-hidden />
                </button>
              </motion.div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
