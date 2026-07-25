"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, X, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService } from '@/services/sales.service';
import { toast } from 'sonner';

interface AddProductForm {
    display_name: string;
    product_description: string;
    pain_points: string;
    social_proof: string;
    sender_name: string;
    sender_title: string;
    cal_link: string;
}

interface AddProductModalProps {
    onClose: () => void;
    onCreated: () => void;
}

const EMPTY_FORM: AddProductForm = {
    display_name: '',
    product_description: '',
    pain_points: '',
    social_proof: '',
    sender_name: '',
    sender_title: '',
    cal_link: '',
};

export function AddProductModal({ onClose, onCreated }: AddProductModalProps) {
    const { user } = useAuth();
    const [form, setForm] = useState<AddProductForm>(EMPTY_FORM);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        if (!user?.email || !form.display_name.trim()) return;
        setLoading(true);
        try {
            await salesService.createProduct(user.email, {
                display_name: form.display_name.trim(),
                product_description: form.product_description || undefined,
                pain_points: form.pain_points
                    ? form.pain_points.split('\n').map((s) => s.trim()).filter(Boolean)
                    : undefined,
                social_proof: form.social_proof
                    ? form.social_proof.split('\n').map((s) => s.trim()).filter(Boolean)
                    : undefined,
                sender_name: form.sender_name || undefined,
                sender_title: form.sender_title || undefined,
                cal_link: form.cal_link || undefined,
            });
            toast.success('Product added successfully');
            onCreated();
            onClose();
        } catch (err: any) {
            toast.error(err?.message || 'Failed to add product');
        } finally {
            setLoading(false);
        }
    };

    const field = (key: keyof AddProductForm, value: string) =>
        setForm((f) => ({ ...f, [key]: value }));

    return (
        <AnimatePresence>
            <motion.div
                key="add-product-modal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.95, y: 20 }}
                    className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border/20">
                        <div className="flex items-center gap-2">
                            <Package size={16} className="text-primary" />
                            <h2 className="text-sm font-bold uppercase tracking-widest">Add New Product</h2>
                        </div>
                        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                                Product Name <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Retailio AI, EBIC"
                                value={form.display_name}
                                onChange={(e) => field('display_name', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm border border-border/30 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                                Product Description
                            </label>
                            <textarea
                                rows={3}
                                placeholder="1-2 sentence value prop for this product..."
                                value={form.product_description}
                                onChange={(e) => field('product_description', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm border border-border/30 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40 resize-none"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                                Pain Points{' '}
                                <span className="text-muted-foreground/40 font-normal normal-case">(one per line)</span>
                            </label>
                            <textarea
                                rows={3}
                                placeholder={"Manual monitoring takes 8 hrs/week\nDelayed alerts miss crisis windows"}
                                value={form.pain_points}
                                onChange={(e) => field('pain_points', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm border border-border/30 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40 resize-none"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                                Social Proof{' '}
                                <span className="text-muted-foreground/40 font-normal normal-case">(one per line)</span>
                            </label>
                            <textarea
                                rows={2}
                                placeholder={"8 hrs/week saved\n95% compliance rate"}
                                value={form.social_proof}
                                onChange={(e) => field('social_proof', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm border border-border/30 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40 resize-none"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                                    Sender Name
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Alex"
                                    value={form.sender_name}
                                    onChange={(e) => field('sender_name', e.target.value)}
                                    className="w-full px-3 py-2.5 text-sm border border-border/30 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                                    Sender Title
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Co-Founder"
                                    value={form.sender_title}
                                    onChange={(e) => field('sender_title', e.target.value)}
                                    className="w-full px-3 py-2.5 text-sm border border-border/30 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                                Calendar Link
                            </label>
                            <input
                                type="url"
                                placeholder="https://cal.com/..."
                                value={form.cal_link}
                                onChange={(e) => field('cal_link', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm border border-border/30 rounded-lg bg-surface/50 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
                            />
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-border/20 flex items-center justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !form.display_name.trim()}
                            className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                        >
                            {loading ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
                            Save Product
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
