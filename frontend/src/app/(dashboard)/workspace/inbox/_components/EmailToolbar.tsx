"use client";
import React from 'react';
import {
  RefreshCw,
  Trash2,
  MailOpen,
  Mail,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Archive,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

interface EmailToolbarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: (checked: boolean) => void;
  onRefresh: () => void;
  onDeleteSelected?: () => void;
  onMarkReadSelected?: () => void;
  onMarkUnreadSelected?: () => void;
  onArchiveSelected?: () => void;
}

export default function EmailToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onRefresh,
  onDeleteSelected,
  onMarkReadSelected,
  onMarkUnreadSelected,
  onArchiveSelected,
}: EmailToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-border/10 bg-background/50 backdrop-blur-sm sticky top-0 z-10 w-full overflow-hidden">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-0.5 sm:gap-1">
          <Checkbox 
            checked={selectedCount > 0 && selectedCount === totalCount}
            onCheckedChange={(checked) => onSelectAll(checked === true)}
            className="w-4 h-4 border-muted/20"
          />
        </div>

        <AnimatePresence>
          {selectedCount > 0 && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-0.5 sm:gap-1 pl-2 sm:pl-4 border-l border-border/20"
            >
              <button 
                onClick={onDeleteSelected}
                className="p-2 hover:bg-error/10 rounded-full transition-colors text-muted/60 hover:text-error"
                title="Delete Selected"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button 
                onClick={onMarkReadSelected}
                className="p-2 hover:bg-surface-hover rounded-full transition-colors text-muted/60 hover:text-foreground"
                title="Mark as Read"
              >
                <MailOpen className="w-4 h-4" />
              </button>
              <button 
                onClick={onMarkUnreadSelected}
                className="p-2 hover:bg-surface-hover rounded-full transition-colors text-muted/60 hover:text-foreground"
                title="Mark as Unread"
              >
                <Mail className="w-4 h-4" />
              </button>
              <button 
                onClick={onArchiveSelected}
                className="p-2 hover:bg-surface-hover rounded-full transition-colors text-muted/60 hover:text-foreground"
                title="Archive"
              >
                <Archive className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-4">
        <span className="hidden xs:block text-[10px] sm:text-xs text-muted/50 font-medium">
          1-{totalCount} of {totalCount}
        </span>
        <div className="flex items-center gap-1">
          <button className="p-1.5 hover:bg-surface-hover rounded-full transition-colors text-muted/40 hover:text-foreground disabled:opacity-20" disabled>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button className="p-1.5 hover:bg-surface-hover rounded-full transition-colors text-muted/40 hover:text-foreground disabled:opacity-20" disabled>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
