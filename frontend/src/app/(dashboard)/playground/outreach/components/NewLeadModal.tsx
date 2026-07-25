"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Plus } from 'lucide-react';
import { CreateLeadPayload } from '@/services/sales.service';

interface NewLeadModalProps {
    onClose: () => void;
    onSave: (payload: CreateLeadPayload) => Promise<void>;
}

export function NewLeadModal({ onClose, onSave }: NewLeadModalProps) {
    const [form, setForm] = useState<CreateLeadPayload>({
        contact_name: '',
        company: '',
        contact_email: '',
        role: '',
        domain: '',
        list_tag: '',
        geo_tag: ''
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.contact_name.trim() || !form.company.trim()) return;
        setSaving(true);
        try {
            await onSave(form);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-md flex flex-col relative overflow-hidden"
            >
                <div className="p-6 border-b border-border flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-normal tracking-tight text-foreground">Add Contact</h2>
                        <p className="text-[11px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">Direct Entry</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground transition-all">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        {[
                            { key: 'contact_name', label: 'Full Name *', placeholder: 'Jane Smith', col: 'col-span-2' },
                            { key: 'company', label: 'Company *', placeholder: 'Acme Corp', col: 'col-span-2' },
                            { key: 'contact_email', label: 'Email', placeholder: 'jane@acme.com', col: 'col-span-2' },
                            { key: 'role', label: 'Role / Title', placeholder: 'VP of Sales', col: 'col-span-1' },
                            { key: 'domain', label: 'Website Domain', placeholder: 'acme.com', col: 'col-span-1' },
                            { key: 'list_tag', label: 'Project Tag', placeholder: 'e.g. Retail I', col: 'col-span-1' },
                            { key: 'geo_tag', label: 'Geography', placeholder: 'e.g. Germany', col: 'col-span-1' },
                        ].map(({ key, label, placeholder, col }) => (
                            <div key={key} className={col}>
                                <label className="text-[10px] font-normal text-muted-foreground uppercase tracking-widest block mb-1.5 ml-1">{label}</label>
                                <input
                                    type="text"
                                    placeholder={placeholder}
                                    value={(form as any)[key]}
                                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                                    className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/40"
                                    required={key === 'contact_name' || key === 'company'}
                                />
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm font-normal text-muted-foreground hover:bg-surface transition-all">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 py-3 rounded-lg bg-primary text-white text-sm font-normal flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                            Save Contact
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
}
