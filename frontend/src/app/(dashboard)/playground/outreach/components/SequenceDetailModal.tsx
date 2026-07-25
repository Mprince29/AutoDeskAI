"use client";

import React, { useState, useEffect } from 'react';
import {
    Layers, Users, Loader2, Clock, Zap, Trash2, X, Eye, MessageSquare
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService, Sequence, SequenceEnrollment } from '@/services/sales.service';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface SequenceDetailModalProps {
    sequence: Sequence;
    onClose: () => void;
    onUpdated: () => void;
}

export function SequenceDetailModal({
    sequence,
    onClose,
    onUpdated,
}: SequenceDetailModalProps) {
    const { user } = useAuth();
    const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(false);
    const [now, setNow] = useState(Date.now());

    // local timer ticking every 60 seconds
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    const fetchEnrollments = () => {
        if (!user?.email) return;
        salesService.getSequenceEnrollments(sequence.id, user.email)
            .then(setEnrollments)
            .catch(() => { })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if (!user?.email) return;
        fetchEnrollments();

        // 30 minute interval to refresh
        const intervalId = setInterval(fetchEnrollments, 30 * 60 * 1000);

        // Window focus listener to refresh
        const handleFocus = () => {
            fetchEnrollments();
        };
        window.addEventListener('focus', handleFocus);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
        };
    }, [sequence.id, user?.email]);

    const getCountdownText = (nextSendAtStr: string | null) => {
        if (!nextSendAtStr) return '-';
        const nextSendAt = new Date(nextSendAtStr).getTime();
        const diffMs = nextSendAt - now;
        if (diffMs <= 0) return 'Sending...';
        const diffHours = diffMs / (1000 * 60 * 60);
        return `In ${diffHours.toFixed(1)}h`;
    };

    const renderStatusBadge = (e: SequenceEnrollment) => {
        if (e.status === 'stopped' || e.replied) {
            return (
                <span className="text-[9px] font-normal uppercase px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]">
                    Replied - stopped
                </span>
            );
        }
        if (e.status === 'completed') {
            return (
                <span className="text-[9px] font-normal uppercase px-2 py-0.5 rounded border bg-blue-500/10 text-blue-500 border-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.1)]">
                    Sequence done
                </span>
            );
        }
        if (e.status === 'unsubscribed') {
            return (
                <span className="text-[9px] font-normal uppercase px-2 py-0.5 rounded border bg-red-500/10 text-red-500 border-red-500/20">
                    Unsubscribed
                </span>
            );
        }
        if (e.status === 'active') {
            const countdown = getCountdownText(e.next_send_at);
            return (
                <span className="text-[9px] font-normal uppercase px-2 py-0.5 rounded border bg-success/5 text-success border-success/20">
                    {countdown}
                </span>
            );
        }
        return (
            <span className="text-[9px] font-normal uppercase px-2 py-0.5 rounded border bg-surface text-muted-foreground border-border/40">
                {e.status}
            </span>
        );
    };

    const handleToggleStatus = async () => {
        if (!user?.email) return;
        setToggling(true);
        try {
            if (sequence.status === 'active') {
                await salesService.pauseSequence(sequence.id, user.email);
                toast.success('Sequence paused');
            } else {
                await salesService.resumeSequence(sequence.id, user.email);
                toast.success('Sequence resumed');
            }
            onUpdated();
        } catch {
            toast.error('Failed to update status');
        } finally {
            setToggling(false);
        }
    };

    const handleDelete = async () => {
        if (!user?.email || !confirm('Permanently delete this sequence?')) return;
        try {
            await salesService.deleteSequence(sequence.id, user.email);
            toast.success('Sequence deleted');
            onUpdated();
            onClose();
        } catch {
            toast.error('Deletion failed');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <div className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-4xl flex flex-col sm:max-h-[85vh] overflow-hidden">
                <div className="relative p-6 border-b border-border/20 shrink-0 overflow-hidden bg-surface/10">
                    <div className="relative flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-normal bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-[0.2em]">Sequence Details</span>
                                <span className={`text-[10px] font-normal px-2 py-0.5 rounded uppercase tracking-[0.2em] ${sequence.status === 'active' ? 'bg-success/10 text-success' : 'bg-surface text-muted-foreground'}`}>{sequence.status}</span>
                            </div>
                            <h2 className="text-xl font-normal tracking-tight text-foreground">{sequence.name}</h2>
                            <p className="text-[12px] text-muted-foreground mt-1.5 flex items-center gap-4">
                                <span className="flex items-center gap-1.5"><Layers size={12} className="text-primary" /> {sequence.steps.length} Steps</span>
                                <span className="flex items-center gap-1.5"><Users size={12} className="text-primary" /> {enrollments.length} Total Enrolled</span>
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleToggleStatus}
                                disabled={toggling}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-normal uppercase tracking-widest border transition-all ${sequence.status === 'active' ? 'bg-surface border-border text-muted-foreground hover:text-foreground' : 'bg-primary text-white border-primary shadow-lg shadow-primary/20'}`}
                            >
                                {toggling ? <Loader2 size={12} className="animate-spin" /> : sequence.status === 'active' ? <Clock size={12} /> : <Zap size={12} />}
                                {sequence.status === 'active' ? 'Pause Series' : 'Resume Series'}
                            </button>
                            <button type="button" onClick={handleDelete} className="p-2 rounded-lg bg-surface hover:bg-error/10 border border-border/20 transition-all text-muted-foreground hover:text-error">
                                <Trash2 size={18} />
                            </button>
                            <button type="button" onClick={onClose} className="p-2 rounded-lg bg-surface hover:bg-surface/80 border border-border/20 transition-all text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center gap-4">
                            <Loader2 size={32} className="animate-spin text-primary opacity-50" />
                            <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest">Loading enrollments...</p>
                        </div>
                    ) : enrollments.length === 0 ? (
                        <div className="py-20 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 bg-surface rounded-full flex items-center justify-center border border-border/20">
                                <Users className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                            <p className="text-sm font-normal text-foreground">No enrollments yet</p>
                            <p className="text-[11px] text-muted-foreground mt-1">People added to this series will appear here.</p>
                        </div>
                    ) : (
                        <table className="w-full text-[12px] border-collapse">
                            <thead className="sticky top-0 bg-background/95 backdrop-blur-xl border-b border-border/20 z-20">
                                <tr>
                                    {['Recipient', 'Status', 'Step', 'Engagement', 'Timeline'].map((h, i) => (
                                        <th key={h} className={`text-left px-6 py-4 text-[10px] font-normal text-muted-foreground uppercase tracking-[0.2em] ${i >= 3 ? 'text-center' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {enrollments.map(e => (
                                    <tr key={e.id} className="hover:bg-surface/30 transition-all group/row">
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-normal text-foreground group-hover/row:text-primary transition-colors">{e.recipient_name || 'Anonymous'}</p>
                                                <p className="text-muted-foreground/60 text-[11px] font-mono">{e.recipient_email}</p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {renderStatusBadge(e)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-[11px] font-normal">Step {e.current_step} / {sequence.steps.length}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-center gap-4">
                                                <div className="flex items-center gap-1.5" title="Opened">
                                                    <Eye size={12} className={e.opened ? 'text-emerald-500' : 'text-muted-foreground/30'} />
                                                    <span className={e.opened ? 'text-emerald-500' : 'text-muted-foreground/30'}>{e.opened ? 'Yes' : 'No'}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5" title="Replied">
                                                    <MessageSquare size={12} className={e.replied ? 'text-primary' : 'text-muted-foreground/30'} />
                                                    <span className={e.replied ? 'text-primary' : 'text-muted-foreground/30'}>{e.replied ? 'Yes' : 'No'}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {e.next_send_at ? (
                                                <div className="text-center">
                                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Next step</p>
                                                    <p className="text-[11px] font-normal">{formatDistanceToNow(new Date(e.next_send_at))} from now</p>
                                                </div>
                                            ) : (
                                                <p className="text-[10px] text-muted-foreground/40 text-center uppercase tracking-widest">Ended</p>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
