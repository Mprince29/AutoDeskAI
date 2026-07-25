"use client";
import { Send, Trash2, XCircle, Plus, Sparkles, Cpu, Archive, Inbox } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { Email } from '@/services/api';
import EmailRow from './EmailRow';
import EmailToolbar from './EmailToolbar';
import EmailTabs, { TabId } from './EmailTabs';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import WorkspaceSkeleton from '@/components/shared/WorkspaceSkeleton';

interface EmailSectionsProps {
  emails: Email[];
  isLoading?: boolean;
  onRefresh?: () => void;
  onReply: (emailId: string) => void;
  onSchedule: (emailId: string) => void;
  onMarkImportant: (emailId: string) => void;
  onMarkSpam: (emailId: string) => void;
  onDelete: (emailId: string) => void;
  onArchive: (emailId: string) => void;
  onMoveToTrash: (emailId: string) => void;
  onEmailClick?: (email: Email) => void;
  onCompose?: () => void;
  onMarkRead: (emailId: string) => void;
  onMarkUnread: (emailId: string) => void;
}

type SectionType = TabId | 'sent_section' | 'spam_section' | 'trash_section' | 'archive_section';

interface SectionConfig {
  id: SectionType;
  title: string;
  icon: React.ReactNode;
  description: string;
  color: string;
}

const sectionConfigs: Record<SectionType, SectionConfig> = {
  main_inbox: { id: 'main_inbox', title: 'Inbox', icon: <Inbox className="w-4 h-4" />, description: 'Intelligence Stream', color: 'text-primary' },
  important_section: { id: 'important_section', title: 'Important', icon: null, description: 'High Priority', color: 'text-warning' },
  meeting_section: { id: 'meeting_section', title: 'Meetings', icon: null, description: 'Sync Protocols', color: 'text-primary' },
  personal_section: { id: 'personal_section', title: 'Social', icon: null, description: 'Neural Link', color: 'text-success' },
  newsletter_section: { id: 'newsletter_section', title: 'Promotions', icon: null, description: 'Broadcasting', color: 'text-muted' },
  sent_section: { id: 'sent_section', title: 'Sent', icon: <Send className="w-4 h-4" />, description: 'Output Buffer', color: 'text-success' },
  spam_section: { id: 'spam_section', title: 'Spam', icon: <XCircle className="w-4 h-4" />, description: 'Aborted Nodes', color: 'text-error' },
  trash_section: { id: 'trash_section', title: 'Trash', icon: <Trash2 className="w-4 h-4" />, description: 'Purged Logs', color: 'text-muted' },
  archive_section: { id: 'archive_section', title: 'Archive', icon: <Archive className="w-4 h-4" />, description: 'Neural Cache', color: 'text-muted' },
};

