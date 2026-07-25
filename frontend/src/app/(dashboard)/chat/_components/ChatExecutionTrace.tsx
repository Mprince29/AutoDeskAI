import React, { useState, useEffect } from "react";
import { 
  Workflow, 
  ChevronRight, 
  Brain, 
  Zap, 
  Bot, 
  Download 
} from "lucide-react";
import { agentService } from "@/services/agent.service";
import { ToolIconMap, ToolDescriptionMap } from "@/utils/toolIcons";

type Step =
  | { kind: "thinking"; label: string; }
  | { kind: "tool"; name: string; label?: string; }
  | { kind: "agent"; name: string; };

export const MessageExecutionSteps: React.FC<{ steps?: Step[]; isStreaming?: boolean }> = ({ steps, isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) setIsExpanded(true);
  }, [isStreaming]);

  if (!steps?.length) return null;

  return (
    <div className="mt-2 mb-6 relative flex flex-col group/steps">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all text-muted/60 hover:text-primary group/trace"
      >
        <div className="relative">
          <Workflow className={`w-3.5 h-3.5 transition-transform duration-500 ${isExpanded ? 'rotate-90 text-primary' : ''}`} />
          {isStreaming && (
            <div className="absolute inset-0 rounded-full border border-primary/40 animate-ping" />
          )}
        </div>
        <span className="text-[9px] font-black uppercase tracking-[0.2em]">
          System Trace ({steps.length} Nodes)
        </span>
        <ChevronRight className={`w-4 h-4 ml-auto transition-transform duration-500 ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-4 pl-3 relative flex flex-col gap-4 animate-fade-in">
          <div className="absolute left-[16px] top-2 bottom-4 w-[1px] bg-gradient-to-b from-primary/40 via-accent/20 to-transparent opacity-30" />

          {steps.map((step, idx) => {
            const isThinking = step.kind === 'thinking';
            const isAgent = step.kind === 'agent';
            const label = isThinking ? step.label : (isAgent ? `Routing to ${step.name}...` : (ToolDescriptionMap[step.name] || step.name));
            const Icon = isThinking ? Brain : (isAgent ? Bot : (ToolIconMap[step.name] || Zap));
            const color = isThinking ? 'var(--amber)' : (isAgent ? 'var(--primary)' : 'var(--accent)');

            return (
              <div key={idx} className="flex items-center gap-3 animate-fade-in relative z-10 transition-all duration-500 hover:translate-x-1">
                <div className="shrink-0 w-2.5 h-2.5 rounded-full flex items-center justify-center relative">
                  <div className="absolute inset-[-4px] rounded-full opacity-30 animate-pulse-soft" />
                  <Icon className="w-4 h-3 relative z-10 drop-shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
                </div>
                <span className="text-[10px] font-medium uppercase opacity-80 truncate" style={{ color: color }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export function ResponseFormatPicker({
  content,
  userEmail,
}: {
  content: string;
  userEmail: string;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  const download = async (fmt: 'pdf' | 'docx' | 'xlsx' | 'txt') => {
    setLoading(fmt);
    try {
      const blob = await agentService.generateDocument(userEmail, content, fmt, 'autodeskai-result');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `autodeskai-result.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed', e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="mt-3 pt-2.5 border-t border-border/20 flex flex-wrap gap-1.5 items-center">
      <Download className="w-3 h-3 text-muted shrink-0" />
      <span className="text-[9px] font-bold text-muted/60 uppercase tracking-widest mr-1">Download as</span>
      {(['pdf', 'docx', 'xlsx', 'txt'] as const).map(fmt => (
        <button
          key={fmt}
          onClick={() => download(fmt)}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-all disabled:opacity-50"
          style={{ background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.25)', color: '#22D3EE' }}
        >
          {loading === fmt ? '...' : `.${fmt}`}
        </button>
      ))}
    </div>
  );
}
