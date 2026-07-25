"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Mail, ChevronRight, Check, ChevronDown, Info, Wand2,
    Loader2, Sparkles, Users, UserPlus, Trash2, CheckCircle2,
    ShieldCheck, ChevronLeft, Send, Plus
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOutreachStore } from '@/store/outreachStore';
import { salesService, Campaign, Lead } from '@/services/sales.service';
import { toast } from 'sonner';

type CampaignStep = 'info' | 'template' | 'recipients' | 'confirm';

interface RecipientRow {
    email: string;
    name: string;
    variables: Record<string, string>;
}

interface NewCampaignModalProps {
    onClose: () => void;
    onCreated: (c: Campaign) => void;
    initialRecipients?: Lead[];
}

export function NewCampaignModal({ onClose, onCreated, initialRecipients }: NewCampaignModalProps) {
    const { user } = useAuth();
    const { products } = useOutreachStore();
    const [selectedProductKey, setSelectedProductKey] = useState<string>('');
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

    const [step, setStep] = useState<CampaignStep>('info');
    const [name, setName] = useState('');
    const [subjectTemplate, setSubjectTemplate] = useState('');
    const [htmlTemplate, setHtmlTemplate] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [generatingTemplate, setGeneratingTemplate] = useState(false);
    const [detectedVars, setDetectedVars] = useState<string[]>([]);
    const [globalVars, setGlobalVars] = useState<Record<string, string>>({});
    const [importing, setImporting] = useState(false);
    const [recipients, setRecipients] = useState<RecipientRow[]>(() => {
        if (initialRecipients && initialRecipients.length > 0) {
            const mapped = initialRecipients
                .filter(r => r.contact_email)
                .map(r => ({
                    email: r.contact_email!,
                    name: r.contact_name || '',
                    variables: {}
                }));
            if (mapped.length > 0) return mapped;
        }
        return [{ email: '', name: '', variables: {} }];
    });
    const [bulkCsv, setBulkCsv] = useState('');
    const [outreachTag, setOutreachTag] = useState('');
    const [csvMode, setCsvMode] = useState(false);
    const [sending, setSending] = useState(false);

    // Auto-detect {{variables}} from subject + body on every change
    useEffect(() => {
        const combined = subjectTemplate + ' ' + htmlTemplate;
        const found = [...new Set([...combined.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];
        setDetectedVars(found);
    }, [subjectTemplate, htmlTemplate]);

    const steps: { key: CampaignStep; label: string }[] = [
        { key: 'info', label: 'Details' },
        { key: 'template', label: 'Template' },
        { key: 'recipients', label: 'Recipients' },
        { key: 'confirm', label: 'Send' },
    ];
    const stepIdx = steps.findIndex(s => s.key === step);

    const handleGenerateTemplate = async () => {
        if (!pasteText.trim() || !user?.email) return;
        setGeneratingTemplate(true);
        try {
            const result = await salesService.generateTemplate(user.email, pasteText);
            setSubjectTemplate(result.subject_template);
            setHtmlTemplate(result.html_template);
            setDetectedVars(result.variables);
            toast.success('Template generated! Review and edit below.');
        } catch {
            toast.error('Failed to generate template');
        } finally {
            setGeneratingTemplate(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user?.email) return;
        setImporting(true);
        try {
            const res = await salesService.bulkImportLeads(user.email, file);
            const importedRows: RecipientRow[] = res.contacts
                .filter(c => c.contact_email)
                .map(c => ({
                    email: c.contact_email!,
                    name: c.contact_name || '',
                    variables: {}
                }));
            
            setRecipients(prev => {
                const existing = prev.filter(r => r.email.trim());
                return [...existing, ...importedRows];
            });
            toast.success(`${res.created} contacts imported, ${res.skipped} skipped`);
        } catch (error: any) {
            toast.error(error?.message || 'Failed to import file');
        } finally {
            setImporting(false);
            e.target.value = '';
        }
    };

    const parseCsv = () => {
        const lines = bulkCsv.trim().split('\n').filter(Boolean);
        const parsed: RecipientRow[] = lines.map(line => {
            const parts = line.split(',').map(p => p.trim());
            return { email: parts[0] || '', name: parts[1] || '', variables: {} };
        }).filter(r => r.email.includes('@'));
        if (parsed.length === 0) { toast.error('No valid emails found. Format: email,name'); return; }
        setRecipients(parsed);
        setCsvMode(false);
        toast.success(`${parsed.length} recipients loaded`);
    };

    const addRecipient = () => setRecipients(r => [...r, { email: '', name: '', variables: {} }]);
    const removeRecipient = (i: number) => setRecipients(r => r.filter((_, idx) => idx !== i));
    const updateRecipient = (i: number, field: 'email' | 'name', val: string) =>
        setRecipients(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

    const validRecipients = recipients.filter(r => r.email.includes('@'));

    const handleSendCampaign = async () => {
        if (!user?.email || !name.trim() || !subjectTemplate.trim() || !htmlTemplate.trim()) return;
        if (validRecipients.length === 0) { toast.error('Add at least one valid recipient'); return; }

        setSending(true);
        try {
            const campaign = await salesService.createCampaign(user.email, {
                name,
                subject_template: subjectTemplate,
                html_template: htmlTemplate,
                outreach_tag: outreachTag,
            });

            await salesService.sendCampaign(
                campaign.id, 
                user.email, 
                validRecipients.map(r => ({
                    email: r.email,
                    name: r.name || undefined,
                    variables: { first_name: r.name, ...globalVars, ...r.variables },
                })),
                selectedProductKey || undefined
            );

            toast.success(`Campaign "${name}" is sending to ${validRecipients.length} recipients!`);
            onCreated(campaign);
            onClose();
        } catch {
            toast.error('Failed to launch campaign');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-2xl flex flex-col sm:max-h-[90vh] overflow-hidden"
            >
                <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0 bg-surface/10">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm">
                            <Mail size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-normal tracking-tight text-foreground">Campaign Builder</h2>
                            <p className="text-[11px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">Email Broadcast</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-2xl hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex items-center gap-0 px-6 py-3 border-b border-border shrink-0 bg-background overflow-x-auto no-scrollbar">
                    {steps.map((s, i) => (
                        <React.Fragment key={s.key}>
                            <div className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all ${i === stepIdx ? 'bg-primary/5' : ''}`}>
                                <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-normal border transition-all ${i < stepIdx ? 'bg-success border-success text-white' : i === stepIdx ? 'border-primary bg-primary text-white shadow-lg shadow-primary/20' : 'border-border bg-surface text-muted-foreground'}`}>
                                    {i < stepIdx ? <Check size={12} strokeWidth={3} /> : i + 1}
                                </div>
                                <span className={`text-[12px] font-normal uppercase tracking-wider whitespace-nowrap ${i <= stepIdx ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
                            </div>
                            {i < steps.length - 1 && (
                                <div className="px-4 shrink-0">
                                    <ChevronRight size={14} className="text-muted-foreground/30" />
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 custom-scrollbar">
                    {step === 'info' && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="space-y-3">
                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Select Product Model (Optional)</label>
                                <div className="relative" ref={productDropdownRef}>
                                    <button
                                        type="button"
                                        onClick={() => setShowProductDropdown(!showProductDropdown)}
                                        className="w-full flex items-center justify-between bg-surface border border-border rounded-xl px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium text-foreground cursor-pointer hover:border-border/80"
                                    >
                                        <span className={selectedProductKey ? 'text-foreground' : 'text-muted-foreground'}>
                                            {selectedProductKey 
                                                ? products.find(p => p.product_key === selectedProductKey)?.display_name || selectedProductKey 
                                                : 'None'}
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
                                                        onClick={() => {
                                                            setSelectedProductKey('');
                                                            setGlobalVars({});
                                                            setShowProductDropdown(false);
                                                        }}
                                                        className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-between ${!selectedProductKey ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface hover:text-foreground'}`}
                                                    >
                                                        None
                                                        {!selectedProductKey && <Check size={16} />}
                                                    </button>
                                                    {products.map(p => (
                                                        <button
                                                            type="button"
                                                            key={p.product_key}
                                                            onClick={async () => {
                                                                setSelectedProductKey(p.product_key);
                                                                setShowProductDropdown(false);
                                                                if (user?.email) {
                                                                    try {
                                                                        const prod = await salesService.getProduct(p.product_key, user.email);
                                                                        if (prod.email1_template) {
                                                                            setHtmlTemplate(prod.email1_template);
                                                                        }
                                                                        const vars: Record<string, string> = {};
                                                                        if (prod.deck_link) vars.DeckLink = prod.deck_link;
                                                                        if (prod.cal_link) vars.CalLink = prod.cal_link;
                                                                        if (prod.sender_name) vars.SenderName = prod.sender_name;
                                                                        if (prod.video_link) vars.VideoLink = prod.video_link;
                                                                        setGlobalVars(prev => ({ ...prev, ...vars }));
                                                                    } catch {
                                                                        toast.error('Failed to load product details');
                                                                    }
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
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Internal Campaign Name *</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Q3 Outreach - SaaS Founders"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-normal"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Email Subject Line *</label>
                                <input
                                    type="text"
                                    placeholder="Quick question for {{first_name}} at {{company}}"
                                    value={subjectTemplate}
                                    onChange={e => setSubjectTemplate(e.target.value)}
                                    className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-normal"
                                />
                                <div className="flex items-center gap-2 mt-2 px-1">
                                    <Info size={12} className="text-primary" />
                                    <p className="text-[11px] text-muted-foreground font-normal">Use <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono font-normal text-[10px]">{'{{variable}}'}</code> to personalize</p>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Outreach Tag</label>
                                <input
                                    type="text"
                                    placeholder="e.g. inbound-followup"
                                    value={outreachTag}
                                    onChange={e => setOutreachTag(e.target.value)}
                                    className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                                />
                            </div>
                        </div>
                    )}

                    {step === 'template' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="p-6 rounded-2xl bg-primary/5 border border-primary/10 space-y-4 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shadow-sm border border-primary/10">
                                            <Wand2 size={16} />
                                        </div>
                                        <p className="text-sm font-normal uppercase tracking-tight">AI Template Generator</p>
                                    </div>
                                    <span className="text-[10px] font-normal text-primary bg-primary/10 px-2 py-0.5 rounded uppercase tracking-widest">Premium</span>
                                </div>
                                <p className="text-[12px] text-muted-foreground font-normal leading-relaxed">Paste a rough draft or an example email - we'll transform it into a high-converting template with variables.</p>
                                <textarea
                                    rows={5}
                                    placeholder={"Hi John,\nI noticed that Acme Corp recently launched a new product and wanted to reach out...\n\nBest,\nAlex"}
                                    value={pasteText}
                                    onChange={e => setPasteText(e.target.value)}
                                    className="w-full bg-background border border-border rounded-lg px-4 py-3.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none font-mono placeholder:text-muted-foreground/30 shadow-inner"
                                />
                                <button
                                    type="button"
                                    onClick={handleGenerateTemplate}
                                    disabled={!pasteText.trim() || generatingTemplate}
                                    className="flex items-center gap-2 bg-primary text-white text-[12px] font-normal px-5 py-2 rounded-lg hover:opacity-90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                                >
                                    {generatingTemplate ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                    {generatingTemplate ? 'Thinking...' : 'Generate Template'}
                                </button>
                                {detectedVars.length > 0 && (
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        {detectedVars.map(v => (
                                            <span key={v} className="text-[10px] font-normal bg-background/80 border border-primary/20 text-primary px-3 py-1 rounded-full shadow-sm">
                                                {`{{${v}}}`}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="relative py-2">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-border"></div>
                                </div>
                                <div className="relative flex justify-center text-[10px] font-normal uppercase tracking-[0.3em]">
                                    <span className="bg-background px-4 text-muted-foreground/40">Manual Editor</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between px-1">
                                    <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest">Email Body (HTML/Text) *</label>
                                    <div className="flex items-center gap-2">
                                        <Check size={12} className="text-success" />
                                        <span className="text-[10px] text-muted-foreground font-normal tracking-widest uppercase">Auto-tracking enabled</span>
                                    </div>
                                </div>
                                <textarea
                                    rows={10}
                                    placeholder={"<p>Hi {{first_name}},</p>\n<p>I noticed {{company}} recently...</p>"}
                                    value={htmlTemplate}
                                    onChange={e => setHtmlTemplate(e.target.value)}
                                    className="w-full bg-surface border border-border rounded-2xl px-5 py-4 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none font-mono leading-relaxed"
                                />
                            </div>
                        </div>
                    )}

                    {step === 'recipients' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {detectedVars.filter(v => v !== 'first_name').length > 0 && (
                                <div className="p-5 rounded-2xl bg-surface border border-border space-y-4 shadow-sm">
                                    <div className="flex items-center gap-2">
                                        <Users size={16} className="text-primary" />
                                        <p className="text-[11px] font-normal uppercase tracking-widest text-foreground">Global Variables</p>
                                    </div>
                                    <p className="text-[12px] text-muted-foreground font-normal">Define these once and we'll apply them to all recipients.</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        {detectedVars.filter(v => v !== 'first_name').map(v => (
                                            <div key={v} className="space-y-1.5">
                                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">{v.replace(/_/g, ' ')}</label>
                                                <input
                                                    type="text"
                                                    placeholder={`Value for ${v}...`}
                                                    value={globalVars[v] || ''}
                                                    onChange={e => setGlobalVars(prev => ({ ...prev, [v]: e.target.value }))}
                                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between px-1">
                                <h3 className="text-sm font-normal tracking-tight uppercase text-foreground">Mailing List</h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setCsvMode(!csvMode)}
                                        className="text-[11px] font-normal uppercase tracking-widest text-primary hover:bg-primary/5 px-3 py-1.5 rounded-lg transition-all"
                                    >
                                        {csvMode ? 'Use Form' : 'Paste CSV'}
                                    </button>
                                    <label className={`text-[11px] font-normal uppercase tracking-widest text-primary hover:bg-primary/5 px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
                                        {importing ? <Loader2 size={12} className="animate-spin" /> : null}
                                        {importing ? 'Uploading...' : 'Upload File'}
                                        <input
                                            type="file"
                                            accept=".csv,.xlsx"
                                            className="hidden"
                                            disabled={importing}
                                            onChange={handleFileUpload}
                                        />
                                    </label>
                                </div>
                            </div>

                            {csvMode ? (
                                <div className="space-y-4">
                                    <p className="text-[11px] text-muted-foreground font-normal bg-surface px-4 py-2 rounded-lg border border-border italic">Format per line: <code className="font-mono font-normal text-foreground">email, name</code></p>
                                    <textarea
                                        rows={8}
                                        placeholder={"john@acme.com, John Smith\njane@corp.com, Jane\n..."}
                                        value={bulkCsv}
                                        onChange={e => setBulkCsv(e.target.value)}
                                        className="w-full bg-surface border border-border rounded-2xl px-5 py-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none shadow-inner"
                                    />
                                    <button
                                        type="button"
                                        onClick={parseCsv}
                                        className="flex items-center gap-2 bg-primary text-white text-[12px] font-normal px-6 py-3 rounded-lg hover:opacity-90 shadow-lg shadow-primary/20"
                                    >
                                        <UserPlus size={16} /> Load Contacts
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-[1fr_1fr_auto] gap-4 text-[10px] font-normal text-muted-foreground uppercase tracking-widest px-4">
                                        <span>Email Address *</span><span>Full Name</span><span></span>
                                    </div>
                                    <div className="space-y-2.5 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                                        {recipients.map((r, i) => (
                                            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center group/row">
                                                <input
                                                    type="email"
                                                    placeholder="e.g. john@acme.com"
                                                    value={r.email}
                                                    onChange={e => updateRecipient(i, 'email', e.target.value)}
                                                    className="bg-surface border border-border rounded-lg px-4 py-2 text-sm focus:bg-background transition-all"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="John Smith"
                                                    value={r.name}
                                                    onChange={e => updateRecipient(i, 'name', e.target.value)}
                                                    className="bg-surface border border-border rounded-lg px-4 py-2 text-sm focus:bg-background transition-all"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeRecipient(i)}
                                                    disabled={recipients.length === 1}
                                                    className="p-2 text-muted-foreground/30 hover:text-error hover:bg-error/10 transition-all rounded-lg disabled:opacity-0"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={addRecipient}
                                        className="flex items-center gap-2 text-[12px] font-normal text-primary hover:bg-primary/5 px-4 py-2 rounded-lg transition-all border border-dashed border-primary/20"
                                    >
                                        <Plus size={16} /> Add Another
                                    </button>
                                </div>
                            )}

                            {validRecipients.length > 0 && (
                                <div className="p-4 rounded-2xl bg-success/5 border border-success/10 flex items-center gap-3 animate-in fade-in zoom-in-95 shadow-sm shadow-success/5">
                                    <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center text-success shadow-sm border border-success/10">
                                        <CheckCircle2 size={16} />
                                    </div>
                                    <p className="text-[13px] font-normal text-success uppercase tracking-tight">
                                        {validRecipients.length} contact{validRecipients.length !== 1 ? 's' : ''} ready for broadcast
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {step === 'confirm' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-5 rounded-2xl bg-surface border border-border space-y-4 shadow-sm">
                                    <h3 className="text-[10px] font-normal uppercase tracking-widest text-muted-foreground/60 border-b border-border pb-2">Configuration</h3>
                                    <div className="space-y-3">
                                        {[
                                            { label: 'Group', value: name },
                                            { label: 'Subject', value: subjectTemplate },
                                            { label: 'Count', value: `${validRecipients.length} people` },
                                        ].map(({ label, value }) => (
                                            <div key={label} className="space-y-1">
                                                <span className="text-[10px] font-normal text-muted-foreground/40 uppercase block">{label}</span>
                                                <span className="text-[13px] font-normal text-foreground line-clamp-1">{value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="p-5 rounded-2xl bg-surface border border-border flex flex-col shadow-sm">
                                    <h3 className="text-[10px] font-normal uppercase tracking-widest text-muted-foreground/60 border-b border-border pb-2 mb-3">Live Preview</h3>
                                    <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar max-h-40">
                                        {validRecipients.slice(0, 5).map((r, i) => (
                                            <div key={i} className="flex items-center gap-3 bg-background/50 p-2 rounded-lg border border-border/50">
                                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-[11px] font-normal text-primary border border-primary/10">
                                                    {((r.name || r.email) || 'U')[0].toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[11px] font-normal truncate">{r.name || 'Anonymous'}</p>
                                                    <p className="text-[9px] text-muted-foreground truncate font-mono">{r.email}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {validRecipients.length > 5 && (
                                            <p className="text-[10px] text-muted-foreground font-normal uppercase tracking-widest text-center py-1">+{validRecipients.length - 5} others</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-4">
                                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0 shadow-sm">
                                    <ShieldCheck size={20} />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[13px] text-amber-700 font-normal tracking-tight">System Notice</p>
                                    <p className="text-[12px] text-amber-600/80 font-normal leading-relaxed">
                                        Campaign will be dispatched via your secure SMTP relay. Engagement (opens, clicks, replies) will be monitored in real-time.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between px-8 py-6 border-t border-border shrink-0 bg-surface/30">
                    <button
                        type="button"
                        onClick={() => {
                            const prev: CampaignStep[] = ['info', 'info', 'template', 'recipients'];
                            setStep(prev[stepIdx]);
                        }}
                        disabled={stepIdx === 0}
                        className="flex items-center gap-2 text-sm font-normal text-muted-foreground hover:text-foreground transition-all disabled:opacity-0 px-4 py-2 rounded-lg"
                    >
                        <ChevronLeft size={18} /> Back
                    </button>

                    <div className="flex items-center gap-4">
                        <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-normal text-muted-foreground hover:text-foreground transition-all hover:bg-surface">Cancel</button>
                        {step !== 'confirm' ? (
                            <button
                                type="button"
                                onClick={() => {
                                    const next: CampaignStep[] = ['template', 'recipients', 'confirm', 'confirm'];
                                    if (step === 'info' && (!name.trim() || !subjectTemplate.trim())) {
                                        toast.error('Campaign name and subject are required');
                                        return;
                                    }
                                    if (step === 'template' && !htmlTemplate.trim()) {
                                        toast.error('Email body cannot be empty');
                                        return;
                                    }
                                    setStep(next[stepIdx]);
                                }}
                                className="flex items-center gap-2 bg-foreground text-background text-sm font-normal px-5 py-2 rounded-lg hover:opacity-90 transition-all shadow-lg shadow-foreground/10"
                            >
                                Continue <ChevronRight size={18} />
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSendCampaign}
                                disabled={sending}
                                className="flex items-center gap-2 bg-primary text-white text-sm font-normal px-10 py-3 rounded-lg hover:opacity-90 transition-all shadow-xl shadow-primary/30 disabled:opacity-60"
                            >
                                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                {sending ? 'Launching...' : `Launch Broadcast`}
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