const EmailSections: React.FC<EmailSectionsProps> = React.memo(({
  emails,
  isLoading,
  onRefresh,
  onReply,
  onSchedule,
  onMarkImportant,
  onMarkSpam,
  onDelete,
  onArchive,
  onMoveToTrash,
  onEmailClick,
  onCompose,
  onMarkRead,
  onMarkUnread
}) => {
  const [activeSection, setActiveSection] = useState<SectionType>('main_inbox');
  const [activeTab, setActiveTab] = useState<TabId>('main_inbox');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const getEmailsForSection = useCallback((sectionId: SectionType, tabId: TabId): Email[] => {
    return emails.filter(email => {
      const labels = email.labelIds ?? [];

      // 1. Top-level section filtering
      if (sectionId === 'spam_section' && !labels.includes('SPAM')) return false;
      if (sectionId === 'sent_section' && !labels.includes('SENT')) return false;
      if (sectionId === 'trash_section' && !labels.includes('TRASH')) return false;
      
      const isInInbox = labels.includes('INBOX');
      const isArchived = !isInInbox && !labels.includes('SPAM') && !labels.includes('TRASH') && !labels.includes('SENT');

      if (sectionId === 'main_inbox' && !isInInbox) return false;
      if (sectionId === 'archive_section' && !isArchived) return false;

      // 2. Tab-level filtering

      const placement = email.classification?.section_placement;

      if (tabId === 'important_section') return labels.includes('IMPORTANT');
      
      if (tabId === 'personal_section') {
        if (placement) return placement.personal_section === true;
        return labels.includes('CATEGORY_SOCIAL') || labels.includes('SOCIAL') || labels.includes('CATEGORY_FORUMS');
      }

      if (tabId === 'newsletter_section') {
        if (placement) return placement.newsletter_section === true;
        return labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_UPDATES');
      }

      if (tabId === 'meeting_section') {
        return placement?.meeting_section === true;
      }

      if (tabId === 'main_inbox') {
        if (placement) return placement.main_inbox === true;
        return !labels.includes('CATEGORY_SOCIAL') &&
          !labels.includes('CATEGORY_PROMOTIONS') &&
          !labels.includes('CATEGORY_UPDATES') &&
          !labels.includes('CATEGORY_FORUMS');
      }

      return false;
    });
  }, [emails]);

  const currentSectionEmails = useMemo(() => getEmailsForSection(activeSection, activeTab), [getEmailsForSection, activeSection, activeTab]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(currentSectionEmails.map(e => e.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleDeleteSelected = () => {
    selectedIds.forEach(id => onDelete(id));
    setSelectedIds(new Set());
  };

  const handleArchiveSelected = () => {
    selectedIds.forEach(id => onArchive(id));
    setSelectedIds(new Set());
  };

  const handleMarkReadSelected = () => {
    selectedIds.forEach(id => onMarkRead(id));
    setSelectedIds(new Set());
  };

  const handleMarkUnreadSelected = () => {
    selectedIds.forEach(id => onMarkUnread(id));
    setSelectedIds(new Set());
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-background">
      {/* SIDEBAR */}
      <aside className="w-full lg:w-64 shrink-0 p-3 lg:p-4 flex flex-row lg:flex-col gap-3 lg:gap-6 border-r border-t border-border/40 overflow-x-auto no-scrollbar items-center lg:items-stretch">
        <button
          onClick={onCompose}
          className="flex shrink-0 items-center gap-2 lg:gap-4 px-4 py-2 lg:px-6 lg:py-4 rounded-xl lg:rounded-2xl bg-surface-elevated border border-border/40 hover:border-primary/20 transition-all text-foreground group"
        >
          <Plus className="w-4 h-4 lg:w-5 lg:h-5 text-primary group-hover:rotate-90 transition-transform" />
          <span className="text-[13px] lg:text-sm font-bold tracking-tight">Compose</span>
        </button>

        <nav className="flex flex-row lg:flex-col gap-2 lg:gap-1 overflow-visible lg:overflow-y-auto shrink-0 pr-4 lg:pr-0">
          {(['main_inbox', 'sent_section', 'archive_section', 'spam_section', 'trash_section'] as SectionType[]).map(id => {
            const config = sectionConfigs[id];
            const isActive = activeSection === id;
            const count = getEmailsForSection(id, 'main_inbox').filter(e => !e.read).length;

            return (
              <button
                key={id}
                onClick={() => {
                  setActiveSection(id);
                  setActiveTab('main_inbox');
                }}
                className={clsx(
                  "flex items-center justify-between px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl transition-all group shrink-0 gap-2 lg:gap-0",
                  isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface/40 hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={clsx("p-1", isActive ? "text-primary" : "text-muted group-hover:text-foreground")}>
                    {config.icon}
                  </div>
                  <span className="text-[13px] font-bold tracking-tight">{config.title}</span>
                </div>
                {count > 0 && (
                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* CONTENT */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 border-t border-border/40">
        <EmailTabs
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab)}
          unseenCounts={{
            main_inbox: getEmailsForSection(activeSection, 'main_inbox').filter(e => !e.read).length,
            important_section: getEmailsForSection(activeSection, 'important_section').filter(e => !e.read).length,
            personal_section: getEmailsForSection(activeSection, 'personal_section').filter(e => !e.read).length,
            newsletter_section: getEmailsForSection(activeSection, 'newsletter_section').filter(e => !e.read).length,
          }}
        />

        <EmailToolbar
          selectedCount={selectedIds.size}
          totalCount={currentSectionEmails.length}
          onSelectAll={handleSelectAll}
          onRefresh={onRefresh || (() => { })}
          onDeleteSelected={handleDeleteSelected}
          onArchiveSelected={handleArchiveSelected}
          onMarkReadSelected={handleMarkReadSelected}
          onMarkUnreadSelected={handleMarkUnreadSelected}
        />

        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          <AnimatePresence mode="popLayout">
            {isLoading ? (
              <WorkspaceSkeleton variant="inbox-list" count={12} />
            ) : currentSectionEmails.length > 0 ? (
              <motion.div layout className="divide-y divide-border/5">
                {currentSectionEmails.map((email) => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    isSelected={selectedIds.has(email.id)}
                    onToggleSelect={toggleSelect}
                    onEmailClick={onEmailClick}
                    onDelete={onDelete}
                    onArchive={onArchive}
                    onReply={onReply}
                    onSchedule={onSchedule}
                    onMarkImportant={onMarkImportant}
                    onMarkRead={onMarkRead}
                    onMarkUnread={onMarkUnread}
                  />
                ))}
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-20 grayscale opacity-40">
                <Trash2 className="w-12 h-12 text-muted mb-4 stroke-1" />
                <h3 className="text-sm font-bold text-foreground">No streams found in {sectionConfigs[activeSection].title}</h3>
                <p className="text-xs text-muted max-w-[200px] mt-2">Intelligence buffer is currently empty for this node.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
});

EmailSections.displayName = 'EmailSections';
export default EmailSections;
