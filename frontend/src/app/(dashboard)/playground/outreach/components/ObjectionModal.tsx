"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, X, Loader2, History, MessageSquareQuote } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService, Lead, ObjectionResult } from '@/services/sales.service';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface ObjectionModalProps {
    lead: Lead;
    onClose: () => void;
}

export function ObjectionModal({ lead, onClose }: ObjectionModalProps) {
    const { user } = useAuth();
    const [replyText, setReplyText] = useState('');
    const [subject, setSubject] = useState('');
    const [result, setResult] = useState<ObjectionResult | null>(null);
    const [loading, setLoading] = useState(false);

    const handleAnalyze = async () => {
        if (!user?.email || !replyText.trim()) return;
        setLoading(true);
        try {
            const res = await salesService.handleObjection(lead.id, user.email, {
                reply_text: replyText,
                contact_name: lead.contact_name,
                company: lead.company,
                original_subject: subject || undefined,
            });
            setResult(res);
            toast.success('Reply analyzed');
        } catch (e: any) {
            toast.error(e.message || 'Analysis failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-2xl flex flex-col relative overflow-hidden"
            >
                <div className="p-6 border-b border-border flex items-center justify-between bg-surface/10">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-warning/10 flex items-center justify-center text-warning border border-warning/20 shadow-sm">
                            <Sparkles size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-normal tracking-tight text-foreground">Objection Handler</h2>
                            <p className="text-[11px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">{lead.contact_name} · {lead.company}</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2.5 rounded-2xl hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                    <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar border-b lg:border-b-0 lg:border-r border-border/20">
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Thread Subject</label>
                                <input
                                    type="text"
                                    placeholder="Original subject (optional)"
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-normal"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Prospect's Message</label>
                                <textarea
                                    rows={5}
                                    placeholder="Paste the negative or hesitant prospect reply here..."
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    className="w-full bg-surface border border-border rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none leading-relaxed shadow-inner"
                                />
                            </div>
                        </div>

                        {result && (
                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-6 space-y-6 animate-in zoom-in-95 duration-500 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-12 bg-primary/10 blur-[60px] rounded-full -mr-8 -mt-8 opacity-40" />

                                <div className="relative flex flex-wrap gap-2">
                                    <span className="rounded-lg bg-background border border-border px-3 py-1 text-[10px] font-normal uppercase tracking-widest text-primary shadow-sm">{result.sentiment}</span>
                                    {result.objection_type && (
                                        <span className="rounded-lg bg-background border border-border px-3 py-1 text-[10px] font-normal uppercase tracking-widest text-foreground/60 shadow-sm">{result.objection_type.replace(/_/g, ' ')}</span>
                                    )}
                                </div>

                                <div className="relative space-y-4">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-muted-foreground/60">Intelligence Summary</p>
                                        <p className="text-[14px] font-normal leading-relaxed">{result.summary}</p>
                                    </div>
                                    <div className="space-y-1.5 pt-2">
                                        <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-primary">Recommended Reply</p>
                                        <textarea
                                            rows={6}
                                            value={result.suggested_reply}
                                            onChange={(e) => setResult((prev) => prev ? { ...prev, suggested_reply: e.target.value } : prev)}
                                            className="w-full bg-background border border-border rounded-2xl px-5 py-4 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none leading-relaxed shadow-sm font-normal"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="w-full lg:w-80 bg-surface/30 flex flex-col overflow-hidden">
                        <div className="px-5 py-3 border-b border-border/20 bg-surface/50">
                            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                                <History size={12} className="text-primary" /> Objection History
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {user?.email && <ObjectionHistoryPanel lead={lead} email={user.email} />}
                        </div>
                    </div>
                </div>

                <div className="p-8 border-t border-border bg-surface/30 flex gap-4">
                    <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm font-normal text-muted-foreground hover:bg-background transition-all">
                        Close
                    </button>
                    <button
                        type="button"
                        onClick={handleAnalyze}
                        disabled={loading || !replyText.trim()}
                        className="flex-1 py-4 rounded-2xl bg-primary text-white text-sm font-normal flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20 disabled:opacity-60"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                        Analyze Objection
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

function ObjectionHistoryPanel({ lead, email }: { lead: Lead, email: string }) {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        salesService.getObjectionHistory(lead.id, email)
            .then(setHistory)
            .finally(() => setLoading(false));
    }, [lead.id, email]);

    if (loading) return <div className="p-4 flex justify-center"><Loader2 size={16} className="animate-spin opacity-20" /></div>;

    if (history.length === 0) return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40 text-center px-4">
            <MessageSquareQuote size={24} className="mb-2 opacity-20" />
            <p className="text-[10px] font-bold uppercase tracking-widest">No Objections Logged</p>
            <p className="text-[9px] mt-1">This lead hasn't raised any concerns yet.</p>
        </div>
    );

    return (
        <div className="divide-y divide-border/10">
            {history.map(h => (
                <div key={h.id} className="p-4 space-y-2 hover:bg-surface/30 transition-all">
                    <div className="flex items-center justify-between">
                        <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${h.sentiment === 'objection' ? 'bg-error/10 text-error border-error/20' : 'bg-surface text-muted-foreground border-border/40'}`}>
                            {h.objection_type || h.sentiment}
                        </span>
                        <span className="text-[8px] text-muted-foreground font-mono">{formatDistanceToNow(new Date(h.created_at))} ago</span>
                    </div>
                    <p className="text-[10px] text-foreground font-normal leading-relaxed line-clamp-2 italic">"{h.reply_text}"</p>
                </div>
            ))}
        </div>
    );
}
