"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, BookOpen, Download, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import { LeadCard } from "./lead-card";
import { DossierModal } from "./dossier-modal";
import { BulkImportModal } from "./bulk-import-modal";
import type { Lead } from "../../state/types";

export function LeadHub() {
  const router = useRouter();
  const campaign = useOutreachStore((state) => state.campaign);
  const leads = useOutreachStore((state) => state.leads);
  const projectId = useOutreachStore((state) => state.projectId);
  const activeIndex = useOutreachStore((state) => state.activeIndex);
  const expandedLeadId = useOutreachStore((state) => state.expandedLeadId);

  const reviewLead = useOutreachStore((state) => state.reviewLead);
  const assignLeadOwner = useOutreachStore((state) => state.assignLeadOwner);
  const setActiveIndex = useOutreachStore((state) => state.setActiveIndex);
  const setExpandedLeadId = useOutreachStore((state) => state.setExpandedLeadId);
  const addAction = useOutreachStore((state) => state.addAction);
  const enrichContact = useOutreachStore((state) => state.enrichContact);
  const bulkEnrich = useOutreachStore((state) => state.bulkEnrich);
  const bulkDeleteLeads = useOutreachStore((state) => state.bulkDeleteLeads);

  const [showRejected, setShowRejected] = useState(true);
  const [showKeyboardFocus, setShowKeyboardFocus] = useState(false);
  const [minFitScore, setMinFitScore] = useState(0);

  // V1 feature additions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dossierLead, setDossierLead] = useState<Lead | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [bulkActionPending, setBulkActionPending] = useState<"enrich" | "delete" | null>(null);

  const visibleLeads = useMemo(() => {
    const campaignId = campaign?.id || "";
    return leads.filter(
      (lead) =>
        lead.campaignId === campaignId &&
        (showRejected ? true : lead.status !== "rejected") &&
        lead.qualityScore >= minFitScore
    );
  }, [leads, campaign, showRejected, minFitScore]);

  const aboveThreshold = useMemo(() => {
    const campaignId = campaign?.id || "";
    return leads.filter(
      (l) => l.campaignId === campaignId && l.qualityScore >= minFitScore && l.status === "pending"
    );
  }, [leads, campaign, minFitScore]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
      if (event.key.toLowerCase() === "j") {
        setShowKeyboardFocus(true);
        setActiveIndex(Math.min(activeIndex + 1, visibleLeads.length - 1));
      }
      if (event.key.toLowerCase() === "k") {
        setShowKeyboardFocus(true);
        setActiveIndex(Math.max(activeIndex - 1, 0));
      }
      if (event.key.toLowerCase() === "e" && visibleLeads[activeIndex]) {
        reviewLead(visibleLeads[activeIndex].id, "approved");
      }
      if (event.key.toLowerCase() === "r" && visibleLeads[activeIndex]) {
        reviewLead(visibleLeads[activeIndex].id, "rejected");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, reviewLead, setActiveIndex, visibleLeads]);

  const approved = useMemo(() => {
    const campaignId = campaign?.id || "";
    return leads.filter((lead) => lead.campaignId === campaignId && lead.status === "approved").length;
  }, [leads, campaign]);

  const campaignLeadsCount = useMemo(() => {
    const campaignId = campaign?.id || "";
    return leads.filter((lead) => lead.campaignId === campaignId).length;
  }, [leads, campaign]);

  const owners = ["Ranu", "Lisa", "Amani", "Prashant"];

  const handleApproveAll = async () => {
    const pending = visibleLeads.filter((lead) => lead.status === "pending");
    for (const lead of pending) {
      await reviewLead(lead.id, "approved");
    }
    addAction("Approved all visible leads");
  };

  const handleApproveAboveThreshold = async () => {
    for (const lead of aboveThreshold) {
      await reviewLead(lead.id, "approved");
    }
    addAction(`Approved ${aboveThreshold.length} leads with fit ≥ ${minFitScore}`);
  };

  // ── Selection helpers ──────────────────────────────────────────────────────

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(visibleLeads.map((l) => l.id)));
  const clearSelection = () => setSelectedIds(new Set());

  // ── Per-lead enrich ────────────────────────────────────────────────────────

  const handleEnrich = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    const numId = parseInt(lead.id);
    if (isNaN(numId)) { addAction(`Enriched ${lead.firstName} (demo)`); return; }
    setEnrichingId(lead.id);
    try {
      await enrichContact(numId);
      addAction(`Enriched ${lead.firstName} ${lead.lastName}`);
    } finally {
      setEnrichingId(null);
    }
  };

  // ── Bulk actions ───────────────────────────────────────────────────────────

  const handleBulkEnrich = async () => {
    const numIds = Array.from(selectedIds).map((id) => parseInt(id)).filter((n) => !isNaN(n));
    if (numIds.length === 0) { addAction(`Bulk enriched ${selectedIds.size} leads (demo)`); clearSelection(); return; }
    setBulkActionPending("enrich");
    try {
      await bulkEnrich(numIds);
      addAction(`Bulk enriched ${numIds.length} leads`);
      clearSelection();
    } finally {
      setBulkActionPending(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} selected leads? This cannot be undone.`)) return;
    const numIds = Array.from(selectedIds).map((id) => parseInt(id)).filter((n) => !isNaN(n));
    setBulkActionPending("delete");
    try {
      if (numIds.length > 0) await bulkDeleteLeads(numIds);
      addAction(`Deleted ${selectedIds.size} leads`);
      clearSelection();
    } finally {
      setBulkActionPending(null);
    }
  };

  const handleExportCSV = () => {
    const toExport = selectedIds.size > 0
      ? visibleLeads.filter((l) => selectedIds.has(l.id))
      : visibleLeads;

    const rows = [
      ["Name", "Email", "Company", "Title", "Geography", "Fit Score", "Status", "Owner"],
      ...toExport.map((l) => [
        `${l.firstName} ${l.lastName}`,
        l.email,
        l.company,
        l.title,
        l.geography,
        String(l.qualityScore),
        l.status,
        l.owner,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${campaign?.name ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addAction(`Exported ${toExport.length} leads to CSV`);
  };

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">Step 2</p>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">Approve lead cards</h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-dark font-medium">
              Confirm fit, pick the outreach rep, and move trusted leads to Draft & Validate.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-xs font-bold text-muted-dark transition-all hover:bg-surface-hover active:scale-95 "
            >
              <UploadCloud size={14} />
              Import
            </button>
            <button
              onClick={handleExportCSV}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-xs font-bold text-muted-dark transition-all hover:bg-surface-hover active:scale-95 "
            >
              <Download size={14} />
              Export CSV
            </button>
            <button
              onClick={handleApproveAll}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 text-xs font-bold text-success transition-all hover:bg-success hover:text-white active:scale-95 "
            >
              Approve all
            </button>
            <button
              onClick={() => {
                if (!projectId) return;
                router.push(`/playground/outreach-v2/${projectId}/drafts`);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white transition-all hover:bg-primary-hover active:scale-95 "
            >
              Draft & Validate
              <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
          <Badge tone="green">
            {approved}/{campaignLeadsCount} approved
          </Badge>
          <Badge tone="grey">18 duplicates suppressed</Badge>
          <button
            onClick={() => setShowRejected((value) => !value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-foreground hover:bg-surface-hover transition-all text-xs font-semibold"
          >
            {showRejected ? "Hide rejected" : "Show rejected"}
          </button>
        </div>

        <FadeUp delay={0.06}>
          <div className="mt-3.5 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 ">
            <div className="flex flex-1 items-center gap-3.5 min-w-[200px]">
              <span className="shrink-0 text-xs font-bold text-muted-dark uppercase tracking-wider">Min fit</span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={minFitScore}
                onChange={(e) => setMinFitScore(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-primary"
              />
              <span className="w-8 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-foreground">
                {minFitScore === 0 ? "All" : `${minFitScore}+`}
              </span>
            </div>
            <button
              onClick={handleApproveAboveThreshold}
              disabled={aboveThreshold.length === 0}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-success/35 bg-success/5 px-3 text-[11px] font-bold text-success transition-all hover:bg-success hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve {aboveThreshold.length > 0 ? `${aboveThreshold.length} ` : ""}above threshold
            </button>
          </div>
        </FadeUp>

        <FadeUp delay={0.1}>
          <section className="mt-4 flex flex-wrap items-center gap-2 border-y border-border py-3" aria-label="Outreach rep workload">
            {owners.map((owner) => {
              const campaignId = campaign?.id || "";
              const owned = leads.filter((lead) => lead.campaignId === campaignId && lead.owner === owner);
              return (
                <div
                  key={owner}
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs "
                >
                  <span className="font-semibold text-foreground">{owner}</span>
                  <span className="font-mono text-muted-dark font-medium">{owned.length}</span>
                </div>
              );
            })}
          </section>
        </FadeUp>

        {/* Bulk action toolbar */}
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5"
            >
              <span className="text-xs font-bold text-primary">{selectedIds.size} selected</span>
              <div className="flex items-center gap-1.5 ml-2">
                <button
                  onClick={handleBulkEnrich}
                  disabled={bulkActionPending === "enrich"}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-dark hover:bg-surface-hover disabled:opacity-50 transition-colors"
                >
                  {bulkActionPending === "enrich" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Bulk enrich
                </button>
                <button
                  onClick={handleExportCSV}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-dark hover:bg-surface-hover transition-colors"
                >
                  <Download size={11} />
                  Export selected
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkActionPending === "delete"}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-error/25 bg-error/5 px-2.5 text-[11px] font-semibold text-error hover:bg-error hover:text-white disabled:opacity-50 transition-colors"
                >
                  {bulkActionPending === "delete" ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  Delete
                </button>
                <button onClick={selectAll} className="text-[11px] font-semibold text-primary hover:underline ml-1">
                  Select all
                </button>
                <button onClick={clearSelection} className="text-[11px] font-semibold text-muted-dark hover:underline">
                  Clear
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <section className="mt-4 space-y-3.5 animate-fade-in" aria-label="Enriched lead cards">
          {visibleLeads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-dark font-medium bg-surface/50">
              No leads match the active filter criteria.
            </div>
          ) : (
            visibleLeads.map((lead, index) => (
              <motion.div
                key={lead.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* Checkbox + card wrapper */}
                <div className="flex items-start gap-2">
                  <button
                    onClick={(e) => toggleSelect(lead.id, e)}
                    className={`mt-[18px] flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      selectedIds.has(lead.id)
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-background hover:border-primary/50"
                    }`}
                    aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                  >
                    {selectedIds.has(lead.id) && (
                      <svg viewBox="0 0 10 8" fill="none" className="size-2.5">
                        <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <LeadCard
                      lead={lead}
                      active={showKeyboardFocus && index === activeIndex}
                      expanded={expandedLeadId === lead.id}
                      onReview={(leadId, status) => reviewLead(leadId, status)}
                      onAssign={(leadId, owner) => assignLeadOwner(leadId, owner)}
                      onToggle={(leadId) => setExpandedLeadId(expandedLeadId === leadId ? null : leadId)}
                    />

                    {/* Per-lead action row */}
                    <div className="mt-1 flex items-center gap-1.5 px-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDossierLead(lead); }}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[10px] font-semibold text-muted-dark hover:border-primary/40 hover:text-primary transition-colors"
                      >
                        <BookOpen size={9} />
                        Dossier
                      </button>
                      <button
                        onClick={(e) => handleEnrich(lead, e)}
                        disabled={enrichingId === lead.id}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[10px] font-semibold text-muted-dark hover:border-primary/40 hover:text-primary disabled:opacity-50 transition-colors"
                      >
                        {enrichingId === lead.id ? <Loader2 size={9} className="animate-spin" /> : <RefreshCw size={9} />}
                        Enrich
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </section>
      </div>

      {/* Dossier modal */}
      <AnimatePresence>
        {dossierLead && (
          <DossierModal
            lead={dossierLead}
            open={!!dossierLead}
            onClose={() => setDossierLead(null)}
          />
        )}
      </AnimatePresence>

      {/* Bulk import modal */}
      <AnimatePresence>
        {importOpen && (
          <BulkImportModal
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={(count) => addAction(`Imported ${count} leads`)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
