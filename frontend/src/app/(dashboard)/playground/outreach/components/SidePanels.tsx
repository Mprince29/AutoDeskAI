"use client";

import React from 'react';
import { ShieldCheck, RotateCcw, Target } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface EscalationPanelProps {
    escalations: any[];
    onResolve: (id: number, action: 'resume' | 'cancel') => Promise<void>;
}

export function EscalationPanel({ escalations, onResolve }: EscalationPanelProps) {
    if (escalations.length === 0) return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40 text-center px-4">
            <ShieldCheck size={24} className="mb-2 opacity-20" />
            <p className="text-[10px] font-bold uppercase tracking-widest">No Active Escalations</p>
            <p className="text-[9px] mt-1">We'll alert you if a high-intent lead needs human intervention.</p>
        </div>
    );

    return (
        <div className="divide-y divide-border/10">
            {escalations.map(ev => (
                <div key={ev.id} className="p-4 space-y-3 hover:bg-surface/30 transition-all">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-error animate-pulse" />
                            <p className="text-[11px] font-bold text-foreground uppercase tracking-tight truncate max-w-[140px]">{ev.contact_name}</p>
                        </div>
                        <span className="text-[9px] font-mono text-muted-foreground">{formatDistanceToNow(new Date(ev.created_at))} ago</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2 bg-error/5 p-2 rounded-lg border border-error/10 italic">
                        "{ev.context_brief}"
                    </p>
                    {!ev.human_took_over && (
                        <div className="flex items-center gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => onResolve(ev.id, 'resume')}
                                className="flex-1 py-1.5 rounded-lg bg-primary text-white text-[9px] font-bold uppercase tracking-widest hover:opacity-90 transition-all"
                            >
                                Resume Sequence
                            </button>
                            <button
                                type="button"
                                onClick={() => onResolve(ev.id, 'cancel')}
                                className="flex-1 py-1.5 rounded-lg border border-border text-muted-foreground text-[9px] font-bold uppercase tracking-widest hover:bg-surface transition-all"
                            >
                                Stop
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

interface ReengagementPanelProps {
    entries: any[];
    onAction: (id: number, action: 'send' | 'cancel') => Promise<void>;
}

export function ReengagementPanel({ entries, onAction }: ReengagementPanelProps) {
    if (entries.length === 0) return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40 text-center px-4">
            <RotateCcw size={24} className="mb-2 opacity-20" />
            <p className="text-[10px] font-bold uppercase tracking-widest">No Re-engagement Tasks</p>
            <p className="text-[9px] mt-1">Pending follow-ups for cold leads will appear here.</p>
        </div>
    );

    return (
        <div className="divide-y divide-border/10">
            {entries.map(e => (
                <div key={e.id} className="p-4 space-y-3 hover:bg-surface/30 transition-all">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${e.status === 'pending' ? 'bg-warning' : 'bg-success'}`} />
                            <p className="text-[11px] font-bold text-foreground uppercase tracking-tight truncate max-w-[140px]">{e.contact_name}</p>
                        </div>
                        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">{e.status}</span>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                            <Target size={10} /> Hook: {e.hook_theme?.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[10px] text-foreground font-medium truncate">{e.draft_subject || 'Re-engagement Draft'}</p>
                    </div>
                    {e.status === 'pending' && (
                        <div className="flex items-center gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => onAction(e.id, 'send')}
                                className="flex-1 py-1.5 rounded-lg bg-foreground text-background text-[9px] font-bold uppercase tracking-widest hover:opacity-90 transition-all"
                            >
                                Send Now
                            </button>
                            <button
                                type="button"
                                onClick={() => onAction(e.id, 'cancel')}
                                className="flex-1 py-1.5 rounded-lg border border-border text-muted-foreground text-[9px] font-bold uppercase tracking-widest hover:bg-surface transition-all"
                            >
                                Ignore
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
