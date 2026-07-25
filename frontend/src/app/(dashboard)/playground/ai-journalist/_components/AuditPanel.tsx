import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AuditReport } from "../types";

export function AuditPanel({ audit }: { audit: AuditReport }) {
  const [open, setOpen] = useState(false);
  const passed = audit.status === "Passed";

  return (
    <div className="mt-3 rounded-xl border border-border/40 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${passed ? "bg-green-500" : "bg-amber-500"}`} />
          <span className="text-[11px] font-bold text-[var(--text-primary)]">
            Editorial Audit - {audit.status}
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--text-tertiary)]" /> : <ChevronDown size={14} className="text-[var(--text-tertiary)]" />}
      </button>
      {open && (
        <div className="px-3 py-3 bg-[var(--bg-primary)] flex flex-col gap-3">
          {[
            { label: "Tone", value: audit.sentiment_tone },
            { label: "Coverage", value: audit.entity_coverage },
            { label: "SEO", value: audit.seo_recommendation },
          ].map(row => (
            <div key={row.label}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">{row.label}</p>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{row.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
