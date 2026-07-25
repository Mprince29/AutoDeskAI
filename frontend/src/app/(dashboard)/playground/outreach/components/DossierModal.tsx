"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Loader2, BookOpen, Tag, Pencil, Globe, X, Linkedin, ExternalLink, Mail,
    Building2, Users, Briefcase, Clock, Cpu, TrendingUp, History, MessageSquare,
    Target, Zap, Award, CheckCircle2, AlertCircle, Newspaper, Copy
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOutreachStore } from '@/store/outreachStore';
import { salesService, Lead } from '@/services/sales.service';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface DossierModalProps {
    lead: Lead;
    onClose: () => void;
}

export function DossierModal({ lead, onClose }: DossierModalProps) {
    const { user } = useAuth();
    const { updateLead } = useOutreachStore();
    const [dossier, setDossier] = useState<any>(lead.dossier);
    const [memory, setMemory] = useState<any[]>([]);
    const [loading, setLoading] = useState(!lead.dossier);

    const [listTagVal, setListTagVal] = useState(lead.list_tag || '');
    const [geoTagVal, setGeoTagVal] = useState(lead.geo_tag || '');
    const [isEditingList, setIsEditingList] = useState(false);
    const [isEditingGeo, setIsEditingGeo] = useState(false);

    useEffect(() => {
        setListTagVal(lead.list_tag || '');
        setGeoTagVal(lead.geo_tag || '');
    }, [lead.list_tag, lead.geo_tag]);

    const handleSaveTags = async (field: 'list_tag' | 'geo_tag', value: string) => {
        if (!user?.email) return;
        try {
            const payload = {
                [field]: value.trim() || null
            };
            const updated = await salesService.updateLead(lead.id, user.email, payload);
            updateLead(lead.id, {
                list_tag: updated.list_tag,
                geo_tag: updated.geo_tag
            });
            toast.success('Tags updated successfully');
        } catch {
            toast.error('Failed to update tags');
            if (field === 'list_tag') setListTagVal(lead.list_tag || '');
            if (field === 'geo_tag') setGeoTagVal(lead.geo_tag || '');
        }
    };

    useEffect(() => {
        if (user?.email) {
            if (!lead.dossier) {
                salesService.generateDossier(lead.id, user.email)
                    .then(res => setDossier(res.dossier))
                    .catch(() => toast.error('Failed to generate dossier'))
                    .finally(() => setLoading(false));
            }
            salesService.getOutreachMemory(lead.id, user.email).then(setMemory).catch(() => {});
        }
    }, [lead.id, lead.dossier, user?.email]);

    if (loading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
                <div className="bg-background border border-border rounded-2xl w-full max-w-lg p-12 text-center flex flex-col items-center gap-6">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                        <Loader2 size={32} className="animate-spin" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-xl font-normal uppercase tracking-tight text-foreground">Building Brief</h2>
                        <p className="text-sm text-muted-foreground">Pulling company and signal context...</p>
                    </div>
                </div>
            </div>
        );
    }

    const techStack = Array.isArray(dossier?.tech_stack)
        ? dossier.tech_stack
        : typeof dossier?.tech_stack === 'string' && dossier.tech_stack.trim()
            ? dossier.tech_stack.split(',').map((s: string) => s.trim()).filter(Boolean)
            : [];

    const newsMentions = typeof lead.company_news === 'string' && lead.company_news.trim()
        ? lead.company_news.split('\n')
            .map((line: string) => line.replace(/^\[news_mention\]\s*/i, '').trim())
            .filter(Boolean)
        : [];

    const recentCampaigns = Array.isArray(dossier?.recent_campaigns)
        ? dossier.recent_campaigns
        : [];

    const notableClients = Array.isArray(dossier?.notable_clients)
        ? dossier.notable_clients
        : [];

    const awards = Array.isArray(dossier?.awards)
        ? dossier.awards
        : [];

    const competitiveContext = typeof dossier?.competitive_context === 'string' && dossier.competitive_context.trim()
        ? dossier.competitive_context
        : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="bg-background border border-border/10 shadow-[0_20px_60px_rgba(0,0,0,0.5)] rounded-3xl w-full max-w-7xl overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="p-6 border-b border-border flex items-center justify-between bg-surface/30 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm">
                            <BookOpen size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold tracking-tight text-foreground uppercase">Prospect Intelligence</h2>
                            <div className="flex flex-wrap items-center gap-3 mt-1.5">
                                <p className="text-[11px] text-muted-foreground font-normal tracking-widest uppercase">{lead.contact_name} @ {lead.company}</p>
                                
                                <div className="h-3 w-px bg-border/40 hidden sm:block" />

                                {/* Project Tag Badge */}
                                {isEditingList ? (
                                    <input
                                        type="text"
                                        value={listTagVal}
                                        onChange={(e) => setListTagVal(e.target.value)}
                                        onBlur={() => {
                                            setIsEditingList(false);
                                            handleSaveTags('list_tag', listTagVal);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                setIsEditingList(false);
                                                handleSaveTags('list_tag', listTagVal);
                                            }
                                        }}
                                        autoFocus
                                        className="text-[9px] font-bold uppercase tracking-widest bg-surface border border-primary/30 px-2 py-0.5 rounded focus:outline-none focus:ring-0 w-24 text-foreground"
                                    />
                                ) : (
                                    <div
                                        onClick={() => setIsEditingList(true)}
                                        className="group/badge cursor-pointer inline-flex items-center gap-1.5 text-[9px] font-bold bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full uppercase tracking-widest hover:bg-primary/20 transition-all shadow-sm"
                                        title="Click to edit project tag"
                                    >
                                        <Tag size={9} />
                                        <span>{listTagVal || 'No Project'}</span>
                                        <Pencil size={8} className="opacity-0 group-hover/badge:opacity-100 transition-opacity ml-0.5 text-primary/60" />
                                    </div>
                                )}

                                {/* Geography Tag Badge */}
                                {isEditingGeo ? (
                                    <input
                                        type="text"
                                        value={geoTagVal}
                                        onChange={(e) => setGeoTagVal(e.target.value)}
                                        onBlur={() => {
                                            setIsEditingGeo(false);
                                            handleSaveTags('geo_tag', geoTagVal);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                setIsEditingGeo(false);
                                                handleSaveTags('geo_tag', geoTagVal);
                                            }
                                        }}
                                        autoFocus
                                        className="text-[9px] font-bold uppercase tracking-widest bg-surface border border-primary/30 px-2 py-0.5 rounded focus:outline-none focus:ring-0 w-24 text-foreground"
                                    />
                                ) : (
                                    <div
                                        onClick={() => setIsEditingGeo(true)}
                                        className="group/badge cursor-pointer inline-flex items-center gap-1.5 text-[9px] font-bold bg-sky-500/10 text-sky-500 border border-sky-500/20 px-2.5 py-0.5 rounded-full uppercase tracking-widest hover:bg-sky-500/20 transition-all shadow-sm"
                                        title="Click to edit geography tag"
                                    >
                                        <Globe size={9} />
                                        <span>{geoTagVal || 'No Geography'}</span>
                                        <Pencil size={8} className="opacity-0 group-hover/badge:opacity-100 transition-opacity ml-0.5 text-sky-500/60" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2.5 rounded-2xl hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                        <X size={20} />
                    </button>
                </div>

                {/* Main Content */}
                <div className="p-8 flex-1 overflow-y-auto custom-scrollbar space-y-8">
                    {/* Profile & Firmographics Card */}
                    <div className="p-6 rounded-[24px] bg-surface/20 border border-border/60 shadow-inner grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                        {/* Avatar & Contact Primary */}
                        <div className="md:col-span-5 flex items-start gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/20 to-sky-500/20 flex items-center justify-center text-primary border border-primary/20 shrink-0 font-bold text-xl uppercase shadow-md">
                                {lead.contact_name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div className="space-y-1 min-w-0">
                                <h3 className="text-lg font-bold tracking-tight text-foreground">{lead.contact_name}</h3>
                                {lead.role && (
                                    <p className="text-xs text-muted-foreground font-medium line-clamp-2">{lead.role}</p>
                                )}
                                {lead.linkedin_headline && (
                                    <p className="text-[11px] text-muted-foreground/60 italic line-clamp-2 mt-1">"{lead.linkedin_headline}"</p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 pt-2">
                                    {lead.linkedin_url && (
                                        <a
                                            href={lead.linkedin_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-surface border border-border hover:border-primary/40 hover:text-primary transition-all px-2.5 py-1 rounded-lg text-muted-foreground"
                                        >
                                            <Linkedin size={10} className="text-[#0A66C2]" /> LinkedIn <ExternalLink size={8} />
                                        </a>
                                    )}
                                    {lead.contact_email && (
                                        <div className="inline-flex items-center gap-1.5">
                                            <div className="inline-flex items-center rounded-md bg-surface border border-border overflow-hidden shadow-sm">
                                                <a
                                                    href={`mailto:${lead.contact_email}`}
                                                    className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider hover:bg-surface-hover hover:text-primary transition-all px-2.5 py-1 text-muted-foreground"
                                                    title="Send email"
                                                >
                                                    <Mail size={10} /> {lead.contact_email}
                                                </a>
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(lead.contact_email || '');
                                                        toast.success('Email copied to clipboard');
                                                    }}
                                                    className="border-l border-border hover:bg-surface-hover hover:text-primary transition-all px-2 py-1 text-muted-foreground flex items-center justify-center"
                                                    title="Copy email"
                                                >
                                                    <Copy size={10} />
                                                </button>
                                            </div>
                                            {lead.email_verified && (
                                                <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                                    lead.email_verified === 'valid'
                                                        ? 'bg-success/10 text-success border border-success/20'
                                                        : lead.email_verified === 'risky'
                                                            ? 'bg-warning/10 text-warning border border-warning/20'
                                                            : 'bg-error/10 text-error border border-error/20'
                                                }`}>
                                                    {lead.email_verified}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Divider for MD+ */}
                        <div className="hidden md:block col-span-1 h-12 w-px bg-border/40 justify-self-center" />

                        {/* Firmographics */}
                        <div className="md:col-span-4 grid grid-cols-2 gap-4 text-xs">
                            <div className="space-y-1">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40 block">Company</span>
                                <span className="font-semibold text-foreground/80 flex items-center gap-1 truncate" title={lead.company}>
                                    <Building2 size={12} className="text-muted-foreground/60 shrink-0" /> {lead.company}
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40 block">Location</span>
                                <span className="font-semibold text-foreground/80 flex items-center gap-1 truncate" title={lead.company_location || undefined}>
                                    <Globe size={12} className="text-muted-foreground/60 shrink-0" /> {lead.company_location || 'Unknown'}
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40 block">Size</span>
                                <span className="font-semibold text-foreground/80 flex items-center gap-1 truncate">
                                    <Users size={12} className="text-muted-foreground/60 shrink-0" /> {lead.company_size || 'Unknown'}
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40 block">Industry & Founded</span>
                                <span className="font-semibold text-foreground/80 flex items-center gap-1 truncate">
                                    <Briefcase size={12} className="text-muted-foreground/60 shrink-0" /> {lead.company_industry || 'Unknown'}
                                    {lead.company_founded && ` (Est. ${lead.company_founded})`}
                                </span>
                            </div>
                        </div>

                        {/* Divider for MD+ */}
                        <div className="hidden md:block col-span-1 h-12 w-px bg-border/40 justify-self-center" />

                        {/* Intent & Timezone */}
                        <div className="md:col-span-1 flex flex-col items-center justify-center gap-2">
                            <div className="relative flex items-center justify-center">
                                {/* Intent Indicator */}
                                <div className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center bg-surface/30 shadow-inner ${
                                    lead.intent_score >= 80
                                        ? 'border-error/30 text-error'
                                        : lead.intent_score >= 50
                                            ? 'border-warning/30 text-warning'
                                            : 'border-success/30 text-success'
                                }`}>
                                    <span className="text-[14px] font-extrabold">{lead.intent_score}</span>
                                    <span className="text-[7px] font-bold uppercase tracking-tighter text-muted-foreground/60 -mt-0.5">Intent</span>
                                </div>
                            </div>
                            {lead.lead_timezone && (
                                <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest flex items-center gap-1">
                                    <Clock size={10} /> {lead.lead_timezone}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                        {/* Column 1: Company Intelligence */}
                        <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
                            <div className="space-y-4">
                                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                    <Globe size={16} className="text-primary" /> Company Blueprint
                                </h3>
                                <div className="p-6 rounded-[24px] bg-surface/40 border border-border shadow-sm group hover:border-primary/20 transition-colors">
                                    <p className="text-[14px] leading-relaxed font-normal text-foreground/80 italic">
                                        "{dossier?.company_overview || dossier?.company_summary || 'Aggregating company data and market positioning...'}"
                                    </p>
                                </div>
                            </div>

                            {techStack.length > 0 && (
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Cpu size={16} className="text-primary" /> Infrastructure & Stack
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {techStack.map((t: string) => (
                                            <span key={t} className="text-[11px] font-medium bg-background border border-border px-3 py-1.5 rounded-xl text-foreground/70 shadow-sm hover:border-primary/30 transition-colors">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {competitiveContext && (
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <TrendingUp size={16} className="text-primary" /> Competitive Context
                                    </h3>
                                    <div className="p-6 rounded-[24px] bg-surface/40 border border-border shadow-sm group hover:border-primary/20 transition-colors">
                                        <p className="text-[13px] leading-relaxed text-foreground/80 font-normal">
                                            {competitiveContext}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {notableClients.length > 0 && (
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Users size={16} className="text-primary" /> Notable Clients
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {notableClients.map((client: string) => (
                                            <span key={client} className="text-[11px] font-medium bg-background border border-border px-3 py-1.5 rounded-xl text-foreground/70 shadow-sm hover:border-primary/30 transition-colors">
                                                {client}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {memory.length > 0 && (
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <History size={16} className="text-primary" /> Outreach Memory
                                    </h3>
                                    <div className="space-y-3">
                                        {memory.map((m: any) => (
                                            <div key={m.id} className="p-4 rounded-2xl bg-surface border border-border/10 flex items-start gap-3 group hover:border-primary/20 transition-all">
                                                <div className="w-8 h-8 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                                                    <Mail size={12} className="text-muted-foreground/40" />
                                                </div>
                                                <div>
                                                    <p className="text-[11px] font-bold text-foreground uppercase tracking-tight">{m.angle}</p>
                                                    <p className="text-[10px] text-muted-foreground line-clamp-1">{m.message_summary}</p>
                                                    <p className="text-[8px] text-muted-foreground/40 mt-1 uppercase tracking-widest">{formatDistanceToNow(new Date(m.used_at))} ago via {m.channel}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Column 2: Outreach Arsenal */}
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <div className="space-y-4">
                                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                    <MessageSquare size={16} className="text-primary" /> Creative Icebreakers
                                </h3>
                                <div className="space-y-3">
                                    {(dossier?.icebreakers || ['Noticed your recent growth signals', 'Congrats on the new initiative']).slice(0, 3).map((p: string, i: number) => (
                                        <div key={i} className="text-[13px] font-normal italic bg-primary/[0.03] p-5 rounded-[24px] border border-primary/10 text-primary shadow-sm relative overflow-hidden group">
                                            <div className="absolute top-0 right-0 p-4 bg-primary/5 rounded-full -mr-4 -mt-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            "{p}"
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                    <Target size={16} className="text-primary" /> Outreach Angles
                                </h3>
                                <div className="space-y-3">
                                    {(dossier?.outreach_angles || ['Scale & Efficiency', 'Market Expansion']).slice(0, 3).map((angle: string, i: number) => (
                                        <div key={i} className="text-[13px] font-normal bg-background border border-border p-5 rounded-[24px] shadow-sm text-foreground/80 leading-relaxed hover:border-primary/40 transition-all hover:translate-x-1">
                                            {angle}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {recentCampaigns.length > 0 && (
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Zap size={16} className="text-primary" /> Recent Campaigns
                                    </h3>
                                    <div className="space-y-2">
                                        {recentCampaigns.map((c: string, idx: number) => (
                                            <div key={idx} className="text-[13px] font-medium bg-background border border-border p-4 rounded-[20px] shadow-sm text-foreground/80 leading-relaxed">
                                                {c}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {awards.length > 0 && (
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Award size={16} className="text-amber-500" /> Key Honors & Awards
                                    </h3>
                                    <div className="space-y-2">
                                        {awards.map((award: string, idx: number) => (
                                            <div key={idx} className="flex items-center gap-3 p-3 bg-amber-500/[0.03] border border-amber-500/10 rounded-2xl text-[12px] font-medium text-foreground/80 leading-snug">
                                                <Award size={14} className="text-amber-500 shrink-0" />
                                                <span>{award}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Column 3: Market Pulse */}
                        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                            <div className="space-y-4">
                                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                    <Zap size={16} className="text-success" /> Buying Triggers
                                </h3>
                                <div className="space-y-3">
                                    {(dossier?.buying_signals || ['Expanding teams', 'New market entry']).slice(0, 3).map((signal: string, i: number) => (
                                        <div key={i} className="flex items-start gap-4 p-4 rounded-[24px] bg-success/[0.03] border border-success/10 group hover:bg-success/[0.06] transition-colors">
                                            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center text-success border border-success/20 shrink-0 shadow-sm group-hover:scale-110 transition-transform">
                                                <CheckCircle2 size={18} />
                                            </div>
                                            <span className="text-[13px] font-medium text-success leading-snug pt-1">{signal}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                    <AlertCircle size={16} className="text-warning" /> Key Friction Points
                                </h3>
                                <div className="p-6 rounded-[32px] bg-warning/[0.03] border border-warning/10 relative overflow-hidden shadow-sm">
                                    <div className="absolute top-0 right-0 p-12 bg-warning/5 blur-[40px] rounded-full -mr-8 -mt-8" />
                                    <ul className="relative space-y-4">
                                        {(dossier?.pain_points || ['Inefficient workflows', 'Data fragmentation']).slice(0, 3).map((p: string, i: number) => (
                                            <li key={i} className="text-[13px] flex items-start gap-3 text-foreground/70">
                                                <div className="w-2 h-2 rounded-full bg-warning mt-1.5 shrink-0 shadow-[0_0_8px_rgba(var(--warning),0.4)]" />
                                                <span className="font-medium leading-relaxed">{p}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            {newsMentions.length > 0 && (
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Newspaper size={16} className="text-sky-500" /> Recent News & Media Pulse
                                    </h3>
                                    <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                                        {newsMentions.map((news: string, idx: number) => (
                                            <div key={idx} className="flex gap-3 p-3.5 rounded-[20px] bg-surface/50 border border-border/40 hover:bg-surface/80 hover:border-sky-500/20 transition-colors">
                                                <Newspaper size={14} className="text-sky-500 shrink-0 mt-0.5" />
                                                <p className="text-[12px] font-medium text-foreground/80 leading-snug">{news}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
