"use client";
import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  X,
  Send,
  Save,
  MessageSquare,
  AlertCircle,
  Loader2,
  User,
  Type,
  AlignLeft,
  CheckCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface EmailComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEmailSent?: () => void;
  onDraftCreated?: () => void;
  replyTo?: {
    emailId: string;
    subject: string;
    from: string;
    threadId?: string;
  };
}

export default function EmailComposeModal({
  isOpen,
  onClose,
  onEmailSent,
  onDraftCreated,
  replyTo
}: EmailComposeModalProps) {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    to: replyTo?.from || "",
    subject: replyTo?.subject ? `Re: ${replyTo.subject}` : "",
    body: ""
  });
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError("");
    setSuccess("");
  };

  const handleSend = async () => {
    if (!formData.to || !formData.subject || !formData.body) {
      setError("Please fill in all fields before sending.");
      return;
    }
    if (!user?.email) return;
    setSending(true);
    setError("");
    try {
      const { apiService } = await import("@/services/api");
      await apiService.composeEmail(user.email, formData.to, formData.subject, formData.body);
      setSuccess("Message sent successfully!");
      setTimeout(() => {
        onClose();
        onEmailSent?.();
        setFormData({ to: "", subject: "", body: "" });
        setSuccess("");
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!formData.to || !formData.subject || !formData.body) {
      setError("Please fill in all fields to save a draft.");
      return;
    }
    if (!user?.email) return;
    setSaving(true);
    setError("");
    try {
      const { apiService } = await import("@/services/api");
      await apiService.createDraft(user.email, formData.to, formData.subject, formData.body);
      setSuccess("Draft saved successfully!");
      setTimeout(() => {
        onClose();
        onDraftCreated?.();
        setFormData({ to: "", subject: "", body: "" });
        setSuccess("");
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-6 overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-background/60 backdrop-blur-xl cursor-alias"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-3xl h-[100dvh] md:h-fit max-h-none md:max-h-full bg-surface/80 backdrop-blur-2xl border-0 md:border border-border/40 rounded-none md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-border/40 bg-background/40">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">
                  {replyTo ? "Reply" : "New Message"}
                </h2>
                <p className="text-[11px] text-muted/60 mt-0.5">
                  {replyTo ? `Replying to conversation` : "Compose a new email"}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2.5 hover:bg-surface rounded-xl text-muted transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 bg-background/20 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted/80 px-1">To</label>
                <div className="relative group">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted group-focus-within:text-primary transition-colors" />
                  <input
                    type="email"
                    value={formData.to}
                    onChange={(e) => handleInputChange("to", e.target.value)}
                    className="w-full h-12 pl-11 pr-4 bg-background/40 border border-border/20 rounded-xl text-[13px] font-medium outline-none focus:border-primary/40 focus:bg-background/60 transition-all placeholder:text-muted/30"
                    placeholder="email@example.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted/80 px-1">Subject</label>
                <div className="relative group">
                  <Type className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted group-focus-within:text-primary transition-colors" />
                  <input
                    type="text"
                    value={formData.subject}
                    onChange={(e) => handleInputChange("subject", e.target.value)}
                    className="w-full h-12 pl-11 pr-4 bg-background/40 border border-border/20 rounded-xl text-[13px] font-medium outline-none focus:border-primary/40 focus:bg-background/60 transition-all placeholder:text-muted/30"
                    placeholder="What is this about?"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted/80 px-1">Message</label>
              <div className="relative group min-h-[320px] flex flex-col">
                <AlignLeft className="absolute left-4 top-5 w-3.5 h-3.5 text-muted group-focus-within:text-primary transition-colors" />
                <textarea
                  value={formData.body}
                  onChange={(e) => handleInputChange("body", e.target.value)}
                  className="flex-1 w-full pl-11 pr-6 py-5 bg-background/40 border border-border/20 rounded-2xl text-[13px] font-medium leading-relaxed outline-none focus:border-primary/40 focus:bg-background/60 transition-all placeholder:text-muted/30 resize-none"
                  placeholder="Write your message here..."
                />
              </div>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-[10px] font-black uppercase tracking-widest flex items-center gap-3">
                <AlertCircle className="w-4 h-4" />
                {error}
              </motion.div>
            )}

            {success && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-success/10 border border-success/20 rounded-xl text-success text-[10px] font-black uppercase tracking-widest flex items-center gap-3">
                <CheckCircle className="w-4 h-4" />
                {success}
              </motion.div>
            )}
          </div>

          {/* Actions */}
          <div className="px-8 py-6 border-t border-border/40 bg-background/40 flex items-center justify-between">
            <button onClick={onClose} className="px-6 py-3 hover:bg-surface rounded-xl text-xs font-bold text-muted hover:text-foreground transition-all">
              Cancel
            </button>
 
            <div className="flex items-center gap-4">
              <button
                onClick={handleSaveDraft}
                disabled={saving || sending}
                className="flex items-center gap-3 px-6 py-3.5 bg-surface text-foreground border border-border/40 rounded-xl text-xs font-bold hover:bg-surface-hover transition-all"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 text-muted" />}
                {saving ? "Saving..." : "Save Draft"}
              </button>
 
              <button
                onClick={handleSend}
                disabled={sending || saving}
                className="flex items-center gap-3 px-8 py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold shadow-xl shadow-primary/20 hover:opacity-90 active:scale-98 transition-all disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}