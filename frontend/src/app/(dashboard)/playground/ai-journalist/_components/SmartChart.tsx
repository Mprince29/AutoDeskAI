"use client";

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';
import { TrendingUp, BarChart3 } from 'lucide-react';

interface DataInsight {
  label: string;
  value: number;
  context?: string;
}

interface SmartChartProps {
  data: DataInsight[];
  title: string;
}

export function SmartChart({ data, title }: SmartChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!data || data.length === 0) return null;

  // Determine chart type based on labels (e.g., if labels are years/dates, use Line)
  const isTimeBased = data.some(d => /\d{4}/.test(d.label));
  const chartType = isTimeBased ? 'line' : 'bar';

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-black/80 backdrop-blur-md border border-white/10 p-3 rounded-xl shadow-2xl">
          <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">{payload[0].payload.label}</p>
          <p className="text-[14px] font-black text-primary">{payload[0].value}</p>
          {payload[0].payload.context && (
            <p className="text-[9px] text-white/40 mt-1 max-w-[150px] leading-tight italic">
              {payload[0].payload.context}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="my-10 p-6 rounded-[32px] bg-surface/30 border border-border/40 backdrop-blur-2xl no-print relative overflow-hidden group">
      {/* Decorative gradient */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/10 blur-[80px] rounded-full pointer-events-none" />
      
      <div className="flex items-center justify-between mb-8 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            {chartType === 'bar' ? <BarChart3 size={20} /> : <TrendingUp size={20} />}
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-foreground">Market Pulse Intelligence</h3>
            <p className="text-[9px] text-muted font-black uppercase tracking-[0.2em] opacity-60">{title}</p>
          </div>
        </div>
        <div className="flex gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/20" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
        </div>
      </div>

      <div className="h-[280px] w-full relative z-10">
        {mounted && <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis 
                dataKey="label" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 9, fontWeight: 700, fill: 'var(--muted)' }} 
                interval={0}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 9, fontWeight: 700, fill: 'var(--muted)' }} 
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar
                dataKey="value"
                radius={[6, 6, 0, 0]}
                animationDuration={2000}
                barSize={32}
                fill="var(--primary)"
              />
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="label" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 9, fontWeight: 700, fill: 'var(--muted)' }} 
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 9, fontWeight: 700, fill: 'var(--muted)' }} 
              />
              <Tooltip content={<CustomTooltip />} />
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke="var(--primary)" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorValue)" 
                animationDuration={2500}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>}
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-4">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">AI Extracted Grounding</span>
          </div>
          <span className="text-[10px] font-mono text-muted/40 italic">AutoDeskAI Intelligence Engine v1.0</span>
      </div>
    </div>
  );
}
