"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Zap, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService, Sequence, Lead } from '@/services/sales.service';
import { toast } from 'sonner';

interface EnrollSequenceModalProps {
    onClose: () => void;
    sequences: Sequence[];
    leads: Lead[];
    onEnrolled: () => Promise<void> | void;
}

export function EnrollSequenceModal({
    onClose,
    sequences,
    leads,
    onEnrolled,
}: EnrollSequenceModalProps) {
    const { user } = useAuth();
    const [sequenceId, setSequenceId] = useState<number>(sequences[0]?.id ?? 0);
    const [sendHour, setSendHour] = useState(9);
    const [saving, setSaving] = useState(false);

    const eligibleLeads = leads.filter((lead) => lead.contact_email && lead.contact_email.includes('@'));

    const handleEnroll = async () => {
        if (!user?.email || !sequenceId || eligibleLeads.length === 0) return;
        setSaving(true);
        try {
            const res = await salesService.enrollToSequence(
                sequenceId,
                user.email,
                eligibleLeads.map((lead) => ({
                    email: lead.contact_email!,
                    name: lead.contact_name,
                    timezone: lead.lead_timezone || undefined,
                    variables: {
                        first_name: lead.contact_name.split(' ')[0] || lead.contact_name,
                        company: lead.company,
                    },
                })),
                sendHour,
            );
            toast.success(`Enrolled ${res.enrolled} contact${res.enrolled !== 1 ? 's' : ''}`);
            await onEnrolled();
            onClose();
        } catch (e: any) {
            toast.error(e.message || 'Enrollment failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-md overflow-hidden"
            >
                <div className="p-8 border-b border-border flex items-center justify-between bg-surface/30">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm shadow-primary/5">
                            <Plus size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-normal tracking-tight text-foreground">Enroll in Series</h2>
                            <p className="text-[11px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">{eligibleLeads.length} People Selected</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2.5 rounded-2xl hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 space-y-6">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Select Workflow</label>
                        <select
                            value={sequenceId}
                            onChange={(e) => setSequenceId(Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-normal appearance-none cursor-pointer"
                        >
                            <option value="">Choose a follow-up series...</option>
                            {sequences.map((sequence) => (
                                <option key={sequence.id} value={sequence.id}>{sequence.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest ml-1">Start Hour (24h)</label>
                        <input
                            type="number"
                            min={0}
                            max={23}
                            value={sendHour}
                            onChange={(e) => setSendHour(Math.max(0, Math.min(23, parseInt(e.target.value) || 9)))}
                            className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-normal"
                        />
                    </div>

                    <div className="rounded-2xl border border-border bg-surface/30 p-2 text-[12px] max-h-48 overflow-y-auto custom-scrollbar shadow-inner">
                        {eligibleLeads.map((lead) => (
                            <div key={lead.id} className="flex items-center justify-between py-2 px-4 rounded-lg hover:bg-background/50 transition-all group">
                                <div className="min-w-0 flex-1">
                                    <p className="font-normal text-foreground truncate">{lead.contact_name}</p>
                                    <p className="text-[10px] text-muted-foreground truncate">{lead.company}</p>
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground/40 px-2 py-0.5 border border-border/50 rounded bg-background/50">{lead.contact_email}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-8 border-t border-border bg-surface/30 flex gap-4">
                    <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm font-normal text-muted-foreground hover:bg-background transition-all">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleEnroll}
                        disabled={saving || !sequenceId || eligibleLeads.length === 0}
                        className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-normal flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                        Confirm Enrollment
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
