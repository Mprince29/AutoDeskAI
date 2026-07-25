"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, X, Loader2, ChevronDown, Check, AlertCircle, ShieldCheck, MailQuestion, Tag, Globe, Plus,
    Zap, Sparkles, Send, FileUp, CheckCircle2, Clock, ChevronRight, BarChart3, Mail,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOutreachStore } from '@/store/outreachStore';
import {
    salesService, Lead, Sequence, PipelineMode, PipelineEvent, PipelineStepState, PipelineRunSummary,
} from '@/services/sales.service';
import { toast } from 'sonner';
import { FaLinkedin } from 'react-icons/fa6';
import { FaTwitter } from 'react-icons/fa';

// ── Pipeline helpers (same as in page.tsx) ───────────────────────────────────

const PIPELINE_STEP_ORDER = [
    { step: 'parse', label: 'Request understood' },
    { step: 'find_leads', label: 'Finding people' },
    { step: 'save_leads', label: 'Saving people' },
    { step: 'enrich', label: 'Finding details' },
    { step: 'email_gen', label: 'Writing emails' },
    { step: 'create_campaign', label: 'Email campaign created' },
    { step: 'send', label: 'Sending' },
    { step: 'sequence_enroll', label: 'Follow-up emails' },
    { step: 'pipeline_complete', label: 'Done' },
] as const;

function createInitialPipelineSteps(): PipelineStepState[] {
    return PIPELINE_STEP_ORDER.map(({ step, label }) => ({
        step,
        label,
        status: 'idle',
        message: '',
        data: {},
    }));
}

function formatParsedPrompt(params: Record<string, any> | undefined): string {
    if (!params) return 'Ready to understand your request.';
    const product = params.product_key ? String(params.product_key).toUpperCase() : null;
    const locations = Array.isArray(params.locations) ? params.locations.filter(Boolean).join(', ') : '';
    const titles = Array.isArray(params.job_titles) ? params.job_titles.filter(Boolean).join(', ') : '';
    const emailNumber = params.email_number ? `Email ${params.email_number}` : '';
    return [product, locations, titles, emailNumber].filter(Boolean).join(' • ') || 'Request understood.';
}

function getPipelineStepMessage(step: string, event: PipelineEvent): string {
    if (step === 'parse' && event.status === 'done') return formatParsedPrompt(event.data?.params);
    if (step === 'find_leads' && event.status === 'done' && typeof event.data?.count === 'number') return `${event.data.count} people found`;
    if (step === 'save_leads' && event.status === 'done') {
        const created = typeof event.data?.created === 'number' ? event.data.created : '-';
        const skipped = typeof event.data?.skipped === 'number' ? event.data.skipped : '-';
        return `${created} new people, ${skipped} skipped`;
    }
    if (step === 'enrich' && event.status === 'done') {
        const enriched = typeof event.data?.enriched === 'number' ? event.data.enriched : '-';
        const total = typeof event.data?.total === 'number' ? event.data.total : null;
        return total ? `${enriched}/${total} people updated` : `${enriched} people updated`;
    }
    if (step === 'email_gen' && event.status === 'done' && typeof event.data?.count === 'number') return `${event.data.count} personalized emails ready`;
    if (step === 'create_campaign' && event.status === 'done') return event.data?.name ? `"${event.data.name}"` : event.message;
    if (step === 'send' && event.status === 'done') {
        const sent = typeof event.data?.sent === 'number' ? event.data.sent : '-';
        const failed = typeof event.data?.failed === 'number' ? event.data.failed : '-';
        return `${sent} sent, ${failed} failed`;
    }
    if (step === 'sequence_enroll' && event.status === 'done' && typeof event.data?.enrolled === 'number') return `${event.data.enrolled} people added to follow-ups`;
    if (step === 'pipeline_complete' && event.status === 'done') {
        const sent = typeof event.data?.emails_sent === 'number' ? event.data.emails_sent : '-';
        return `${sent} emails sent`;
    }
    return event.message || '';
}

