"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { 
  Table2, Search, ExternalLink, RefreshCw, 
  Loader2, MoreVertical, FilePlus2, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { SiGooglesheets } from "react-icons/si";

import WorkspaceSkeleton from "@/components/shared/WorkspaceSkeleton";

export default function SheetsPage() {
  const { user, loading, preferences } = useAuth();
  const router = useRouter();
  const { assets, fetching, fetchAssets, initialLoadDone } = useWorkspaceStore();
  const docs = assets["sheets"] || [];
  const isFetching = fetching["sheets"];
  const isLoaded = initialLoadDone["sheets"];
  
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/auth");
  }, [user, loading, router]);

  const loadDocs = useCallback(async () => {
    if (!user?.email || !preferences?.gmail_connected) return;
    await fetchAssets(user.email, "sheets");
  }, [user?.email, preferences?.gmail_connected, fetchAssets]);

  useEffect(() => {
    if (user && preferences?.gmail_connected && !isLoaded) {
      loadDocs();
    }
  }, [user, preferences?.gmail_connected, loadDocs, isLoaded]);

  const filteredDocs = useMemo(() => {
    return docs.filter(doc => 
      doc.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [docs, searchTerm]);

  const totalPages = Math.ceil(filteredDocs.length / itemsPerPage);
  const paginatedDocs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredDocs.slice(start, start + itemsPerPage);
  }, [filteredDocs, currentPage]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-background/50 backdrop-blur-xl border-b border-border/40 shrink-0 gap-3">
        <div className="flex items-center justify-between sm:justify-start gap-4 flex-1 sm:flex-none">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <SiGooglesheets className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-sm font-black text-foreground tracking-tight uppercase leading-none">Smart Sheets</h1>
              <p className="text-[10px] text-muted mt-1 font-medium">Your AI-enhanced Google Spreadsheets</p>
            </div>
          </div>
          <button 
            onClick={loadDocs}
            className="sm:hidden p-2 rounded-xl text-muted hover:text-foreground hover:bg-surface/60 border border-border/10 transition-all"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </button>
        </div>

        <div className="flex-1 sm:max-w-xl sm:px-8">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder="Search your sheets..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-surface/50 border border-border/40 hover:border-border-light focus:border-primary/40 focus:bg-background rounded-2xl pl-10 pr-4 py-2 text-sm outline-none transition-all"
            />
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <button 
            onClick={loadDocs}
            className="p-2 rounded-xl text-muted hover:text-foreground hover:bg-surface/60 border border-border/10 transition-all"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </button>
        </div>
      </header>

      {loading || !preferences || (isFetching && !isLoaded) ? <WorkspaceSkeleton /> : <main className="flex-1 overflow-y-auto custom-scrollbar bg-surface/10 flex flex-col">
        {!preferences?.gmail_connected ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-6 border border-primary/20">
              <Table2 className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-black text-foreground mb-3">Connect Google Drive</h2>
            <p className="text-muted text-sm mb-8">Access and manage your Google Sheets directly within AutoDeskAI.</p>
            <button className="btn-primary px-8 py-3 rounded-2xl">Enable Workspace</button>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-30 grayscale">
            <FilePlus2 className="w-16 h-16 mb-4" />
            <p className="text-sm font-black uppercase tracking-widest">No sheets found</p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 bg-background overflow-hidden">
            <div className="flex-1 divide-y divide-border/20 overflow-y-auto">
              {paginatedDocs.map((doc) => (
                <div 
                  key={doc.id}
                  className="p-4 hover:bg-surface/40 transition-colors items-center cursor-pointer group"
                  onClick={() => setPreviewDoc(doc)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center">
                        <Table2 className="w-8 h-8 text-emerald-500" />
                      </div>
                      <div className="flex flex-col gap-0">
                        <span className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">{doc.name}</span>
                        <span className="text-[11px] text-muted font-medium">
                          {formatDistanceToNow(new Date(doc.modifiedTime), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="p-2 rounded-xl text-muted hover:text-foreground hover:bg-surface transition-all">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-border/40 flex items-center justify-between bg-surface/10">
                <span className="text-[11px] text-muted font-medium uppercase tracking-tight">
                  Page <span className="text-foreground font-black">{currentPage}</span> of <span className="text-foreground font-black">{totalPages}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover disabled:opacity-30 text-[10px] font-black uppercase tracking-widest transition-all border border-border/40"
                  >
                    Previous
                  </button>
                  <button 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover disabled:opacity-30 text-[10px] font-black uppercase tracking-widest transition-all border border-border/40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>}

      <AnimatePresence>
        {previewDoc && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={() => setPreviewDoc(null)} />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="relative w-full h-full max-w-6xl bg-background border border-border shadow-2xl rounded-3xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-surface/20 shrink-0">
                <div className="flex items-center gap-3 overflow-hidden">
                  <Table2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <h2 className="text-sm font-bold text-foreground truncate">{previewDoc.name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => window.open(previewDoc.webViewLink, "_blank")} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-hover text-[11px] font-bold text-foreground transition-all border border-border/40">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Original
                  </button>
                  <button onClick={() => setPreviewDoc(null)} className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-foreground transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 bg-white relative">
                <iframe src={previewDoc.webViewLink} className="w-full h-full border-none" title={previewDoc.name} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
