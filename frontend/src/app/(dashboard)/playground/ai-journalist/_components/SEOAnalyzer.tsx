"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Search, Clock, BookOpen, Activity, AlertCircle, CheckCircle2, TrendingUp, Info } from 'lucide-react';

interface SEOAnalyzerProps {
  content: string;
  topic: string;
  audit?: any;
}

export function SEOAnalyzer({ content, topic, audit }: SEOAnalyzerProps) {
  // Calculations
  const words = content.trim().split(/\s+/).length;
  const readingTime = Math.ceil(words / 200);
  
  // Simple Flesch-Kincaid mock
  const readingLevel = words > 1000 ? "Academic" : words > 500 ? "Professional" : "General";

  // SEO Score logic
  const hasHeaders = /#+\s/.test(content);
  const hasImages = /!\[.*\]\(.*\)/.test(content) || content.includes('<img');
  const hasLinks = /\[.*\]\(.*\)/.test(content);
  const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const keywordDensity = topicWords.filter(w => content.toLowerCase().includes(w)).length / Math.max(topicWords.length, 1);
  
  let score = 30;
  if (hasHeaders) score += 20;
  if (hasImages) score += 15;
  if (hasLinks) score += 10;
  if (words > 600) score += 15;
  if (keywordDensity > 0.5) score += 10;
  score = Math.min(score, 100);

  const getScoreColor = (s: number) => {
    if (s > 80) return "text-success";
    if (s > 50) return "text-warning";
    return "text-destructive";
  };

  return (
    <div className="flex flex-col h-full bg-surface/30 backdrop-blur-xl border-l border-border/40 p-5 overflow-y-auto custom-scrollbar">
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.2em] text-primary">Intelligence Audit</h3>
        <div className={`text-2xl font-black ${getScoreColor(score)}`}>
          {score}<span className="text-[10px] opacity-40 ml-1 font-bold">/100</span>
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="bg-background/40 border border-border/30 p-3 rounded-2xl">
          <div className="flex items-center gap-2 mb-1 opacity-60">
            <Clock size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wider">Read Time</span>
          </div>
          <div className="text-[14px] font-bold">{readingTime} min</div>
        </div>
        <div className="bg-background/40 border border-border/30 p-3 rounded-2xl">
          <div className="flex items-center gap-2 mb-1 opacity-60">
            <BookOpen size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wider">Words</span>
          </div>
          <div className="text-[14px] font-bold">{words}</div>
        </div>
      </div>

      {/* SEO Checklist */}
      <div className="space-y-4 mb-8">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted mb-4">SEO Checklist</h4>
        <CheckItem label="Header Hierarchy" complete={hasHeaders} value="Optimized" />
        <CheckItem label="Visual Assets" complete={hasImages} value={hasImages ? "Present" : "Missing"} />
        <CheckItem label="Backlink Profile" complete={hasLinks} value={hasLinks ? "Linked" : "Internal Only"} />
        <CheckItem label="Semantic Density" complete={keywordDensity > 0.4} value={`${Math.round(keywordDensity * 100)}%`} />
      </div>

      {/* Readability */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-primary">Readability Profile</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-[12px] font-medium text-muted">Audience Tier</span>
          <span className="text-[12px] font-bold text-foreground">{readingLevel}</span>
        </div>
        <div className="h-1.5 w-full bg-primary/10 rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-1000" 
            style={{ width: readingLevel === "Academic" ? "90%" : readingLevel === "Professional" ? "65%" : "35%" }} 
          />
        </div>
      </div>

      {/* Sentiment Analysis if Audit exists */}
      {audit && (
        <div className="space-y-4">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-muted">Sentiment & Tone</h4>
          <div className="p-4 bg-surface/50 border border-border/20 rounded-2xl">
             <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-bold capitalize text-primary">{audit.sentiment_tone || "Neutral"}</span>
                <TrendingUp size={14} className="text-primary opacity-40" />
             </div>
             <p className="text-[11px] text-muted leading-relaxed italic">
               "{audit.critique?.slice(0, 100)}..."
             </p>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {audit?.suggestions?.length > 0 && (
        <div className="mt-8 pt-6 border-t border-border/20">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-muted mb-4">Recommendations</h4>
          <div className="space-y-2">
            {audit.suggestions.slice(0, 3).map((s: string, i: number) => (
              <div key={i} className="flex gap-2 p-2 rounded-lg hover:bg-surface/50 transition-colors group">
                <AlertCircle size={12} className="text-warning shrink-0 mt-0.5" />
                <span className="text-[11px] text-muted-dark group-hover:text-foreground transition-colors leading-snug">{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckItem({ label, complete, value }: { label: string, complete: boolean, value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {complete ? <CheckCircle2 size={12} className="text-success" /> : <div className="w-3 h-3 rounded-full border border-muted/30" />}
        <span className="text-[11px] font-medium text-muted">{label}</span>
      </div>
      <span className={`text-[10px] font-bold ${complete ? 'text-foreground' : 'text-muted/40'}`}>{value}</span>
    </div>
  );
}