function mergePipelineSummary(current: PipelineRunSummary | null, event: PipelineEvent): PipelineRunSummary | null {
    const next: PipelineRunSummary = { ...(current || {}) };
    if (event.step === 'find_leads' && typeof event.data?.count === 'number') next.leads_found = event.data.count;
    if (event.step === 'save_leads') {
        if (typeof event.data?.created === 'number') next.contacts_created = event.data.created;
        if (typeof event.data?.total === 'number') next.contacts_saved = event.data.total;
    }
    if (event.step === 'create_campaign') {
        if (typeof event.data?.campaign_id === 'number') next.campaign_id = event.data.campaign_id;
        if (typeof event.data?.name === 'string') next.campaign_name = event.data.name;
    }
    if (event.step === 'send') {
        if (typeof event.data?.sent === 'number') next.emails_sent = event.data.sent;
        if (typeof event.data?.failed === 'number') next.failed = event.data.failed;
        if (typeof event.data?.live === 'boolean') next.live_mode = event.data.live;
        if (typeof event.data?.campaign_id === 'number') next.campaign_id = event.data.campaign_id;
    }
    if (event.step === 'pipeline_complete') {
        if (typeof event.data?.campaign_id === 'number') next.campaign_id = event.data.campaign_id;
        if (typeof event.data?.leads_found === 'number') next.leads_found = event.data.leads_found;
        if (typeof event.data?.contacts_created === 'number') next.contacts_created = event.data.contacts_created;
        if (typeof event.data?.emails_sent === 'number') next.emails_sent = event.data.emails_sent;
        if (typeof event.data?.live_mode === 'boolean') next.live_mode = event.data.live_mode;
    }
    return next;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface LeadFinderModalProps {
    onClose: () => void;
    onSave: (leads: Lead[]) => void;
    sequences: Sequence[];
    onPipelineComplete?: () => Promise<void>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LeadFinderModal({ onClose, onSave, sequences, onPipelineComplete }: LeadFinderModalProps) {
    const { user } = useAuth();
    const { products } = useOutreachStore();

    const [activeTab, setActiveTab] = useState<'discovery' | 'pipeline'>('discovery');

    // ── Lead Discovery state ─────────────────────────────────────────────────
    const [selectedProductKey, setSelectedProductKey] = useState<string>('');
    const [productPreview, setProductPreview] = useState<any>(null);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const productDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (productDropdownRef.current && !productDropdownRef.current.contains(event.target as Node)) {
                setShowProductDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const [icp, setIcp] = useState('');
    const [productDescription, setProductDescription] = useState('');
    const [limit, setLimit] = useState(25);
    const [loading, setLoading] = useState(false);
    const [leads, setLeads] = useState<any[]>([]);
    const [parsedFilters, setParsedFilters] = useState<any | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [enrichingRows, setEnrichingRows] = useState<Set<number>>(new Set());
    const [enrichingDone, setEnrichingDone] = useState(false);
    const [listTag, setListTag] = useState('');
    const [geoTag, setGeoTag] = useState('');
    const [duplicates, setDuplicates] = useState<any[]>([]);
    const [ignoreDuplicates, setIgnoreDuplicates] = useState(false);

    useEffect(() => {
        if (parsedFilters?.geographies?.length > 0) setGeoTag(parsedFilters.geographies[0]);
        else if (parsedFilters?.regions?.length > 0) setGeoTag(parsedFilters.regions[0]);
        else if (parsedFilters?.countries?.length > 0) setGeoTag(parsedFilters.countries[0]);
    }, [parsedFilters]);

    const leadKey = (lead: any) => (
        lead.contact_email || lead.linkedin_url || `${lead.contact_name || 'unknown'}::${lead.company || 'unknown'}`
    );

    const handleSearch = async () => {
        if (!icp.trim() || !user?.email) return;
        setLoading(true);
        setEnrichingDone(false);
        setEnrichingRows(new Set());
        try {
            const res = await salesService.findLeads(user.email, {
                icp_description: icp,
                product_description: productDescription,
                limit,
                product_key: selectedProductKey || undefined,
            });
            const rawLeads = res.leads as any[];
            setLeads(rawLeads);
            setParsedFilters(res.parsed_filters || null);
            const autoSelect = new Set(
                rawLeads.filter((l: any) => l.contact_email || l.linkedin_url).slice(0, 10).map((l: any) => leadKey(l))
            );
            setSelectedIds(autoSelect);

            const needsEnrich = rawLeads.map((l, i) => ({ l, i })).filter(({ l }) => !l.company || !l.domain || !l.company_industry || !l.company_location);
            if (needsEnrich.length > 0) {
                setEnrichingRows(new Set(needsEnrich.map(({ i }) => i)));
                salesService.webEnrichLeads(
                    rawLeads,
                    res.parsed_filters || null,
                    (index, updates) => {
                        setLeads(prev => { const next = [...prev]; next[index] = { ...next[index], ...updates }; return next; });
                        setEnrichingRows(prev => { const next = new Set(prev); next.delete(index); return next; });
                    },
                    () => setEnrichingDone(true),
                );
            } else {
                setEnrichingDone(true);
            }
        } catch {
            toast.error('Search failed');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (selectedIds.size === 0 || !user?.email) return;
        setSaving(true);
        try {
            const selectedLeads = leads.filter(l => selectedIds.has(leadKey(l)));
            const res = await salesService.saveLeads(user.email, selectedLeads, listTag || null, geoTag || null, ignoreDuplicates, selectedProductKey || null);
            const orgDuplicates = res.org_duplicates ?? [];
            if (orgDuplicates.length > 0 && !ignoreDuplicates) {
                setDuplicates(orgDuplicates);
                toast.warning('Duplicate organization contacts found. Please review before proceeding.');
                setSaving(false);
                return;
            }
            const parts = [];
            if (res.created > 0) parts.push(`${res.created} added`);
            if (res.updated > 0) parts.push(`${res.updated} re-enriching`);
            toast.success(parts.length > 0 ? parts.join(', ') : 'Leads processed');
            onSave(res.contacts);
            onClose();
        } catch {
            toast.error('Failed to save leads');
        } finally {
            setSaving(false);
        }
    };

    const toggleSelect = (lead: any) => {
        const key = leadKey(lead);
        const next = new Set(selectedIds);
        if (next.has(key)) next.delete(key); else next.add(key);
        setSelectedIds(next);
    };

    // ── Pipeline state ───────────────────────────────────────────────────────
    const [pipelinePrompt, setPipelinePrompt] = useState('');
    const [pipelineMode, setPipelineMode] = useState<PipelineMode | null>(null);
    const [isModeLoading, setIsModeLoading] = useState(false);
    const [testRecipientsInput, setTestRecipientsInput] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [selectedPipelineProductKey, setSelectedPipelineProductKey] = useState<string | null>(null);
    const [selectedFollowUpSequenceId, setSelectedFollowUpSequenceId] = useState<number | null>(null);
    const [isPipelineRunning, setIsPipelineRunning] = useState(false);
    const [pipelineSteps, setPipelineSteps] = useState<PipelineStepState[]>(createInitialPipelineSteps);
    const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);
    const [pipelineSummary, setPipelineSummary] = useState<PipelineRunSummary | null>(null);
    const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);
    const [createdCampaignName, setCreatedCampaignName] = useState<string | null>(null);
    const pipelineRunRef = useRef<AbortController | null>(null);
    const [pipelineJobId, setPipelineJobId] = useState<string | null>(null);
    const [pipelineDecisionPending, setPipelineDecisionPending] = useState(false);
    const [pipelineDecisionContacts, setPipelineDecisionContacts] = useState<any[]>([]);
    const [pipelineDecisionCounts, setPipelineDecisionCounts] = useState<{ with_email: number; no_email: number; total: number } | null>(null);
    const [pipelineCompleteJobId, setPipelineCompleteJobId] = useState<string | null>(null);
    const [pipelineCompleteDecision, setPipelineCompleteDecision] = useState<string | null>(null);
    const [noEmailLeadsCount, setNoEmailLeadsCount] = useState(0);

    // Load pipeline mode on mount (only once)
    useEffect(() => {
        if (!user?.email) return;
        setIsModeLoading(true);
        salesService.getPipelineMode()
            .then(mode => setPipelineMode(mode))
            .catch(() => toast.error('Failed to load pipeline mode'))
            .finally(() => setIsModeLoading(false));
    }, [user?.email]);

    // Auto-fill test recipient with own email
    useEffect(() => {
        if (pipelineMode?.live_mode === false && !testRecipientsInput.trim() && user?.email) {
            setTestRecipientsInput(user.email);
        }
    }, [pipelineMode?.live_mode, testRecipientsInput, user?.email]);

    const handlePipelineModeChange = async (nextLiveMode: boolean) => {
        if (isModeLoading) return;
        setIsModeLoading(true);
        try {
            const result = await salesService.setPipelineMode({ live_mode: nextLiveMode, confirm: nextLiveMode ? 'I understand this will send real emails' : '' });
            setPipelineMode({
                live_mode: result.live_mode,
                label: result.live_mode ? 'Real emails will be sent to matched people' : 'Test emails only - no real prospects will be contacted',
                warning: result.live_mode ? 'Real email sending is ON. This will contact matched people.' : null,
            });
            toast.success(result.message);
        } catch (error: any) {
            toast.error(error.message || 'Failed to change email sending mode');
        } finally {
            setIsModeLoading(false);
        }
    };

    const handleRunPipeline = async () => {
        if (!user?.email || isPipelineRunning) return;
        const prompt = pipelinePrompt.trim();
        if (!prompt) { toast.error('Enter instructions before starting'); return; }

        pipelineRunRef.current?.abort();
        setPipelineSteps(createInitialPipelineSteps());
        setPipelineEvents([]);
        setPipelineSummary(null);
        setCreatedCampaignId(null);
        setCreatedCampaignName(null);
        setPipelineJobId(null);
        setPipelineDecisionPending(false);
        setPipelineDecisionContacts([]);
        setPipelineDecisionCounts(null);
        setPipelineCompleteJobId(null);
        setPipelineCompleteDecision(null);
        setNoEmailLeadsCount(0);
        setIsPipelineRunning(true);

        let sawPipelineError = false;
        let decisionRequiredReceived = false;

        pipelineRunRef.current = salesService.findLeadsPipeline(
            user.email,
            { prompt, product_key: selectedPipelineProductKey },
            {
                onEvent: (event) => {
                    setPipelineEvents(prev => [...prev, event]);
                    setPipelineSummary(prev => mergePipelineSummary(prev, event));

                    if (event.step === 'decision_required') {
                        decisionRequiredReceived = true;
                        setPipelineJobId(event.data?.job_id || null);
                        setPipelineDecisionPending(true);
                        setPipelineDecisionContacts(event.data?.contacts || []);
                        setPipelineDecisionCounts({
                            with_email: event.data?.with_email || 0,
                            no_email: event.data?.without_email || 0,
                            total: event.data?.total_leads || 0,
                        });
                        return;
                    }

                    if (event.status === 'error') sawPipelineError = true;

                    setPipelineSteps(prev => prev.map(step => {
                        if (step.step !== event.step) return step;
                        return { ...step, status: event.status, message: getPipelineStepMessage(step.step, event), data: event.data || {}, ts: event.ts };
                    }));
                },
                onError: async (error) => {
                    sawPipelineError = true;
                    setIsPipelineRunning(false);
                    pipelineRunRef.current = null;
                    setPipelineSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'error', message: error.message } : step));
                    toast.error(error.message || 'Email workflow failed');
                },
                onDone: async () => {
                    if (!decisionRequiredReceived) {
                        setIsPipelineRunning(false);
                        pipelineRunRef.current = null;
                        try { await onPipelineComplete?.(); } catch { /* silent */ }
                    }
                },
            },
        );
    };

    const handleSelectDecision = async (decision: 'send_with_email_export_rest' | 'export_all') => {
        if (!user?.email || !pipelineJobId) return;
        const liveMode = pipelineMode?.live_mode ?? false;
        const testRecipients = testRecipientsInput.split(',').map(e => e.trim()).filter(Boolean);

        if (decision === 'send_with_email_export_rest' && !liveMode && testRecipients.length === 0) {
            toast.error('Add at least one test recipient while test mode is enabled');
            return;
        }

        setPipelineDecisionPending(false);
        setIsPipelineRunning(true);

        if (decision === 'export_all') {
            setPipelineSteps(prev => prev.map(step => {
                if (['enrich', 'email_gen', 'create_campaign', 'send', 'sequence_enroll'].includes(step.step)) {
                    return { ...step, status: 'skipped', message: 'Skipped for download-only choice' };
                }
                return step;
            }));
        } else if (!selectedFollowUpSequenceId) {
            setPipelineSteps(prev => prev.map(step => step.step === 'sequence_enroll' ? { ...step, status: 'skipped', message: 'No follow-up emails selected' } : step));
        }

        let sawPipelineError = false;
        let sawPipelineComplete = false;

        pipelineRunRef.current?.abort();
        pipelineRunRef.current = salesService.sendOutreachPipeline(
            user.email,
            {
                job_id: pipelineJobId,
                decision,
                test_recipients: liveMode ? [] : testRecipients,
                force_live: liveMode,
                follow_up_sequence_id: selectedFollowUpSequenceId,
            },
            {
                onEvent: (event) => {
                    setPipelineEvents(prev => [...prev, event]);
                    setPipelineSummary(prev => mergePipelineSummary(prev, event));

                    if (event.step === 'create_campaign') {
                        if (typeof event.data?.campaign_id === 'number') setCreatedCampaignId(event.data.campaign_id);
                        if (typeof event.data?.name === 'string') setCreatedCampaignName(event.data.name);
                    }
                    if (event.step === 'send' && typeof event.data?.campaign_id === 'number') setCreatedCampaignId(event.data.campaign_id);
                    if (event.step === 'pipeline_complete') {
                        sawPipelineComplete = true;
                        setPipelineCompleteJobId(pipelineJobId);
                        setPipelineCompleteDecision(decision);
                        if (typeof event.data?.no_email_leads === 'number') {
                            setNoEmailLeadsCount(event.data.no_email_leads);
                        } else if (pipelineDecisionCounts) {
                            setNoEmailLeadsCount(pipelineDecisionCounts.no_email);
                        }
                        if (typeof event.data?.campaign_id === 'number') setCreatedCampaignId(event.data.campaign_id);
                    }
                    if (event.status === 'error') sawPipelineError = true;

                    setPipelineSteps(prev => prev.map(step => {
                        if (decision === 'export_all' && ['enrich', 'email_gen', 'create_campaign', 'send', 'sequence_enroll'].includes(step.step)) return step;
                        if (decision === 'send_with_email_export_rest' && step.step === 'sequence_enroll' && !selectedFollowUpSequenceId && step.status === 'skipped') return step;
                        if (step.step !== event.step) return step;
                        return { ...step, status: event.status, message: getPipelineStepMessage(step.step, event), data: event.data || {}, ts: event.ts };
                    }));
                },
                onError: async (error) => {
                    sawPipelineError = true;
                    setIsPipelineRunning(false);
                    pipelineRunRef.current = null;
                    setPipelineSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'error', message: error.message } : step));
                    toast.error(error.message || 'Email workflow failed');
                },
                onDone: async () => {
                    setIsPipelineRunning(false);
                    pipelineRunRef.current = null;
                    if (!sawPipelineError) {
                        setPipelineSteps(prev => prev.map(step => {
                            if (step.step === 'pipeline_complete' && !sawPipelineComplete) return { ...step, status: 'done', message: step.message || 'Workflow completed' };
                            if (step.step === 'sequence_enroll' && !selectedFollowUpSequenceId && step.status === 'skipped') return step;
                            if (decision === 'export_all' && ['enrich', 'email_gen', 'create_campaign', 'send', 'sequence_enroll'].includes(step.step)) return step;
                            if (step.status === 'running') return { ...step, status: 'done', message: step.message || 'Completed' };
                            return step;
                        }));
                        try { await onPipelineComplete?.(); } catch { toast.error('Workflow finished, but refresh failed'); }
                        toast.success(sawPipelineComplete ? 'Email workflow completed successfully' : 'Workflow finished');
                    }
                },
            },
        );
    };

    const downloadCSV = (jobId: string, which: 'no_email' | 'all' | 'with_email') => {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
        window.open(`${API_BASE_URL}/api/pipeline/export-csv/${jobId}?which=${which}`, '_blank');
    };

    const pipelineSummaryModeLive = pipelineSummary?.live_mode ?? pipelineMode?.live_mode ?? false;
    const visiblePipelineSteps = useMemo(() => (
        pipelineSteps.filter(step => step.step !== 'sequence_enroll' || selectedFollowUpSequenceId !== null)
    ), [pipelineSteps, selectedFollowUpSequenceId]);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-background sm:border border-border/10 shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.5)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-5xl flex flex-col sm:max-h-[90vh] overflow-hidden"
            >
                {/* Header */}
                <div className="p-6 border-b border-border flex items-center justify-between bg-surface/10 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-background/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                            {activeTab === 'discovery' ? <Search size={24} className="relative z-10" /> : <Sparkles size={24} className="relative z-10" />}
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold tracking-tight text-foreground uppercase">
                                {activeTab === 'discovery' ? 'Find People' : 'Email Campaigns'}
                            </h2>
                            <p className="text-[11px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">
                                {activeTab === 'discovery' ? 'Find people who match your best customers' : 'Turn a request into emails and downloads'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Tab switcher */}
                        <div className="hidden sm:flex items-center rounded-xl border border-border/40 bg-surface/30 p-1 gap-1">
                            <button
                                type="button"
                                onClick={() => setActiveTab('discovery')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-[0.18em] transition-all ${activeTab === 'discovery' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                <Search size={11} /> Find
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('pipeline')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-[0.18em] transition-all ${activeTab === 'pipeline' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                <Zap size={11} /> Campaign
                            </button>
                        </div>
                        <button type="button" onClick={onClose} className="p-2.5 rounded-2xl hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Tab body */}
                {activeTab === 'discovery' ? (
                    <>
                        {/* ── Lead Discovery Tab ── */}
                        <div className="p-8 space-y-8 flex-1 overflow-y-auto custom-scrollbar">
                            {/* Product Selector */}
                            <div className="space-y-4">
                                <label className="text-[10px] font-normal uppercase tracking-[0.2em] text-muted-foreground ml-1">What are you selling?</label>
                                <div className="relative" ref={productDropdownRef}>
                                    <button
                                        type="button"
                                        onClick={() => setShowProductDropdown(!showProductDropdown)}
                                        className="w-full flex items-center justify-between bg-surface border border-border rounded-xl px-5 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium text-foreground cursor-pointer hover:border-border/80"
                                    >
                                        <span className={selectedProductKey ? 'text-foreground' : 'text-muted-foreground'}>
                                            {selectedProductKey ? products.find(p => p.product_key === selectedProductKey)?.display_name || selectedProductKey : 'I will describe it myself'}
                                        </span>
                                        <ChevronDown size={16} className={`text-muted-foreground transition-transform duration-300 ${showProductDropdown ? 'rotate-180' : ''}`} />
                                    </button>

                                    <AnimatePresence>
                                        {showProductDropdown && (
                                            <motion.div
                                                key="product-dropdown"
                                                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                                transition={{ duration: 0.15, ease: "easeOut" }}
                                                className="absolute top-full left-0 right-0 mt-2 bg-background border border-border rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] z-50 overflow-hidden backdrop-blur-xl"
                                            >
                                                <div className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setSelectedProductKey(''); setProductPreview(null); setIcp(''); setProductDescription(''); setListTag(''); setShowProductDropdown(false); }}
                                                        className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-between ${!selectedProductKey ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface hover:text-foreground'}`}
                                                    >
                                                        I will describe it myself
                                                        {!selectedProductKey && <Check size={16} />}
                                                    </button>
                                                    {products.map(p => (
                                                        <button
                                                            type="button"
                                                            key={p.product_key}
                                                            onClick={async () => {
                                                                setSelectedProductKey(p.product_key);
                                                                setShowProductDropdown(false);
                                                                if (p.display_name) setListTag(p.display_name);
                                                                if (user?.email) {
                                                                    try {
                                                                        const prod = await salesService.getProduct(p.product_key, user.email);
                                                                        setProductPreview(prod);
                                                                        setIcp(prod.icp_persona_description || '');
                                                                        setProductDescription(prod.product_description || '');
                                                                        if (prod.display_name) setListTag(prod.display_name);
                                                                    } catch { toast.error('Failed to load product details'); }
                                                                }
                                                            }}
                                                            className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-between ${selectedProductKey === p.product_key ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface'}`}
                                                        >
                                                            {p.display_name || p.product_key}
                                                            {selectedProductKey === p.product_key && <Check size={16} />}
                                                        </button>
                                                    ))}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {productPreview && (
                                    <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2">
                                        <span className="text-[10px] font-normal bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-lg uppercase tracking-widest shadow-sm">Target: {productPreview.icp_job_titles?.length || 0} Titles</span>
                                        <span className="text-[10px] font-normal bg-background border border-border px-3 py-1.5 rounded-lg text-muted-foreground uppercase tracking-widest shadow-sm">{productPreview.icp_locations?.join(', ') || 'Global'}</span>
                                        {productPreview.icp_industries?.slice(0, 2).map((ind: string) => (
                                            <span key={ind} className="text-[10px] font-normal bg-background border border-border px-3 py-1.5 rounded-lg text-muted-foreground uppercase tracking-widest shadow-sm">{ind}</span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-12 gap-6">
                                <div className="col-span-12 lg:col-span-8 space-y-4">
                                    <label className="text-[10px] font-normal uppercase tracking-[0.2em] text-muted-foreground ml-1">Who do you want to reach?</label>
                                    <textarea value={icp} onChange={e => setIcp(e.target.value)} placeholder="e.g. Founders at US SaaS companies with 50-200 employees..." className="w-full bg-surface border border-border rounded-xl px-4 sm:px-6 py-4 text-sm sm:text-[15px] font-normal focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background transition-all min-h-[120px] resize-none leading-relaxed" />
                                </div>
                                <div className="col-span-12 lg:col-span-4 space-y-4">
                                    <label className="text-[10px] font-normal uppercase tracking-[0.2em] text-muted-foreground ml-1">What should we offer them?</label>
                                    <textarea value={productDescription} onChange={e => setProductDescription(e.target.value)} placeholder="e.g. We help teams book more meetings with personalized outbound..." className="w-full bg-surface border border-border rounded-xl px-4 sm:px-6 py-4 text-sm sm:text-[13px] font-normal focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-background transition-all min-h-[120px] resize-none leading-relaxed" />
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-4 pt-2">
                                <div className="flex items-center gap-3">
                                    <label className="text-[10px] font-normal uppercase tracking-widest text-muted-foreground">How many people:</label>
                                    <input type="number" min={10} max={200} value={limit} onChange={e => setLimit(Math.max(10, Math.min(200, parseInt(e.target.value) || 10)))} className="w-20 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                                </div>
                                <button type="button" onClick={handleSearch} disabled={loading || !icp.trim()} className="bg-primary text-white font-semibold text-sm px-3 py-2 rounded-lg hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-primary/20">
                                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                                    Find People
                                </button>
                            </div>

                            {leads.length > 0 && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center justify-between px-1">
                                        <h3 className="text-sm font-normal uppercase tracking-widest text-foreground">People Found ({leads.length})</h3>
                                        <div className="flex items-center gap-4">
                                            {enrichingRows.size > 0 && (
                                                <span className="flex items-center gap-2 text-[10px] font-normal text-primary bg-primary/5 px-3 py-1.5 rounded-lg border border-primary/10">
                                                    <span className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block" />
                                                    Finding details for {enrichingRows.size} people...
                                                </span>
                                            )}
                                            {enrichingDone && enrichingRows.size === 0 && (
                                                <span className="text-[10px] font-normal text-success bg-success/5 px-3 py-1.5 rounded-lg border border-success/10">Details Ready</span>
                                            )}
                                            <div className="flex items-center gap-2 pr-2">
                                                <button type="button" onClick={() => setSelectedIds(new Set(leads.map(l => leadKey(l))))} className="text-[10px] text-primary hover:underline uppercase tracking-widest font-normal">Select All</button>
                                                <span className="w-1 h-1 rounded-full bg-border" />
                                                <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[10px] text-muted-foreground hover:text-foreground uppercase tracking-widest font-normal">None</button>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground font-normal uppercase tracking-widest">{selectedIds.size} selected</p>
                                        </div>
                                    </div>

                                    {parsedFilters && (
                                        <div className="p-5 rounded-2xl border border-border bg-surface/30 space-y-3">
                                            <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-muted-foreground/50">Search Summary</p>
                                            <div className="flex flex-wrap gap-2">
                                                {Object.entries(parsedFilters).filter(([, value]) => Array.isArray(value) && (value as any[]).length > 0).flatMap(([key, value]) => (value as string[]).map(item => (
                                                    <span key={`${key}-${item}`} className="text-[10px] font-normal bg-background border border-border px-3 py-1.5 rounded-lg text-primary shadow-sm">{key.replace(/_/g, ' ')}: <span className="text-foreground">{item}</span></span>
                                                )))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="border border-border rounded-lg overflow-hidden bg-background shadow-sm">
                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full text-[13px]">
                                                <thead className="bg-surface/50 border-b border-border">
                                                    <tr>
                                                        <th className="w-12 px-6 py-4"><div className="w-4" /></th>
                                                        <th className="text-left px-4 py-4 text-[10px] font-normal uppercase tracking-widest text-muted-foreground/60">Person</th>
                                                        <th className="text-left px-4 py-4 text-[10px] font-normal uppercase tracking-widest text-muted-foreground/60">Company</th>
                                                        <th className="text-center px-4 py-4 text-[10px] font-normal uppercase tracking-widest text-muted-foreground/60">Fit</th>
                                                        <th className="text-right px-6 py-4 text-[10px] font-normal uppercase tracking-widest text-muted-foreground/60">Email</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border">
                                                    {leads.map((l, i) => {
                                                        const isEnriching = enrichingRows.has(i);
                                                        const isSelected = selectedIds.has(leadKey(l));
                                                        return (
                                                            <tr key={leadKey(l) || i} className={`transition-colors cursor-pointer group ${isSelected ? 'bg-primary/[0.02]' : 'hover:bg-surface/30'}`} onClick={() => toggleSelect(l)}>
                                                                <td className="px-6 py-4 text-center">
                                                                    <div className={`w-5 h-5 rounded-lg border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20' : 'border-border bg-background group-hover:border-primary/30'}`}>
                                                                        {isSelected && <Check size={12} strokeWidth={4} />}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-4">
                                                                    <div className="flex flex-col">
                                                                        <span className="font-normal text-foreground group-hover:text-primary transition-colors">{l.contact_name}</span>
                                                                        <span className="text-[11px] text-muted-foreground font-normal">{l.role}</span>
                                                                        <div className="flex items-center gap-3 mt-1.5">
                                                                            {l.linkedin_url && <a href={l.linkedin_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-muted-foreground/40 hover:text-[#0077b5] transition-colors"><FaLinkedin size={12} /></a>}
                                                                            {l.twitter_handle && <a href={`https://x.com/${l.twitter_handle}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-muted-foreground/40 hover:text-sky-500 transition-colors"><FaTwitter size={12} /></a>}
                                                                            {l.contact_email && <span className="text-[10px] text-primary/60 font-normal tracking-tight">{l.contact_email}</span>}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-4">
                                                                    <div className="flex flex-col">
                                                                        <span className="font-normal text-foreground">{l.company}</span>
                                                                        <span className="text-[11px] text-muted-foreground">{l.company_location}</span>
                                                                        {l.company_industry && <span className="text-[10px] font-normal text-primary/40 uppercase tracking-widest mt-1">{l.company_industry}</span>}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-4 text-center">
                                                                    <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg font-normal text-[14px] ${l.icp_score > 85 ? 'text-emerald-500 bg-emerald-500/5 border border-emerald-500/10' : l.icp_score > 60 ? 'text-primary bg-primary/5 border border-primary/10' : 'text-muted-foreground bg-surface border border-border'}`}>{l.icp_score}</div>
                                                                </td>
                                                                <td className="p-4 text-right">
                                                                    {isEnriching ? (
                                                                        <span className="inline-flex items-center gap-2 text-[10px] font-normal text-primary/60 uppercase tracking-widest"><span className="w-2.5 h-2.5 rounded-full border-2 border-primary border-t-transparent animate-spin" /></span>
                                                                    ) : l.email_verified === 'valid' ? (
                                                                        <span className="text-[10px] font-normal bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-3 py-1 rounded-lg uppercase tracking-widest inline-flex items-center gap-1.5 shadow-sm shadow-emerald-500/5"><ShieldCheck size={12} /> Verified</span>
                                                                    ) : l.contact_email ? (
                                                                        <span className="text-[10px] w-fit font-normal bg-surface text-muted-foreground border border-border px-3 py-1 rounded-lg uppercase tracking-widest inline-flex items-center gap-1.5"><MailQuestion size={12} /> Check</span>
                                                                    ) : (
                                                                        <span className="text-[10px] w-fit font-normal bg-red-500/5 text-red-500/60 border border-red-500/10 px-3 py-1 rounded-lg uppercase tracking-widest inline-flex items-center gap-1.5"><AlertCircle size={12} /> No Email</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {duplicates.length > 0 && (
                            <div className="mx-6 mb-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex flex-col gap-3 shrink-0">
                                <div className="flex items-start gap-2.5">
                                    <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <h4 className="text-[12px] font-bold text-amber-500 uppercase tracking-widest leading-none mb-1">Similar Contacts Found</h4>
                                        <p className="text-[11px] text-muted-foreground leading-normal">Someone on your team already has these companies in their list:</p>
                                    </div>
                                </div>
                                <div className="max-h-24 overflow-y-auto space-y-1.5 pl-7">
                                    {duplicates.map((dup, idx) => (
                                        <div key={idx} className="flex justify-between items-center text-[10px] bg-background/50 px-2.5 py-1.5 rounded border border-border/20">
                                            <span className="font-semibold text-foreground uppercase tracking-wider">{dup.company} ({dup.contact_name})</span>
                                            <span className="text-muted-foreground uppercase tracking-widest text-[9px]">Owned by: {dup.owned_by}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 pl-7 pt-1 border-t border-border/5">
                                    <input type="checkbox" id="ignore-dup-checkbox" checked={ignoreDuplicates} onChange={e => setIgnoreDuplicates(e.target.checked)} className="w-3.5 h-3.5 rounded border-border bg-surface text-primary focus:ring-0 focus:ring-offset-0 cursor-pointer" />
                                    <label htmlFor="ignore-dup-checkbox" className="text-[10px] font-semibold text-foreground uppercase tracking-widest cursor-pointer select-none">Save anyway, I understand this may create duplicates</label>
                                </div>
                            </div>
                        )}

                        <div className="p-6 border-t border-border flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between bg-surface/5 shrink-0">
                            <div className="flex flex-wrap items-center gap-3.5 flex-1 max-w-xl">
                                <div className="flex items-center gap-2 bg-surface/40 border border-border/40 px-3 py-1.5 rounded-lg focus-within:border-primary/40 transition-all flex-1 min-w-[140px]">
                                    <Tag size={12} className="text-muted-foreground/40 shrink-0" />
                                    <input type="text" placeholder="Group name (e.g. Retail I)" value={listTag} onChange={e => setListTag(e.target.value)} className="w-full bg-transparent border-0 p-0 text-[11px] font-bold uppercase tracking-widest text-foreground focus:ring-0 focus:outline-none placeholder:text-muted-foreground/30" />
                                </div>
                                <div className="flex items-center gap-2 bg-surface/40 border border-border/40 px-3 py-1.5 rounded-lg focus-within:border-primary/40 transition-all flex-1 min-w-[140px]">
                                    <Globe size={12} className="text-muted-foreground/40 shrink-0" />
                                    <input type="text" placeholder="Location (e.g. Germany)" value={geoTag} onChange={e => setGeoTag(e.target.value)} className="w-full bg-transparent border-0 p-0 text-[11px] font-bold uppercase tracking-widest text-foreground focus:ring-0 focus:outline-none placeholder:text-muted-foreground/30" />
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-4 shrink-0">
                                <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-normal text-muted-foreground hover:text-foreground transition-all">Cancel</button>
                                <button type="button" onClick={handleSave} disabled={selectedIds.size === 0 || saving || (duplicates.length > 0 && !ignoreDuplicates)} className="bg-primary text-white font-semibold text-sm px-4 py-2 rounded-lg hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-primary/20">
                                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                                    {duplicates.length > 0 && ignoreDuplicates ? 'Save Anyway' : `Save ${selectedIds.size} People`}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {/* ── Pipeline Console Tab ── */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {/* Mode header */}
                            <div className="border-b border-border/15 px-5 py-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between shrink-0">
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground max-w-2xl">Tell the assistant who to find and what email to prepare. It can save people, write emails, send them, and add follow-ups.</p>
                                </div>
                                <div className="flex flex-col items-start lg:items-end gap-2">
                                    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${pipelineMode?.live_mode ? 'border-red-500/25 bg-red-500/10 text-red-500' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500'}`}>
                                        {isModeLoading ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                                        {pipelineMode?.live_mode ? 'Real Emails' : 'Test Emails'}
                                    </span>
                                    <div className="flex items-center gap-3">
                                        <button type="button" disabled={isModeLoading || isPipelineRunning} onClick={() => handlePipelineModeChange(false)} className={`rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-all ${pipelineMode?.live_mode === false ? 'bg-emerald-500 text-white shadow-sm' : 'bg-surface border border-border/40 text-muted-foreground hover:text-foreground'}`}>Test Emails</button>
                                        <button type="button" disabled={isModeLoading || isPipelineRunning} onClick={() => handlePipelineModeChange(true)} className={`rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-all ${pipelineMode?.live_mode ? 'bg-red-500 text-white shadow-sm' : 'bg-surface border border-border/40 text-muted-foreground hover:text-foreground'}`}>Real Emails</button>
                                    </div>
                                    <p className={`text-xs max-w-sm text-right ${pipelineMode?.live_mode ? 'text-red-500/80' : 'text-emerald-600/80'}`}>
                                        {pipelineMode?.live_mode ? (pipelineMode.warning || 'Real email sending is ON. People may receive emails.') : 'Emails will only go to your test addresses in test mode.'}
                                    </p>
                                </div>
                            </div>

                            <div className="p-5 space-y-4">
                                {/* Prompt + run */}
                                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">What should the assistant do?</label>
                                        <textarea value={pipelinePrompt} onChange={e => setPipelinePrompt(e.target.value)} placeholder="Find 50 PR agency founders in India for EBIC and send the first email" rows={3} className="w-full resize-none rounded-2xl border border-border/40 bg-surface/40 px-4 py-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/40 focus:border-primary/40" />
                                    </div>
                                    <div className="flex flex-col justify-between gap-3">
                                        <div className="rounded-2xl border border-border/40 bg-surface/30 p-4">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Email sending</p>
                                            <p className="mt-2 text-lg font-semibold text-foreground">{pipelineMode?.live_mode ? 'REAL' : 'TEST'}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">{pipelineMode?.label || 'Loading pipeline mode...'}</p>
                                        </div>
                                        <button onClick={() => void handleRunPipeline()} disabled={isPipelineRunning || isModeLoading || !user?.email} className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] text-white transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50">
                                            {isPipelineRunning ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                                            {isPipelineRunning ? 'Working' : 'Start'}
                                        </button>
                                    </div>
                                </div>

                                {/* Test recipients */}
                                {!pipelineMode?.live_mode && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Send test emails to</label>
                                        <input type="text" value={testRecipientsInput} onChange={e => setTestRecipientsInput(e.target.value)} placeholder="founder@yourcompany.com, ops@yourcompany.com" className="w-full rounded-2xl border border-border/40 bg-surface/35 px-4 py-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/40 focus:border-primary/40" />
                                        <p className="text-xs text-muted-foreground">Add internal email addresses separated by commas. In test mode, only these inboxes receive emails.</p>
                                    </div>
                                )}

                                {/* Advanced (product + sequence) */}
                                <div className="rounded-2xl border border-border/30 bg-surface/20 overflow-hidden">
                                    <button type="button" onClick={() => setShowAdvanced(prev => !prev)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">More options</p>
                                            <p className="text-xs text-muted-foreground mt-1">Choose a product and optional follow-up emails.</p>
                                        </div>
                                        <ChevronDown size={16} className={`text-muted-foreground transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {showAdvanced && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-border/20">
                                                <div className="grid gap-4 p-4 md:grid-cols-2">
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Product</label>
                                                        <select value={selectedPipelineProductKey || ''} onChange={e => setSelectedPipelineProductKey(e.target.value || null)} className="w-full rounded-2xl border border-border/40 bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary/40">
                                                            <option value="">Use prompt / backend default</option>
                                                            {products.map(product => (
                                                                <option key={product.product_key} value={product.product_key}>{product.display_name || product.product_key}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Follow-up emails</label>
                                                        <select value={selectedFollowUpSequenceId ?? ''} onChange={e => setSelectedFollowUpSequenceId(e.target.value ? Number(e.target.value) : null)} className="w-full rounded-2xl border border-border/40 bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary/40">
                                                            <option value="">No auto-enrollment</option>
                                                            {sequences.map(seq => <option key={seq.id} value={seq.id}>{seq.name}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Pipeline Visualizer */}
                                {(isPipelineRunning || pipelineEvents.length > 0) && !pipelineDecisionPending && (
                                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                                        <div className="rounded-[24px] border border-border/30 bg-surface/20 p-4">
                                            <div className="flex items-center justify-between gap-3 mb-4">
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Progress</p>
                                                    <p className="text-sm text-foreground font-semibold mt-1">Watching each step complete</p>
                                                </div>
                                                {isPipelineRunning && (
                                                    <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                                                        <Loader2 size={12} className="animate-spin" /> Working
                                                    </span>
                                                )}
                                            </div>
                                            <div className="space-y-3">
                                                {visiblePipelineSteps.map(step => {
                                                    const isDone = step.status === 'done';
                                                    const isError = step.status === 'error';
                                                    const isRunning = step.status === 'running';
                                                    const isSkipped = step.status === 'skipped';
                                                    return (
                                                        <div key={step.step} className={`rounded-2xl border px-4 py-3 transition-all ${isError ? 'border-red-500/20 bg-red-500/5' : isDone ? 'border-emerald-500/20 bg-emerald-500/5' : isRunning ? 'border-primary/25 bg-primary/5' : isSkipped ? 'border-border/20 bg-surface/20 opacity-80' : 'border-border/20 bg-background/50'}`}>
                                                            <div className="flex items-start gap-3">
                                                                <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border ${isError ? 'border-red-500/20 bg-red-500/10 text-red-500' : isDone ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500' : isRunning ? 'border-primary/20 bg-primary/10 text-primary' : 'border-border/30 bg-surface text-muted-foreground'}`}>
                                                                    {isRunning ? <Loader2 size={14} className="animate-spin" /> : isError ? <AlertCircle size={14} /> : isDone ? <CheckCircle2 size={14} /> : isSkipped ? <Clock size={14} /> : <ChevronRight size={14} />}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <p className="text-sm font-semibold text-foreground">{step.label}</p>
                                                                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{step.status}</span>
                                                                    </div>
                                                                    <p className={`mt-1 text-sm ${isError ? 'text-red-500/85' : 'text-muted-foreground'}`}>{step.message || 'Waiting to start'}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {pipelineSummary && (
                                            <div className="rounded-[24px] border border-border/30 bg-background/85 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Results</p>
                                                        <p className="mt-1 text-base font-semibold text-foreground">Campaign ready to review</p>
                                                    </div>
                                                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${pipelineSummaryModeLive ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                                        {pipelineSummaryModeLive ? 'REAL' : 'TEST'}
                                                    </span>
                                                </div>
                                                <div className="mt-4 space-y-3">
                                                    {[
                                                        { label: 'People found', value: pipelineSummary.leads_found },
                                                        { label: 'People saved', value: pipelineSummary.contacts_created ?? pipelineSummary.contacts_saved },
                                                        { label: 'Emails sent', value: pipelineSummary.emails_sent },
                                                        { label: 'Email campaign', value: createdCampaignName || pipelineSummary.campaign_name || (createdCampaignId ? `#${createdCampaignId}` : undefined) },
                                                    ].map(({ label, value }) => (
                                                        <div key={label} className="flex items-center justify-between text-sm">
                                                            <span className="text-muted-foreground">{label}</span>
                                                            <span className="font-semibold text-foreground text-right break-all">{value ?? '-'}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Decision Required Panel */}
                                {pipelineDecisionPending && pipelineDecisionCounts && (
                                    <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center"><AlertCircle size={18} className="text-amber-500" /></div>
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">Choose Next Step</p>
                                                    <p className="text-sm font-semibold text-foreground mt-0.5">How do you want to proceed?</p>
                                                </div>
                                            </div>
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600 shrink-0"><Clock size={11} /> Expires in 30 min</span>
                                        </div>

                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="rounded-2xl border border-border/30 bg-background/60 p-3 text-center">
                                                <p className="text-xl font-bold text-foreground">{pipelineDecisionCounts.total}</p>
                                                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">Total People</p>
                                            </div>
                                            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                                                <p className="text-xl font-bold text-emerald-500">{pipelineDecisionCounts.with_email}</p>
                                                <p className="text-[10px] text-emerald-600/80 uppercase tracking-widest mt-0.5">Email Found</p>
                                            </div>
                                            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3 text-center">
                                                <p className="text-xl font-bold text-red-500">{pipelineDecisionCounts.no_email}</p>
                                                <p className="text-[10px] text-red-500/80 uppercase tracking-widest mt-0.5">No Email</p>
                                            </div>
                                        </div>

                                        {pipelineDecisionContacts.length > 0 && (
                                            <div className="rounded-2xl border border-border/20 bg-background/50 overflow-hidden">
                                                <div className="px-4 py-2 border-b border-border/10"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Lead Preview</p></div>
                                                <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                    {pipelineDecisionContacts.slice(0, 20).map((contact: any, idx: number) => (
                                                        <div key={idx} className="flex items-center justify-between px-4 py-2.5 border-b border-border/10 last:border-0">
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-xs font-semibold text-foreground truncate">{contact.full_name || contact.name || `Lead ${idx + 1}`}</p>
                                                                <p className="text-[10px] text-muted-foreground truncate">{contact.company || contact.company_name || ''}</p>
                                                            </div>
                                                            <span className={`ml-3 shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${contact.has_email ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                                                                <Mail size={9} />{contact.has_email ? 'Has Email' : 'No Email'}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <button type="button" onClick={() => void handleSelectDecision('send_with_email_export_rest')} className="flex flex-col items-start gap-1.5 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3.5 text-left transition-all hover:border-primary/50 hover:bg-primary/10 active:scale-[0.98]">
                                                <div className="flex items-center gap-2"><Send size={14} className="text-primary" /><p className="text-sm font-bold text-foreground">Send Emails + Download Rest</p></div>
                                                <p className="text-[11px] text-muted-foreground">Send emails to {pipelineDecisionCounts.with_email} people and download {pipelineDecisionCounts.no_email} people without emails</p>
                                            </button>
                                            <button type="button" onClick={() => void handleSelectDecision('export_all')} className="flex flex-col items-start gap-1.5 rounded-2xl border border-border/30 bg-surface/30 px-4 py-3.5 text-left transition-all hover:border-border/60 hover:bg-surface/60 active:scale-[0.98]">
                                                <div className="flex items-center gap-2"><FileUp size={14} className="text-muted-foreground" /><p className="text-sm font-bold text-foreground">Download All</p></div>
                                                <p className="text-[11px] text-muted-foreground">Download all {pipelineDecisionCounts.total} people and do not send emails</p>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* CSV Download Buttons */}
                                {pipelineCompleteJobId && (
                                    <div className="rounded-[24px] border border-emerald-500/25 bg-emerald-500/5 p-5 space-y-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center"><CheckCircle2 size={16} className="text-emerald-500" /></div>
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Downloads Ready</p>
                                                <p className="text-xs text-muted-foreground mt-0.5">Download your people lists below</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-3">
                                            {pipelineCompleteDecision === 'send_with_email_export_rest' && noEmailLeadsCount > 0 && (
                                                <button type="button" onClick={() => downloadCSV(pipelineCompleteJobId!, 'no_email')} className="inline-flex items-center gap-2 rounded-2xl border border-border/40 bg-background/80 px-4 py-2.5 text-sm font-semibold text-foreground transition-all hover:border-primary/30 hover:text-primary">
                                                    <FileUp size={14} /> Download {noEmailLeadsCount} people without email
                                                </button>
                                            )}
                                            {pipelineCompleteDecision === 'export_all' && (
                                                <button type="button" onClick={() => downloadCSV(pipelineCompleteJobId!, 'all')} className="inline-flex items-center gap-2 rounded-2xl border border-border/40 bg-background/80 px-4 py-2.5 text-sm font-semibold text-foreground transition-all hover:border-primary/30 hover:text-primary">
                                                    <FileUp size={14} /> Download all people
                                                </button>
                                            )}
                                            {pipelineCompleteDecision === 'send_with_email_export_rest' && pipelineDecisionCounts && pipelineDecisionCounts.with_email > 0 && (
                                                <button type="button" onClick={() => downloadCSV(pipelineCompleteJobId!, 'with_email')} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-600 transition-all hover:bg-emerald-500/20">
                                                    <Mail size={14} /> Download {pipelineDecisionCounts.with_email} emailed people
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-border/20 shrink-0 bg-surface/5">
                            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-all">Close</button>
                        </div>
                    </>
                )}
            </motion.div>
        </div>
    );
}
