"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Building2,
  ExternalLink,
  Lightbulb,
  Loader2,
  Newspaper,
  RefreshCw,
  Sparkles,
  Target,
  X,
  Zap,
} from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge } from "../../shared/ui-elements";
import type { Lead } from "../../state/types";

interface DossierData {
  overview?: string;
  tech_stack?: string[];
  recent_news?: Array<{ headline: string; date?: string; source?: string }>;
  pain_points?: string[];
  outreach_angles?: string[];
  icebreakers?: string[];
  competitors?: string[];
  awards?: string[];
  company_size?: string;
  revenue_range?: string;
}

export function DossierModal({
  lead,
  open,
  onClose,
}: {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
}) {
  const generateDossier = useOutreachStore((s) => s.generateDossier);

  const [dossier, setDossier] = useState<DossierData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !lead) return;
    setDossier(null);
    setError(null);
    loadDossier();
  }, [open, lead?.id]);

  const loadDossier = async () => {
    if (!lead) return;
    const numId = parseInt(lead.id);
    if (isNaN(numId)) {
      // Mock dossier for demo leads
      setDossier(mockDossier(lead));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await generateDossier(numId);
      setDossier(result.dossier ?? mockDossier(lead));
    } catch {
      setDossier(mockDossier(lead));
    } finally {
      setLoading(false);
    }
  };

  if (!open || !lead) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface  max-h-[88vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-foreground">{lead.company}</h2>
              <Badge tone="grey">{lead.geography}</Badge>
              {lead.companySize && <Badge tone="grey">{lead.companySize} employees</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-dark">
              {lead.firstName} {lead.lastName} · {lead.title}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={loadDossier}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-dark hover:bg-surface-hover disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-surface-hover transition-colors"
            >
              <X size={14} className="text-muted-dark" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="text-xs text-muted-dark">Generating company intelligence...</p>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-error">{error}</p>
            </div>
          ) : dossier ? (
            <div className="p-6 space-y-5">
              {/* Overview */}
              {dossier.overview && (
                <Section icon={<Building2 size={14} />} title="Company overview">
                  <p className="text-xs text-foreground leading-relaxed">{dossier.overview}</p>
                </Section>
              )}

              {/* Outreach angles */}
              {dossier.outreach_angles?.length ? (
                <Section icon={<Target size={14} />} title="Outreach angles">
                  <ul className="space-y-1.5">
                    {dossier.outreach_angles.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" />
                        {a}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {/* Icebreakers */}
              {dossier.icebreakers?.length ? (
                <Section icon={<Sparkles size={14} />} title="Icebreakers">
                  <div className="space-y-2">
                    {dossier.icebreakers.map((ic, i) => (
                      <div key={i} className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
                        "{ic}"
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {/* Pain points */}
              {dossier.pain_points?.length ? (
                <Section icon={<Zap size={14} />} title="Likely pain points">
                  <div className="flex flex-wrap gap-1.5">
                    {dossier.pain_points.map((pp, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-warning/20 bg-warning/10 px-2.5 py-0.5 text-[11px] font-medium text-warning"
                      >
                        {pp}
                      </span>
                    ))}
                  </div>
                </Section>
              ) : null}

              {/* Recent news */}
              {dossier.recent_news?.length ? (
                <Section icon={<Newspaper size={14} />} title="Recent news">
                  <div className="space-y-2">
                    {dossier.recent_news.map((n, i) => (
                      <div key={i} className="rounded-lg border border-border bg-background px-3 py-2">
                        <p className="text-xs font-semibold text-foreground">{n.headline}</p>
                        {(n.date || n.source) && (
                          <p className="mt-0.5 text-[11px] text-muted-dark">
                            {n.source}{n.source && n.date ? " · " : ""}{n.date}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {/* Tech stack */}
              {dossier.tech_stack?.length ? (
                <Section icon={<Lightbulb size={14} />} title="Tech stack">
                  <div className="flex flex-wrap gap-1.5">
                    {dossier.tech_stack.map((t, i) => (
                      <span key={i} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-dark">
                        {t}
                      </span>
                    ))}
                  </div>
                </Section>
              ) : null}

              {/* Competitors */}
              {dossier.competitors?.length ? (
                <Section icon={<Target size={14} />} title="Competitors">
                  <div className="flex flex-wrap gap-1.5">
                    {dossier.competitors.map((c, i) => (
                      <span key={i} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-dark">
                        {c}
                      </span>
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {lead.linkedinUrl && (
          <div className="border-t border-border px-6 py-3">
            <a
              href={lead.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <ExternalLink size={12} />
              View LinkedIn profile
            </a>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-muted-dark">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function mockDossier(lead: Lead): DossierData {
  return {
    overview: `${lead.company} is a ${lead.companySize}-employee company focused on ${lead.triggerReason.toLowerCase().includes("ai") ? "AI-driven" : "technology-driven"} solutions in their space. ${lead.context}`,
    outreach_angles: [
      `${lead.triggerReason} creates an ideal opening to discuss how we can accelerate ${lead.firstName}'s workflow.`,
      `With ${lead.companySize} employees, ${lead.company} is at the stage where intelligent tooling has outsized ROI.`,
      `${lead.title} at a company of this scale typically owns the decision for solutions in this category.`,
    ],
    icebreakers: [
      `Saw that ${lead.triggerReason.toLowerCase()} — that's the kind of momentum we love helping teams capitalize on.`,
      `Your work at ${lead.company} has a clear throughline to the problem we solve — curious if ${lead.firstName} has noticed the same gap.`,
    ],
    pain_points: ["Manual research overhead", "Slow outreach cycle", "Low signal-to-noise ratio"],
    recent_news: [
      { headline: lead.triggerReason, source: "Company intelligence", date: "Recent" },
    ],
    tech_stack: ["HubSpot", "Salesforce", "Slack", "G Suite"],
    competitors: ["Apollo.io", "Outreach.io", "Salesloft"],
  };
}
