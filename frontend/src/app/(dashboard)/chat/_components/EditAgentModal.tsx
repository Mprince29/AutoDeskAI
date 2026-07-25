import React from "react";
import {
  XCircle,
  Edit,
  User,
  Settings,
  Database,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { AgentQualityPreview } from "./AgentModals";
import { Agent } from "@/types/agent.types";
import { motion } from "framer-motion";

export function EditAgentModal({
  editingAgent,
  editForm,
  setEditForm,
  customInstructions,
  setCustomInstructions,
  uploadedDoc,
  onUpload,
  onRemoveDoc,
  onSave,
  onClose,
  isSaving,
  fileInputRef,
}: {
  editingAgent: Agent;
  editForm: { name: string; description: string; role: string; industry: string };
  setEditForm: (f: { name: string; description: string; role: string; industry: string }) => void;
  customInstructions: string;
  setCustomInstructions: (s: string) => void;
  uploadedDoc: { id: string; filename: string } | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveDoc: () => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-300">
      <div className="w-full h-[100dvh] md:h-auto max-w-4xl bg-background border border-border/60 rounded-none md:rounded-2xl flex flex-col max-h-none md:max-h-[90vh] shadow-2xl shadow-black/10 overflow-hidden relative">
        <div className="w-full flex gap-5 flex-col items-center p-4  relative z-20">
          <div className="w-full flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                <Edit className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-foreground tracking-tight capitalize">
                  {editingAgent?.id === 'new' ? 'Create Your AI Agent' : 'Update Your Agent'}
                </h2>
                <p className="text-xs font-medium text-muted mt-1 capitalize">Identity & Skills</p>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-xl flex items-center justify-center bg-background hover:bg-surface border border-border/60 text-muted transition-all">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          <AgentQualityPreview form={editForm} hasContext={!!uploadedDoc} hasInstructions={!!customInstructions.trim()} />
        </div>

        <div className="px-8 py-6 overflow-y-auto flex-1 space-y-10 relative z-20 custom-scrollbar">

          {/* Section 01: Core Identity */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-xs font-bold text-primary">01</div>
              <span className="text-xs font-bold capitalize text-foreground">Basic Info</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted capitalize ml-1 cursor-pointer">Agent Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full bg-background/30 border border-border/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-xl px-4 py-3.5 text-[13px] font-bold transition-all outline-none placeholder:text-muted/30"
                  placeholder="e.g. Research Assistant"
                />
                {!editForm.name.trim() && (
                  <p className="text-[10px] text-error/70 mt-1">Name is required to save</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted capitalize ml-1 cursor-pointer">Role / Job Title</label>
                <input
                  type="text"
                  value={editForm.role}
                  onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full bg-background/30 border border-border/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-xl px-4 py-3.5 text-[13px] font-bold transition-all outline-none placeholder:text-muted/30"
                  placeholder="e.g. SEO Specialist"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted capitalize ml-1 cursor-pointer">Task Description</label>
              <textarea
                value={editForm.description}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                className="w-full bg-background/30 border border-border/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-xl px-4 py-3.5 text-[12px] font-bold min-h-[100px] transition-all outline-none resize-none placeholder:text-muted/30"
                placeholder="Describe tasks..."
              />
            </div>
          </div>

          {/* Section 02: Training & Instructions */}
          <div className="space-y-6 pt-2">
            <div className="flex items-center gap-3">
              <div className="px-2 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-xs font-bold text-orange-500">02</div>
              <span className="text-xs font-bold capitalize text-foreground">Detailed Instructions</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted capitalize ml-1 cursor-pointer">Industry / Sector</label>
              <input
                type="text"
                value={editForm.industry}
                onChange={e => setEditForm({ ...editForm, industry: e.target.value })}
                className="w-full bg-background/30 border border-border/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-xl px-4 py-3.5 text-[13px] font-bold transition-all outline-none placeholder:text-muted/30"
                placeholder="e.g. Real Estate, Marketing..."
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between ml-1">
                <label className="text-xs font-medium text-muted capitalize">Step-By-Step Instructions</label>
                <span className="text-[10px] font-medium text-orange-500/60 capitalize text-right">Expert Mode</span>
              </div>
              <textarea
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                className="w-full bg-background border border-border/30 focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/10 rounded-xl px-5 py-5 text-[11px] font-mono min-h-[140px] transition-all outline-none resize-none text-orange-400 placeholder:text-orange-900/30 custom-scrollbar shadow-inner"
                placeholder="// Enter detailed instructions..."
              />
            </div>
          </div>

          {/* Section 03: Knowledge Base */}
          <div className="space-y-6 pt-2">
            <div className="flex items-center gap-3">
              <div className="px-2 py-0.5 rounded-md bg-success/10 border border-success/20 text-xs font-bold text-success">03</div>
              <span className="text-xs font-bold capitalize text-foreground">Resources</span>
            </div>
            <input ref={fileInputRef} type="file" className="hidden" onChange={onUpload} />
            {uploadedDoc ? (
              <div className="flex items-center justify-between p-5 rounded-2xl border border-success/30 bg-success/5 group/doc transition-all hover:bg-success/10">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center border border-success/30">
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <span className="text-xs font-black text-foreground block truncate max-w-[200px]">{uploadedDoc.filename}</span>
                    <span className="text-[9px] font-bold text-success/60 uppercase tracking-widest">File Successfully Linked</span>
                  </div>
                </div>
                <button 
                  onClick={onRemoveDoc} 
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black text-error border border-error/20 hover:bg-error/10 transition-all opacity-0 group-hover/doc:opacity-100 uppercase tracking-wider"
                >
                  Remove File
                </button>
              </div>
            ) : (
              <button 
                onClick={() => fileInputRef.current?.click()} 
                className="group relative w-full py-8 rounded-2xl border-2 border-dashed border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-all outline-none"
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-surface-hover flex items-center justify-center border border-border/60 group-hover:border-primary/30 transition-all">
                    <Database className="w-5 h-5 text-muted group-hover:text-primary transition-colors" />
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] font-black text-muted-dark uppercase tracking-widest group-hover:text-primary transition-colors">UPLOAD FILE</p>
                    <p className="text-[9px] font-medium text-muted/60 mt-1">PDF, DOCX, JSON</p>
                  </div>
                </div>
              </button>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-border/60 relative z-20 flex justify-end items-center gap-5 bg-background">
          <button 
            onClick={onClose} 
            className="px-6 py-2.5 rounded-xl text-[11px] font-black tracking-widest text-muted-dark hover:text-foreground transition-all border border-transparent hover:bg-white/5"
          >
            Cancel
          </button>
          <button 
            onClick={onSave} 
            disabled={isSaving || !editForm.name.trim()} 
            className="relative group px-10 py-3 rounded-xl overflow-hidden shadow-2xl shadow-primary/20 disabled:opacity-50 disabled:shadow-none transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent transition-transform duration-500 group-hover:scale-110" />
            <div className="relative flex items-center gap-2">
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <>
                  <span className="text-[12px] font-black tracking-[0.15em] text-white">Create Agent</span>
                  <CheckCircle2 className="w-4 h-4 text-white/70" />
                </>
              )}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
