"use client";
import Link from 'next/link';
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mail, Users, Zap, BarChart3, Search, Plus, Send, Eye,
    MousePointer2, Loader2, RefreshCcw, X, ChevronRight,
    Clock, Sparkles, AlertCircle, CheckCircle2, Trash2, ChevronLeft,
    UserPlus, Wand2, Check, ArrowRight, Upload, FileUp,
    Activity, Newspaper, Briefcase, CircleDollarSign,
    MessageCircle, Github, TrendingUp, ExternalLink,
    BookOpen, Globe, Cpu, User, Flame, Thermometer, Wind,
    Target, Info, AlertTriangle, PenTool, MessageSquare,
    Link2, MailCheck, MailQuestion, ShieldCheck, ShieldAlert,
    EllipsisVertical, Download,
    Pencil,
    Hash,
    ChevronDown,
    Tag,
    Layers,
    ArrowLeft,
    History,
    RotateCcw,
    MessageSquareQuote,
    Calendar,
    Linkedin,
    Building2,
    Award,
    Package,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
    salesService, Lead, Campaign, Signal, NextAction,
    CreateLeadPayload, CampaignRecipient, Sequence, SequenceStep, SequenceEnrollment,
    BulkValidateResult, ObjectionResult, PipelineMode, PipelineEvent, PipelineStepState, PipelineRunSummary,
} from '@/services/sales.service';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { ConfirmationModal } from '@/components/shared/ConfirmationModal';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';


// ── Extracted Components ────────────────────────────────────────────────────────
import { useOutreachStore } from '@/store/outreachStore';
import { NewLeadModal } from './components/NewLeadModal';
import { BulkImportModal } from './components/BulkImportModal';
import { NewCampaignModal } from './components/NewCampaignModal';
import { LeadTimezoneCell } from './components/LeadTimezoneCell';
import { CampaignDetailModal } from './components/CampaignDetailModal';
import { NextActionPanel, SignalHistoryPanel } from './components/ActionPanels';
import { LeadRow, LeadRowSkeleton, LeadCard } from './components/LeadRow';
import { Skeleton } from './components/LeadRow';
import { SequenceBuilderModal } from './components/SequenceBuilderModal';
import { EnrollSequenceModal } from './components/EnrollSequenceModal';
import { SequenceDetailModal } from './components/SequenceDetailModal';
import { ObjectionModal } from './components/ObjectionModal';
import { LeadFinderModal } from './components/LeadFinderModal';
import { DossierModal } from './components/DossierModal';
import { EscalationPanel, ReengagementPanel } from './components/SidePanels';
import { AddProductModal } from './components/AddProductModal';

const LIVE_CONFIRMATION_TEXT = 'I understand this will send real emails';
const PIPELINE_STEP_ORDER = [
    { step: 'parse', label: 'Prompt parsed' },
    { step: 'find_leads', label: 'Finding leads' },
    { step: 'save_leads', label: 'Saved to CRM' },
    { step: 'enrich', label: 'Enriching contacts' },
    { step: 'email_gen', label: 'Generating emails' },
    { step: 'create_campaign', label: 'Campaign created' },
    { step: 'send', label: 'Sending' },
    { step: 'sequence_enroll', label: 'Follow-up sequence' },
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
    if (!params) return 'Ready to parse your outreach instructions.';
    const product = params.product_key ? String(params.product_key).toUpperCase() : null;
    const locations = Array.isArray(params.locations) ? params.locations.filter(Boolean).join(', ') : '';
    const titles = Array.isArray(params.job_titles) ? params.job_titles.filter(Boolean).join(', ') : '';
    const emailNumber = params.email_number ? `Email ${params.email_number}` : '';
    return [product, locations, titles, emailNumber].filter(Boolean).join(' • ') || 'Prompt parsed.';
}

function getPipelineStepMessage(step: string, event: PipelineEvent): string {
    if (step === 'parse' && event.status === 'done') {
        return formatParsedPrompt(event.data?.params);
    }
    if (step === 'find_leads' && event.status === 'done' && typeof event.data?.count === 'number') {
        return `${event.data.count} leads discovered`;
    }
    if (step === 'save_leads' && event.status === 'done') {
        const created = typeof event.data?.created === 'number' ? event.data.created : '-';
        const skipped = typeof event.data?.skipped === 'number' ? event.data.skipped : '-';
        return `${created} new contacts, ${skipped} skipped`;
    }
    if (step === 'enrich' && event.status === 'done') {
        const enriched = typeof event.data?.enriched === 'number' ? event.data.enriched : '-';
        const total = typeof event.data?.total === 'number' ? event.data.total : null;
        return total ? `${enriched}/${total} contacts enriched` : `${enriched} contacts enriched`;
    }
    if (step === 'email_gen' && event.status === 'done' && typeof event.data?.count === 'number') {
        return `${event.data.count} personalized emails ready`;
    }
    if (step === 'create_campaign' && event.status === 'done') {
        return event.data?.name ? `"${event.data.name}"` : event.message;
    }
    if (step === 'send' && event.status === 'done') {
        const sent = typeof event.data?.sent === 'number' ? event.data.sent : '-';
        const failed = typeof event.data?.failed === 'number' ? event.data.failed : '-';
        return `${sent} sent, ${failed} failed`;
    }
    if (step === 'sequence_enroll' && event.status === 'done' && typeof event.data?.enrolled === 'number') {
        return `${event.data.enrolled} recipients enrolled`;
    }
    if (step === 'pipeline_complete' && event.status === 'done') {
        const sent = typeof event.data?.emails_sent === 'number' ? event.data.emails_sent : '-';
        return `${sent} emails sent`;
    }
    return event.message || '';
}

