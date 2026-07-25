"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Sparkles, X, Loader2, Target, AlertTriangle, Clock, CheckCircle2,
    PenTool, AlertCircle, Newspaper, Briefcase, CircleDollarSign,
    MessageCircle, Github, MousePointer2, Mail, TrendingUp, Activity, ExternalLink
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService, Lead, Signal, NextAction } from '@/services/sales.service';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface NextActionPanelProps {
    lead: Lead;
    onClose: () => void;
}

const URGENCY_STYLE: Record<string, string> = {
    high: 'bg-error/5 border-error/20 text-error-dark',
    medium: 'bg-warning/5 border-warning/20 text-warning-dark',
    low: 'bg-success/5 border-success/20 text-success-dark',
};

export function NextActionPanel({ lead, onClose }: NextActionPanelProps) {
    const { user } = useAuth();
    const [result, setResult] = useState<{ intent_score: number; recommendation: NextAction } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.email) return;
        salesService.getNextAction(lead.id, user.email)
            .then(r => setResult(r))
            .catch(() => toast.error('Failed to get recommendation'))
            .finally(() => setLoading(false));
    }, [lead.id, user?.email]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-xl flex flex-col relative overflow-hidden"
            >
                <div className="p-6 border-b border-border flex items-center justify-between bg-surface/30">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h2 className="text-base font-normal text-foreground uppercase tracking-tight">AI Strategy</h2>
                            <p className="text-[10px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">Recommended Next Action</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex items-center gap-3 px-1">
                        <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-foreground font-normal text-[10px]">
                            {lead.contact_name?.charAt(0)}
                        </div>
                        <div>
                            <p className="text-[13px] font-normal text-foreground">{lead.contact_name}</p>
                            <p className="text-[10px] text-muted-foreground font-normal uppercase tracking-widest">{lead.company}</p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm">
                                <Loader2 size={24} className="animate-spin" />
                            </div>
                            <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest animate-pulse">Analyzing Engagement...</p>
                        </div>
                    ) : result ? (
                        <div className="space-y-6">
                            <div className={`p-6 rounded-[24px] border ${URGENCY_STYLE[result.recommendation.urgency] || 'border-border bg-surface'} shadow-sm`}>
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-[10px] font-normal uppercase tracking-widest flex items-center gap-1.5 opacity-60">
                                        <Target size={12} /> Strategic Move
                                    </span>
                                    <span className={`text-[9px] font-normal uppercase px-2 py-1 rounded-lg border ${URGENCY_STYLE[result.recommendation.urgency] || 'border-border bg-surface'} flex items-center gap-1.5 shadow-sm`}>
                                        {result.recommendation.urgency === 'high' ? <AlertTriangle size={10} /> : result.recommendation.urgency === 'medium' ? <Clock size={10} /> : <CheckCircle2 size={10} />}
                                        {result.recommendation.urgency} priority
                                    </span>
                                </div>
                                <p className="text-lg font-normal leading-tight text-foreground">{result.recommendation.action}</p>
                            </div>

                            <div className="p-6 rounded-[24px] bg-surface/50 border border-border shadow-sm">
                                <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest mb-2">Rationale</p>
                                <p className="text-[13px] text-foreground font-normal leading-relaxed">{result.recommendation.reason}</p>
                            </div>

                            {result.recommendation.suggested_subject && (
                                <div className="p-6 rounded-[24px] bg-surface/50 border border-border shadow-sm">
                                    <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                        <PenTool size={11} className="text-primary" /> Suggested Hook
                                    </p>
                                    <p className="text-[13px] text-foreground font-normal italic">"{result.recommendation.suggested_subject}"</p>
                                </div>
                            )}

                            <div className="space-y-2">
                                <div className="flex items-center justify-between px-1">
                                    <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest">Interest Momentum</p>
                                    <span className="text-[11px] font-normal text-primary uppercase tracking-widest">{result.intent_score}/100</span>
                                </div>
                                <div className="h-2 rounded-full bg-surface border border-border overflow-hidden p-0.5">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${result.intent_score}%` }}
                                        className="h-full rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.3)]"
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="py-12 text-center space-y-4">
                            <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground/30" />
                            <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest">Could not generate recommendation</p>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-border bg-surface/30 flex justify-end">
                    <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-lg bg-foreground text-background text-[11px] font-normal uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-foreground/10">Execute Plan</button>
                </div>
            </motion.div>
        </div>
    );
}

interface SignalHistoryPanelProps {
    lead: Lead;
    onClose: () => void;
}

export function SignalHistoryPanel({ lead, onClose }: SignalHistoryPanelProps) {
    const { user } = useAuth();
    const [signals, setSignals] = useState<Signal[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.email) return;
        salesService.getSignals(lead.id, user.email)
            .then(setSignals)
            .catch(() => toast.error('Failed to load signal history'))
            .finally(() => setLoading(false));
    }, [lead.id, user?.email]);

    const getSignalIcon = (type: string) => {
        switch (type) {
            case 'news_mention': return <Newspaper size={14} />;
            case 'hiring_signal': return <Briefcase size={14} />;
            case 'funding_round': return <CircleDollarSign size={14} />;
            case 'reddit_mention': return <MessageCircle size={14} />;
            case 'github_signal': return <Github size={14} />;
            case 'email_click': return <MousePointer2 size={14} />;
            case 'email_reply': return <Mail size={14} />;
            default: return <TrendingUp size={14} />;
        }
    };

    const getSignalBg = (type: string) => {
        const colors: Record<string, string> = {
            news_mention: 'bg-warning/10 border-warning/20',
            hiring_signal: 'bg-primary/10 border-primary/20',
            funding_round: 'bg-primary/10 border-primary/20',
            reddit_mention: 'bg-error/10 border-error/20',
            github_signal: 'bg-primary/10 border-primary/20',
            email_click: 'bg-primary/10 border-primary/20',
            email_reply: 'bg-primary/10 border-primary/20',
        };
        return colors[type] || 'bg-surface border-border';
    };

    const SIGNAL_COLOR: Record<string, string> = {
        email_open: 'text-success',
        email_click: 'text-primary',
        email_reply: 'text-primary',
        news_mention: 'text-warning',
        hiring_signal: 'text-primary',
        funding_round: 'text-primary',
        reddit_mention: 'text-error',
        github_signal: 'text-primary',
    };

    const SIGNAL_LABEL: Record<string, string> = {
        email_open: 'open',
        email_click: 'click',
        email_reply: 'reply',
        news_mention: 'news',
        hiring_signal: 'hiring',
        funding_round: 'funding',
        reddit_mention: 'reddit',
        github_signal: 'github',
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-lg flex flex-col sm:max-h-[85vh] overflow-hidden"
            >
                {/* Header */}
                <div className="p-6 pb-4 border-b border-border flex items-center justify-between bg-surface/30 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm">
                            <Activity size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-normal uppercase tracking-tight text-foreground">Activity Timeline</h2>
                            <p className="text-[10px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">{lead.contact_name} / {lead.company}</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-4 custom-scrollbar">
                    {loading ? (
                        [...Array(5)].map((_, i) => (
                            <div key={i} className="h-20 rounded-2xl bg-surface dark:bg-background/5 animate-pulse" />
                        ))
                    ) : signals.length === 0 ? (
                        <div className="py-20 text-center flex flex-col items-center">
                            <div className="w-16 h-16 rounded-full bg-surface dark:bg-background/5 flex items-center justify-center mb-4 border border-zinc-200 dark:border-border/50">
                                <TrendingUp className="w-8 h-8 text-muted-foreground/20" />
                            </div>
                            <p className="text-[11px] font-normal uppercase tracking-[0.2em] text-muted-foreground">No Activity Yet</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1 max-w-[200px]">Nothing to show for this person yet.</p>
                        </div>
                    ) : signals.filter(sig => sig.type !== 'email_open').map(sig => (
                        <motion.div
                            key={sig.id}
                            className={`group relative p-4 rounded-2xl border transition-all duration-300 ${getSignalBg(sig.type)}`}
                        >
                            <div className="flex items-start gap-4">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-transform  duration-300 ${SIGNAL_COLOR[sig.type] ?? 'text-muted-foreground'} bg-background `}>
                                    {getSignalIcon(sig.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-4 mb-1">
                                        <p className="text-[13px] font-normal leading-tight text-foreground line-clamp-2">
                                            {sig.metadata?.title || sig.type.replace(/_/g, ' ')}
                                        </p>
                                        <span className={`text-[9px] font-normal uppercase px-2 py-1 rounded-md border tracking-tighter shrink-0 ${SIGNAL_COLOR[sig.type] ?? 'text-muted-foreground'} bg-background/50`}>
                                            {SIGNAL_LABEL[sig.type] ?? sig.type.split('_')[0]}
                                        </span>
                                    </div>

                                    {sig.metadata?.url && (
                                        <a
                                            href={sig.metadata.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors mt-1 mb-2 group/link"
                                        >
                                            <span className="truncate max-w-[240px]">{new URL(sig.metadata.url).hostname}</span>
                                            <ExternalLink size={10} className="opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                        </a>
                                    )}

                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5 text-[10px] font-normal text-muted-foreground/60">
                                            <Clock size={10} />
                                            {formatDistanceToNow(new Date(sig.created_at))} ago
                                        </div>
                                        {sig.metadata?.source && (
                                            <span className="text-[10px] font-normal uppercase tracking-widest text-muted-foreground/40">{sig.metadata.source}</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Accent highlight */}
                            <div className={`absolute top-4 bottom-4 left-0 w-1 rounded-r-full opacity-40 ${SIGNAL_COLOR[sig.type] ?? 'bg-muted-foreground'} bg-current`} />
                        </motion.div>
                    ))}
                </div>

                {/* Footer / Summary */}
                <div className="p-4 border-t border-border/30 bg-surface/50 dark:bg-background/[0.01] flex items-center justify-between px-6 shrink-0">
                    <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-muted-foreground/40">
                        {signals.length} activities recorded
                    </p>
                    <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shadow-[0_0_8px_rgba(var(--success),0.4)]" />
                        <span className="text-[10px] font-normal uppercase tracking-widest text-success/70">Monitoring Active</span>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
