"use client";

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, FileUp, Upload, Loader2, Send, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { salesService, Lead, BulkValidateResult } from '@/services/sales.service';
import { toast } from 'sonner';

interface BulkImportModalProps {
    onClose: () => void;
    onImported: (leads: Lead[]) => void;
}

export function BulkImportModal({ onClose, onImported }: BulkImportModalProps) {
    const { user } = useAuth();
    const fileRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [validating, setValidating] = useState(false);
    const [importing, setImporting] = useState(false);
    const [validation, setValidation] = useState<BulkValidateResult | null>(null);
    const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

    const handleValidate = async () => {
        if (!file || !user?.email) return;
        setValidating(true);
        try {
            const res = await salesService.bulkValidateLeads(user.email, file);
            setValidation(res);
            toast.success(`Validated ${res.total} row${res.total !== 1 ? 's' : ''}`);
        } catch (e: any) {
            toast.error(e.message || 'Validation failed');
        } finally {
            setValidating(false);
        }
    };

    const handleImport = async () => {
        if (!file || !user?.email) return;
        setImporting(true);
        try {
            const res = await salesService.bulkImportLeads(user.email, file);
            setResult({ created: res.created, skipped: res.skipped });
            onImported(res.contacts);
            toast.success(`${res.created} leads imported!`);
        } catch (e: any) {
            toast.error(e.message || 'Import failed');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md sm:p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-background sm:border border-border shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.1)] sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-md p-6 relative overflow-hidden"
            >
                <div className="absolute top-0 right-0 p-12 bg-primary/5 blur-[80px] rounded-full -mr-16 -mt-16" />

                <div className="relative flex items-center justify-between mb-10">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm shadow-primary/5">
                            <FileUp size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-normal tracking-tight text-foreground">Bulk Import</h2>
                            <p className="text-[11px] text-muted-foreground font-normal tracking-widest uppercase mt-0.5">CSV / XLSX Upload</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2.5 rounded-2xl hover:bg-surface transition-all text-muted-foreground hover:text-foreground">
                        <X size={20} />
                    </button>
                </div>

                {!result ? (
                    <div className="relative space-y-8">
                        <div className="p-5 rounded-2xl bg-surface/50 border border-border space-y-3">
                            <p className="text-[10px] font-normal text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                <CheckCircle2 size={12} className="text-primary" /> Format Guidelines
                            </p>
                            <div className="space-y-2.5 text-[12px] text-muted-foreground leading-relaxed">
                                <p>Accepted: <span className="text-foreground font-normal italic">CSV, XLSX, TXT</span></p>
                                <p>Columns: <code className="bg-background border border-border px-1.5 py-0.5 rounded text-primary font-mono text-[10px] shadow-sm">name, email, company</code></p>
                                <p>Optional: <code className="bg-background border border-border px-1.5 py-0.5 rounded font-mono text-[10px] shadow-sm text-foreground/70">role, domain</code></p>
                            </div>
                        </div>

                        <div
                            onClick={() => fileRef.current?.click()}
                            className={`group relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-300 ${file ? 'border-primary/50 bg-primary/5 shadow-inner' : 'border-border hover:border-primary/40 hover:bg-surface/80'}`}
                        >
                            <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-5 transition-all duration-300 ${file ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-surface text-muted-foreground group-hover:text-primary group-hover:scale-110 shadow-sm border border-border'}`}>
                                <Upload size={28} />
                            </div>
                            {file ? (
                                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <p className="text-sm font-normal text-foreground">{file.name}</p>
                                    <p className="text-[10px] text-primary font-normal mt-1.5 uppercase tracking-widest bg-primary/10 px-3 py-1 rounded-full inline-block">{(file.size / 1024).toFixed(1)} KB · Ready</p>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <p className="text-[15px] font-normal text-foreground">Drop your file here</p>
                                    <p className="text-[11px] text-muted-foreground font-normal">or click to browse local files</p>
                                </div>
                            )}
                            <input
                                ref={fileRef}
                                type="file"
                                accept=".csv,.xlsx,.xls,.txt"
                                className="hidden"
                                onChange={e => {
                                    setFile(e.target.files?.[0] ?? null);
                                    setValidation(null);
                                }}
                            />
                        </div>

                        {validation && (
                            <div className="rounded-2xl border border-border bg-surface/50 p-5 space-y-4 animate-in slide-in-from-top-4 duration-500">
                                <div className="flex items-center justify-between text-[10px] font-normal uppercase tracking-widest">
                                    <span className="text-muted-foreground">Validation Summary</span>
                                    <span className="bg-background px-2.5 py-1 rounded-lg border border-border text-foreground">
                                        {validation.valid} valid / {validation.invalid} invalid
                                    </span>
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-2.5 pr-2 custom-scrollbar">
                                    {validation.rows.slice(0, 10).map((row) => (
                                        <div key={row.row} className="rounded-lg border border-border bg-background px-4 py-3 shadow-sm group/row hover:border-primary/30 transition-colors">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <p className="font-normal text-[12px] truncate">{row.contact_name || 'Unnamed'}</p>
                                                    <p className="text-[10px] text-muted-foreground/60 font-mono">Row {row.row}</p>
                                                </div>
                                                <span className={`text-[10px] font-normal uppercase tracking-wider px-2 py-0.5 rounded-lg border ${row.valid ? 'text-success bg-success/10 border-success/20' : 'text-warning bg-warning/10 border-warning/20'}`}>
                                                    {row.valid ? 'Ready' : row.issues[0]}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    {validation.rows.length > 10 && (
                                        <p className="text-[10px] text-muted-foreground font-normal text-center py-1">+{validation.rows.length - 10} more rows...</p>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex gap-4 pt-2">
                            <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm font-normal text-muted-foreground hover:bg-surface transition-all">
                                Cancel
                            </button>
                            <button
                                onClick={validation ? handleImport : handleValidate}
                                disabled={!file || importing || validating}
                                className="flex-1 py-3.5 rounded-2xl bg-primary text-white text-sm font-normal flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-primary/20 disabled:opacity-40"
                            >
                                {validating || importing ? <Loader2 size={18} className="animate-spin" /> : validation ? <Send size={18} /> : <CheckCircle2 size={18} />}
                                {validating ? 'Validating...' : importing ? 'Importing...' : validation ? 'Confirm Import' : 'Validate File'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="relative space-y-8 text-center animate-in zoom-in-95 duration-500 py-4">
                        <div className="w-24 h-24 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-success/20 shadow-xl shadow-success/10">
                            <CheckCircle2 size={48} className="text-success" />
                        </div>
                        <div className="space-y-3">
                            <h3 className="text-xl sm:text-2xl font-normal tracking-tight text-foreground">{result.created} Contacts Added</h3>
                            <p className="text-sm text-muted-foreground px-8 leading-relaxed font-normal">Excellent! Your mailing list has been updated and enrichment is starting in the background.</p>
                            {result.skipped > 0 && (
                                <p className="text-[10px] font-normal text-warning uppercase tracking-widest bg-warning/5 py-1.5 px-4 rounded-full inline-block mt-4 border border-warning/10">
                                    {result.skipped} rows skipped (invalid data)
                                </p>
                            )}
                        </div>
                        <button onClick={onClose} className="w-full py-2 rounded-lg bg-foreground text-background text-sm font-normal hover:opacity-90 transition-all shadow-lg shadow-foreground/10">
                            Done
                        </button>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