function mergePipelineSummary(current: PipelineRunSummary | null, event: PipelineEvent): PipelineRunSummary | null {
    const next: PipelineRunSummary = { ...(current || {}) };

    if (event.step === 'find_leads' && typeof event.data?.count === 'number') {
        next.leads_found = event.data.count;
    }
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

export default function OutreachPage() {
    const { user } = useAuth();
    const {
        leads, campaigns, globalSignals, isLoading, fetchData, fetchLeads,
        addLead, addLeads, updateLead, removeLead, removeLeads, addCampaign,
        refreshLead, campaignTags, selectedTag, setSelectedTag, fetchTags, fetchCampaigns,
        selectedContactCampaignId, selectedContactTag,
        selectedContactListTag, selectedContactGeoTag, setSelectedContactListTag, setSelectedContactGeoTag,
        availableListTags, availableGeoTags,
        escalations, reengagementEntries, sequences, fetchEscalations, fetchReengagement, fetchSequences,
        addSequence, updateSequence,
        products, fetchProducts,
        selectedProductFilter, setSelectedProductFilter,
        selectedContactProductKey, setSelectedContactProductKey,
    } = useOutreachStore();

    const [isRefreshing, setIsRefreshing] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showNewLead, setShowNewLead] = useState(false);
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [showNewCampaign, setShowNewCampaign] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
    const [nextActionLead, setNextActionLead] = useState<Lead | null>(null);
    const [historyLead, setHistoryLead] = useState<Lead | null>(null);
    const [showLeadFinder, setShowLeadFinder] = useState(false);
    const [dossierLead, setDossierLead] = useState<Lead | null>(null);
    const [objectionLead, setObjectionLead] = useState<Lead | null>(null);
    const [isDeletingLead, setIsDeletingLead] = useState(false);
    const [leadToDelete, setLeadToDelete] = useState<number | null>(null);
    const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
    const [selectedSequence, setSelectedSequence] = useState<Sequence | null>(null);
    const [showNewSequence, setShowNewSequence] = useState(false);
    const [showEnrollSequence, setShowEnrollSequence] = useState(false);
    const [showBulkTag, setShowBulkTag] = useState(false);
    const [bulkListTagInput, setBulkListTagInput] = useState('');
    const [bulkGeoTagInput, setBulkGeoTagInput] = useState('');
    const bulkTagRef = useRef<HTMLDivElement>(null);
    const [isBulkEnriching, setIsBulkEnriching] = useState(false);
    const [isExportingCsv, setIsExportingCsv] = useState(false);
    const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
    const [contactFilter, setContactFilter] = useState<'all' | 'contacted' | 'no_reply' | 'new'>('all');
    const [sidebarTab, setSidebarTab] = useState<'outreach' | 'followups' | 'objections' | 'escalations' | 'reengagement'>('outreach');
    const [showTagMenu, setShowTagMenu] = useState(false);
    const [showListTagMenu, setShowListTagMenu] = useState(false);
    const [showGeoTagMenu, setShowGeoTagMenu] = useState(false);
    const [showProductFilterMenu, setShowProductFilterMenu] = useState(false);
    const [showContactProductMenu, setShowContactProductMenu] = useState(false);
    const [showAddProduct, setShowAddProduct] = useState(false);
    const [pipelinePrompt, setPipelinePrompt] = useState('');
    const [pipelineMode, setPipelineMode] = useState<PipelineMode | null>(null);
    const [isModeLoading, setIsModeLoading] = useState(false);
    const [showLiveConfirmModal, setShowLiveConfirmModal] = useState(false);
    const [liveConfirmText, setLiveConfirmText] = useState('');
    const [testRecipientsInput, setTestRecipientsInput] = useState('');
    const [selectedFollowUpSequenceId, setSelectedFollowUpSequenceId] = useState<number | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [selectedPipelineProductKey, setSelectedPipelineProductKey] = useState<string | null>(null);
    const [isPipelineRunning, setIsPipelineRunning] = useState(false);
    const [pipelineSteps, setPipelineSteps] = useState<PipelineStepState[]>(createInitialPipelineSteps);
    const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);
    const [pipelineSummary, setPipelineSummary] = useState<PipelineRunSummary | null>(null);
    const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);
    const [createdCampaignName, setCreatedCampaignName] = useState<string | null>(null);
    const pipelineRunRef = useRef<AbortController | null>(null);
    const [pipelineJobId, setPipelineJobId] = useState<string | null>(null);
    const [pipelineDecisionPending, setPipelineDecisionPending] = useState<boolean>(false);
    const [pipelineDecisionContacts, setPipelineDecisionContacts] = useState<any[]>([]);
    const [pipelineDecisionCounts, setPipelineDecisionCounts] = useState<{ with_email: number; no_email: number; total: number } | null>(null);
    const [pipelineCompleteJobId, setPipelineCompleteJobId] = useState<string | null>(null);
    const [pipelineCompleteDecision, setPipelineCompleteDecision] = useState<string | null>(null);
    const [noEmailLeadsCount, setNoEmailLeadsCount] = useState<number>(0);
    const [campaignRecipients, setCampaignRecipients] = useState<Lead[]>([]);
    const tagMenuRef = useRef<HTMLDivElement>(null);
    const listTagMenuRef = useRef<HTMLDivElement>(null);
    const geoTagMenuRef = useRef<HTMLDivElement>(null);
    const productFilterMenuRef = useRef<HTMLDivElement>(null);
    const contactProductMenuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
                setShowTagMenu(false);
            }
            if (listTagMenuRef.current && !listTagMenuRef.current.contains(e.target as Node)) {
                setShowListTagMenu(false);
            }
            if (geoTagMenuRef.current && !geoTagMenuRef.current.contains(e.target as Node)) {
                setShowGeoTagMenu(false);
            }
            if (productFilterMenuRef.current && !productFilterMenuRef.current.contains(e.target as Node)) {
                setShowProductFilterMenu(false);
            }
            if (contactProductMenuRef.current && !contactProductMenuRef.current.contains(e.target as Node)) {
                setShowContactProductMenu(false);
            }
            if (bulkTagRef.current && !bulkTagRef.current.contains(e.target as Node)) {
                setShowBulkTag(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Initial load - fetch everything once
    useEffect(() => {
        if (user?.email) {
            fetchData(user.email).catch(() => toast.error('Failed to load outreach data'));
            fetchEscalations(user.email);
            fetchReengagement(user.email);
        }
    }, [user?.email, fetchData, fetchEscalations, fetchReengagement]);

    useEffect(() => {
        if (!user?.email) return;
        setIsModeLoading(true);
        salesService.getPipelineMode()
            .then((mode) => setPipelineMode(mode))
            .catch(() => toast.error('Failed to load pipeline mode'))
            .finally(() => setIsModeLoading(false));
    }, [user?.email]);

    useEffect(() => {
        if (pipelineMode?.live_mode === false && !testRecipientsInput.trim() && user?.email) {
            setTestRecipientsInput(user.email);
        }
    }, [pipelineMode?.live_mode, testRecipientsInput, user?.email]);

    // Re-fetch contacts when project filter changes (skip on mount - fetchData already loaded them)
    const isFirstContactFilterRender = React.useRef(true);
    useEffect(() => {
        if (isFirstContactFilterRender.current) { isFirstContactFilterRender.current = false; return; }
        if (user?.email) fetchLeads(user.email, selectedContactCampaignId, selectedContactTag);
    }, [selectedContactCampaignId, selectedContactTag]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch campaigns when tag filter changes (skip on mount - fetchData already loaded them)
    const isFirstTagRender = React.useRef(true);
    useEffect(() => {
        if (isFirstTagRender.current) { isFirstTagRender.current = false; return; }
        if (user?.email) fetchCampaigns(user.email, selectedTag);
    }, [selectedTag]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch campaigns when product filter changes
    const isFirstProductFilterRender = React.useRef(true);
    useEffect(() => {
        if (isFirstProductFilterRender.current) { isFirstProductFilterRender.current = false; return; }
        if (user?.email) fetchCampaigns(user.email, selectedTag);
    }, [selectedProductFilter]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch contacts when contact product filter changes
    const isFirstContactProductRender = React.useRef(true);
    useEffect(() => {
        if (isFirstContactProductRender.current) { isFirstContactProductRender.current = false; return; }
        if (user?.email) fetchLeads(user.email, selectedContactCampaignId, selectedContactTag);
    }, [selectedContactProductKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreateLead = async (payload: CreateLeadPayload) => {
        if (!user?.email) return;
        try {
            const newLead = await salesService.createLead(user.email, payload);
            addLead(newLead);
            toast.success(`${newLead.contact_name} added to leads`);
        } catch {
            toast.error('Failed to add lead');
            throw new Error('failed');
        }
    };


    const handleRefreshLead = async (leadId: number) => {
        if (!user?.email) return;
        setIsRefreshing(leadId);
        try {
            const { new_signals } = await refreshLead(leadId, user.email);
            toast.success(`${new_signals} new signal${new_signals !== 1 ? 's' : ''} collected`);
        } catch {
            toast.error('Refresh failed');
        } finally {
            setIsRefreshing(null);
        }
    };

    const handleDeleteLead = async (leadId: number) => {
        if (!user?.email) return;
        setIsDeletingLead(true);
        try {
            await salesService.deleteLead(leadId, user.email);
            removeLead(leadId);
            toast.success('Lead removed');
        } catch {
            toast.error('Delete failed');
        } finally {
            setIsDeletingLead(false);
            setLeadToDelete(null);
        }
    };

    const handleEnrichLead = async (leadId: number) => {
        if (!user?.email) return;
        updateLead(leadId, { enrichment_status: 'pending' });
        try {
            const updated = await salesService.enrichContact(leadId, user.email);
            updateLead(leadId, updated);
            toast.success(`Enriched with ${updated.new_signals} new signals`);
        } catch {
            updateLead(leadId, { enrichment_status: 'failed' });
            toast.error('Enrichment failed');
        }
    };

    const handleBulkDelete = async () => {
        if (!user?.email || selectedLeadIds.size === 0) return;
        const ids = Array.from(selectedLeadIds);
        if (!confirm(`Are you sure you want to remove ${ids.length} contacts?`)) return;

        try {
            await salesService.bulkDeleteLeads(user.email, ids);
            removeLeads(ids);
            setSelectedLeadIds(new Set());
            toast.success(`${ids.length} contacts removed`);
        } catch {
            toast.error('Bulk removal failed');
        }
    };

    const handleCampaignCreated = (campaign: Campaign) => {
        addCampaign(campaign);
        if (user?.email) {
            fetchTags(user.email);
            fetchData(user.email);
        }
    };

    const toggleLeadSelection = (leadId: number) => {
        setSelectedLeadIds((prev) => {
            const next = new Set(prev);
            if (next.has(leadId)) next.delete(leadId);
            else next.add(leadId);
            return next;
        });
    };

    const clearSelectedLeads = () => setSelectedLeadIds(new Set());

    const filteredLeads = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return leads.filter(l => {
            const matchesSearch = l.contact_name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q);
            if (!matchesSearch) return false;
            if (selectedContactListTag && l.list_tag !== selectedContactListTag) return false;
            if (selectedContactGeoTag && l.geo_tag !== selectedContactGeoTag) return false;
            if (contactFilter === 'contacted') return !!l.last_contacted_at;
            if (contactFilter === 'no_reply') return !!l.last_contacted_at && !l.last_signal_at;
            if (contactFilter === 'new') return !l.last_contacted_at;
            return true;
        });
    }, [leads, searchQuery, contactFilter, selectedContactListTag, selectedContactGeoTag]);

    const selectedLeads = useMemo(
        () => leads.filter((lead) => selectedLeadIds.has(lead.id)),
        [leads, selectedLeadIds]
    );
    const visibleSelectedCount = useMemo(
        () => filteredLeads.filter((lead) => selectedLeadIds.has(lead.id)).length,
        [filteredLeads, selectedLeadIds]
    );
    const hasSearch = searchQuery.trim().length > 0;
    const allVisibleSelected = filteredLeads.length > 0 && visibleSelectedCount === filteredLeads.length;

    const contactFilterCounts = useMemo(() => ({
        all: leads.length,
        contacted: leads.filter(l => !!l.last_contacted_at).length,
        no_reply: leads.filter(l => !!l.last_contacted_at && !l.last_signal_at).length,
        new: leads.filter(l => !l.last_contacted_at).length,
    }), [leads]);

    const hotLeads = useMemo(() =>
        [...leads].sort((a, b) => (b.intent_score ?? 0) - (a.intent_score ?? 0)).slice(0, 3),
        [leads]);


    const stats = useMemo(() => {
        const avgScore = leads.length > 0
            ? Math.round(leads.reduce((acc, l) => acc + (l.intent_score ?? 0), 0) / leads.length) : 0;
        const avgOpenRate = campaigns.length > 0
            ? (campaigns.reduce((acc, c) => acc + c.open_rate, 0) / campaigns.length).toFixed(1) : '0';
        const activeCampaigns = campaigns.filter(c => c.status === 'sending' || c.status === 'sent').length;
        return [
            { label: 'People', value: leads.length.toString(), icon: Users, color: 'text-primary' },
            { label: 'Interest Level', value: avgScore.toString(), icon: Flame, color: 'text-warning' },
            { label: 'Emails Opened', value: `${avgOpenRate}%`, icon: Eye, color: 'text-success' },
            { label: 'Email Groups', value: activeCampaigns.toString(), icon: Send, color: 'text-primary' },
        ];
    }, [leads, campaigns]);

    const handleCallNext = () => {
        if (hotLeads.length > 0) {
            toast.info(`Initiating AI Voice Dial for ${hotLeads[0].contact_name}...`);
        } else {
            toast.error("No high-intent leads available.");
        }
    };

    const handleBulkTag = async () => {
        if (!user?.email || selectedLeads.length === 0) return;
        if (bulkListTagInput === '' && bulkGeoTagInput === '') {
            toast.error('Enter at least one tag to apply');
            return;
        }
        const ids = selectedLeads.map(l => l.id);
        try {
            await salesService.bulkTagContacts(
                user.email, ids,
                bulkListTagInput !== '' ? (bulkListTagInput.trim() || null) : undefined,
                bulkGeoTagInput !== '' ? (bulkGeoTagInput.trim() || null) : undefined,
            );
            ids.forEach(id => {
                const upd: Partial<Lead> = {};
                if (bulkListTagInput !== '') upd.list_tag = bulkListTagInput.trim() || null;
                if (bulkGeoTagInput !== '') upd.geo_tag = bulkGeoTagInput.trim() || null;
                updateLead(id, upd);
            });
            toast.success(`Tagged ${ids.length} contact${ids.length !== 1 ? 's' : ''}`);
            setShowBulkTag(false);
            setBulkListTagInput('');
            setBulkGeoTagInput('');
        } catch (e: any) {
            toast.error(e.message || 'Tagging failed');
        }
    };

    const handleBulkEnrich = async () => {
        if (!user?.email || selectedLeads.length === 0) return;
        setIsBulkEnriching(true);
        try {
            const res = await salesService.bulkEnrich(user.email, selectedLeads.map((lead) => lead.id));
            await fetchData(user.email);
            clearSelectedLeads();
            toast.success(`Bulk enrich finished: ${res.enriched} enriched, ${res.failed} failed`);
        } catch (e: any) {
            toast.error(e.message || 'Bulk enrich failed');
        } finally {
            setIsBulkEnriching(false);
        }
    };

    const handleExportSelectedCsv = async () => {
        if (!user?.email || selectedLeads.length === 0) return;
        setIsExportingCsv(true);
        try {
            const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
            const params = new URLSearchParams({
                email: user.email,
                format: 'csv',
                contact_ids: selectedLeads.map((lead) => lead.id).join(','),
            });
            const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
            const res = await fetch(`${API_BASE_URL}/api/sales/contacts/download?${params.toString()}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'CSV export failed');
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `selected-leads-${selectedLeads.length}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            toast.success(`Exported ${selectedLeads.length} contact${selectedLeads.length !== 1 ? 's' : ''}`);
        } catch (e: any) {
            toast.error(e.message || 'CSV export failed');
        } finally {
            setIsExportingCsv(false);
        }
    };

    const toggleVisibleLeads = () => {
        setSelectedLeadIds((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                filteredLeads.forEach((lead) => next.delete(lead.id));
            } else {
                filteredLeads.forEach((lead) => next.add(lead.id));
            }
            return next;
        });
    };

    // Most recent signal per lead (globalSignals is already newest-first)
    const latestSignalByLead = useMemo(() => {
        const map = new Map<number, Signal>();
        globalSignals.forEach(({ signal, lead }) => {
            if (!map.has(lead.id)) map.set(lead.id, signal);
        });
        return map;
    }, [globalSignals]);

    const handleBookMeeting = async (lead: Lead) => {
        if (!user?.email) return;
        try {
            toast.info(`Generating booking link for ${lead.contact_name}...`);
            const res = await salesService.getBookingLink(lead.id, user.email, 'discovery-call');
            if (res.booking_link) {
                window.open(res.booking_link, '_blank');
                toast.success('Booking link opened in new tab');
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to generate booking link');
        }
    };

    const handleResolveEscalation = async (id: number, action: 'resume' | 'cancel') => {
        if (!user?.email) return;
        try {
            await salesService.resolveEscalation(id, user.email, action);
            fetchEscalations(user.email);
            fetchData(user.email);
            toast.success(`Escalation ${action === 'resume' ? 'resumed' : 'cancelled'}`);
        } catch (err: any) {
            toast.error(err.message || 'Resolution failed');
        }
    };

    const handleReengagementAction = async (id: number, action: 'send' | 'cancel') => {
        if (!user?.email) return;
        try {
            if (action === 'send') {
                await salesService.sendReengagementNow(id, user.email);
                toast.success('Re-engagement email sent');
            } else {
                await salesService.cancelReengagement(id, user.email);
                toast.success('Re-engagement entry cancelled');
            }
            fetchReengagement(user.email);
        } catch (err: any) {
            toast.error(err.message || 'Action failed');
        }
    };

    const handlePipelineModeChange = async (nextLiveMode: boolean) => {
        if (isModeLoading) return;
        if (nextLiveMode) {
            setLiveConfirmText('');
            setShowLiveConfirmModal(true);
            return;
        }

        setIsModeLoading(true);
        try {
            const result = await salesService.setPipelineMode({ live_mode: false, confirm: '' });
            setPipelineMode({
                live_mode: result.live_mode,
                label: 'TEST - emails sent to test recipients only',
                warning: null,
            });
            toast.success(result.message);
        } catch (error: any) {
            toast.error(error.message || 'Failed to switch pipeline mode');
        } finally {
            setIsModeLoading(false);
        }
    };

    const handleConfirmLiveMode = async () => {
        setIsModeLoading(true);
        try {
            const result = await salesService.setPipelineMode({
                live_mode: true,
                confirm: liveConfirmText,
            });
            setPipelineMode({
                live_mode: result.live_mode,
                label: 'LIVE - emails sent to real leads',
                warning: 'Live mode is ON. All pipeline runs will contact real leads.',
            });
            setShowLiveConfirmModal(false);
            toast.success(result.message);
        } catch (error: any) {
            toast.error(error.message || 'Failed to enable live mode');
        } finally {
            setIsModeLoading(false);
        }
    };

    const handleOpenCreatedCampaign = async () => {
        if (!createdCampaignId || !user?.email) return;

        const openCampaign = (list: Campaign[]) => {
            const match = list.find((campaign) => campaign.id === createdCampaignId);
            if (match) {
                setSelectedCampaign(match);
                return true;
            }
            return false;
        };

        if (openCampaign(campaigns)) return;

        try {
            await fetchData(user.email);
            if (!openCampaign(useOutreachStore.getState().campaigns)) {
                toast.error('Campaign not found yet. Try again in a moment.');
            }
        } catch {
            toast.error('Failed to load campaign analytics');
        }
    };

    const handleRunPipeline = async () => {
        if (!user?.email || isPipelineRunning) return;

        const prompt = pipelinePrompt.trim();
        if (!prompt) {
            toast.error('Enter a prompt before running the pipeline');
            return;
        }

        pipelineRunRef.current?.abort();
        const initialSteps = createInitialPipelineSteps();

        setPipelineSteps(initialSteps);
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
            {
                prompt,
                product_key: selectedPipelineProductKey,
            },
            {
                onEvent: (event) => {
                    setPipelineEvents((prev) => [...prev, event]);
                    setPipelineSummary((prev) => mergePipelineSummary(prev, event));

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

                    if (event.status === 'error') {
                        sawPipelineError = true;
                    }

                    setPipelineSteps((prev) => prev.map((step) => {
                        if (step.step !== event.step) return step;
                        return {
                            ...step,
                            status: event.status,
                            message: getPipelineStepMessage(step.step, event),
                            data: event.data || {},
                            ts: event.ts,
                        };
                    }));
                },
                onError: async (error) => {
                    sawPipelineError = true;
                    setIsPipelineRunning(false);
                    pipelineRunRef.current = null;
                    setPipelineSteps((prev) => prev.map((step) => {
                        if (step.status === 'running') {
                            return { ...step, status: 'error', message: error.message };
                        }
                        return step;
                    }));
                    toast.error(error.message || 'Pipeline failed');
                },
                onDone: async () => {
                    if (!decisionRequiredReceived) {
                        setIsPipelineRunning(false);
                        pipelineRunRef.current = null;
                        try {
                            await fetchData(user.email);
                            await fetchCampaigns(user.email, selectedTag || undefined);
                            await fetchLeads(user.email, selectedContactCampaignId, selectedContactTag);
                        } catch {
                            // silent
                        }
                    }
                },
            },
        );
    };

    const handleSelectDecision = async (decision: 'send_with_email_export_rest' | 'export_all') => {
        if (!user?.email || !pipelineJobId) return;

        const liveMode = pipelineMode?.live_mode ?? false;
        const testRecipients = testRecipientsInput
            .split(',')
            .map((email) => email.trim())
            .filter(Boolean);

        if (decision === 'send_with_email_export_rest') {
            if (!liveMode && testRecipients.length === 0) {
                toast.error('Add at least one test recipient while test mode is enabled');
                return;
            }
        }

        setPipelineDecisionPending(false);
        setIsPipelineRunning(true);

        if (decision === 'export_all') {
            setPipelineSteps((prev) => prev.map((step) => {
                const intermediate = ['enrich', 'email_gen', 'create_campaign', 'send', 'sequence_enroll'];
                if (intermediate.includes(step.step)) {
                    return {
                        ...step,
                        status: 'skipped',
                        message: 'Skipped for CSV export',
                    };
                }
                return step;
            }));
        } else {
            if (!selectedFollowUpSequenceId) {
                setPipelineSteps((prev) => prev.map((step) => {
                    if (step.step === 'sequence_enroll') {
                        return {
                            ...step,
                            status: 'skipped',
                            message: 'No follow-up sequence selected',
                        };
                    }
                    return step;
                }));
            }
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
                    setPipelineEvents((prev) => [...prev, event]);
                    setPipelineSummary((prev) => mergePipelineSummary(prev, event));

                    if (event.step === 'create_campaign') {
                        if (typeof event.data?.campaign_id === 'number') setCreatedCampaignId(event.data.campaign_id);
                        if (typeof event.data?.name === 'string') setCreatedCampaignName(event.data.name);
                    }
                    if (event.step === 'send' && typeof event.data?.campaign_id === 'number') {
                        setCreatedCampaignId(event.data.campaign_id);
                    }
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
                    if (event.status === 'error') {
                        sawPipelineError = true;
                    }

                    setPipelineSteps((prev) => prev.map((step) => {
                        if (decision === 'export_all' && ['enrich', 'email_gen', 'create_campaign', 'send', 'sequence_enroll'].includes(step.step)) {
                            return step;
                        }
                        if (decision === 'send_with_email_export_rest' && step.step === 'sequence_enroll' && !selectedFollowUpSequenceId && step.status === 'skipped') {
                            return step;
                        }

                        if (step.step !== event.step) return step;
                        return {
                            ...step,
                            status: event.status,
                            message: getPipelineStepMessage(step.step, event),
                            data: event.data || {},
                            ts: event.ts,
                        };
                    }));
                },
                onError: async (error) => {
                    sawPipelineError = true;
                    setIsPipelineRunning(false);
                    pipelineRunRef.current = null;
                    setPipelineSteps((prev) => prev.map((step) => {
                        if (step.status === 'running') {
                            return { ...step, status: 'error', message: error.message };
                        }
                        return step;
                    }));
                    toast.error(error.message || 'Pipeline failed');
                },
                onDone: async () => {
                    setIsPipelineRunning(false);
                    pipelineRunRef.current = null;

                    if (!sawPipelineError) {
                        setPipelineSteps((prev) => prev.map((step) => {
                            if (step.step === 'pipeline_complete' && !sawPipelineComplete) {
                                return {
                                    ...step,
                                    status: 'done',
                                    message: step.message || 'Pipeline stream completed',
                                };
                            }
                            if (step.step === 'sequence_enroll' && !selectedFollowUpSequenceId && step.status === 'skipped') {
                                return step;
                            }
                            if (decision === 'export_all' && ['enrich', 'email_gen', 'create_campaign', 'send', 'sequence_enroll'].includes(step.step)) {
                                return step;
                            }
                            if (step.status === 'running') {
                                return {
                                    ...step,
                                    status: 'done',
                                    message: step.message || 'Completed',
                                };
                            }
                            return step;
                        }));

                        try {
                            await fetchData(user.email);
                            await fetchCampaigns(user.email, selectedTag || undefined);
                            await fetchLeads(user.email, selectedContactCampaignId, selectedContactTag);
                            if (selectedFollowUpSequenceId) {
                                await fetchSequences(user.email);
                            }
                        } catch {
                            toast.error('Pipeline finished, but refresh failed');
                        }

                        toast.success(sawPipelineComplete ? 'Pipeline completed successfully' : 'Pipeline stream finished');
                    }
                },
            }
        );
    };

    const downloadCSV = (jobId: string, which: 'no_email' | 'all' | 'with_email') => {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
        const url = `${API_BASE_URL}/api/pipeline/export-csv/${jobId}?which=${which}`;
        window.open(url, '_blank');
    };

    const pipelineSummaryModeLive = pipelineSummary?.live_mode ?? pipelineMode?.live_mode ?? false;
    const visiblePipelineSteps = useMemo(() => (
        pipelineSteps.filter((step) => step.step !== 'sequence_enroll' || selectedFollowUpSequenceId !== null)
    ), [pipelineSteps, selectedFollowUpSequenceId]);


    return (
        <>
            {/* ── Modals ── */}
            <AnimatePresence>
                {showNewLead && (
                    <NewLeadModal
                        key="new-lead"
                        onClose={() => setShowNewLead(false)}
                        onSave={handleCreateLead}
                    />
                )}
                {showBulkImport && (
                    <BulkImportModal
                        key="bulk-import"
                        onClose={() => setShowBulkImport(false)}
                        onImported={(newLeads) => { addLeads(newLeads); }}
                    />
                )}
                {showNewCampaign && (
                    <NewCampaignModal
                        key="new-campaign"
                        initialRecipients={campaignRecipients.length > 0 ? campaignRecipients : undefined}
                        onClose={() => {
                            setShowNewCampaign(false);
                            setCampaignRecipients([]);
                            setSelectedLeadIds(new Set());
                        }}
                        onCreated={(campaign) => {
                            handleCampaignCreated(campaign);
                            setShowNewCampaign(false);
                            setCampaignRecipients([]);
                            setSelectedLeadIds(new Set());
                        }}
                    />
                )}
                {selectedCampaign && (
                    <CampaignDetailModal
                        key="campaign-detail"
                        campaign={selectedCampaign}
                        onClose={() => setSelectedCampaign(null)}
                        onSelectTag={setSelectedTag}
                    />
                )}
                {nextActionLead && (
                    <NextActionPanel
                        key="next-action"
                        lead={nextActionLead}
                        onClose={() => setNextActionLead(null)}
                    />
                )}
                {historyLead && (
                    <SignalHistoryPanel
                        key="signal-history"
                        lead={historyLead}
                        onClose={() => setHistoryLead(null)}
                    />
                )}
                {showLeadFinder && (
                    <LeadFinderModal
                        key="lead-finder"
                        onClose={() => setShowLeadFinder(false)}
                        onSave={(newLeads) => { addLeads(newLeads); setShowLeadFinder(false); }}
                        sequences={sequences}
                        onPipelineComplete={async () => {
                            if (user?.email) {
                                await fetchData(user.email);
                                await fetchCampaigns(user.email, selectedTag || undefined);
                                await fetchLeads(user.email, selectedContactCampaignId, selectedContactTag);
                            }
                        }}
                    />
                )}
                {dossierLead && (
                    <DossierModal
                        key="dossier"
                        lead={dossierLead}
                        onClose={() => setDossierLead(null)}
                    />
                )}
                {objectionLead && (
                    <ObjectionModal
                        key="objection"
                        lead={objectionLead}
                        onClose={() => setObjectionLead(null)}
                    />
                )}
                {leadToDelete !== null && (
                    <ConfirmationModal
                        key="delete-lead"
                        isOpen={leadToDelete !== null}
                        onClose={() => setLeadToDelete(null)}
                        onConfirm={() => handleDeleteLead(leadToDelete!)}
                        title="Remove this contact?"
                        description="This will permanently delete the contact and all their activity."
                        confirmText="Yes, remove"
                        isLoading={isDeletingLead}
                    />
                )}
                <AlertDialog open={showLiveConfirmModal} onOpenChange={(open) => {
                    setShowLiveConfirmModal(open);
                    if (!open) setLiveConfirmText('');
                }}>
                    <AlertDialogContent className="border border-border/70 bg-background shadow-[0_30px_90px_rgba(0,0,0,0.18)] sm:max-w-[520px] sm:rounded-3xl">
                        <AlertDialogHeader className="text-left">
                            <AlertDialogTitle className="text-xl font-semibold tracking-tight text-foreground">
                                Enable Live Mode
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
                                Type the exact confirmation phrase below to allow the pipeline to send real emails.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-500/80">Confirmation phrase</p>
                            <p className="mt-2 text-sm font-medium text-foreground">{LIVE_CONFIRMATION_TEXT}</p>
                            <input
                                type="text"
                                value={liveConfirmText}
                                onChange={(e) => setLiveConfirmText(e.target.value)}
                                placeholder="Type the phrase exactly"
                                className="mt-4 w-full rounded-xl border border-border/60 bg-background px-4 py-3 text-sm text-foreground outline-none transition-all focus:border-red-500/40"
                            />
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel
                                disabled={isModeLoading}
                                className="rounded-xl border-border/70"
                            >
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                disabled={isModeLoading || liveConfirmText !== LIVE_CONFIRMATION_TEXT}
                                onClick={(e) => {
                                    e.preventDefault();
                                    void handleConfirmLiveMode();
                                }}
                                className="rounded-xl bg-red-500 text-white hover:bg-red-600"
                            >
                                {isModeLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Enable Live Mode
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                {selectedSequence && (
                    <SequenceDetailModal
                        key="sequence-detail"
                        sequence={selectedSequence}
                        onClose={() => setSelectedSequence(null)}
                        onUpdated={() => user?.email && fetchSequences(user.email)}
                    />
                )}
                {showNewSequence && (
                    <SequenceBuilderModal
                        key="new-sequence"
                        onClose={() => setShowNewSequence(false)}
                        onCreated={(seq) => { addSequence(seq); setShowNewSequence(false); }}
                    />
                )}
                {showEnrollSequence && (
                    <EnrollSequenceModal
                        key="enroll-sequence"
                        sequences={sequences}
                        leads={selectedLeads}
                        onClose={() => setShowEnrollSequence(false)}
                        onEnrolled={() => {
                            if (user?.email) {
                                fetchData(user.email);
                                fetchSequences(user.email);
                            }
                            clearSelectedLeads();
                            setShowEnrollSequence(false);
                        }}
                    />
                )}
            </AnimatePresence>

            {/* ── Add Product Modal ── */}
            {showAddProduct && (
                <AddProductModal
                    onClose={() => setShowAddProduct(false)}
                    onCreated={() => user?.email && fetchProducts(user.email)}
                />
            )}

            {/* ── Main Page ── */}
            <div className="h-full bg-background overflow-y-auto overflow-x-hidden flex flex-col" onClick={() => setActiveMenuId(null)}>

                {/* Top bar */}
                <div className="border-b border-border/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-20">
                    <div className="flex items-center gap-3">
                        <Link href="/playground" className='p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:border hover:border-border/20  bg-surface transition-all shrink-0'> <ArrowLeft size={16} /></Link>
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shadow-sm border border-primary/20 shrink-0">
                            <Zap size={16} fill="currentColor" className="opacity-80" />
                        </div>
                        <div>
                            <h1 className="text-sm sm:text-base font-bold text-foreground uppercase tracking-tight">Outreach Intelligence</h1>
                            <p className="hidden sm:block text-[10px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5 opacity-60">Automated Prospecting & Intelligence</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
                        <button
                            onClick={() => fetchData(user?.email || '')}
                            title="Refresh"
                            className="p-2 border border-border/20 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-all shrink-0"
                        >
                            <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={() => setShowBulkImport(true)}
                            className="flex items-center gap-1.5 border border-border/20 text-muted-foreground/80 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest px-2.5 sm:px-3 py-2 rounded-lg hover:bg-surface transition-all shrink-0"
                        >
                            <FileUp size={13} /> <span>Upload List</span>
                        </button>
                        <button
                            onClick={() => setShowLeadFinder(true)}
                            className="flex items-center gap-1.5 text-white text-[9px] sm:text-[10px] font-bold uppercase tracking-widest px-2.5 sm:px-3 py-2 rounded-lg bg-primary cursor-pointer hover:opacity-90 transition-all shrink-0"
                        >
                            <Sparkles size={13} /> <span>Find Leads</span>
                        </button>
                    </div>
                </div>

                {/* Stats bar */}
                <div className="border-b border-border/10 px-4 py-2.5 flex items-center gap-6 sm:gap-10 bg-surface/50 backdrop-blur-sm shrink-0 overflow-x-auto no-scrollbar">
                    {stats.map((s, idx) => (
                        <div key={s.label} className="flex items-center gap-2 group relative shrink-0">
                            {idx > 0 && <div className="hidden sm:block absolute -left-5 top-1/2 -translate-y-1/2 w-[1px] h-3 bg-border/40" />}
                            <div className={`p-1.5 rounded-md ${s.color.replace('text-', 'bg-')}/10 ${s.color}`}>
                                <s.icon size={12} />
                            </div>
                            <div className="flex flex-col min-w-max">
                                <span className="text-muted-foreground text-[9px] font-normal uppercase tracking-widest leading-none mb-0.5">{s.label}</span>
                                <span className="font-semibold text-foreground text-[10px] sm:text-[11px] uppercase tracking-widest leading-none">{s.value}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Body - 2 columns */}
                <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">

                    {/* Left: contact table */}
                    <div className="flex-1 lg:flex-1 flex flex-col lg:overflow-hidden border-b lg:border-b-0 border-border/20">
                        {/* Project / campaign filter */}
                        <div className="flex justify-between items-center border-b border-border/20">
                            <div className="px-4 py-1.5 flex flex-wrap items-center gap-3 shrink-0">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30 shrink-0">Filters</span>

                                {/* List Tag / Project Filter Dropdown */}
                                <div className="relative" ref={listTagMenuRef}>
                                    <button
                                        onClick={() => setShowListTagMenu(!showListTagMenu)}
                                        className="flex items-center gap-2 px-3 py-2 bg-surface/50 border border-border/40 rounded-lg hover:border-primary/40 transition-all group"
                                        title="Filter by Project Tag"
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <Tag size={10} className={selectedContactListTag ? "text-primary/70 shrink-0" : "text-muted-foreground/40 shrink-0"} />
                                            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground truncate max-w-[120px]">
                                                {selectedContactListTag || 'All Projects'}
                                            </span>
                                        </div>
                                        <ChevronDown size={10} className={`text-muted-foreground/40 group-hover:text-primary/70 transition-transform ${showListTagMenu ? 'rotate-180' : ''}`} />
                                    </button>

                                    <AnimatePresence>
                                        {showListTagMenu && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                                className="absolute left-0 mt-2 w-48 bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl z-[100] overflow-hidden py-1.5"
                                            >
                                                <button
                                                    onClick={() => { setSelectedContactListTag(null); setShowListTagMenu(false); }}
                                                    className={`w-full flex items-center justify-between px-3 py-2 hover:bg-primary/5 transition-colors ${!selectedContactListTag ? 'text-primary' : 'text-muted-foreground'}`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <Layers size={12} className="opacity-40" />
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">All Projects</span>
                                                    </div>
                                                    {!selectedContactListTag && <Check size={12} />}
                                                </button>

                                                {availableListTags.length > 0 && (
                                                    <>
                                                        <div className="px-3 py-1.5 mt-1 border-t border-border/10">
                                                            <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/40">Filter by Project</span>
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                            {availableListTags.map(tag => (
                                                                <button
                                                                    key={tag}
                                                                    onClick={() => { setSelectedContactListTag(tag); setShowListTagMenu(false); }}
                                                                    className={`w-full flex items-center justify-between px-3 py-2 hover:bg-primary/5 transition-colors ${selectedContactListTag === tag ? 'text-primary' : 'text-muted-foreground'}`}
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <Tag size={12} className="opacity-40" />
                                                                        <span className="text-[10px] font-bold uppercase tracking-widest">{tag}</span>
                                                                    </div>
                                                                    {selectedContactListTag === tag && <Check size={12} />}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Geography / Region Filter Dropdown */}
                                <div className="relative" ref={geoTagMenuRef}>
                                    <button
                                        onClick={() => setShowGeoTagMenu(!showGeoTagMenu)}
                                        className="flex items-center gap-2 px-3 py-2 bg-surface/50 border border-border/40 rounded-lg hover:border-primary/40 transition-all group"
                                        title="Filter by Geography"
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <Globe size={10} className={selectedContactGeoTag ? "text-sky-500/70 shrink-0" : "text-muted-foreground/40 shrink-0"} />
                                            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground truncate max-w-[120px]">
                                                {selectedContactGeoTag || 'All Geographies'}
                                            </span>
                                        </div>
                                        <ChevronDown size={10} className={`text-muted-foreground/40 group-hover:text-primary/70 transition-transform ${showGeoTagMenu ? 'rotate-180' : ''}`} />
                                    </button>

                                    <AnimatePresence>
                                        {showGeoTagMenu && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                                className="absolute left-0 mt-2 w-48 bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl z-[100] overflow-hidden py-1.5"
                                            >
                                                <button
                                                    onClick={() => { setSelectedContactGeoTag(null); setShowGeoTagMenu(false); }}
                                                    className={`w-full flex items-center justify-between px-3 py-2 hover:bg-primary/5 transition-colors ${!selectedContactGeoTag ? 'text-sky-500' : 'text-muted-foreground'}`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <Layers size={12} className="opacity-40" />
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">All Geographies</span>
                                                    </div>
                                                    {!selectedContactGeoTag && <Check size={12} />}
                                                </button>

                                                {availableGeoTags.length > 0 && (
                                                    <>
                                                        <div className="px-3 py-1.5 mt-1 border-t border-border/10">
                                                            <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/40">Filter by Geography</span>
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                            {availableGeoTags.map(tag => (
                                                                <button
                                                                    key={tag}
                                                                    onClick={() => { setSelectedContactGeoTag(tag); setShowGeoTagMenu(false); }}
                                                                    className={`w-full flex items-center justify-between px-3 py-2 hover:bg-primary/5 transition-colors ${selectedContactGeoTag === tag ? 'text-sky-500' : 'text-muted-foreground'}`}
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <Globe size={12} className="opacity-40" />
                                                                        <span className="text-[10px] font-bold uppercase tracking-widest">{tag}</span>
                                                                    </div>
                                                                    {selectedContactGeoTag === tag && <Check size={12} />}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Product Filter Dropdown */}
                                <div className="relative" ref={contactProductMenuRef}>
                                    <button
                                        onClick={() => setShowContactProductMenu(!showContactProductMenu)}
                                        className="flex items-center gap-2 px-3 py-2 bg-surface/50 border border-border/40 rounded-lg hover:border-primary/40 transition-all group"
                                        title="Filter by Product"
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <Package size={10} className={selectedContactProductKey ? "text-primary/70 shrink-0" : "text-muted-foreground/40 shrink-0"} />
                                            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground truncate max-w-[100px]">
                                                {selectedContactProductKey ? (products.find(p => p.product_key === selectedContactProductKey)?.display_name || selectedContactProductKey) : 'All Products'}
                                            </span>
                                        </div>
                                        <ChevronDown size={10} className={`text-muted-foreground/40 group-hover:text-primary/70 transition-transform ${showContactProductMenu ? 'rotate-180' : ''}`} />
                                    </button>
                                    <AnimatePresence>
                                        {showContactProductMenu && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                                                className="absolute top-full left-0 mt-2 w-48 bg-background border border-border rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] z-50 overflow-hidden py-1.5 backdrop-blur-xl"
                                            >
                                                <div className="px-3 py-1 mb-1 border-b border-border/10">
                                                    <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/40">Filter by Product</span>
                                                </div>
                                                <button
                                                    onClick={() => { setSelectedContactProductKey(null); setShowContactProductMenu(false); }}
                                                    className={`w-full flex items-center justify-between px-3 py-2 hover:bg-primary/5 transition-colors ${!selectedContactProductKey ? 'text-primary' : 'text-muted-foreground'}`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <Package size={10} />
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">All Products</span>
                                                    </div>
                                                    {!selectedContactProductKey && <Check size={12} />}
                                                </button>
                                                {products.length > 0 && (
                                                    <>
                                                        <div className="h-px bg-border/10 my-1" />
                                                        {products.map(p => (
                                                            <button
                                                                key={p.product_key}
                                                                onClick={() => { setSelectedContactProductKey(p.product_key); setShowContactProductMenu(false); }}
                                                                className={`w-full flex items-center justify-between px-3 py-2 hover:bg-primary/5 transition-colors ${selectedContactProductKey === p.product_key ? 'text-primary' : 'text-muted-foreground'}`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <Package size={10} />
                                                                    <span className="text-[10px] font-bold uppercase tracking-widest">{p.display_name || p.product_key}</span>
                                                                </div>
                                                                {selectedContactProductKey === p.product_key && <Check size={12} />}
                                                            </button>
                                                        ))}
                                                    </>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            {/* Filter tabs */}
                            {/* <div className="px-4 flex items-center gap-1 bg-background shrink-0">
                                {(['all', 'no_reply', 'contacted', 'new'] as const).map((f) => {
                                    const labels = { all: 'All', no_reply: 'No Reply', contacted: 'Contacted', new: 'New' };
                                    const active = contactFilter === f;
                                    return (
                                        <button
                                            key={f}
                                            onClick={() => setContactFilter(f)}
                                            className={`flex items-center gap-1.5 px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                                        >
                                            {labels[f]}
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-normal ${active ? 'bg-primary/10 text-primary' : 'bg-surface text-muted-foreground'}`}>
                                                {contactFilterCounts[f]}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div> */}
                        </div>
                        {/* Search + bulk actions */}
                        <div className="px-4 py-2 border-b border-border/10 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 bg-background shrink-0">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                <div className="relative w-64 xl:w-80 shrink-0">
                                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                                    <input
                                        type="text"
                                        placeholder="Search contacts..."
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full pl-8 pr-3 py-2 text-xs font-normal border border-border/10 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-muted-foreground/40"
                                    />
                                </div>
                                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-visible pb-1 lg:pb-0 custom-scrollbar">
                                    <button
                                        onClick={toggleVisibleLeads}
                                        disabled={filteredLeads.length === 0}
                                        className="h-9 shrink-0 px-3 rounded-lg text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground hover:bg-surface transition-all disabled:opacity-40 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                    >
                                        {allVisibleSelected ? 'Unselect' : 'Select all'}
                                    </button>
                                    {selectedLeads.length > 0 && (
                                        <div className="shrink-0 inline-flex flex-nowrap items-center gap-2 rounded-xl border border-border/20 bg-surface/40 p-1.5 animate-in fade-in slide-in-from-left-2 duration-300">
                                            <span className="inline-flex h-8 items-center rounded-lg bg-background/80 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/80 whitespace-nowrap">
                                                {selectedLeads.length} selected
                                            </span>
                                            <button
                                                onClick={handleBulkEnrich}
                                                disabled={isBulkEnriching}
                                                className="h-8 shrink-0 flex items-center gap-2 px-3 border border-border/20 rounded-lg bg-background/70 hover:bg-background text-muted-foreground hover:text-foreground transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                                title="Research Selected"
                                            >
                                                {isBulkEnriching ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Research</span>
                                            </button>
                                            <button
                                                onClick={() => setShowEnrollSequence(true)}
                                                className="h-8 shrink-0 flex items-center gap-2 px-3 border border-border/20 rounded-lg bg-background/70 hover:bg-background text-muted-foreground hover:text-foreground transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                                title="Enroll in Sequence"
                                            >
                                                <Zap size={12} />
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Enroll</span>
                                            </button>
                                            <button
                                                onClick={handleExportSelectedCsv}
                                                disabled={isExportingCsv}
                                                className="h-8 shrink-0 flex items-center gap-2 px-3 border border-primary rounded-lg bg-surface hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                                title="Export Selected as CSV"
                                            >
                                                {isExportingCsv ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Export CSV</span>
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setCampaignRecipients(selectedLeads);
                                                    setShowNewCampaign(true);
                                                }}
                                                className="h-8 shrink-0 flex items-center gap-2 px-3 border border-primary/25 rounded-lg bg-primary/5 hover:bg-primary/10 text-primary/80 hover:text-primary transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                                title="Create Campaign from selected"
                                            >
                                                <Send size={12} />
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Campaign</span>
                                            </button>
                                            <div className="relative shrink-0" ref={bulkTagRef}>
                                                <button
                                                    onClick={() => setShowBulkTag(v => !v)}
                                                    className={`h-8 flex items-center gap-2 px-3 border rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${showBulkTag ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border/20 bg-background/70 hover:bg-background text-muted-foreground hover:text-foreground'}`}
                                                    title="Tag Selected"
                                                >
                                                    <Tag size={12} />
                                                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Tag</span>
                                                </button>
                                                <AnimatePresence>
                                                    {showBulkTag && (
                                                        <motion.div
                                                            initial={{ opacity: 0, y: 6, scale: 0.97 }}
                                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                                            exit={{ opacity: 0, y: 6, scale: 0.97 }}
                                                            transition={{ duration: 0.15 }}
                                                            className="absolute top-full mt-2 left-0 z-50 w-60 bg-background border border-border/30 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)] p-3 flex flex-col gap-3"
                                                        >
                                                            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                                                                Tag {selectedLeads.length} selected contact{selectedLeads.length !== 1 ? 's' : ''}
                                                            </p>
                                                            <div className="flex flex-col gap-1.5">
                                                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                                                    <Tag size={9} className="text-primary/60" /> Project Tag
                                                                </label>
                                                                <input
                                                                    list="bulk-list-tags"
                                                                    value={bulkListTagInput}
                                                                    onChange={e => setBulkListTagInput(e.target.value)}
                                                                    placeholder="e.g. EBIC Agency · leave blank to skip"
                                                                    className="w-full text-xs bg-surface border border-border/20 rounded-lg px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                                                />
                                                                <datalist id="bulk-list-tags">
                                                                    {availableListTags.map(t => <option key={t} value={t} />)}
                                                                </datalist>
                                                            </div>
                                                            <div className="flex flex-col gap-1.5">
                                                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                                                    <Globe size={9} className="text-sky-500/60" /> Geography
                                                                </label>
                                                                <input
                                                                    list="bulk-geo-tags"
                                                                    value={bulkGeoTagInput}
                                                                    onChange={e => setBulkGeoTagInput(e.target.value)}
                                                                    placeholder="e.g. India · leave blank to skip"
                                                                    className="w-full text-xs bg-surface border border-border/20 rounded-lg px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-sky-500/30"
                                                                />
                                                                <datalist id="bulk-geo-tags">
                                                                    {availableGeoTags.map(t => <option key={t} value={t} />)}
                                                                </datalist>
                                                            </div>
                                                            <p className="text-[8px] text-muted-foreground/40 -mt-1">
                                                                Leave a field blank to keep existing value. Enter a single space to clear a tag.
                                                            </p>
                                                            <button
                                                                onClick={handleBulkTag}
                                                                className="w-full text-[10px] font-bold uppercase tracking-widest py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-[0.98]"
                                                            >
                                                                Apply Tags
                                                            </button>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                            <button
                                                onClick={handleBulkDelete}
                                                className="h-8 shrink-0 flex items-center gap-2 px-3 border border-error/20 rounded-lg bg-background/70 hover:bg-error/10 text-error transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-error/30"
                                                title="Remove Selected"
                                            >
                                                <Trash2 size={12} />
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Delete</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={() => setShowNewLead(true)}
                                className="w-full sm:w-auto flex items-center justify-center gap-2 border border-border/40 text-foreground text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 rounded-lg hover:bg-surface transition-all shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                            >
                                <Plus size={13} /> New Leads
                            </button>
                        </div>

                        {/* Table */}
                        <div className="flex-1 lg:flex-1 min-h-[300px] lg:min-h-0 overflow-x-auto lg:overflow-y-auto custom-scrollbar">
                            {isLoading ? (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border/10 text-left bg-gradient-to-r from-surface/50 to-transparent sticky top-0 z-10 backdrop-blur-sm">
                                            <th className="pl-4 pr-2 py-1.5 w-8" />
                                            <th className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">Name</th>
                                            <th className="hidden md:table-cell px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 w-32 lg:w-56">Role</th>

                                            <th className="hidden xl:table-cell px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 w-36">Recent Activity</th>
                                            <th className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 w-24 sm:w-48 text-right pr-6">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...Array(8)].map((_, i) => <LeadRowSkeleton key={i} />)}
                                    </tbody>
                                </table>
                            ) : filteredLeads.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground/40">
                                    <Users size={28} className="mb-2 opacity-30" />
                                    <p className="text-[13px] font-normal uppercase tracking-widest">{hasSearch ? 'No contacts match search' : contactFilter === 'no_reply' ? 'No unanswered contacts' : contactFilter === 'contacted' ? 'No contacted leads yet' : contactFilter === 'new' ? 'No new leads' : 'No contacts yet'}</p>
                                    {!hasSearch && contactFilter === 'all' && (
                                        <button
                                            onClick={() => setShowNewLead(true)}
                                            className="mt-3 text-[10px] font-normal text-primary uppercase tracking-widest hover:underline"
                                        >
                                            + Add your first contact
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border/10 text-left bg-gradient-to-r from-surface/50 to-transparent sticky top-0 z-10 backdrop-blur-sm">
                                            <th className="pl-4 pr-2 py-3 w-8" />
                                            <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">Name</th>
                                            <th className="hidden md:table-cell px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 w-32 md:w-44">Role</th>
                                            <th className="hidden xl:table-cell px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 w-44">Recent Activity</th>
                                            <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 w-24 sm:w-48 text-right pr-6">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredLeads.map((lead, i) => (
                                            <LeadRow
                                                key={`${lead.id}-${i}`}
                                                lead={lead}
                                                index={i}
                                                isRefreshing={isRefreshing}
                                                onRefresh={handleRefreshLead}
                                                onGenerateOutreach={setNextActionLead}
                                                onHistory={setHistoryLead}
                                                onEnrich={handleEnrichLead}
                                                onDossier={setDossierLead}
                                                isSelected={selectedLeadIds.has(lead.id)}
                                                onToggleSelect={toggleLeadSelection}
                                                onHandleObjection={setObjectionLead}
                                                onDelete={setLeadToDelete}
                                                onBookMeeting={handleBookMeeting}
                                                menuOpen={activeMenuId === lead.id}
                                                setMenuOpen={(open) => setActiveMenuId(open ? lead.id : null)}
                                                latestSignal={latestSignalByLead.get(lead.id)}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                    {/* Right sidebar */}
                    <div className="w-full lg:w-96 shrink-0 flex flex-col lg:overflow-hidden border-t lg:border-t-0 lg:border-l border-border/20">
                        {/* Premium Tabbed Navigation */}
                        <div className="flex border-b border-border/20 shrink-0 backdrop-blur-sm">
                            {[
                                { id: 'outreach', icon: Mail, label: 'Outreach', count: campaigns.length },
                                { id: 'followups', icon: Zap, label: 'Series', count: sequences.length },
                                { id: 'objections', icon: History, label: 'Alerts', count: globalSignals.filter(s => s.signal.type === 'email_reply').length },
                                { id: 'escalations', icon: ShieldAlert, label: 'Review', count: escalations.filter(e => !e.human_took_over).length },
                                { id: 'reengagement', icon: RotateCcw, label: 'Retry', count: reengagementEntries.filter(e => e.status === 'pending').length },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setSidebarTab(tab.id as any)}
                                    className={`flex-1 flex flex-col items-center justify-center py-3 border-b-2 transition-all relative ${sidebarTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground'}`}
                                >
                                    <tab.icon size={16} />
                                    <span className="text-[8px] font-bold uppercase tracking-[0.1em] mt-1.5">{tab.label}</span>
                                    {tab.count > 0 && (
                                        <span className="absolute top-2 right-2 w-3.5 h-3.5 rounded-full bg-primary text-white text-[8px] flex items-center justify-center font-bold">
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {sidebarTab === 'outreach' && (
                                <div className="flex flex-col h-full">
                                    <div className="px-4 py-2.5 bg-surface/10 border-b border-border/10 flex flex-col gap-2.5">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">Email Outreaches</h3>
                                            <button
                                                onClick={() => setShowNewCampaign(true)}
                                                className="text-[10px] bg-surface border py-1 px-2 rounded-lg border-border/20 text-foreground font-medium uppercase tracking-widest hover:text-primary transition-all flex items-center gap-1 active:scale-95 shrink-0"
                                            >
                                                <Plus size={12} /> New
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 custom-scrollbar">
                                            <div className="relative shrink-0" ref={tagMenuRef}>
                                                <button
                                                    onClick={() => setShowTagMenu(!showTagMenu)}
                                                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all bg-surface text-foreground border border-border/30"
                                                >
                                                    <Check size={10} />
                                                    {selectedTag || 'All Tags'}
                                                    <ChevronDown size={10} className={`ml-0.5 transition-transform duration-300 ${showTagMenu ? 'rotate-180' : ''}`} />
                                                </button>
                                                <AnimatePresence>
                                                    {showTagMenu && (
                                                        <motion.div
                                                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                                                            className="absolute top-full right-0 mt-2 w-44 bg-background border border-border rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] z-50 overflow-hidden py-1.5 backdrop-blur-xl"
                                                        >
                                                            <div className="px-3 py-1 mb-1 border-b border-border/10">
                                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Filter by Tag</p>
                                                            </div>
                                                            <button
                                                                onClick={() => { setSelectedTag(null); setShowTagMenu(false); }}
                                                                className="w-full text-left px-3 py-2 text-[10px] font-medium hover:bg-primary/5 transition-all flex items-center justify-between group"
                                                            >
                                                                <span className={!selectedTag ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}>All Tags</span>
                                                                {!selectedTag && <Check size={10} className="text-primary" />}
                                                            </button>
                                                            <div className="h-px bg-border/10 my-1" />
                                                            <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                                {(campaignTags || []).map(tag => (
                                                                    <button
                                                                        key={tag}
                                                                        onClick={() => { setSelectedTag(tag); setShowTagMenu(false); }}
                                                                        className="w-full text-left px-3 py-2 text-[10px] font-medium hover:bg-primary/5 transition-all flex items-center justify-between group"
                                                                    >
                                                                        <span className={selectedTag === tag ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}>{tag}</span>
                                                                        {selectedTag === tag && <Check size={10} className="text-primary" />}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                            <div className="relative" ref={productFilterMenuRef}>
                                                <button
                                                    onClick={() => setShowProductFilterMenu(!showProductFilterMenu)}
                                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${selectedProductFilter ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface text-foreground border-border/30'}`}
                                                >
                                                    <Package size={10} />
                                                    {selectedProductFilter ? (products.find(p => p.product_key === selectedProductFilter)?.display_name || selectedProductFilter) : 'All Products'}
                                                    <ChevronDown size={10} className={`ml-0.5 transition-transform duration-300 ${showProductFilterMenu ? 'rotate-180' : ''}`} />
                                                </button>
                                                <AnimatePresence>
                                                    {showProductFilterMenu && (
                                                        <motion.div
                                                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                                                            className="absolute top-full right-0 mt-2 w-48 bg-background border border-border rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.4)] z-50 overflow-hidden py-1.5 backdrop-blur-xl"
                                                        >
                                                            <div className="px-3 py-1 mb-1 border-b border-border/10">
                                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Filter by Product</p>
                                                            </div>
                                                            <button
                                                                onClick={() => { setSelectedProductFilter(null); setShowProductFilterMenu(false); }}
                                                                className="w-full text-left px-3 py-2 text-[10px] font-medium hover:bg-primary/5 transition-all flex items-center justify-between group"
                                                            >
                                                                <span className={!selectedProductFilter ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}>All Products</span>
                                                                {!selectedProductFilter && <Check size={10} className="text-primary" />}
                                                            </button>
                                                            <div className="h-px bg-border/10 my-1" />
                                                            <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                                {products.map(p => (
                                                                    <button
                                                                        key={p.product_key}
                                                                        onClick={() => { setSelectedProductFilter(p.product_key); setShowProductFilterMenu(false); }}
                                                                        className="w-full text-left px-3 py-2 text-[10px] font-medium hover:bg-primary/5 transition-all flex items-center justify-between group"
                                                                    >
                                                                        <span className={selectedProductFilter === p.product_key ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}>{p.display_name || p.product_key}</span>
                                                                        {selectedProductFilter === p.product_key && <Check size={10} className="text-primary" />}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                            <div className="h-px bg-border/10 my-1" />
                                                            <button
                                                                onClick={() => { setShowAddProduct(true); setShowProductFilterMenu(false); }}
                                                                className="w-full text-left px-3 py-2 text-[10px] font-medium text-primary hover:bg-primary/5 transition-all flex items-center gap-1.5"
                                                            >
                                                                <Plus size={10} /> Add New Product
                                                            </button>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </div>
                                    </div>
                                    {isLoading ? <div className="p-4 space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div> : campaigns.length === 0 ? <div className="p-8 text-center text-xs text-muted-foreground/40">No campaigns found</div> : (
                                        campaigns.map((c, i) => (
                                            <button key={`${c.id}-${i}`} onClick={() => setSelectedCampaign(c)} className="w-full text-left px-4 py-4 hover:bg-surface/50 transition-all border-b border-border/20 last:border-0 group">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="text-[11px] font-bold text-foreground uppercase tracking-tight truncate group-hover:text-primary transition-colors">{c.name}</p>
                                                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0 border ${c.status === 'sent' ? 'bg-success/5 text-success border-success/20' : 'bg-warning/5 text-warning border-warning/20'}`}>{c.status}</span>
                                                </div>
                                                <div className="flex items-center gap-4 mt-2">
                                                    <div className="flex items-center gap-1"><Send size={10} className="text-muted-foreground/30" /><span className="text-[10px] font-normal text-muted-foreground/60">{c.sent_count}</span></div>
                                                    <div className="flex items-center gap-1"><Eye size={10} className="text-emerald-500/30" /><span className="text-[10px] font-normal text-emerald-500/60">{c.open_rate}%</span></div>
                                                </div>
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}

                            {sidebarTab === 'followups' && (
                                <div className="flex flex-col h-full">
                                    <div className="px-4 py-2.5 bg-surface/10 border-b border-border/10 flex items-center justify-between">
                                        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Follow-up Series</h3>
                                        <button onClick={() => setShowNewSequence(true)} className="text-[10px] bg-surface border py-1 px-2 rounded-lg border-border/20 text-foreground font-medium uppercase tracking-widest hover:text-primary transition-all flex items-center gap-1 active:scale-95">+ New</button>
                                    </div>
                                    {isLoading ? <div className="p-4 space-y-4">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div> : sequences.length === 0 ? <div className="p-8 text-center text-xs text-muted-foreground/40">No series created yet</div> : (
                                        sequences.map((seq, i) => (
                                            <button key={`${seq.id}-${i}`} onClick={() => setSelectedSequence(seq)} className="w-full text-left px-4 py-4 hover:bg-surface/50 transition-all border-b border-border/20 last:border-0 group">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="text-[11px] font-bold text-foreground uppercase tracking-tight truncate group-hover:text-primary transition-colors">{seq.name}</p>
                                                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest border ${seq.status === 'active' ? 'bg-success/5 text-success border-success/20' : 'bg-surface text-muted-foreground border-border/40'}`}>{seq.status}</span>
                                                </div>
                                                <div className="flex items-center gap-4 mt-2 text-[10px] font-normal text-muted-foreground/60 uppercase tracking-widest">
                                                    <span>{seq.steps.length} steps</span>
                                                    <span className="flex items-center gap-1"><User size={10} /> {seq.stats?.active ?? 0} active</span>
                                                </div>
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}

                            {sidebarTab === 'objections' && (
                                <div className="flex flex-col h-full">
                                    <div className="px-4 py-2.5 bg-surface/10 border-b border-border/10 flex items-center gap-2">
                                        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Recent Activity</h3>
                                    </div>
                                    <div className="divide-y divide-border/10">
                                        {globalSignals.slice(0, 15).map(({ lead, signal }, i) => (
                                            <div key={`${signal.id}-${i}`} className="p-4 hover:bg-surface/30 transition-all cursor-pointer" onClick={() => setHistoryLead(lead)}>
                                                <div className="flex items-center justify-between mb-1">
                                                    <p className="text-[11px] font-bold text-foreground uppercase tracking-tight truncate max-w-[150px]">{lead.contact_name}</p>
                                                    <span className="text-[9px] font-mono text-muted-foreground">{formatDistanceToNow(new Date(signal.created_at))} ago</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${signal.type === 'email_reply' ? 'bg-primary' : 'bg-success'}`} />
                                                    <p className="text-[10px] text-muted-foreground font-normal uppercase tracking-widest">{signal.type.replace(/_/g, ' ')}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {globalSignals.length === 0 && <div className="p-8 text-center text-xs text-muted-foreground/40">No signals recorded</div>}
                                    </div>
                                </div>
                            )}

                            {sidebarTab === 'escalations' && (
                                <div className="flex flex-col h-full">
                                    <div className="px-4 py-2.5 bg-surface/10 border-b border-border/10 flex items-center gap-2">
                                        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Human Review Needed</h3>
                                    </div>
                                    <EscalationPanel escalations={escalations} onResolve={handleResolveEscalation} />
                                </div>
                            )}

                            {sidebarTab === 'reengagement' && (
                                <div className="flex flex-col h-full">
                                    <div className="px-4 py-2.5 bg-surface/10 border-b border-border/10 flex items-center gap-2">
                                        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Re-engagement Desk</h3>
                                    </div>
                                    <ReengagementPanel entries={reengagementEntries} onAction={handleReengagementAction} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
