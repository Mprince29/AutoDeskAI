import { Email } from "@/services/api";
import { clsx } from "clsx";
import { format } from "date-fns";
import {
  AlertCircle,
  CalendarCheck,
  Clock,
  Mail,
  Reply,
  Trash2,
  User
} from "lucide-react";

interface EmailCardProps {
  email: Email;
  onReply?: (emailId: string) => void;
  onSchedule?: (emailId: string) => void;
  onMarkImportant?: (emailId: string) => void;
  onMarkSpam?: (emailId: string) => void;
  onDelete?: (emailId: string) => void;
  onEmailClick?: (email: Email) => void;
}

const getCategoryStyles = (category: string) => {
  switch (category) {
    case 'important':
      return { base: 'text-warning bg-warning/10 border-warning/20', icon: <AlertCircle className="w-3 h-3" /> };
    case 'meeting_request':
      return { base: 'text-primary bg-primary/10 border-primary/20', icon: <CalendarCheck className="w-3 h-3" /> };
    case 'personal':
      return { base: 'text-success bg-success/10 border-success/20', icon: <User className="w-3 h-3" /> };
    case 'spam':
      return { base: 'text-error bg-error/10 border-error/20', icon: <AlertCircle className="w-3 h-3" /> };
    default:
      return { base: 'text-muted bg-surface/50 border-border/40', icon: <Mail className="w-3 h-3" /> };
  }
};

export default function EmailCard({
  email,
  onReply,
  onSchedule,
  onDelete,
  onEmailClick,
}: EmailCardProps) {
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return format(date, 'MMM d, h:mm a');
    } catch {
      return 'Unknown date';
    }
  };

  const { base: badgeBase, icon: badgeIcon } = getCategoryStyles(email.classification?.category || 'business');

  return (
    <div
      onClick={() => onEmailClick?.(email)}
      className="group relative bg-surface/30 backdrop-blur-md border border-border/40 rounded-2xl p-5 pb-2 hover:border-primary/40 hover:bg-surface/40 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-xl hover:shadow-primary/5"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-2">
            {!email.read && (
              <div className="w-2 h-2 rounded-full bg-primary shadow-lg shadow-primary/50 shrink-0 animate-pulse" />
            )}
            <h3 className={clsx(
              "text-sm font-black truncate tracking-tight transition-colors",
              email.read ? "text-muted" : "text-foreground group-hover:text-primary"
            )}>
              {email.subject && email.subject !== 'No Subject' ? email.subject : 'Untitled Intelligence'}
            </h3>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-muted/60 mb-3">
            <span className="text-foreground/80">
              {email.labelIds?.includes('SENT') ? `To: ${email.to || 'External Receiver'}` : (email.from.split('<')[0].trim() || email.from)}
            </span>
            <span className="opacity-30">•</span>
            <div className="flex items-center gap-1.5 bg-background/30 px-2 py-0.5 rounded-lg border border-border/10">
              <Clock className="w-2.5 h-2.5" />
              {formatDate(email.date)}
            </div>
          </div>

          <p className="text-xs font-medium text-muted/80 line-clamp-2 leading-relaxed">
            {email.snippet}
          </p>

          <div className="flex items-center justify-between border-t border-border/10">
            <div className="flex items-center gap-4">
              {email.classification && (
                <div className={clsx("flex items-center gap-2 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-widest border shadow-sm", badgeBase)}>
                  {badgeIcon}
                  {email.classification.category?.replace('_', ' ') || 'Stream'}
                </div>
              )}
              {email.classification?.confidence && (
                <div className="flex items-center gap-1 text-[9px] font-bold text-muted/40">
                  <div className="w-8 h-1 bg-border/20 rounded-full overflow-hidden">
                    <div className="h-full bg-primary/40" style={{ width: `${email.classification.confidence * 100}%` }} />
                  </div>
                  {Math.round(email.classification.confidence * 100)}%
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 bg-background/20 rounded-xl border border-border/10 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
              {email.classification?.category === 'meeting_request' && onSchedule && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSchedule(email.id); }}
                  className="p-2 hover:bg-primary/10 rounded-lg text-primary transition-all"
                  title="Schedule Protocol"
                >
                  <CalendarCheck className="w-4 h-4" />
                </button>
              )}
              {onReply && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReply(email.id); }}
                  className="p-2 hover:bg-surface rounded-lg text-muted hover:text-foreground transition-all"
                  title="Initialise Reply"
                >
                  <Reply className="w-4 h-4" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(email.id); }}
                  className="p-2 hover:bg-error/10 rounded-lg text-muted hover:text-error transition-all"
                  title="Purge Intelligence"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Active Indicator Backdrop */}
      <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/[0.02] rounded-2xl transition-colors pointer-events-none" />
    </div>
  );
}