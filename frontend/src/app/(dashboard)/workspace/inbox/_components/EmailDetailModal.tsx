"use client";
import React, { useState } from "react";
import { Email } from "@/services/api";
import { format } from "date-fns";
import {
  Mail,
  X,
  Tag,
  Sparkles,
  AlertCircle,
  Trash2,
  Clock,
  User,
  Reply,
  CalendarCheck,
  Star,
  StarOff,
  AtSign,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "framer-motion";

interface EmailDetailModalProps {
  email: Email | null;
  isOpen: boolean;
  onClose: () => void;
  onReply?: (emailId: string) => void;
  onSchedule?: (emailId: string) => void;
  onModifyLabels?: (emailId: string, addLabels?: string[], removeLabels?: string[]) => void;
  onDelete?: (emailId: string) => void;
}

type Category = "important" | "meeting_request" | "personal" | "spam" | string;

const CATEGORY_CONFIG: Record<string, { label: string; gradient: string; ring: string; icon: React.ReactNode }> = {
  important: { label: "Important", gradient: "from-amber-500/20 to-orange-500/10", ring: "border-amber-400/40", icon: <AlertCircle className="w-3.5 h-3.5" /> },
  meeting_request: { label: "Meeting Request", gradient: "from-primary/20 to-accent/10", ring: "border-primary/40", icon: <CalendarCheck className="w-3.5 h-3.5" /> },
  personal: { label: "Personal", gradient: "from-emerald-500/20 to-teal-500/10", ring: "border-emerald-400/40", icon: <User className="w-3.5 h-3.5" /> },
  spam: { label: "Spam", gradient: "from-rose-500/20 to-red-500/10", ring: "border-rose-400/40", icon: <AlertCircle className="w-3.5 h-3.5" /> },
  default: { label: "General", gradient: "from-surface to-background", ring: "border-border/40", icon: <Mail className="w-3.5 h-3.5" /> },
};

const LABEL_PILL_MAP: Record<string, { bg: string; text: string }> = {
  INBOX: { bg: "bg-primary/10", text: "text-primary" },
  IMPORTANT: { bg: "bg-amber-500/10", text: "text-amber-500" },
  STARRED: { bg: "bg-yellow-400/10", text: "text-yellow-500" },
  SPAM: { bg: "bg-rose-500/10", text: "text-rose-500" },
  SENT: { bg: "bg-teal-500/10", text: "text-teal-500" },
  DRAFT: { bg: "bg-muted/10", text: "text-muted" },
};

function getCategoryConfig(category: Category) {
  return CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.default;
}

/** Decode HTML entities so raw &#39; / &amp; etc. don't appear in the body */
function decodeHtmlEntities(text: string): string {
  if (typeof window === "undefined") {
    // SSR fallback: handle the most common ones
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&nbsp;/g, " ");
  }
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

function ShieldCheck({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

export default function EmailDetailModal({
  email,
  isOpen,
  onClose,
  onReply,
  onSchedule,
  onModifyLabels,
  onDelete,
}: EmailDetailModalProps) {
  const [showAllLabels, setShowAllLabels] = useState(false);

  if (!isOpen || !email) return null;

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "EEEE, MMMM d, yyyy");
    } catch {
      return "Unknown date";
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return format(new Date(dateString), "h:mm a");
    } catch {
      return "";
    }
  };

  const category = email.classification?.category ?? "default";
  const catConfig = getCategoryConfig(category);
  const isImportant = email.labelIds?.includes("IMPORTANT");
  const isSpam = email.labelIds?.includes("SPAM");
  const classification = email.classification;

  const visibleLabels = showAllLabels ? email.labelIds : email.labelIds?.slice(0, 3);
  const hiddenCount = (email.labelIds?.length ?? 0) - 3;

  const fromName = email.from?.split("<")[0]?.trim() || email.from || "Unknown Sender";
  const fromEmail = email.from?.match(/<(.+)>/)?.[1] || email.from || "";

  const handleAction = async (action: "reply" | "schedule" | "spam" | "important" | "delete") => {
    try {
      switch (action) {
        case "reply":
          onReply?.(email.id);
          return;
        case "schedule":
          onSchedule?.(email.id);
          break;
        case "spam":
          if (isSpam) {
            await onModifyLabels?.(email.id, ["INBOX"], ["SPAM"]);
          } else {
            await onModifyLabels?.(email.id, ["SPAM"], ["INBOX"]);
          }
          return;
        case "important":
          if (isImportant) {
            await onModifyLabels?.(email.id, undefined, ["IMPORTANT"]);
          } else {
            await onModifyLabels?.(email.id, ["IMPORTANT"]);
          }
          return;
        case "delete":
          onDelete?.(email.id);
          break;
      }
      onClose();
    } catch (err) {
      console.error("Action failed:", err);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-8 overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-background/70 backdrop-blur-2xl cursor-alias"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 24 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="relative w-full max-w-4xl h-[100dvh] md:h-[88vh] max-h-none md:max-h-[600px] flex flex-col bg-surface/60 backdrop-blur-3xl border-0 md:border border-border/50 rounded-none md:rounded-[2rem] shadow-[0_40px_160px_-40px_rgba(0,0,0,0.6)] overflow-hidden"
        >
          {/* Ambient glow */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[2rem]">
            <div className={clsx("absolute -top-32 -left-32 w-80 h-80 rounded-full blur-[100px] opacity-30 bg-gradient-to-br", catConfig.gradient)} />
            <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full blur-[100px] opacity-20 bg-primary/20" />
          </div>

          {/* ── HEADER ── */}
          <div className="relative flex-none flex items-start justify-between gap-3 md:gap-4 px-4 md:px-8 py-5 md:py-6 border-b border-border/30 bg-background/30">
            {/* Left: Avatar + metadata */}
            <div className="flex items-start gap-3 md:gap-5 min-w-0">
              {/* Sender avatar */}
              <div className="flex-none relative">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/30 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10">
                  <span className="text-base md:text-lg font-black text-primary">
                    {fromName.charAt(0).toUpperCase()}
                  </span>
                </div>
                {/* Category indicator dot */}
                <div className={clsx(
                  "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-surface flex items-center justify-center",
                  category === "important" ? "bg-amber-400" :
                    category === "meeting_request" ? "bg-primary" :
                      category === "personal" ? "bg-emerald-400" :
                        category === "spam" ? "bg-rose-500" : "bg-muted/40"
                )} />
              </div>

              {/* Subject + sender info */}
              <div className="min-w-0 flex-1">
                <h2 className="text-base md:text-lg font-black text-foreground tracking-tight leading-snug line-clamp-2 max-w-[520px]">
                  {email.subject || "No Subject"}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex items-center gap-1.5">
                    <User className="w-3 h-3 text-muted/60 flex-none" />
                    <span className="text-xs md:text-sm font-semibold text-foreground/80">{fromName}</span>
                  </div>
                  {fromEmail && fromEmail !== fromName && (
                    <div className="flex items-center gap-1 text-[10px] md:text-xs text-muted/60">
                      <AtSign className="w-3 h-3 flex-none" />
                      <span className="font-mono truncate max-w-[120px] md:max-w-none">{fromEmail}</span>
                    </div>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] md:text-xs text-muted/50">
                  <div className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5 flex-none" />
                    <span>{formatDate(email.date)}</span>
                  </div>
                  <span className="hidden md:inline text-muted/30">·</span>
                  <span className="font-semibold text-muted/60">{formatTime(email.date)}</span>
                </div>
              </div>
            </div>

            {/* Right: Pill + close */}
            <div className="flex-none flex items-center gap-3">
              {/* Category badge */}
              <div className={clsx(
                "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border",
                catConfig.ring,
                "bg-gradient-to-r",
                catConfig.gradient,
                "text-foreground/80"
              )}>
                {catConfig.icon}
                {catConfig.label}
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                className="p-2.5 rounded-xl bg-surface/60 hover:bg-surface-hover border border-border/30 hover:border-border/60 text-muted hover:text-foreground transition-all duration-200 group"
              >
                <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
              </button>
            </div>
          </div>

          {/* ── LABELS ROW ── */}
          {email.labelIds && email.labelIds.length > 0 && (
            <div className="flex-none flex items-center gap-2 px-4 md:px-8 py-2 md:py-3 border-b border-border/20 bg-background/20 flex-wrap">
              <Tag className="w-3 h-3 md:w-3.5 md:h-3.5 text-muted/40 flex-none" />
              {visibleLabels?.map((label) => {
                const pill = LABEL_PILL_MAP[label] ?? { bg: "bg-surface", text: "text-muted/60" };
                return (
                  <span
                    key={label}
                    className={clsx(
                      "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest",
                      pill.bg, pill.text
                    )}
                  >
                    {label}
                  </span>
                );
              })}
              {hiddenCount > 0 && !showAllLabels && (
                <button
                  onClick={() => setShowAllLabels(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-surface text-muted/50 hover:text-muted transition-colors"
                >
                  +{hiddenCount} more <ChevronDown className="w-3 h-3" />
                </button>
              )}
              {showAllLabels && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllLabels(false)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-surface text-muted/50 hover:text-muted transition-colors"
                >
                  Show less <ChevronUp className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* ── BODY ── */}
          <div className="flex-1 overflow-y-auto px-8 py-7">
            {/* AI Summary chip */}
            {classification?.summary && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="mb-6 flex items-start gap-2 md:gap-3 p-3 md:p-4 rounded-2xl bg-primary/5 border border-primary/15"
              >
                <div className="flex-none w-6 h-6 md:w-7 md:h-7 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
                  <Sparkles className="w-3 h-3 md:w-3.5 md:h-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary/70 mb-1">AI Summary</p>
                  <p className="text-sm text-foreground/80 leading-relaxed">{classification.summary}</p>
                </div>
              </motion.div>
            )}

            {/* Email body */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-sm text-foreground/85 leading-relaxed md:leading-[1.85] whitespace-pre-wrap font-[450] selection:bg-primary/20 selection:text-foreground"
            >
              {email.body || email.snippet
                ? decodeHtmlEntities(email.body || email.snippet)
                : <span className="italic text-muted/40">No content available.</span>
              }
            </motion.div>
          </div>

          {/* ── ACTION BAR ── */}
          <div className="flex-none border-t border-border/30 bg-background/30 px-4 md:px-8 py-4 md:py-5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              {/* Primary actions */}
              <div className="flex items-center flex-wrap gap-2 md:gap-3">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleAction("reply")}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 md:px-5 py-2.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-primary/25 transition-all duration-200"
                  style={{ background: "var(--primary-gradient)" }}
                >
                  <Sparkles className="w-3 md:w-3.5 h-3 md:h-3.5" />
                  <span className="truncate">AI Reply</span>
                </motion.button>

                {category === "meeting_request" && (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleAction("schedule")}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 md:px-5 py-2.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest bg-surface hover:bg-surface-hover border border-border/50 hover:border-primary/30 text-foreground/80 hover:text-foreground transition-all duration-200"
                  >
                    <CalendarCheck className="w-3 md:w-3.5 h-3 md:h-3.5 text-primary" />
                    <span className="truncate">Schedule</span>
                  </motion.button>
                )}

                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => onReply?.(email.id)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 md:px-4 py-2.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest bg-surface hover:bg-surface-hover border border-border/40 hover:border-border/70 text-muted hover:text-foreground transition-all duration-200"
                >
                  <Reply className="w-3 md:w-3.5 h-3 md:h-3.5" />
                  <span className="truncate">Reply</span>
                </motion.button>
              </div>

              {/* Secondary actions */}
              <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">
                <div className="flex items-center gap-2">
                  {/* Important toggle */}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleAction("important")}
                    title={isImportant ? "Remove from important" : "Mark as important"}
                    className={clsx(
                      "p-2 md:p-2.5 rounded-xl border transition-all duration-200",
                      isImportant
                        ? "bg-amber-500/10 border-amber-400/30 text-amber-400 shadow-sm shadow-amber-400/10"
                        : "bg-surface border-border/30 text-muted/60 hover:text-amber-400 hover:border-amber-400/30"
                    )}
                  >
                    {isImportant ? <Star className="w-3.5 md:w-4 h-3.5 md:h-4 fill-current" /> : <StarOff className="w-3.5 md:w-4 h-3.5 md:h-4" />}
                  </motion.button>

                  {/* Delete */}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleAction("delete")}
                    title="Delete"
                    className="p-2 md:p-2.5 rounded-xl border border-border/30 bg-surface text-muted/60 hover:text-rose-400 hover:border-rose-400/30 hover:bg-rose-500/5 transition-all duration-200"
                  >
                    <Trash2 className="w-3.5 md:w-4 h-3.5 md:h-4" />
                  </motion.button>
                </div>

                {/* Divider */}
                <div className="w-px h-6 bg-border/30 mx-1 hidden sm:block" />

                {/* Footer metadata */}
                <div className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-muted/40 font-mono">
                  <ShieldCheck className="w-2.5 md:w-3 h-2.5 md:h-3" />
                  <span className="truncate max-w-[60px] md:max-w-none">{email.id.slice(0, 8).toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
