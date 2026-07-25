"use client";
import React, { memo } from 'react';
import { Email } from '@/services/api';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import {
  Star,
  Trash2,
  Reply,
  CalendarCheck,
  Mail,
  MoreVertical,
  Archive,
  CheckCircle,
  Inbox,
  MailOpen,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { motion } from 'framer-motion';

interface EmailRowProps {
  email: Email;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onEmailClick?: (email: Email) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
  onReply?: (id: string) => void;
  onSchedule?: (id: string) => void;
  onMarkImportant?: (id: string) => void;
  onMarkRead?: (id: string) => void;
  onMarkUnread?: (id: string) => void;
}

const EmailRow = memo(function EmailRow({
  email,
  isSelected,
  onToggleSelect,
  onEmailClick,
  onDelete,
  onArchive,
  onReply,
  onSchedule,
  onMarkImportant,
  onMarkRead,
  onMarkUnread,
}: EmailRowProps) {
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      if (date.toDateString() === now.toDateString()) {
        return format(date, 'h:mm a');
      }
      return format(date, 'MMM d');
    } catch {
      return '';
    }
  };

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onEmailClick?.(email)}
      className={clsx(
        "group relative flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 sm:py-2 cursor-pointer transition-all border-b border-border/10",
        isSelected ? "bg-primary/5" : "hover:bg-surface/40",
        !email.read && "bg-background/40"
      )}
    >
      {/* ── SELECTION & STAR ── */}
      <div className="flex items-center gap-2 shrink-0" onClick={stopPropagation}>
        <Checkbox 
          checked={isSelected} 
          onCheckedChange={() => onToggleSelect?.(email.id)}
          className="w-4 h-4 border-muted/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
        <button
          onClick={() => onMarkImportant?.(email.id)}
          className={clsx(
            "p-1 rounded-md transition-colors",
            email.labelIds?.includes('IMPORTANT') ? "text-warning" : "text-muted/30 hover:text-muted"
          )}
        >
          <Star className={clsx("w-4 h-4", email.labelIds?.includes('IMPORTANT') && "fill-current")} />
        </button>
      </div>

      <div className="flex flex-1 min-w-0 flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
        {/* SENDER */}
        <div className={clsx(
          "w-full sm:w-48 shrink-0 text-[13px] sm:text-sm truncate",
          !email.read ? "font-bold text-foreground" : "font-semibold text-muted/80"
        )}>
          {email.labelIds?.includes('SENT') ? `To: ${email.to || 'External'}` : (email.from ? (email.from.split('<')[0].trim() || email.from) : '(Unknown Sender)')}
        </div>

        {/* SUBJECT & SNIPPET */}
        <div className="flex-1 flex flex-col gap-0.5 sm:gap-2 min-w-0">
          <span className={clsx(
            "text-[13px] sm:text-sm shrink-0 truncate sm:w-[60%]",
            !email.read ? "font-bold text-foreground" : "font-medium text-muted/70"
          )}>
            {email.subject || '(No Subject)'}
          </span>
          <span className="text-[12px] sm:text-sm text-muted/50 truncate font-medium">
            {email.snippet}
          </span>
        </div>
      </div>

      {/* ── BADGE (Optional, only show if specifically classified) ── */}
      {email.classification?.category && (
        <div className={clsx(
          "shrink-0 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border",
          email.classification.category === 'meeting_request' ? "bg-primary/10 border-primary/20 text-primary" :
          email.classification.category === 'important' ? "bg-warning/10 border-warning/20 text-warning" :
          "bg-surface/50 border-border/20 text-muted"
        )}>
          {email.classification.category.replace('_', ' ')}
        </div>
      )}

      {/* ── DATE / HOVER ACTIONS ── */}
      <div className="absolute right-3 top-3 sm:relative sm:right-0 sm:top-0 sm:w-20 shrink-0 text-right">
        <div className="text-[10px] sm:text-[11px] font-bold text-muted/60 uppercase tracking-widest sm:group-hover:hidden">
          {formatDate(email.date)}
        </div>
        
        {/* Hover Actions Bar */}
        <div className="hidden group-hover:flex items-center justify-end gap-1" onClick={stopPropagation}>
          {email.labelIds?.includes('INBOX') ? (
            <button
              onClick={() => onArchive?.(email.id)}
              className="p-1.5 hover:bg-surface-hover text-muted/40 hover:text-muted rounded-md transition-all"
              title="Archive"
            >
              <Archive className="w-4 h-4" />
            </button>
          ) : (
            !email.labelIds?.includes('SPAM') && !email.labelIds?.includes('TRASH') && (
              <button
                onClick={() => onArchive?.(email.id)}
                className="p-1.5 hover:bg-surface-hover text-muted/40 hover:text-muted rounded-md transition-all"
                title="Move to Inbox"
              >
                <Inbox className="w-4 h-4" />
              </button>
            )
          )}
          
          <button
            onClick={() => email.read ? onMarkUnread?.(email.id) : onMarkRead?.(email.id)}
            className="p-1.5 hover:bg-surface-hover text-muted/40 hover:text-foreground rounded-md transition-all"
            title={email.read ? "Mark as Unread" : "Mark as Read"}
          >
            {email.read ? <Mail className="w-4 h-4" /> : <MailOpen className="w-4 h-4" />}
          </button>

          <button
            onClick={() => onDelete?.(email.id)}
            className="p-1.5 hover:bg-error/10 text-muted/40 hover:text-error rounded-md transition-all"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onReply?.(email.id)}
            className="p-1.5 hover:bg-surface-hover text-muted/40 hover:text-foreground rounded-md transition-all"
            title="Reply"
          >
            <Reply className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
});

EmailRow.displayName = 'EmailRow';
export default EmailRow;
