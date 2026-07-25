"use client";
import Link from "next/link";
import { ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { TbTools } from "react-icons/tb";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TOOLS, type Tool } from "@/constants/tools-list";

export default function PlaygroundPage() {
  return (
    <div className="min-h-full bg-background p-4">
      {/* Header section with background glow effect */}
      <div className="relative mb-6">
        <div className="flex items-center gap-3 relative">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm shrink-0">
            <TbTools className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-xl md:text-2xl font-semibold text-foreground tracking-tight">
            Playground
          </h1>
        </div>
      </div>

      {/* Tool grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {TOOLS.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
        <div className="h-full flex items-center justify-center flex-col p-6 rounded-xl border-2 border-dashed border-border/60 bg-surface/40 shadow-sm transition-all duration-300 hover:border-primary/30 hover:bg-primary/5 group/soon">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-4 transition-transform duration-500 group-hover/soon:rotate-[20deg]">
            <Sparkles className="w-6 h-6 text-amber-500" />
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground shadow-sm mb-3">
            Coming Soon
          </div>
          <p className="text-[12px] text-muted-foreground/80 text-center leading-relaxed max-w-[200px]">
            We're building more specialized assistants for your workflow.
          </p>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);
    router.push(tool.href);
  };

  return (
    <a href={tool.href} onClick={handleClick} className="group relative block h-full">
      <div
        className="relative h-full flex flex-col p-6 rounded-xl border border-border bg-surface shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 overflow-hidden"
      >
        {/* Hover background effect */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ background: `radial-gradient(circle at top right, ${tool.color}10, transparent)` }} />

        <div className="flex items-center gap-3 mb-4 relative">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center border transition-transform duration-300 group-hover:scale-105 group-hover:rotate-2 shrink-0"
            style={{
              background: `${tool.color}15`,
              borderColor: `${tool.color}25`
            }}
          >
            <Icon className="w-5.5 h-5.5" style={{ color: tool.color }} />
          </div>
          <h3 className="text-lg font-bold text-foreground tracking-tight group-hover:text-primary transition-colors">
            {tool.label}
          </h3>
        </div>

        <p className="text-[13px] text-muted-foreground leading-relaxed mb-6 flex-1 relative">
          {tool.description}
        </p>

        <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase mt-auto relative" style={{ color: tool.color }}>
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Opening...
            </>
          ) : (
            <>
              Open Tool
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </>
          )}
        </div>
      </div>
    </a>
  );
}
