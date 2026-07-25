export interface FollowUp {
  id: number;
  recipient: string;
  subject: string;
  commitment: string;
  draft_content?: string;
  created_at?: string;
  date_sent?: string;
  days_ago?: number | null;
  all_commitments?: string[];
  snippet?: string;
  thread_id?: string | null;
}

export interface FollowUpDraftRequest {
  email_id: string;
  subject: string;
  commitment: string;
  recipient: string;
  days_ago: number;
}

export interface BriefingSummary {
  unread_emails: number;
  urgent_emails: number;
  meetings_today: number;
  pending_follow_ups: number;
}

export interface BriefingResult {
  generated_at: string;
  user_email: string;
  narrative: string;
  email: { unread_count: number; urgent_count: number; urgent: { subject: string; from: string; snippet: string }[]; summary: string };
  calendar: { event_count: number; events_today: { title: string; start: string; attendees: number }[]; summary: string };
  follow_ups: { count: number };
}

export interface RelationshipCard {
  contact_email: string;
  name: string;
  status: string;
  last_contact_date: string | null;
  days_since_contact: number | null;
  total_interactions: number;
  sent_count: number;
  received_count: number;
  response_rate_pct: number | null;
  avg_response_days: number | null;
  topics: string[];
  tone_trend: 'warm' | 'neutral' | 'cooling' | 'cold' | 'unknown';
  health: 'green' | 'yellow' | 'red' | 'unknown';
  my_commitments: string[];
  their_commitments: string[];
  last_subject: string;
  last_snippet: string;
  last_direction: 'sent' | 'received' | '';
  suggested_action: string | null;
  message?: string;
}
