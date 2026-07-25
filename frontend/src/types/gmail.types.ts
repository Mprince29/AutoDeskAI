export interface Email {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  from: string;
  to?: string;
  subject: string;
  date: string;
  body?: string;
  read?: boolean;
  ai_processed?: boolean;
  classification?: {
    category: string;
    confidence: number;
    is_meeting_request?: boolean;
    urgency?: string;
    requires_response?: boolean;
    action_required?: string;
    reasoning?: string;
    classifier?: string;
    summary?: string;
    section_placement?: {
      main_inbox: boolean;
      spam_section: boolean;
      newsletter_section: boolean;
      sent_section: boolean;
      meeting_section: boolean;
      important_section: boolean;
      business_section: boolean;
      personal_section: boolean;
      notification_section: boolean;
      trash_section: boolean;
    };
  };
}

export interface EmailReply {
  reply: string;
  original_email: Email;
  suggested_labels: string[];
}

export interface Draft {
  id: string;
  messageId?: string;
  subject?: string;
  to?: string;
  date?: string;
  body?: string;
}

export interface EmailNotification {
  email_id: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  timestamp: string;
  notification_time: string;
  auto_reply_scheduled: boolean;
  time_until_auto_reply: number;
}
