"use client";
import { useAuth } from "@/context/AuthContext";
import { apiService } from "@/services/api";
import {
  Upload,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Download,
  X,
  RefreshCw,
  Table2,
  Trash2,
  Hash,
  Calendar,
  AlignLeft,
  Copy,
  ChevronRight,
  Info,
  Loader2,
  FileSpreadsheet,
  ChevronLeft
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CleanIssue {
  type: string;
  detail: string;
  action: string;
  count?: number;
  mapping?: Record<string, string>;
  by_column?: Record<string, unknown>;
}

interface CleanResult {
  cleaned_csv: string;
  original_shape: [number, number];
  cleaned_shape: [number, number];
  rows_removed: number;
  cols_removed: number;
  issues: CleanIssue[];
}

// ── Issue icon map ─────────────────────────────────────────────────────────────

const ISSUE_META: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  empty_rows: { label: "Empty Rows", color: "#F87171", Icon: Trash2 },
  phantom_columns: { label: "Phantom Columns", color: "#FB923C", Icon: Table2 },
  headers_normalised: { label: "Headers Normalised", color: "#22D3EE", Icon: AlignLeft },
  nulls_standardised: { label: "Nulls Standardised", color: "#FCD34D", Icon: X },
  whitespace_stripped: { label: "Whitespace Stripped", color: "#A78BFA", Icon: AlignLeft },
  duplicates: { label: "Duplicate Rows", color: "#F87171", Icon: Copy },
  numeric_cleaned: { label: "Numeric Formatting", color: "#34D399", Icon: Hash },
  dates_normalised: { label: "Date Formats", color: "#22D3EE", Icon: Calendar },
  missing_values: { label: "Missing Values", color: "#FB923C", Icon: AlertTriangle },
  malformed_rows: { label: "Malformed Rows", color: "#F87171", Icon: AlertTriangle },
};

function issueMeta(type: string) {
  return ISSUE_META[type] ?? { label: type, color: "#94A3B8", Icon: AlertTriangle };
}

// ── Preview first N rows of a CSV string ─────────────────────────────────────

/** RFC 4180-compliant single-row parser - handles quoted fields with embedded commas/newlines. */
function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] === '"') {
      // quoted field
      i++;
      let field = "";
      while (i < row.length) {
        if (row[i] === '"' && row[i + 1] === '"') { field += '"'; i += 2; }
        else if (row[i] === '"') { i++; break; }
        else { field += row[i++]; }
      }
      fields.push(field.trim());
      if (row[i] === ',') i++;
    } else {
      const end = row.indexOf(',', i);
      if (end === -1) { fields.push(row.slice(i).trim()); break; }
      fields.push(row.slice(i, end).trim());
      i = end + 1;
    }
  }
  return fields;
}

