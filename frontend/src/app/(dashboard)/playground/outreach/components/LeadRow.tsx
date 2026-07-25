"use client";

import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
    User, Mail, Tag, Globe, Flame, Thermometer, Wind, Loader2, Wand2,
    Activity, EllipsisVertical, RefreshCcw, BarChart3, MessageCircle, Calendar, Trash2
} from 'lucide-react';
import { Lead, Signal } from '@/services/sales.service';

export const SIGNAL_LABEL: Record<string, string> = {
    email_open: 'opened your email',
    email_click: 'clicked a link',
    funding_round: 'got funding',
    news_mention: 'in the news',
    hiring_signal: 'now hiring',
    job_posting: 'posted a job',
    product_launch: 'launched product',
};

export const Skeleton = ({ className }: { className?: string }) => (
    <div className={`shimmer rounded bg-surface ${className}`} />
);

export const LeadRowSkeleton = () => (
    <tr className="border-b border-border/30">
        <td className="pl-4 pr-2 py-3 w-8"><Skeleton className="w-4 h-4" /></td>
        <td className="px-3 py-3">
            <div className="flex items-center gap-2">
                <Skeleton className="w-7 h-7 rounded-full" />
                <div className="space-y-1.5">
                    <Skeleton className="w-32 h-3" />
                    <Skeleton className="w-24 h-2" />
                </div>
            </div>
        </td>
        <td className="hidden md:table-cell px-3 py-3 w-56"><Skeleton className="w-40 h-3" /></td>

        <td className="hidden xl:table-cell px-3 py-3 w-36">
            <div className="space-y-1.5">
                <Skeleton className="w-20 h-3" />
                <Skeleton className="w-16 h-2" />
            </div>
        </td>
        <td className="px-3 py-3 w-24 sm:w-48">
            <div className="flex gap-2 justify-end items-center">
                <Skeleton className="w-8 h-8 rounded-lg" />
                <Skeleton className="w-20 h-8 rounded-lg" />
                <Skeleton className="w-8 h-8 rounded-lg" />
            </div>
        </td>
    </tr>
);

interface LeadRowProps {
    lead: Lead;
    index: number;
    onRefresh: (id: number) => void;
    isRefreshing: number | null;
    onGenerateOutreach: (lead: Lead) => void;
    onHistory: (lead: Lead) => void;
    onEnrich: (id: number) => void;
    onDossier: (lead: Lead) => void;
    isSelected: boolean;
    onToggleSelect: (id: number) => void;
    onHandleObjection: (lead: Lead) => void;
    onDelete: (id: number) => void;
    onBookMeeting: (lead: Lead) => void;
    menuOpen: boolean;
    setMenuOpen: (open: boolean) => void;
    latestSignal?: Signal;
}

