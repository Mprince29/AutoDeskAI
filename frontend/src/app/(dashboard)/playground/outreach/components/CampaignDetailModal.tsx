"use client";

import React, { useState, useEffect } from 'react';
import {
    Mail, RefreshCcw, X, Hash, Upload, Send, Eye,
    MousePointer2, TrendingUp, Sparkles, Loader2, Users
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService, Campaign, CampaignRecipient, SequenceEnrollment } from '@/services/sales.service';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { LeadTimezoneCell } from './LeadTimezoneCell';

interface CampaignDetailModalProps {
    campaign: Campaign;
    onClose: () => void;
    onSelectTag: (tag: string) => void;
}

export function CampaignDetailModal({ campaign, onClose, onSelectTag }: CampaignDetailModalProps) {
    const { user } = useAuth();
    const [campaignState, setCampaignState] = useState<Campaign>(campaign);
    const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
    const [loading, setLoading] = useState(true);
    const [enrollmentsMap, setEnrollmentsMap] = useState<Map<string, SequenceEnrollment>>(new Map());
    const [now, setNow] = useState<number>(Date.now());

    const fetchEnrollments = async () => {
        if (!user?.email) return;
        try {
            const seqs = await salesService.getSequences(user.email);
            const allEnrollments = await Promise.all(
                seqs.map(seq => salesService.getSequenceEnrollments(seq.id, user.email).catch(() => []))
            );
            const map = new Map<string, SequenceEnrollment>();
            allEnrollments.flat().forEach(e => {
                if (e.recipient_email) {
                    map.set(e.recipient_email.toLowerCase(), e);
                }
            });
            setEnrollmentsMap(map);
        } catch (err) {
            console.error('Failed to load sequence enrollments', err);
        }
    };

    const fetchCampaignData = async () => {
        if (!user?.email) return;
        try {
            const [updatedCampaign, updatedRecipients] = await Promise.all([
                salesService.getCampaign(campaign.id, user.email),
                salesService.getCampaignRecipients(campaign.id, user.email)
            ]);
            setCampaignState(updatedCampaign);
            setRecipients(updatedRecipients);
        } catch {
            // silent error
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!user?.email) return;

        fetchCampaignData();
        fetchEnrollments();

        const intervalId = setInterval(() => {
            fetchCampaignData();
            fetchEnrollments();
        }, 3000);

        const nowInterval = setInterval(() => {
            setNow(Date.now());
        }, 10000);

        const handleFocus = () => {
            fetchCampaignData();
            fetchEnrollments();
            setNow(Date.now());
        };
        window.addEventListener('focus', handleFocus);

        // Refresh once when the window becomes visible again
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchCampaignData();
                fetchEnrollments();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(intervalId);
            clearInterval(nowInterval);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [campaign.id, user?.email]);

    const handleManualRefresh = () => {
        if (!user?.email) return;
        setLoading(true);
        Promise.all([
            salesService.getCampaign(campaign.id, user.email),
            salesService.getCampaignRecipients(campaign.id, user.email),
            fetchEnrollments()
        ]).then(([c, r]) => {
            setCampaignState(c);
            setRecipients(r);
        }).finally(() => setLoading(false));
    };

    const STATUS_COLOR: Record<string, string> = {
        sent: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]',
        failed: 'text-red-500 bg-red-500/10 border-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.1)]',
        pending: 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.1)]',
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <div
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-4xl flex flex-col sm:max-h-[85vh] overflow-hidden"
            >
                {/* Premium Header */}
                <div className="relative p-6 border-b border-border/20 shrink-0 overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 bg-primary/5 blur-[80px] rounded-full -mr-10 -mt-10" />
                    <div className="relative flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-normal bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-[0.2em]">Email Details</span>
                            </div>
                            <h2 className="text-xl font-normal tracking-tight text-foreground">{campaignState.name}</h2>
                            <p className="text-[12px] text-muted-foreground mt-1.5 flex items-center gap-2">
                                <Mail size={12} className="text-primary" />
                                <span className="font-mono bg-surface px-2 py-0.5 rounded border border-border/20 text-foreground/80">{campaignState.subject_template}</span>
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleManualRefresh}
                                className="p-2 rounded-lg bg-surface hover:bg-surface/80 border border-border/20 transition-all text-muted-foreground hover:text-foreground"
                                title="Refresh data"
                            >
                                <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button type="button" onClick={onClose} className="p-2 rounded-lg bg-surface hover:bg-surface/80 border border-border/20 transition-all text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-3 border-b border-border/20 bg-surface/10 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        {campaignState.outreach_tag ? (
                            <>
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-normal uppercase tracking-widest">
                                    <Hash size={10} /> {campaignState.outreach_tag}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { onSelectTag(campaignState.outreach_tag!); onClose(); }}
                                    className="text-[10px] text-muted-foreground hover:text-primary transition-colors underline underline-offset-2 uppercase tracking-widest"
                                >
                                    Filter by this tag
                                </button>
                            </>
                        ) : (
                            <span className="text-[10px] text-muted-foreground/40 uppercase tracking-widest">No tag assigned</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 px-4 py-1.5 bg-foreground text-background rounded-lg text-[10px] font-normal uppercase tracking-widest hover:opacity-90 transition-all cursor-pointer shadow-sm">
                            <Upload size={12} />
                            Upload CSV
                            <input
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file || !user?.email) return;
                                    try {
                                        toast.info('Uploading recipients...');
                                        const res = await salesService.uploadRecipients(campaignState.id, user.email, file);
                                        toast.success(res.message);
                                        handleManualRefresh();
                                    } catch (err: any) {
                                        toast.error(err.message || 'Upload failed');
                                    }
                                }}
                            />
                        </label>
                    </div>
                </div>

                {/* Modern Stats Grid */}
                <div className="grid grid-cols-4 gap-4 p-6 bg-surface/30 border-b border-border/20 shrink-0">
                    {[
                        { label: 'Sent', value: campaignState.sent_count, icon: Send, color: 'text-foreground', bg: 'bg-surface' },
                        { label: 'Unique Opens', value: campaignState.unique_open_count ?? campaignState.open_count, icon: Eye, color: 'text-emerald-500', bg: 'bg-emerald-500/5' },
                        { label: 'Clicks', value: campaignState.click_count, icon: MousePointer2, color: 'text-blue-500', bg: 'bg-blue-500/5' },
                        { label: 'Open Rate', value: `${campaignState.open_rate}%`, icon: TrendingUp, color: 'text-primary', bg: 'bg-primary/5' },
                    ].map(({ label, value, icon: Icon, color, bg }) => (
                        <div key={label} className={`flex flex-col items-center justify-center p-4 ${bg} rounded-2xl border border-border/20 gap-1 group/stat transition-all`}>
                            <Icon size={16} className={`${color} mb-1  transition-transform`} />
                            <p className="text-2xl font-normal leading-tight tracking-tight text-foreground">{value}</p>
                            <p className="text-[9px] font-normal text-muted-foreground uppercase tracking-[0.2em]">{label}</p>
                        </div>
                    ))}
                </div>

                {/* Recent openers highlight */}
                {!loading && recipients.some(r => r.open_count > 0) && (
                    <div className="px-6 py-3 border-b border-border/20 shrink-0 bg-emerald-500/5">
                        <p className="text-[10px] font-normal uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-1.5">
                            <Sparkles size={11} className="animate-pulse" /> RECENT ACTIVITY
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {recipients.filter(r => r.open_count > 0).slice(0, 8).map(r => (
                                <div key={r.id} className="flex items-center gap-2 bg-background/50 backdrop-blur-sm border border-emerald-500/20 rounded-lg px-3 py-1.5 transition-all hover:border-emerald-500/40 cursor-default ">
                                    <div className="w-5 h-5 rounded-lg bg-emerald-500/20 flex items-center justify-center text-[9px] font-normal text-emerald-600">
                                        {((r.name || r.email) || 'U')[0].toUpperCase()}
                                    </div>
                                    <span className="text-[11px] font-normal truncate max-w-[120px] text-foreground">{r.name || r.email}</span>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-emerald-500 font-normal">{r.open_count}×</span>
                                        <Eye size={10} className="text-emerald-500/50" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recipients Table Area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 size={32} className="animate-spin text-primary opacity-50" />
                            <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest animate-pulse">Syncing real-time tracking...</p>
                        </div>
                    ) : recipients.length === 0 ? (
                        <div className="py-20 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 bg-surface rounded-full flex items-center justify-center border border-border/20">
                                <Users className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                            <p className="text-sm font-normal text-foreground">No recipients found</p>
                            <p className="text-[11px] text-muted-foreground mt-1">Check back once the campaign starts sending.</p>
                        </div>
                    ) : (
                        <table className="w-full text-[12px] border-collapse">
                            <thead className="sticky top-0 bg-background/95 backdrop-blur-xl border-b border-border/20 z-20">
                                <tr>
                                    {['Recipient', 'Sent', 'Opened', 'Replied', 'Next Follow-up', 'Lead Timezone'].map((h, i) => (
                                        <th key={h} className={`text-left px-6 py-4 text-[10px] font-normal text-muted-foreground uppercase tracking-[0.2em] ${i >= 1 && i <= 4 ? 'text-center' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {recipients.map(r => {
                                    const enrollment = enrollmentsMap.get(r.email.toLowerCase());
                                    let followUpText = '-';
                                    if (enrollment) {
                                        if (enrollment.status === 'stopped' || enrollment.replied) {
                                            followUpText = 'Replied - stopped';
                                        } else if (enrollment.status === 'completed') {
                                            followUpText = 'Sequence done';
                                        } else if (enrollment.status === 'unsubscribed') {
                                            followUpText = 'Unsubscribed';
                                        } else if (enrollment.status === 'active' && enrollment.next_send_at) {
                                            const nextSend = new Date(enrollment.next_send_at).getTime();
                                            const diffMs = nextSend - now;
                                            if (diffMs <= 0) {
                                                followUpText = 'Sending...';
                                            } else {
                                                const diffHours = diffMs / (1000 * 60 * 60);
                                                followUpText = `In ${diffHours.toFixed(1)}h`;
                                            }
                                        } else {
                                            followUpText = enrollment.status;
                                        }
                                    }

                                    return (
                                        <tr key={r.id} className="hover:bg-surface/30 transition-all group/row">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-surface border border-border/20 flex items-center justify-center font-normal text-[10px] text-primary group-hover/row:border-primary transition-all">
                                                        {(r.name || r.email).charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-normal text-foreground group-hover/row:text-primary transition-colors">{r.name || 'Anonymous'}</p>
                                                            {r.replied && (
                                                                <span className="inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                                                    Replied
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-muted-foreground/60 text-[11px] font-mono">{r.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {r.sent_at ? (
                                                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-normal">
                                                        ✅ Day 0
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground/30">-</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {r.open_count > 0 ? (
                                                    <span className="text-emerald-500 font-normal text-sm" title={`${r.open_count} opens`}>✅</span>
                                                ) : (
                                                    <span className="text-red-500 font-normal text-sm">❌</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {r.replied ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase tracking-widest">
                                                        ✅ Replied
                                                    </span>
                                                ) : (
                                                    <span className="text-red-500 font-normal text-sm">❌</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`text-[11px] font-medium ${
                                                    followUpText.startsWith('In ') 
                                                        ? 'text-primary' 
                                                        : followUpText === 'Replied - stopped' 
                                                            ? 'text-emerald-500' 
                                                            : followUpText === 'Sequence done' 
                                                                ? 'text-blue-500' 
                                                                : 'text-muted-foreground'
                                                }`}>
                                                    {followUpText}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <LeadTimezoneCell timezone={r.lead_timezone} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer Insight */}
                <div className="p-4 bg-surface/30 border-t border-border/20 flex items-center justify-center gap-6 text-[10px] font-normal text-muted-foreground/40 uppercase tracking-[0.2em] shrink-0">
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Tracking Active</span>
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-primary" /> Live Sync</span>
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Real-time Analytics</span>
                </div>
            </div>
        </div>
    );
}