function parsePreview(csv: string, maxRows = 6): { headers: string[]; rows: string[][] } {
  // Split on newlines but respect quoted newlines by scanning character-by-character
  const csvLines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') { inQuotes = !inQuotes; current += ch; }
    else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current.trim()) csvLines.push(current);
      current = "";
      if (ch === '\r' && csv[i + 1] === '\n') i++; // CRLF
    } else { current += ch; }
  }
  if (current.trim()) csvLines.push(current);

  if (csvLines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvRow(csvLines[0]);
  const rows = csvLines.slice(1, maxRows + 1).map(parseCsvRow);
  return { headers, rows };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DataCleanerPage() {
  const { user } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setDocId(null);
    setResult(null);
    setError(null);
  };

  const handleFile = useCallback(async (f: File) => {
    if (!user) return;
    if (!f.name.endsWith(".csv")) {
      setError("Only CSV files are supported.");
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
    setUploading(true);
    try {
      const doc = await apiService.uploadDocument(user.email, f);
      setDocId(doc.id);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [user]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleClean = async () => {
    if (!user || !docId) return;
    setCleaning(true);
    setError(null);
    try {
      const res = await apiService.cleanCsv(user.email, docId);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cleaning failed.");
    } finally {
      setCleaning(false);
    }
  };

  const downloadClean = () => {
    if (!result) return;
    const blob = new Blob([result.cleaned_csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleaned_${file?.name ?? "data.csv"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const preview = result ? parsePreview(result.cleaned_csv) : null;

  return (
    <div className="relative min-h-[100dvh] lg:h-screen w-full flex flex-col bg-background text-foreground overflow-x-hidden lg:overflow-hidden font-sans">
      {/* Ambient Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
      </div>

      <main className="relative z-10 flex flex-col flex-1 pt-4 lg:pt-4 w-full px-4 pb-10 overflow-y-auto lg:overflow-hidden min-h-0 custom-scrollbar">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 md:gap-4">
            <button
              onClick={() => router.push('/playground')}
              className="p-2.5 hover:bg-surface/50 rounded-xl border border-border/20 transition-all active:scale-95"
            >
              <ChevronLeft className="w-5 h-5 text-muted" />
            </button>
            <div className="p-2 md:p-3 bg-primary/10 rounded-xl md:rounded-2xl border border-primary/20 shrink-0">
              <Table2 className="w-5 h-5 md:w-6 md:h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-black text-foreground tracking-tighter leading-none mb-1 md:mb-1.5">CSV Cleaner</h1>
              <p className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] text-primary/70 truncate">Autonomous AI Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-4 py-2 bg-surface/30 rounded-xl border border-border/40 backdrop-blur-sm text-xs font-bold text-muted flex items-center gap-2">
              <Info className="w-4 h-4" />
              CSV FORMAT ONLY
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
          {/* ── Left: Upload + Issues ── */}
          <div className="lg:col-span-3 space-y-4 flex flex-col h-auto lg:h-full lg:min-h-0 lg:overflow-hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="flex flex-col flex-1 min-h-0"
            >
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => !file && fileInputRef.current?.click()}
                className={`relative group rounded-2xl p-1 flex flex-col items-center justify-center transition-all duration-500 min-h-[180px] h-48 lg:h-60 border-2 border-dashed overflow-hidden ${file
                  ? 'border-primary/40 bg-primary/[0.03]'
                  : 'border-border/30 bg-surface/10 hover:border-primary/40 hover:bg-surface/20'
                  }`}
              >
                {/* Animated Border SVG (Only if no file yet) */}
                {!file && !uploading && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <rect
                      width="100%" height="100%"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="12 12"
                      className="text-primary/10 group-hover:text-primary/30 transition-colors"
                      style={{
                        animation: 'marching-ants 20s linear infinite',
                      }}
                    />
                  </svg>
                )}

                <style jsx>{`
                  @keyframes marching-ants {
                    0% { stroke-dashoffset: 0; }
                    100% { stroke-dashoffset: 1000; }
                  }
                `}</style>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                />

                <AnimatePresence mode="wait">
                  {uploading ? (
                    <motion.div
                      key="uploading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <Loader2 className="w-12 h-12 text-primary animate-spin" />
                      <div className="text-center">
                        <p className="text-base font-bold text-foreground">Synchronizing Buffer</p>
                        <p className="text-xs font-black uppercase tracking-widest text-muted mt-1">Uploading payload...</p>
                      </div>
                    </motion.div>
                  ) : file ? (
                    <motion.div
                      key="file"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="flex flex-col items-center gap-4 w-full px-6"
                    >
                      <div className="p-3 bg-background/50 rounded-lg border border-primary/20 relative group-hover:scale-105 transition-transform backdrop-blur-sm">
                        <FileSpreadsheet className="w-8 h-8 text-primary" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground max-w-[180px] truncate">{file.name}</p>
                        <p className="text-[10px] font-black text-muted uppercase mt-1">{(file.size / 1024).toFixed(1)} KB · READY</p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); reset(); }}
                        className="p-2 bg-surface hover:bg-error/10 rounded-lg transition-colors border border-border/40"
                      >
                        <Trash2 className="w-5 h-5 text-error/60" />
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <div className="w-16 h-16 rounded-xl bg-surface flex items-center justify-center border border-border/50 group-hover:border-primary/40 transition-all">
                        <Upload className="w-6 h-6 text-muted/50 group-hover:text-primary transition-colors" />
                      </div>
                      <div className="text-center">
                        <p className="text-base font-bold text-foreground">Drop Memory Object</p>
                        <p className="text-xs font-black uppercase tracking-widest text-muted mt-1 group-hover:text-primary/70">Click to browse filesystem</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Decorative Elements */}
                <div className="absolute top-8 right-8 w-12 h-12 opacity-30">
                  <div className="absolute top-0 right-0 w-full h-[1.5px] bg-primary/40" />
                  <div className="absolute top-0 right-0 w-[1.5px] h-full bg-primary/40" />
                </div>
                <div className="absolute bottom-8 left-8 w-12 h-12 opacity-30 rotate-180">
                  <div className="absolute top-0 right-0 w-full h-[1.5px] bg-primary/40" />
                  <div className="absolute top-0 right-0 w-[1.5px] h-full bg-primary/40" />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 rounded-lg bg-error/5 border border-error/20 flex items-center gap-3 text-error"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <p className="text-xs font-bold leading-tight">{error}</p>
                </motion.div>
              )}

              {file && docId && !result && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={handleClean}
                  disabled={cleaning}
                  className="mt-6 w-full btn-primary py-4 rounded-xl flex items-center justify-center gap-3 font-black tracking-widest leading-relaxed group hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  {cleaning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing Engine...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 group-hover:animate-pulse" />
                      Start Cleaning
                    </>
                  )}
                </motion.button>
              )}

              {/* Issues list */}
              <AnimatePresence>
                {result && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 flex flex-col flex-1 lg:min-h-0"
                  >
                    <div className="rounded-xl overflow-hidden bg-surface/[0.03] border border-border/20 backdrop-blur-xl flex flex-col h-auto lg:h-full min-h-0">
                      <div className="px-5 py-3 flex items-center justify-between bg-background/60 border-b border-border/20">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center border border-success/20">
                            <CheckCircle2 className="w-4 h-4 text-success" />
                          </div>
                          <div>
                            <span className="text-xs font-black uppercase tracking-[0.2em] text-foreground">Analysis Log</span>
                            <p className="text-[10px] font-bold text-muted mt-0.5">Stream Integrity Report</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                            {result.issues.length} ANOMALIES
                          </span>
                        </div>
                      </div>

                      <div className="lg:flex-1 lg:overflow-y-auto p-4 custom-scrollbar space-y-4">
                        {result.issues.map((issue, i) => {
                          const { label, color, Icon } = issueMeta(issue.type);
                          return (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05 }}
                              className="p-3 rounded-lg bg-background/60 border border-border/10 flex items-start gap-3 hover:border-primary/30 hover:bg-background/80 transition-all group relative overflow-hidden"
                            >
                              <div className="absolute top-0 left-0 w-[2px] h-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: color }} />
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}10`, border: `1px solid ${color}20` }}>
                                <Icon className="w-4 h-4" style={{ color }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <h4 className="text-sm md:text-base font-black text-foreground tracking-tight">{label}</h4>
                                  <span className="text-[8px] md:text-[9px] font-black text-muted uppercase tracking-widest bg-surface/50 px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg border border-border/20">
                                    {issue.action}
                                  </span>
                                </div>
                                <p className="text-[11px] md:text-xs text-muted/80 leading-relaxed font-semibold mb-3">{issue.detail}</p>

                                {issue.mapping && Object.keys(issue.mapping).length > 0 && (
                                  <div className="flex flex-wrap gap-2 py-1">
                                    {Object.entries(issue.mapping).slice(0, 4).map(([old, neo]) => (
                                      <div key={old} className="flex items-center gap-2 px-3 py-1.5 bg-surface/40 rounded-xl border border-border/10 text-[10px] font-black group/map">
                                        <span className="text-muted/40 line-through truncate max-w-[80px]">{old}</span>
                                        <ChevronRight className="w-3 h-3 opacity-20" />
                                        <span className="text-primary truncate max-w-[100px]">{neo}</span>
                                      </div>
                                    ))}
                                    {Object.keys(issue.mapping).length > 4 && (
                                      <div className="px-2 py-1 bg-surface/20 rounded-lg border border-border/10 text-[8px] font-black text-muted/40 tracking-widest flex items-center">
                                        + {Object.keys(issue.mapping).length - 4} OTHERS
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}

                        {result.issues.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-24 relative">
                            <div className="relative">
                              <CheckCircle2 className="w-20 h-20 text-success/20 mb-6" />
                              <motion.div
                                animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.5, 0.2] }}
                                transition={{ duration: 3, repeat: Infinity }}
                                className="absolute inset-0 bg-success/10 rounded-full blur-2xl"
                              />
                            </div>
                            <p className="text-sm font-black uppercase tracking-[0.3em] text-success/60 text-center">Protocol Verified</p>
                            <p className="text-[10px] font-bold text-muted/40 mt-2 uppercase tracking-widest">Target Buffer Status: Normal</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          {/* ── Right: Stats + Preview + Download ── */}
          <div className="lg:col-span-9 space-y-6 flex flex-col h-auto lg:h-full lg:min-h-0 lg:overflow-hidden">
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-4 flex flex-col h-full"
                >
                  {/* Stats Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Original', val: result.original_shape[0], color: 'text-muted', gradient: 'from-surface/80 to-surface/40' },
                      { label: 'Cleaned', val: result.cleaned_shape[0], color: 'text-success', gradient: 'from-success/10 to-success/[0.02]' },
                      { label: 'Rows Purged', val: result.rows_removed, color: 'text-error', gradient: 'from-error/10 to-error/[0.02]' },
                      { label: 'Cols Purged', val: result.cols_removed, color: 'text-warning', gradient: 'from-warning/10 to-warning/[0.02]' },
                    ].map(({ label, val, color, gradient }) => (
                      <div key={label} className={`rounded-xl p-3 flex flex-col items-center justify-center border border-border/30 backdrop-blur-xl relative overflow-hidden group bg-gradient-to-br ${gradient}`}>
                        <div className="relative z-10 text-center">
                          <motion.p
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className={`text-2xl md:text-3xl font-black tracking-tighter ${color}`}
                          >
                            {val}
                          </motion.p>
                          <p className="text-[8px] md:text-[9px] font-black text-muted uppercase tracking-[0.25em] mt-1 opacity-60 group-hover:opacity-100 transition-opacity">{label}</p>
                        </div>
                        <div className="absolute -bottom-4 -right-4 opacity-[0.03] group-hover:opacity-[0.07] transition-all duration-700 group-hover:scale-110 group-hover:-rotate-12">
                          <Hash className="w-16 h-16" />
                        </div>
                        <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                      </div>
                    ))}
                  </div>

                  {/* Preview table */}
                  {preview && preview.headers.length > 0 && (
                    <div className="flex-1 rounded-2xl overflow-hidden bg-surface/[0.05] border border-border/20 flex flex-col backdrop-blur-3xl relative min-h-0">
                      <div className="px-5 md:px-8 py-3 md:py-4 flex items-center justify-between bg-background/60 border-b border-border/20 relative z-10">
                        <div className="flex items-center gap-3 md:gap-4">
                          <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-lg shadow-primary/5">
                            <Table2 className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                          </div>
                          <div>
                            <span className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] text-foreground block">Clean Data Buffer</span>
                            <div className="flex items-center gap-2 md:gap-3 mt-0.5 md:mt-1">
                              <span className="text-[8px] md:text-[9px] font-black px-1.5 md:py-0.5 rounded-md bg-surface/50 text-muted border border-border/20 uppercase tracking-widest">
                                {result.cleaned_shape[1]} COLS
                              </span>
                              <div className="w-0.5 h-0.5 md:w-1 md:h-1 rounded-full bg-border" />
                              <span className="text-[8px] md:text-[9px] font-black px-1.5 md:py-0.5 rounded-md bg-surface/50 text-muted border border-border/20 uppercase tracking-widest">
                                {result.cleaned_shape[0]} ROWS
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                        </div>
                      </div>

                      <div className="flex-1 overflow-auto custom-scrollbar relative z-10 bg-background/20">
                        <table className="w-full text-sm border-separate border-spacing-0">
                          <thead className="sticky top-0 z-20">
                            <tr className="bg-background/80 backdrop-blur-xl">
                              {preview.headers.map(h => (
                                <th key={h} className="px-4 py-3 text-left font-black uppercase tracking-[0.15em] whitespace-nowrap text-primary border-b border-border/30 text-[10px]">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.map((row, i) => (
                              <tr key={i} className="group hover:bg-primary/[0.04] transition-all">
                                {row.map((cell, j) => (
                                  <td key={j} className="px-4 py-2.5 text-muted/80 whitespace-nowrap max-w-[250px] truncate border-b border-border/[0.05] group-last:border-0 transition-colors group-hover:text-foreground">
                                    {cell ? (
                                      <span className="opacity-90">{cell}</span>
                                    ) : (
                                      <span className="italic opacity-30 font-black text-[9px] tracking-widest px-2 py-0.5 bg-muted/10 rounded-md border border-muted/20">NULL</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Download Section */}
                      <div className="py-5 md:py-6 px-4 md:px-8 border-t border-border/20 bg-background/60 backdrop-blur-md relative z-10">
                        <div className="flex flex-col sm:flex-row gap-4 md:gap-5">
                          <button
                            onClick={downloadClean}
                            className="w-full sm:flex-[3] btn-primary py-3 rounded-xl font-black text-[10px] md:text-[11px] uppercase tracking-[0.2em] md:tracking-[0.3em] leading-relaxed flex items-center justify-center gap-3 md:gap-4 transition-all hover:scale-[1.01] active:scale-[0.98] group"
                          >
                            <Download className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-y-0.5 transition-transform" />
                            <span>Download Buffer</span>
                          </button>
                          <button
                            onClick={reset}
                            className="w-full sm:flex-1 py-3 rounded-xl text-[10px] md:text-[11px] font-black text-muted uppercase tracking-[0.2em] leading-relaxed hover:text-error hover:bg-error/5 border border-border/20 transition-all flex items-center justify-center gap-3 group/flush"
                          >
                            <RefreshCw className="w-4 h-4 md:w-5 md:h-5 group-hover/flush:rotate-[360deg] transition-transform duration-700 opacity-60" />
                            FLUSH
                          </button>
                        </div>
                      </div>

                      {/* Decorative Background Element */}
                      <div className="absolute bottom-0 right-0 w-64 h-64 bg-primary/5 rounded-full filter blur-[100px] pointer-events-none" />
                    </div>
                  )}
                </motion.div>
              ) : (
                /* Placeholder when no result yet */
                <motion.div
                  key="placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center gap-4 lg:gap-6 rounded-lg border-2 border-dashed border-border/40 bg-surface/10 p-6 lg:p-12 text-center"
                >
                  <div className="w-24 h-24 rounded-lg bg-surface flex items-center justify-center border border-border/50 relative overflow-hidden group">
                    <Table2 className="w-10 h-10 text-muted/30 group-hover:text-primary transition-colors relative z-10" />
                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-foreground mb-2">Awaiting Intelligence Payload</h3>
                    <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed font-medium">
                      Upload any unstructured CSV buffer. The cleaning engine will auto-detect missing values,
                      duplicates, invalid date structures, and phantom columns.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 opacity-50">
                    {['Duplicates', 'Nulls', 'Outliers', 'Headers'].map(tag => (
                      <span key={tag} className="px-3 py-1 bg-surface border border-border/50 rounded-full text-[10px] font-black uppercase tracking-widest">{tag}</span>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
