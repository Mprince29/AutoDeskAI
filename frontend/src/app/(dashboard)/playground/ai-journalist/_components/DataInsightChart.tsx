"use client";

import React from 'react';
import { BarChart3, Info } from 'lucide-react';

interface DataInsight {
  label: string;
  value: number;
  context?: string;
}

interface DataInsightChartProps {
  data: DataInsight[];
}

function formatValue(value: number, label: string, context?: string): string {
  const l = label.toLowerCase();
  const ctx = context?.toLowerCase() ?? '';
  
  if (ctx.includes('billion') || ctx.includes('usd') || ctx.includes('USD')) {
    return `$${value % 1 === 0 ? value : value.toFixed(2)}B`;
  }
  
  if (
    ctx.includes('percentage') || ctx.includes('%') || 
    l.includes('penetration') || l.includes('rate') || 
    l.includes('percentage') || l.includes('growth') || 
    l.includes('share') || l.includes('vulnerability')
  ) {
    return `${value % 1 === 0 ? value : value.toFixed(2)}%`;
  }
  
  return value % 1 === 0 ? `${value}` : value.toFixed(2);
}

export default function DataInsightChart({ data }: DataInsightChartProps) {
  if (!data || data.length === 0) return null;

  const maxValue = Math.max(...data.map(d => d.value), 100);

  return (
    <div className="my-8 p-6 rounded-2xl bg-surface/40 border border-border/40 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-700 no-print">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/5">
          <BarChart3 size={20} className="text-primary" />
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-foreground">Data Intelligence</h3>
          <p className="text-[10px] text-muted uppercase tracking-[0.2em] font-bold opacity-70">Extracted Statistical Insights</p>
        </div>
      </div>

      <div className="space-y-8">
        {data.map((item, idx) => (
          <div key={idx} className="group relative">
            <div className="flex justify-between items-start mb-3">
              <div className="flex flex-col gap-1 pr-4 min-w-0">
                <span className="text-[13px] font-bold text-foreground/90 group-hover:text-primary transition-colors truncate">
                  {item.label}
                </span>
                {item.context && (
                  <div className="flex items-start gap-1.5">
                    <Info size={10} className="text-primary mt-0.5 shrink-0 opacity-70" />
                    <p className="text-[10px] text-muted leading-relaxed font-medium line-clamp-2">
                      {item.context}
                    </p>
                  </div>
                )}
              </div>
              <span className="text-[15px] font-black text-primary tabular-nums shrink-0">
                {formatValue(item.value, item.label, item.context)}
              </span>
            </div>
            
            <div className="h-1.5 w-full bg-background/50 rounded-full overflow-hidden border border-border/30">
              <div
                className="h-full bg-gradient-to-r from-primary via-primary/80 to-primary/60 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(83,74,183,0.2)]"
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 pt-5 border-t border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1 h-1 rounded-full bg-success"></div>
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider opacity-60">Verified Research Grounding</span>
        </div>
        <div className="flex gap-1.5 opacity-40">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse delay-150"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse delay-300"></div>
        </div>
      </div>
    </div>
  );
}