export function LeadRow({
    lead, index, onRefresh, isRefreshing, onGenerateOutreach, onHistory, onEnrich, onDossier,
    isSelected, onToggleSelect, onHandleObjection, latestSignal, onDelete,
    onBookMeeting,
    menuOpen, setMenuOpen,
}: LeadRowProps) {
    const score = lead.intent_score ?? 0;
    const isHot = score >= 80;
    const hasActivity = !!(latestSignal || lead.last_signal_at || lead.last_contacted_at);
    const activityLabel = latestSignal
        ? SIGNAL_LABEL[latestSignal.type] ?? latestSignal.type.replace(/_/g, ' ')
        : null;
    const activityTime = latestSignal
        ? formatDistanceToNow(new Date(latestSignal.created_at), { addSuffix: true })
        : lead.last_signal_at
            ? formatDistanceToNow(new Date(lead.last_signal_at), { addSuffix: true })
            : lead.last_contacted_at
                ? formatDistanceToNow(new Date(lead.last_contacted_at), { addSuffix: true })
                : null;

    const isRowRefreshing = isRefreshing === lead.id;

    return (
        <tr
            onClick={() => onDossier(lead)}
            className={`border-b border-border/40 transition-colors relative cursor-pointer ${isSelected ? 'bg-primary/5' : 'hover:bg-surface/40'}`}
        >
            {isRowRefreshing && (
                <td colSpan={6} className="absolute inset-0 z-10">
                    <div className="w-full h-full shimmer opacity-30" />
                </td>
            )}
            {/* Checkbox */}
            <td className="pl-4 pr-2 py-2 align-middle w-8">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(lead.id)}
                    onClick={e => e.stopPropagation()}
                    className="h-4 w-4 rounded border-border bg-background text-primary cursor-pointer accent-primary"
                />
            </td>

            {/* Name + Company */}
            <td className="px-3 py-2 align-middle min-w-0">
                <div className="flex items-center gap-2">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-primary/20 to-sky-500/20 flex items-center justify-center shrink-0 relative border border-primary/20 shadow-sm">
                        <span className="font-bold text-primary uppercase text-sm tracking-widest">
                            {lead.contact_name ? lead.contact_name.split(' ').slice(0, 2).map(n => n[0]).join('') : '?'}
                        </span>
                        {isHot && (
                            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-warning rounded-full border-2 border-background shadow-[0_0_10px_rgba(245,158,11,0.5)] animate-pulse" />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground leading-tight truncate">{lead.contact_name}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight truncate">{lead.company}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {(lead.replied === true || lead.signals?.some(s => s.type === 'email_reply')) && (
                                <span className="inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                    <MessageCircle size={8} />
                                    Replied
                                </span>
                            )}
                            {lead.campaign_names && lead.campaign_names.map((campName) => (
                                <span key={campName} className="inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                    <Mail size={8} />
                                    {campName}
                                </span>
                            ))}
                            <span className={`inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest ${
                                lead.list_tag 
                                    ? 'bg-primary/10 text-primary border border-primary/20' 
                                    : 'bg-surface text-muted-foreground/40 border border-border'
                            }`}>
                                <Tag size={8} />
                                {lead.list_tag || 'No Project'}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-widest ${
                                lead.geo_tag 
                                    ? 'bg-sky-500/10 text-sky-500 border border-sky-500/20' 
                                    : 'bg-surface text-muted-foreground/40 border border-border'
                            }`}>
                                <Globe size={8} />
                                {lead.geo_tag || 'No Geography'}
                            </span>
                        </div>
                    </div>
                </div>
            </td>

            {/* Role */}
            <td className="hidden md:table-cell px-3 py-2 align-middle text-xs text-muted-foreground w-32">
                {lead.role || <span className="text-muted-foreground/30">-</span>}
            </td>


            {/* Recent activity */}
            <td className="hidden xl:table-cell px-3 py-2 align-middle w-36">
                <div className="flex items-center gap-1.5">
                    {hasActivity && (
                        <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                        </span>
                    )}
                    <div className="min-w-0">
                        {activityLabel && (
                            <p className="text-xs text-foreground/80 truncate leading-tight font-normal">{activityLabel}</p>
                        )}
                        {activityTime ? (
                            <p className="text-[10px] text-muted-foreground leading-tight font-normal">{activityTime}</p>
                        ) : (
                            <p className="text-xs text-muted-foreground/30">&mdash;</p>
                        )}
                    </div>
                </div>
            </td>

            {/* Actions */}
            <td className="px-3 py-2 align-middle w-24 sm:w-48">
                <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEnrich(lead.id); }}
                        disabled={lead.enrichment_status === 'pending'}
                        title="Research this person with AI"
                        className={`h-7 px-2.5 sm:px-3 rounded-lg border transition-all flex items-center gap-1.5 ${lead.enrichment_status === 'pending' ? 'bg-primary/5 text-primary border-primary/20' : 'text-muted-foreground border-border/20 hover:border-border hover:bg-surface hover:text-foreground'}`}
                    >
                        {lead.enrichment_status === 'pending' ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                        <span className="hidden sm:inline text-[10px] font-normal uppercase tracking-wider">Research</span>
                    </button>

                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onGenerateOutreach(lead); }}
                        className="h-7 px-2.5 sm:px-3 rounded-lg bg-primary text-white text-[10px] font-normal uppercase tracking-wider flex items-center gap-1.5 hover:opacity-90 transition-all shadow-sm shadow-primary/20"
                        title="Get AI suggestion for next step"
                    >
                        <Activity size={12} />
                        <span className="hidden xs:inline">Action</span>
                    </button>

                    <div className="relative">
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                            className={`p-1.5 rounded-lg border transition-all ${menuOpen ? 'bg-surface border-border text-foreground' : 'border-transparent hover:border-border hover:bg-surface text-muted-foreground/40 hover:text-foreground'}`}
                        >
                            <EllipsisVertical size={16} />
                        </button>

                        <div className={`absolute right-0 top-full mt-1 w-44 bg-background border border-border rounded-lg shadow-xl transition-all z-30 p-1 ${menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                            {[
                                { icon: RefreshCcw, label: 'Sync Profile', onClick: () => onRefresh(lead.id), loading: isRefreshing === lead.id },
                                { icon: BarChart3, label: 'Engagement Stats', onClick: () => onHistory(lead) },
                                { icon: MessageCircle, label: 'Handle Replies', onClick: () => onHandleObjection(lead) },
                                { icon: Calendar, label: 'Book Meeting', onClick: () => onBookMeeting(lead) },
                                { icon: Trash2, label: 'Remove Lead', onClick: () => { onDelete(lead.id); }, color: 'text-error' },
                            ].map((item, i) => (
                                <button
                                    type="button"
                                    key={i}
                                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); item.onClick(); }}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-normal transition-colors hover:bg-surface ${item.color || 'text-muted-foreground-dark hover:text-foreground'}`}
                                >
                                    {item.loading ? <Loader2 size={12} className="animate-spin" /> : <item.icon size={12} />}
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    );
}

// Alias for backward compat
export const LeadCard = LeadRow;
