"use client";

import React from "react";
import { 
  Calendar, 
  Mail, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Zap
} from "lucide-react";
import { motion } from "framer-motion";

export interface BriefingData {
  summary: string;
  stats: {
    emails_analyzed: number;
    important_emails: number;
    events_found: number;
    tasks_created: number;
  };
  important_emails: Array<{
    subject: string;
    sender: string;
    summary: string;
    priority: string;
  }>;
  agenda: Array<{
    time: string;
    event: string;
    type: string;
  }>;
}

export function BriefingCard({ data }: { data: BriefingData }) {
  if (!data) return null;

  return (
    <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border/50 bg-surface/30 backdrop-blur-xl">
      {/* Header with Sparkles */}
      <div className="relative border-b border-border/50 bg-primary/5 p-6">
        <div className="absolute right-6 top-6">
          <motion.div
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5] 
            }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Sparkles className="h-6 w-6 text-primary" />
          </motion.div>
        </div>
        
        <h3 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
          <Zap className="h-5 w-5 text-primary" />
          Today's Overview
        </h3>
        <p className="mt-1 text-sm text-muted-dark/60">
          Here is what's happening today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-px bg-border/30 sm:grid-cols-4">
        <StatItem 
          label="Emails" 
          value={data.stats.emails_analyzed} 
          icon={<Mail className="h-4 w-4 text-blue-500" />} 
        />
        <StatItem 
          label="Important" 
          value={data.stats.important_emails} 
          icon={<AlertCircle className="h-4 w-4 text-orange-500" />} 
        />
        <StatItem 
          label="Meetings" 
          value={data.agenda.length} 
          icon={<Calendar className="h-4 w-4 text-purple-500" />} 
        />
        <StatItem 
          label="To-dos" 
          value={data.stats.tasks_created} 
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />} 
        />
      </div>

      <div className="p-6 space-y-8">
        {/* Summary Section */}
        <section>
          <h4 className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-3">Quick Summary</h4>
          <p className="text-[15px] leading-relaxed text-foreground/90 bg-primary/5 p-4 rounded-2xl border border-primary/10 italic">
            "{data.summary}"
          </p>
        </section>

        {/* Agenda Section */}
        {data.agenda.length > 0 && (
          <section>
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-3">Today's Agenda</h4>
            <div className="space-y-2">
              {data.agenda.map((item, idx) => (
                <div 
                  key={idx} 
                  className="group flex items-center gap-4 rounded-2xl border border-border/50 bg-surface/50 p-3 transition-all hover:bg-surface-hover hover:border-primary/20"
                >
                  <div className="flex p-3 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-[11px] font-bold text-primary">
                    {item.time}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{item.event}</p>
                    <p className="text-[11px] text-muted-dark/50 capitalize">{item.type}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted/20 group-hover:text-primary transition-colors" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Important Emails */}
        {data.important_emails.length > 0 && (
          <section>
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-3">Important Emails</h4>
            <div className="space-y-3">
              {data.important_emails.map((email, idx) => (
                <div 
                  key={idx} 
                  className="rounded-2xl border border-border/50 bg-surface/50 p-4 transition-all hover:border-orange-500/20"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-primary truncate max-w-[200px]">{email.sender}</span>
                    <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-orange-500">
                      {email.priority}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-foreground mb-1">{email.subject}</p>
                  <p className="text-xs text-muted-dark/70 line-clamp-2">{email.summary}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatItem({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="bg-surface/30 p-4 text-center">
      <div className="mb-1 flex justify-center">{icon}</div>
      <div className="text-lg font-black tracking-tight text-foreground">{value}</div>
      <div className="text-[9px] font-black uppercase tracking-widest text-muted/60">{label}</div>
    </div>
  );
}
