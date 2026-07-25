"use client";
import React, { useState } from "react";
import { Email, EmailReply } from "@/services/api";
import { apiService } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { Sparkles, Send, X, Loader2, RefreshCw, Briefcase, Smile, User, MessageSquare, Zap } from "lucide-react";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AIReplyModalProps {
  email: Email;
  isOpen: boolean;
  onClose: () => void;
  onReplySent?: () => void;
}

const toneConfigs = [
  { id: 'professional', label: 'Professional', icon: <Briefcase className="w-3.5 h-3.5" />, color: 'text-primary' },
  { id: 'friendly', label: 'Friendly', icon: <Smile className="w-3.5 h-3.5" />, color: 'text-success' },
  { id: 'casual', label: 'Casual', icon: <User className="w-3.5 h-3.5" />, color: 'text-muted' },
  { id: 'formal', label: 'Formal', icon: <Briefcase className="w-3.5 h-3.5" />, color: 'text-foreground' }
];

export default function AIReplyModal({
  email,
  isOpen,
  onClose,
  onReplySent
}: AIReplyModalProps) {
  const { user } = useAuth();
  const [tone, setTone] = useState('professional');
  const [customMessage, setCustomMessage] = useState('');
  const [generatedReply, setGeneratedReply] = useState<EmailReply | null>(null);
  const [editedReply, setEditedReply] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [, setError] = useState('');

  if (!isOpen) return null;

  const handleGenerateReply = async () => {
    if (!user) return;
    setIsGenerating(true);
    setError('');
    try {
      const reply = await apiService.generateReply(user.email, email.id, tone, customMessage || undefined);
      setGeneratedReply(reply);
      setEditedReply(reply.reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate reply');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendReply = async () => {
    if (!user || !generatedReply) return;
    setIsSending(true);
    setError('');
    try {
      await apiService.sendReply(user.email, email.id, editedReply || generatedReply.reply);
      onReplySent?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-6 overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-background/60 backdrop-blur-xl cursor-alias"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-3xl h-[100dvh] md:h-fit max-h-none md:max-h-full bg-surface/80 backdrop-blur-2xl border-0 md:border border-border/40 rounded-none md:rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-border/40 bg-background/40">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-black text-foreground tracking-tight">Autonomous Reply Generation</h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted/60 mt-0.5">Engine: Agentic AI-4</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2.5 hover:bg-surface rounded-xl text-muted transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 bg-background/20 space-y-8">
            {/* Original Digest */}
            <div className="p-5 bg-surface/40 border border-border/20 rounded-2xl">
              <h3 className="text-[9px] font-black text-muted uppercase tracking-[0.2em] mb-3">Context Buffer</h3>
              <p className="text-xs text-muted/80 italic line-clamp-2 leading-relaxed font-medium">
                &ldquo;{email.body || email.snippet}&rdquo;
              </p>
            </div>

            {/* Neural Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] px-1">Tone Vector</label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger className="w-full h-12 bg-background/40 border-border/20 rounded-xl text-xs font-bold focus:ring-1 focus:ring-primary/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-surface/90 backdrop-blur-xl border-border/40 rounded-xl shadow-2xl">
                    {toneConfigs.map(t => (
                      <SelectItem key={t.id} value={t.id} className="text-xs font-bold py-2.5">
                        <div className="flex items-center gap-3">
                          <div className={clsx("p-1 rounded-md", t.color.replace('text-', 'bg-') + '/10', t.color)}>
                            {t.icon}
                          </div>
                          {t.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] px-1">Bias / Instructions</label>
                <input
                  type="text"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="e.g. 'Express interest for next Tuesday'"
                  className="w-full h-12 px-4 bg-background/40 border border-border/20 rounded-xl text-xs font-bold outline-none focus:border-primary/40 transition-all placeholder:text-muted/40"
                />
              </div>
            </div>

            {/* AI Result Area */}
            <div className="relative min-h-[240px] border border-border/10 rounded-2xl overflow-hidden bg-background/10">
              <AnimatePresence mode="wait">
                {isGenerating ? (
                  <motion.div 
                    key="generating"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center"
                  >
                    <div className="relative w-16 h-16 mb-6">
                      <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                      <div className="relative w-full h-full bg-primary/20 backdrop-blur-md border border-primary/40 rounded-full flex items-center justify-center">
                        <Zap className="w-6 h-6 text-primary animate-pulse" />
                      </div>
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary animate-pulse">Computing Response Vector...</p>
                  </motion.div>
                ) : generatedReply ? (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="p-6 space-y-6"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-success shadow-lg shadow-success/40" />
                        <h3 className="text-[9px] font-black text-success uppercase tracking-[0.2em]">Generated Intelligence</h3>
                      </div>
                      <span className="text-[9px] font-bold text-muted/40 uppercase">Editable Field</span>
                    </div>
                    <textarea
                      value={editedReply}
                      onChange={(e) => setEditedReply(e.target.value)}
                      rows={8}
                      className="w-full text-xs font-medium text-foreground/80 bg-background/40 border border-border/10 rounded-xl p-4 leading-relaxed outline-none focus:border-primary/20 transition-all resize-none"
                    />
                    {generatedReply.suggested_labels && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {generatedReply.suggested_labels.map(l => (
                          <span key={l} className="px-2.5 py-1 bg-primary/5 text-primary text-[9px] font-black uppercase tracking-widest border border-primary/10 rounded-lg">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted/40">
                    <MessageSquare className="w-10 h-10 mb-4 stroke-[1.5]" />
                    <p className="text-[10px] font-black uppercase tracking-widest">Initialise sequence to begin</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-8 py-6 border-t border-border/40 bg-background/40 flex items-center justify-end gap-4">
            {!generatedReply ? (
              <button
                onClick={handleGenerateReply}
                disabled={isGenerating}
                className="flex items-center gap-3 px-8 py-3.5 bg-primary text-primary-foreground rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-98 transition-all disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Process Logic
              </button>
            ) : (
              <>
                <button
                  onClick={handleGenerateReply}
                  disabled={isGenerating}
                  className="flex items-center gap-3 px-6 py-3.5 bg-surface text-foreground border border-border/40 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-surface-hover transition-all"
                >
                  <RefreshCw className={clsx("w-4 h-4", isGenerating && "animate-spin")} />
                  Reroute
                </button>
                <button
                  onClick={handleSendReply}
                  disabled={isSending}
                  className="flex items-center gap-3 px-8 py-3.5 bg-primary text-primary-foreground rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-98 transition-all disabled:opacity-50"
                >
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Deploy Stream
                </button>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
