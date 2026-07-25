"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Zap, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService, Sequence, SequenceStep } from '@/services/sales.service';
import { toast } from 'sonner';

export const STOP_ON_OPTIONS = [
    { value: 'reply', label: 'Reply received' },
    { value: 'open', label: 'Email opened' },
    { value: 'click', label: 'Link clicked' },
    { value: 'none', label: 'Always continue' },
];

interface SequenceBuilderModalProps {
    onClose: () => void;
    onCreated: (seq: Sequence) => void;
}

export function SequenceBuilderModal({ onClose, onCreated }: SequenceBuilderModalProps) {
    const { user } = useAuth();
    const [name, setName] = useState('');
    const [steps, setSteps] = useState<SequenceStep[]>([
        { step_number: 1, delay_days: 0, subject_template: '', html_template: '', stop_on: 'reply' },
    ]);
    const [saving, setSaving] = useState(false);

    const addStep = () => setSteps(prev => [
        ...prev,
        { step_number: prev.length + 1, delay_days: 3, subject_template: '', html_template: '', stop_on: 'reply' },
    ]);

    const removeStep = (i: number) => setSteps(prev =>
        prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, step_number: idx + 1 }))
    );

    const updateStep = (i: number, patch: Partial<SequenceStep>) =>
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));

    const handleSave = async () => {
        if (!user?.email || !name.trim()) return;
        const invalidStep = steps.findIndex(s => !s.subject_template.trim() || !s.html_template.trim());
        if (invalidStep >= 0) { toast.error(`Step ${invalidStep + 1}: subject and email body are required`); return; }
        setSaving(true);
        try {
            const seq = await salesService.createSequence(user.email, { name, steps });
            toast.success(`Sequence "${seq.name}" created with ${steps.length} step${steps.length !== 1 ? 's' : ''}`);
            onCreated(seq);
            onClose();
        } catch {
            toast.error('Failed to create sequence');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-2xl flex flex-col sm:max-h-[90vh] overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div>
                        <h2 className="text-base font-normal text-foreground">Set Up Follow-up Emails</h2>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Send a series of emails automatically, one after another.</p>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                </div>

                <div className="overflow-y-auto flex-1 px-5 py-3 space-y-4">
                    {/* Sequence name */}
                    <div>
                        <label className="text-[11px] font-normal uppercase tracking-wider text-muted-foreground block mb-1">Give this a name</label>
                        <input
                            className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                            placeholder="Q3 SaaS Founders Drip"
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                    </div>

                    {/* Steps */}
                    {steps.map((step, i) => (
                        <div key={i} className="border border-border/60 rounded-lg p-4 space-y-3 bg-surface/30">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-normal uppercase tracking-wider text-primary">Step {step.step_number}</span>
                                {steps.length > 1 && (
                                    <button onClick={() => removeStep(i)} className="text-muted-foreground hover:text-destructive transition-colors"><X size={14} /></button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-normal text-muted-foreground uppercase block mb-1">
                                        {i === 0 ? 'Send immediately after enroll' : 'Wait (days after prev step)'}
                                    </label>
                                    <input
                                        type="number" min={0} max={90}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                                        value={step.delay_days}
                                        disabled={i === 0}
                                        onChange={e => updateStep(i, { delay_days: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-normal text-muted-foreground uppercase block mb-1">Stop advancing if</label>
                                    <select
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                                        value={step.stop_on}
                                        onChange={e => updateStep(i, { stop_on: e.target.value as SequenceStep['stop_on'] })}
                                    >
                                        {STOP_ON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-normal text-muted-foreground uppercase block mb-1">Subject</label>
                                <input
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                                    placeholder="Quick question, {{first_name}}"
                                    value={step.subject_template}
                                    onChange={e => updateStep(i, { subject_template: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-normal text-muted-foreground uppercase block mb-1">Email Body (HTML or plain)</label>
                                <textarea
                                    rows={4}
                                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none font-mono"
                                    placeholder={`Hi {{first_name}},\n\nI noticed {{company}} recently...`}
                                    value={step.html_template}
                                    onChange={e => updateStep(i, { html_template: e.target.value })}
                                />
                            </div>
                        </div>
                    ))}

                    <button onClick={addStep} className="w-full py-2 rounded-lg border-2 border-dashed border-border hover:border-primary/40 text-sm font-normal text-muted-foreground hover:text-primary transition-all flex items-center justify-center gap-2">
                        <Plus size={15} /> Add Step
                    </button>
                </div>

                <div className="px-5 py-3 border-t border-border flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm font-normal text-muted-foreground hover:bg-surface transition-colors">Cancel</button>
                    <button onClick={handleSave} disabled={saving || !name.trim()} className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-normal flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-60">
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                        Save & Start
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
