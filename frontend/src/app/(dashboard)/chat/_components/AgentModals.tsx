import {
  Bot,
  X,
  ArrowRight
} from "lucide-react";

export function AgentQualityPreview({
  form,
  hasContext,
  hasInstructions
}: {
  form: { description: string, industry: string, role: string },
  hasContext: boolean,
  hasInstructions: boolean
}) {
  const score =
    (form.description ? 0.35 : 0) +
    (form.industry ? 0.25 : 0) +
    (form.role ? 0.15 : 0) +
    (hasInstructions ? 0.10 : 0) +
    (hasContext ? 0.15 : 0);
  const pct = Math.round(score * 100);

  const colorClass = pct >= 75 ? "from-success/80 to-success" : pct >= 50 ? "from-warning/80 to-warning" : "from-primary/80 to-primary";
  const glowColor = pct >= 75 ? "rgba(16,185,129,0.4)" : pct >= 50 ? "rgba(245,158,11,0.4)" : "rgba(83,74,183,0.4)";
  const label = pct >= 75 ? "Exceptional" : pct >= 50 ? "Standard" : pct >= 30 ? "Functional" : "Initialising";

  return (
    <div className="w-full p-5 bg-surface border border-border/30 rounded-2xl relative overflow-hidden group">
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-muted capitalize mb-1">Agent Setup Quality</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-foreground">{label}</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-2xl font-semibold text-foreground tabular-nums tracking-tighter">{pct}%</span>
          <p className="text-[10px] font-medium text-muted capitalize mt-1">Completeness</p>
        </div>
      </div>

      <div className="relative w-full h-2 bg-black/20 dark:bg-white/5 rounded-full overflow-hidden border border-white/5">
        <div
          className={`h-full bg-gradient-to-r ${colorClass} rounded-full transition-all duration-1000 ease-out relative`}
          style={{ width: `${pct}%`, boxShadow: `0 0 20px ${glowColor}` }}
        >
          {/* Scanning Animation Effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent w-20 animate-scan pointer-events-none" />
        </div>
      </div>

      <p className="text-[9px] font-bold text-muted/60 uppercase tracking-widest mt-3 block text-center">
        Add more details or files to improve your agent&apos;s performance
      </p>
    </div>
  );
}

interface AgentSuggestion { name: string; description: string; role: string }

export function NoAgentModal({
  suggestion,
  onClose,
  onCreateAgent,
}: {
  suggestion: AgentSuggestion;
  onClose: () => void;
  onCreateAgent: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-0 md:p-4">
      <div
        className="bg-background border-0 md:border border-border/60 rounded-none md:rounded-xl p-6 md:p-4 w-full h-[100dvh] md:h-auto flex flex-col justify-center animate-scale-in"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)' }}>
              <Bot className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm capitalize">Agent Required</p>
              <p className="text-xs text-muted font-medium mt-0.5 capitalize">No fleet agents deployed yet</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-muted hover:text-foreground hover:bg-background transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-4 p-4 rounded-xl border flex flex-col gap-1"
          style={{ background: 'rgba(139,92,246,0.05)', borderColor: 'rgba(139,92,246,0.2)' }}>
          <p className="text-xs font-semibold w-full capitalize" style={{ color: 'var(--accent)' }}>
            Recommended Agent
          </p>
          <p className="text-base font-semibold text-foreground capitalize">{suggestion.name}</p>
        </div>

        <p className="text-[12px] text-muted leading-relaxed mb-5">
          Task execution - like creating documents, sending emails, or building spreadsheets -
          requires a dedicated agent in your fleet. Agents connect to Google Workspace and execute
          tasks on your behalf.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onCreateAgent}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
            style={{ background: 'var(--primary-gradient)', boxShadow: '0 0 15px var(--primary-glow)' }}
          >
            <span className="font-semibold capitalize text-sm">Create Agent</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-foreground border border-border hover:bg-surface transition-colors"
          >
            <span className="font-medium capitalize text-sm">Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  );
}
