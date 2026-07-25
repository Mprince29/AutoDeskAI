"use client";
import { toast } from "sonner";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface User {
  email: string;
  name: string;
}

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
  // Add these new properties
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

export interface MeetingDetails {
  summary: string;
  description: string;
  attendees: string[];
  duration: string;
  location?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: string[];
  organizer: string;
  status: string;
  location?: string;
  htmlLink?: string;
  meetLink?: string;
}

export interface UserPreferences {
  auto_classify_emails: boolean;
  auto_schedule_meetings: boolean;
  timezone: string;
  gmail_connected: boolean;
  calendar_connected: boolean;
  llm_provider?: string;
  preferred_model?: string;
  is_monitoring?: boolean;
  is_company_user?: boolean;
  use_company_keys?: boolean | null;
  communication_profile?: string | null;
  last_visited_path?: string | null;
}

export interface AgentStatus {
  enabled: boolean;
  assistant_id: string | null;
  thread_id: string | null;
  status: string;
  message?: string;
}

export interface AgentResponse {
  status: string;
  message?: string;
  assistant_id?: string;
  thread_id?: string;
  response?: string;
  toolsUsed?: string[];
}

export interface CalendarReminder {
  event_id: string;
  event_summary: string;
  event_start: string;
  reminder_time: string;
  sent: boolean;
  minutes_until_event: number;
}

export interface CalendarReminderStatus {
  is_monitoring: boolean;
  active_reminders: number;
  last_update: number;
}

export interface AgentChatRequest {
  message: string;
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

export interface AutomatedServiceStatus {
  is_monitoring: boolean;
  active_notifications: number;
  auto_reply_delay: number;
  check_interval: number;
  service_running: boolean;
}

export interface NotificationsResponse {
  notifications: EmailNotification[];
  total: number;
  auto_reply_delay: number;
}

export interface AgentExecutionResult {
  summary?: {
    message?: string;
    tools_used?: string[];
  };
  message?: string;
  output?: string;
  step_results?: Record<string, unknown>;
  [key: string]: unknown;
}

// Drafts
export interface Draft {
  id: string;
  messageId?: string;
  subject?: string;
  to?: string;
  date?: string;
  body?: string;
}

export interface Contact {
  id: number;
  name: string;
  email: string;
  nickname?: string;
  phone?: string;
  company?: string;
  title?: string;
  notes?: string;
  tags?: string[];
  created_at: string;
}

export interface WorkflowStep {
  id: number;
  name: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'modified' | 'completed' | 'failed' | 'executing' | 'cancelled';
  step_number?: number;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  requires_approval?: boolean;
  result?: string;
  input_data: Record<string, unknown>;
  output_data?: Record<string, unknown>;
}

export interface Workflow {
  id: number;
  schema_id: string;
  name: string;
  goal?: string;
  status: 'active' | 'completed' | 'failed' | 'paused' | string;
  current_step_index: number;
  steps: WorkflowStep[];
  created_at: string;
  step_count?: number;
}

export interface AgentStreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done' | 'status' | 'tool_call' | 'result' | 'chunk' | 'workflow_created' | 'agent' | 'cache_hit' | 'safety';
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  error?: string;
  message?: string;
  tool?: string;
  text?: string;
  result?: string;
  tools_used?: string[];
  /** Set when type === 'workflow_created' - the new workflow's DB id */
  workflow_id?: number;
  is_qa?: boolean;
  evaluation?: { has_warnings: boolean; flags: string[]; requires_human_review: boolean };
  context_trace?: unknown;
  advice?: { rule_id: string; message: string; action_label?: string | null; action_type?: string | null; icon?: string } | null;
  token_count?: number;
  model_used?: string;
  name?: string;
  display?: string;
}

export interface ContentDraft {
  id: string;
  user_email: string;
  draft_type: 'document' | 'spreadsheet' | 'presentation' | string;
  title: string;
  content: string;
  format?: string | null;
  status: 'pending' | 'saved' | 'discarded' | string;
  saved_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ContactCreate {
  name: string;
  email: string;
  nickname?: string;
  phone?: string;
  company?: string;
  title?: string;
  notes?: string;
  tags?: string[];
}

export interface EmailApiResponse {
  emails: Email[];
  total: number;
}

// ── Proactive Intelligence Types ──────────────────────────────────────────────

export interface FollowUp {
  id: number;
  recipient: string;
  subject: string;
  commitment: string;
  draft_content?: string;
  created_at?: string;
  // legacy fields (follow_up_hunter scanner)
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

export interface AgentBlueprint {
  blueprint_id: string;
  archetype_name: string;
  tagline: string;
  icon: string;
  color_class: string;
  suggested_capabilities: string[];
  gating_summary: string;
  requires_credentials: string[];
  sample_prompts: string[];
  category: string;
}

export interface RelationshipCard {
  contact_email: string;
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
  suggested_action: string | null;
  message?: string;
}

class ApiService {
  private configCache: Record<string, any> = {};
  private emailCache: Record<string, any> = {};

  public async request<T>(
    endpoint: string,
    options: RequestInit & { silent?: boolean } = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string>),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        ...options,
      });
    } catch (error) {
      const msg = 'We’re having trouble reaching the server. Please check your connection.';
      console.warn(`[ApiService] Fetch failed for ${endpoint}:`, error);
      if (!options.silent) {
        toast.error(msg, { id: 'network-error' });
      }
      throw new Error(msg);
    }

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = { detail: 'Unknown error' };
      }

      // Use warn instead of error so expected failures (e.g. prefs 404) don't
      // trigger Next.js dev overlay or pollute console as hard errors.
      console.warn('API Error Response:', {
        status: response.status,
        statusText: response.statusText,
        errorData: errorData,
        url: url
      });

      type ErrorPayload = { detail?: unknown; message?: string; error?: string };
      // Extract the backend's own message first - preserving it lets callers
      // (e.g. AuthContext) pattern-match on backend details like "User not found".
      let errorMessage: string;
      if (typeof errorData === 'string') {
        errorMessage = errorData;
      } else if (errorData && typeof errorData === 'object') {
        const e = errorData as ErrorPayload;
        let detailStr: string | undefined;
        if (e.detail) {
          if (typeof e.detail === 'object') {
            try { detailStr = JSON.stringify(e.detail); } catch { detailStr = String(e.detail); }
          } else {
            detailStr = String(e.detail);
          }
        }
        errorMessage = detailStr || e.message || e.error || `HTTP ${response.status}: ${response.statusText}`;
      } else {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }

      // Only fall back to generic messages when the backend gave us nothing useful.
      // Do NOT override 404 here - "User not found" must reach AuthContext intact
      // so it can auto-logout stale sessions.
      if (response.status === 403) {
        errorMessage = errorMessage || "You don't have permission to perform this action.";
      } else if (response.status === 401) {
        errorMessage = errorMessage || "Your session has expired. Please sign in again to continue.";
      } else if (response.status === 500) {
        errorMessage = errorMessage || "Something went wrong on our end. We're looking into it!";
      } else if (response.status === 422) {
        errorMessage = errorMessage || "We couldn't process this request. Please check your input and try again.";
      }

      // Show toast notification for non-404 errors (404 is often handled gracefully or expected)
      if (response.status !== 404 && !options.silent) {
        toast.error(errorMessage, {
          id: `api-error-${errorMessage}`, // prevent duplicate toasts for the same message
          duration: 5000,
        });
      }

      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return null as any;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async get<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, body?: any, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : options.body,
    });
  }

  // Authentication
  async signup(data: { name: string; email: string; password: string }) {
    return this.request<{ access_token: string; user: User }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { email: string; password: string }) {
    return this.request<{ access_token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Gmail OAuth
  getGmailAuthUrl(email: string): string {
    return `${API_BASE_URL}/api/auth/login?email=${encodeURIComponent(email)}`;
  }

  // Calendar OAuth (uses same OAuth flow as Gmail)
  getCalendarAuthUrl(email: string): string {
    return `${API_BASE_URL}/api/auth/login?email=${encodeURIComponent(email)}`;
  }

  async validateGoogleConnection(email: string): Promise<{ valid: boolean; refreshed?: boolean; error?: string }> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/google/validate?email=${encodeURIComponent(email)}`);
      return await res.json();
    } catch {
      return { valid: false, error: "Could not reach server" };
    }
  }

  // Microsoft OAuth - DISABLED
  // getMicrosoftAuthUrl(email: string): string {
  //   return `${API_BASE_URL}/api/auth/microsoft/login?email=${encodeURIComponent(email)}`;
  // }
  //
  // async disconnectMicrosoft(email: string): Promise<void> {
  //   await this.request<void>(`/api/auth/microsoft/disconnect?email=${encodeURIComponent(email)}`, {
  //     method: 'POST',
  //   });
  // }

  // ── Proactive Intelligence ──────────────────────────────────────────────────

  async getFollowUps(email: string, days: number = 14) {
    return this.request<{ follow_ups: FollowUp[]; total: number; days_scanned: number }>(
      `/api/proactive/follow-ups?email=${encodeURIComponent(email)}&days=${days}`
    );
  }

  async getPendingFollowUps(email: string) {
    return this.request<{ follow_ups: FollowUp[]; total: number }>(
      `/api/proactive/follow-ups/pending?email=${encodeURIComponent(email)}`
    );
  }

  async approveFollowUp(email: string, id: number, editedDraft?: string) {
    return this.request<{ success: boolean; status: string }>(
      `/api/proactive/follow-ups/${id}/approve?email=${encodeURIComponent(email)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_draft: editedDraft ?? null }),
      }
    );
  }

  async cancelFollowUp(email: string, id: number) {
    return this.request<{ success: boolean }>(
      `/api/proactive/follow-ups/${id}/cancel?email=${encodeURIComponent(email)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
  }

  async generateFollowUpDraft(email: string, item: FollowUpDraftRequest) {
    return this.request<{ draft: string; suggested_subject: string; recipient: string }>(
      `/api/proactive/follow-ups/draft?email=${encodeURIComponent(email)}`,
      { method: 'POST', body: JSON.stringify(item) }
    );
  }

  async getBriefing(email: string) {
    return this.request<BriefingResult>(`/api/proactive/briefing?email=${encodeURIComponent(email)}`);
  }

  async runBriefing(email: string) {
    return this.request<{ success: boolean; narrative: string; email_sent: boolean; summary: BriefingSummary }>(
      `/api/proactive/briefing/run?email=${encodeURIComponent(email)}`,
      { method: 'POST' }
    );
  }

  async getBriefingSettings(email: string) {
    return this.request<{ enabled: boolean; time: string }>(
      `/api/proactive/briefing/settings?email=${encodeURIComponent(email)}`
    );
  }

  async updateBriefingSettings(email: string, enabled: boolean, time: string) {
    return this.request<{ success: boolean; message: string }>(
      `/api/proactive/briefing/settings?email=${encodeURIComponent(email)}`,
      { method: 'PUT', body: JSON.stringify({ enabled, time }) }
    );
  }

  async getRelationshipCard(email: string, contact: string, days: number = 60) {
    return this.request<RelationshipCard>(
      `/api/proactive/relationship?email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contact)}&days=${days}`
    );
  }

  // Email Management
  async getEmails(email: string, maxResults: number = 50, labelIds?: string, _classify: boolean = true, pageToken?: string) {
    const cacheKey = `list:${email}:${labelIds || 'ALL'}:${pageToken || 'START'}`;
    if (this.emailCache[cacheKey]) return this.emailCache[cacheKey];

    const body: Record<string, string | number | string[]> = {
      user_email: email,
      max_results: maxResults,
    };
    if (labelIds) {
      body.label_ids = labelIds.split(',').map(s => s.trim());
    }
    if (pageToken) {
      body.page_token = pageToken;
    }
    const res = await this.request<{ emails: Email[]; total: number; nextPageToken?: string; resultSizeEstimate?: number }>(
      `/api/gmail/list_emails`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    
    this.emailCache[cacheKey] = res;
    return res;
  }

  async searchEmails(email: string, query: string, maxResults: number = 50) {
    const cacheKey = `search:${email}:${query}`;
    if (this.emailCache[cacheKey]) return this.emailCache[cacheKey];

    const res = await this.request<{ emails: Email[]; total: number; nextPageToken?: string }>(
      `/api/gmail/list_emails`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, query, max_results: maxResults }),
      headers: { 'Content-Type': 'application/json' },
    });

    this.emailCache[cacheKey] = res;
    return res;
  }

  clearEmailCache() {
    this.emailCache = {};
  }

  async markRead(email: string, emailId: string) {
    return this.modifyLabels(email, emailId, undefined, ['UNREAD']);
  }

  async markUnread(email: string, emailId: string) {
    return this.modifyLabels(email, emailId, ['UNREAD']);
  }

  async getEmail(email: string, emailId: string) {
    return this.request<Email>(`/api/gmail/get_email`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, message_id: emailId }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ── Contact Management ───────────────────────────────────────────────────

  async getContacts(email: string): Promise<Contact[]> {
    return this.request<Contact[]>(`/api/contacts/?email=${encodeURIComponent(email)}`);
  }

  async addContact(email: string, data: ContactCreate): Promise<Contact> {
    return this.request<Contact>(`/api/contacts/?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async updateContact(email: string, id: number, data: Partial<ContactCreate>): Promise<Contact> {
    return this.request<Contact>(`/api/contacts/${id}?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async deleteContact(email: string, id: number): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/api/contacts/${id}?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
  }

  async searchContacts(email: string, query: string): Promise<Contact[]> {
    return this.request<Contact[]>(`/api/contacts/search?email=${encodeURIComponent(email)}&q=${encodeURIComponent(query)}`);
  }

  // ── Agent Management (Fleets/Status) ─────────────────────────────────────

  async composeEmail(email: string, to: string, subject: string, body: string) {
    return this.request(`/api/gmail/send_email`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        to,
        subject,
        body,
      }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async composeEmailIntelligent(email: string, to: string, prompt: string) {
    const task = `Use the provided prompt to draft an email to ${to}, and then send it immediately. Prompt: ${prompt}`;
    return this.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async createDraft(email: string, to: string, subject: string, body: string) {
    return this.request(`/api/gmail/create_draft`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        to,
        subject,
        body,
      }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async createDraftIntelligent(email: string, to: string, prompt: string) {
    const task = `Use the provided prompt to create a draft email to ${to}. DO NOT send it. Prompt: ${prompt}`;
    return this.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getDrafts(email: string, maxResults: number = 50) {
    return this.request<{ drafts: Draft[]; total: number }>(`/api/gmail/get_drafts`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, max_results: maxResults }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async sendDraft(email: string, draftId: string) {
    return this.request(`/api/gmail/send_draft`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, draft_id: draftId }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async deleteDraft(email: string, draftId: string) {
    return this.request(`/api/gmail/delete_draft`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, draft_id: draftId }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async deleteEmail(email: string, emailId: string) {
    return this.request(`/api/gmail/delete_email`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, message_id: emailId }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async moveToTrash(email: string, emailId: string) {
    return this.request(`/api/gmail/move_to_trash`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, message_id: emailId }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async modifyLabels(email: string, emailId: string, addLabels?: string[], removeLabels?: string[]) {
    return this.request(`/api/gmail/modify_labels`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        message_id: emailId,
        add_labels: addLabels,
        remove_labels: removeLabels,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // AI Agent
  async processEmails(email: string, maxEmails: number = 10) {
    const task = `Fetch my last ${maxEmails} emails and classify them. Give me a summary of what you found.`;
    await this.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });
    return { emails: [], total: 0, auto_classified: true };
  }

  async processSpecificEmails(userEmail: string, emailIds: string[]): Promise<void> {
    const task = `Process and classify the following emails by their IDs: ${emailIds.join(', ')}.`;
    const response = await this.request<{ success: boolean; result?: AgentExecutionResult | string; error?: string }>(`/api/agents/execute?email=${encodeURIComponent(userEmail)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.success) throw new Error(response.error || "Failed to process specific emails");
  }

  async generateReply(email: string, emailId: string, tone: string = 'professional', customMessage?: string) {
    const task = `Read the email with ID ${emailId} and draft a ${tone} reply. DO NOT send the reply. Just return the text of the reply you generated.${customMessage ? ` Additional instructions: ${customMessage}` : ''}`;

    const response = await this.request<{ success: boolean; result?: AgentExecutionResult | string; error?: string }>(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.success) throw new Error(response.error || "Failed to generate reply");

    // agent_executor returns: result = { summary: { message: "...", tools_used: [...] } }
    const result = response.result;
    let replyText: string | null = null;

    if (result && typeof result === 'object') {
      replyText = result.summary?.message || result.message || result.output || null;
    } else if (typeof result === 'string') {
      replyText = result;
    }

    if (!replyText) throw new Error("Agent did not return a reply. Please try again.");

    return {
      reply: replyText,
      original_email: {} as Email,
      suggested_labels: [],
    } as EmailReply;
  }

  async sendReply(email: string, emailId: string, replyText: string) {
    const task = `Reply to the email with ID ${emailId} using exactly the following text:\n\n${replyText}`;
    return this.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async rescheduleMeeting(email: string, emailId: string, originalTime?: string, reason: string = "scheduling conflict") {
    const task = `Look at the email with ID ${emailId}. The meeting scheduled at ${originalTime || 'the original time'} needs to be rescheduled because of: ${reason}. Please find an alternative time and reply to reschedule.`;
    return this.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async scheduleMeeting(email: string, emailId: string, proposedTimes?: string[]) {
    const timesStr = proposedTimes && proposedTimes.length > 0 ? ` Proposed times: ${proposedTimes.join(', ')}.` : '';
    const task = `Look at the email with ID ${emailId} and schedule the requested meeting.${timesStr} Send an invite.`;
    return this.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async createEvent(email: string, meetingDetails: MeetingDetails, startTime: string, endTime: string) {
    return this.request(`/api/calendar/create_event`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        summary: meetingDetails.summary,
        description: meetingDetails.description,
        start_time: startTime,
        end_time: endTime,
        attendees: meetingDetails.attendees,
        location: meetingDetails.location
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async updateEvent(email: string, eventId: string, fields: {
    summary?: string; description?: string; start_time?: string;
    end_time?: string; attendees?: string[]; location?: string;
  }) {
    return this.request(`/api/calendar/update_event`, {
      method: 'PATCH',
      body: JSON.stringify({ user_email: email, event_id: eventId, ...fields }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async deleteEvent(email: string, eventId: string) {
    return this.request(`/api/calendar/delete_event`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, event_id: eventId }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Calendar
  async getEvents(email: string, timeMin?: string, timeMax?: string, maxResults: number = 50) {
    return this.request<{ events: CalendarEvent[]; total: number }>(`/api/calendar/list_events`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        time_min: timeMin,
        time_max: timeMax,
        max_results: maxResults,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async checkAvailability(email: string, startTime: string, endTime: string, attendees?: string) {
    return this.request(`/api/calendar/check_availability`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        start_time: startTime,
        end_time: endTime,
        attendees: attendees ? attendees.split(',').map(a => a.trim()) : [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async suggestTimes(email: string, startTime: string, endTime: string, attendees?: string, maxSuggestions: number = 5) {
    return this.request(`/api/calendar/suggest_times`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        start_date: startTime,
        end_date: endTime,
        duration_minutes: 30, // Default duration if not specified
        attendees: attendees ? attendees.split(',').map(a => a.trim()) : [],
        max_suggestions: maxSuggestions
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // User Preferences
  async getPreferences(email: string) {
    return this.request<UserPreferences>(`/api/user/preferences?email=${encodeURIComponent(email)}`, { silent: true });
  }

  async updatePreferences(
    email: string,
    preferences: Partial<UserPreferences>
  ) {
    return this.request(`/api/user/preferences?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      body: JSON.stringify(preferences),
      headers: { 'Content-Type': 'application/json' },
      silent: true,
    });
  }

  // Agent SDK (Legacy Stubbed)
  async initializeAgent(_email: string) {
    return Promise.resolve({ status: 'completed', message: 'Agent connected locally.' } as AgentResponse);
  }

  async getLegacyAgentStatus(_email: string) {
    return Promise.resolve({
      enabled: true,
      assistant_id: 'global',
      thread_id: 'global',
      status: 'active'
    } as AgentStatus);
  }

  async chatWithAgent(email: string, request: AgentChatRequest) {
    const execRes = await this.executeAgentTask(email, request.message);
    const resultText = execRes.result?.step_results?.final_output ||
      execRes.result?.step_results?.answer ||
      execRes.result?.summary?.message ||
      "I processed that successfully.";

    // the backend uses 'tools_used' inside result.summary
    const toolsUsed = execRes.result?.summary?.tools_used || [];

    return {
      status: 'completed',
      response: resultText,
      toolsUsed: toolsUsed
    } as AgentResponse;
  }

  async chatWithAgentStream(
    email: string,
    request: AgentChatRequest & { doc_id?: string; doc_ids?: string[]; agent_id?: number },
    onEvent: (event: AgentStreamEvent) => void
  ) {
    const url = `${API_BASE_URL}/api/agents/chat/stream?email=${encodeURIComponent(email)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_description: request.message,
        doc_id: request.doc_id ?? null,
        doc_ids: request.doc_ids ?? null,
        agent_id: request.agent_id ?? null,
        cost_opt_mode: localStorage.getItem('mc_cost_opt') === 'true',
      }),
    });

    if (!response.ok) {
      throw new Error(`Stream error: ${response.statusText}`);
    }

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let jsonStr = line;
        if (line.startsWith('data: ')) {
          jsonStr = line.slice(6);
        } else if (line.startsWith('data:')) {
          jsonStr = line.slice(5);
        }

        if (jsonStr.trim() === '[DONE]') {
          continue;
        }

        try {
          const data = JSON.parse(jsonStr);
          onEvent(data);
        } catch {
          console.error("Failed to parse stream line:", line);
        }
      }
    }
  }

  async generateDocument(
    email: string,
    content: string,
    format: 'pdf' | 'docx' | 'xlsx' | 'txt',
    filename: string
  ): Promise<Blob> {
    const res = await fetch(`${API_BASE_URL}/api/documents/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, content, format, filename }),
    });
    if (!res.ok) throw new Error(`Generate failed: ${res.statusText}`);
    return res.blob();
  }

  // Centralized Agent System
  async executeAgentTask(email: string, taskDescription: string, agentType?: string, context?: Record<string, unknown>) {
    const res = await this.request<{
      success: boolean;
      agent?: {
        type: string;
        name: string;
        description: string;
      };
      task: string;
      result?: {
        workflow_steps_executed: number;
        step_results?: Record<string, unknown>;
        summary?: {
          message: string;
          tools_used: string[];
        };
        task_completed: boolean;
      };
      execution_time: string;
      error?: string;
    }>(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({
        task_description: taskDescription,
        agent_type: agentType,
        context: context
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.success) {
      throw new Error(res.error || "Agent execution failed.");
    }

    return res;
  }

  // Document Upload Service
  async uploadDocument(email: string, file: File): Promise<{ id: string; db_id: number; filename: string; size: number; uploaded_at: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${API_BASE_URL}/api/documents/upload?email=${encodeURIComponent(email)}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to upload document: ${errText}`);
    }

    // Backend returns the fields directly (not wrapped in a "document" key)
    return await response.json();
  }

  async listDocuments(email: string): Promise<{ id: string; filename: string; size: number; uploaded_at: string }[]> {
    const res = await this.request<{ success: boolean; documents: { id: string; filename: string; size: number; uploaded_at: string }[] }>(
      `/api/documents/list?email=${encodeURIComponent(email)}`
    );
    return res.documents ?? [];
  }

  async parseDocument(email: string, docId: string): Promise<{ text: string; filename: string; char_count: number }> {
    const res = await this.request<{ success: boolean; text: string; filename: string; char_count: number }>(
      `/api/documents/parse/${encodeURIComponent(docId)}?email=${encodeURIComponent(email)}`
    );
    return { text: res.text, filename: res.filename, char_count: res.char_count };
  }

  async deleteDocument(email: string, docId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/api/documents/${encodeURIComponent(docId)}?email=${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    );
  }

  async getDraft(email: string, draftId: string): Promise<ContentDraft | null> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const res = await fetch(
      `${API_BASE_URL}/api/drafts/${encodeURIComponent(draftId)}?email=${encodeURIComponent(email)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.draft;
  }

  async updateDraft(email: string, draftId: string, payload: { content: string; title?: string }): Promise<ContentDraft> {
    const res = await this.request<{ draft: ContentDraft }>(
      `/api/drafts/${encodeURIComponent(draftId)}?email=${encodeURIComponent(email)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return res.draft;
  }

  async saveDraft(email: string, draftId: string): Promise<{ draft: ContentDraft; result: { success: boolean; url?: string; message?: string } }> {
    return this.request<{ draft: ContentDraft; result: { success: boolean; url?: string; message?: string } }>(
      `/api/drafts/${encodeURIComponent(draftId)}/save?email=${encodeURIComponent(email)}`,
      {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  async cleanCsv(email: string, docId: string): Promise<{
    cleaned_csv: string;
    original_shape: [number, number];
    cleaned_shape: [number, number];
    rows_removed: number;
    cols_removed: number;
    issues: Array<{
      type: string;
      detail: string;
      action: string;
      count?: number;
      mapping?: Record<string, string>;
      by_column?: Record<string, unknown>;
    }>;
  }> {
    return this.request(`/api/documents/clean/${docId}?email=${encodeURIComponent(email)}`, {
      method: 'POST',
    });
  }

  async getCentralizedAgentStatus(email: string) {
    return this.request<{
      total_agents: number;
      active_agents: number;
      agent_types: Record<string, {
        name: string;
        status: string;
        capabilities_count: number;
        tools_count: number;
      }>;
      tool_coverage: Record<string, number>;
    }>(`/api/agents/status?email=${encodeURIComponent(email)}`);
  }

  async listAllAgents(email: string) {
    return this.request<{
      agents: Array<{
        type: string;
        name: string;
        description: string;
        is_active: boolean;
        capabilities: Array<{
          name: string;
          description: string;
          examples: string[];
        }>;
        required_tools: string[];
        optional_tools: string[];
        workflows: Array<{
          step_name: string;
          description: string;
          expected_output: string;
        }>;
      }>;
      total_count: number;
    }>(`/api/agents/list?email=${encodeURIComponent(email)}`);
  }

  async getAgentRecommendation(email: string, taskDescription: string) {
    return this.request<{
      recommended_agent: {
        type: string;
        name: string;
        description: string;
        confidence: string;
        reasoning: string;
        capabilities: string[];
        required_tools: string[];
      };
      alternative_agents: Array<{
        type: string;
        name: string;
        description: string;
        confidence: string;
      }>;
      task: string;
    }>(`/api/agents/recommend?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({
        task_description: taskDescription
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // ── Phase 11: Blueprint API ──────────────────────────────────────────────────

  async getAgentBlueprints() {
    return this.request<{
      blueprints: AgentBlueprint[];
    }>('/api/dynamic-agents/blueprints');
  }

  async createAgentFromBlueprint(
    email: string,
    blueprintId: string,
    customizationPrompt: string,
    agentName?: string,
  ) {
    return this.request<{
      success: boolean;
      agent?: {
        id: number;
        name: string;
        description: string;
        capabilities: string[];
        tools: string[];
      };
      message: string;
      blueprint?: {
        id: string;
        archetype_name: string;
        gating_summary: string;
        requires_credentials: string[];
      };
    }>(`/api/dynamic-agents/create-from-blueprint?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blueprint_id: blueprintId,
        customization_prompt: customizationPrompt,
        agent_name: agentName,
      }),
    });
  }

  // Dynamic Agent Creation System
  async createAgentFromPrompt(
    email: string,
    prompt: string,
    agentName?: string,
    roleDescription?: string
  ) {
    console.log('Debug - API call createAgentFromPrompt:', { email, prompt, agentName, roleDescription });

    return this.request<{
      success: boolean;
      agent?: {
        id: number;
        name: string;
        description: string;
        capabilities: string[];  // Changed to match backend: List[str]
        tools: string[];
        workflows: Array<{
          step_name: string;
          description: string;
          input_data: Record<string, unknown>;
          expected_output: string;
        }>;
      };
      message: string;
      error?: string;
      required_apis?: string[];
      api_required?: boolean;
    }>(`/api/dynamic-agents/create?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: prompt,
        agent_name: agentName,
        role_description: roleDescription
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getUserCreatedAgents(email: string) {
    return this.request<{
      agents: Array<{
        id: number;
        name: string;
        description: string;
        role: string;
        industry?: string;
        benchmark_score?: number | null;
        research_context?: { quality_score?: number };
        has_rag?: boolean;
        agent_config?: { gating_policy?: { requires_approval?: boolean; required_credentials?: string[] } | null };
        capabilities: string[];
        tools: string[];
        workflows: Array<{
          step_name: string;
          description: string;
          input_data: Record<string, unknown>;
          expected_output: string;
        }>;
        created_at: string;
        is_default: boolean;
      }>;
      total_count: number;
    }>(`/api/dynamic-agents/user-agents?email=${encodeURIComponent(email)}`);
  }

  async deleteUserAgent(email: string, agentId: number) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/api/dynamic-agents/user-agents/${agentId}?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
  }

  async updateUserAgent(email: string, agentId: number, data: { name?: string; description?: string; role?: string; industry?: string }) {
    return this.request<{
      success: boolean;
      message: string;
      cloned?: boolean;
      new_agent_id?: number;
    }>(`/api/dynamic-agents/user-agents/${agentId}?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ── Agent V2 (Brain-powered) ────────────────────────────────────────────────

  async createAgentV2Stream(
    email: string,
    data: {
      task: string;
      industry: string;
      role?: string;
      job_title?: string;
      company_website?: string;
      company_name?: string;
      agent_name?: string;
    },
    onEvent: (event: { stage: string; progress: number; message: string; agent?: unknown; error?: string }) => void
  ): Promise<void> {
    const url = `${API_BASE_URL}/api/dynamic-agents/create-v2/stream?email=${encodeURIComponent(email)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || 'Failed to start agent creation');
    }
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch { /* ignore malformed */ }
        }
      }
    }
  }

  async getAgentStatus(email: string, agentId: number) {
    return this.request<{
      id: number;
      name: string;
      role: string;
      industry: string;
      status: string;
      is_active: boolean;
      has_rag: boolean;
      benchmark_score: number | null;
      quality_score: number | null;
      soul: {
        identity: Record<string, string>;
        personality: Record<string, string>;
        capabilities_count: number;
        workflows_count: number;
        terminology_count: number;
        guardrails_count: number;
        has_custom_instructions: boolean;
      };
      research: { facts_collected: number; quality_passed: boolean | null };
      created_at: string | null;
    }>(`/api/dynamic-agents/${agentId}/status?email=${encodeURIComponent(email)}`);
  }

  async uploadKnowledgeDoc(email: string, agentId: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_BASE_URL}/api/dynamic-agents/${agentId}/upload-knowledge?email=${encodeURIComponent(email)}`;
    const response = await fetch(url, { method: 'POST', body: formData });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || 'Upload failed');
    }
    return response.json() as Promise<{ success: boolean; doc_id: number; filename: string; size_bytes: number; status: string }>;
  }

  async listKnowledgeDocs(email: string, agentId: number) {
    return this.request<{
      agent_id: number;
      has_rag: boolean;
      documents: Array<{
        id: number;
        filename: string;
        size_bytes: number;
        status: 'pending' | 'processing' | 'indexed' | 'failed';
        chunk_count: number | null;
        error_message: string | null;
        created_at: string | null;
        indexed_at: string | null;
      }>;
      total: number;
    }>(`/api/dynamic-agents/${agentId}/knowledge-docs?email=${encodeURIComponent(email)}`);
  }

  async deleteKnowledgeDoc(email: string, agentId: number, docId: number) {
    return this.request<{ success: boolean; message: string }>(
      `/api/dynamic-agents/${agentId}/knowledge-docs/${docId}?email=${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    );
  }

  async submitAgentFeedback(email: string, agentId: number, quality: number, text?: string, category?: string) {
    return this.request<{ success: boolean; message: string }>(
      `/api/dynamic-agents/${agentId}/feedback?email=${encodeURIComponent(email)}`,
      {
        method: 'POST',
        body: JSON.stringify({ response_quality: quality, feedback_text: text, feedback_category: category }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  async processEmailsWithAgent(email: string, maxEmails: number = 20) {
    const task = `Read and summarize my last ${maxEmails} emails.`;
    const execRes = await this.executeAgentTask(email, task);
    return {
      emails: [],
      insights: [execRes.result?.step_results?.final_output || "Finished processing emails."],
      suggestions: []
    };
  }

  // Automated Email Service (Stubbed for Dynamic Agent System)
  async startEmailMonitoring(email: string) {
    return this.request<{ success: boolean; message: string }>(
      `/api/proactive/monitoring/start?email=${encodeURIComponent(email)}`,
      { method: 'POST' }
    );
  }

  async stopEmailMonitoring(email: string) {
    return this.request<{ success: boolean; message: string }>(
      `/api/proactive/monitoring/stop?email=${encodeURIComponent(email)}`,
      { method: 'POST' }
    );
  }
  async getEmailNotifications(_email: string) { return Promise.resolve({ notifications: [], total: 0, auto_reply_delay: 300 } as NotificationsResponse); }
  async dismissEmailNotification(_email: string, _emailId: string) { return Promise.resolve({ success: true, message: "Dismissed" }); }
  async updateAutoReplyDelay(_email: string, delaySeconds: number) { return Promise.resolve({ success: true, message: "Updated", new_delay: delaySeconds }); }
  async getAutomatedServiceStatus(email: string) {
    try {
      const prefs = await this.request<UserPreferences>(`/api/user/preferences?email=${encodeURIComponent(email)}`);
      return {
        is_monitoring: Boolean(prefs.is_monitoring),
        active_notifications: 0,
        auto_reply_delay: 300,
        check_interval: 60,
        service_running: Boolean(prefs.is_monitoring),
      } as AutomatedServiceStatus;
    } catch {
      return {
        is_monitoring: false,
        active_notifications: 0,
        auto_reply_delay: 300,
        check_interval: 60,
        service_running: false,
      } as AutomatedServiceStatus;
    }
  }

  // Calendar Reminder Service (Stubbed for Dynamic Agent System)
  async startCalendarReminders(_email: string) { return Promise.resolve({ success: true, message: "Started" }); }
  async stopCalendarReminders(_email: string) { return Promise.resolve({ success: true, message: "Stopped" }); }
  async getCalendarReminders(_email: string) { return Promise.resolve({ success: true, reminders: [] as CalendarReminder[], total: 0 }); }
  async getCalendarReminderStatus(_email: string) {
    return Promise.resolve({
      success: true,
      status: { is_monitoring: false, active_reminders: 0, last_update: Date.now() } as CalendarReminderStatus
    });
  }
  async clearCalendarReminders(_email: string) { return Promise.resolve({ success: true, message: "Cleared" }); }

  async getEmailsByIds(userEmail: string, ids: string[], classify: boolean = false): Promise<EmailApiResponse> {
    const promises = ids.map(id => this.getEmail(userEmail, id).catch(() => null));
    const results = await Promise.all(promises);
    const validEmails = results.filter(Boolean) as Email[];
    return {
      emails: validEmails,
      total: validEmails.length,
      auto_classified: classify
    } as unknown as EmailApiResponse;
  }

  // API Key Management (Stubbed - using .env globally now)
  async createAPIKey(_serviceName: string, _apiKey: string, _permissions?: Record<string, unknown>) {
    return Promise.resolve({
      success: true,
      message: "API Key configured securely via env variables.",
      api_key_id: Math.floor(Math.random() * 1000)
    });
  }

  async getUserAPIKeys(_email: string) {
    return Promise.resolve([]);
  }

  async deleteAPIKey(_apiKeyId: number, _email: string) {
    return Promise.resolve({
      success: true,
      message: "Key removed from local view"
    });
  }

  async getSupportedServices() {
    return Promise.resolve([
      {
        name: "openai",
        display_name: "OpenAI GPT-4",
        description: "Default AI Model",
        capabilities: ["chat", "reasoning"],
        required_fields: ["api_key"]
      },
      {
        name: "gemini",
        display_name: "Google Gemini",
        description: "Alternative AI Model",
        capabilities: ["chat", "reasoning"],
        required_fields: ["api_key"]
      }
    ]);
  }

  async assignAPIKeyToAgent(_apiKeyId: number, _agentId: number, _permissions: Record<string, unknown>) {
    return Promise.resolve({
      success: true,
      message: "Agent access granted."
    });
  }

  async getAgentAPIAccess(agentId: number) {
    return Promise.resolve({
      agent_id: agentId,
      api_access: []
    });
  }

  async validateAPIKey(serviceName: string) {
    return Promise.resolve({
      service_name: serviceName,
      has_valid_key: true,
      user_id: 1
    });
  }

  // Sheets Integrations
  async createSpreadsheet(email: string, title: string, sheetName: string = "Sheet1", initialData?: unknown[][]) {
    return this.request(`/api/sheets/create_spreadsheet`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, title, sheet_name: sheetName, initial_data: initialData }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getSheetData(email: string, spreadsheetId: string, range: string) {
    return this.request(`/api/sheets/get_sheet_data`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, spreadsheet_id: spreadsheetId, range }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async writeSheetData(email: string, spreadsheetId: string, range: string, values: unknown[][]) {
    return this.request(`/api/sheets/write_sheet_data`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, spreadsheet_id: spreadsheetId, range, values }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async appendRows(email: string, spreadsheetId: string, range: string, values: unknown[][]) {
    return this.request(`/api/sheets/append_rows`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, spreadsheet_id: spreadsheetId, range, values }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Forms Integrations
  async createForm(email: string, title: string, description: string = "", questions?: { title: string; type: 'text' | 'paragraph' | 'multiple_choice' | 'checkbox' | 'dropdown' | 'scale'; required?: boolean; options?: string[] }[]) {
    return this.request(`/api/forms/create_form`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, title, description, questions }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getFormResponses(email: string, formId: string, maxResults: number = 100) {
    return this.request(`/api/forms/get_form_responses`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, form_id: formId, max_results: maxResults }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Slides Integrations
  async createPresentation(email: string, title: string, slides?: { layout?: 'TITLE_AND_BODY' | 'BLANK' | 'TITLE_ONLY' | 'TITLE' | 'SECTION_HEADER' | 'SECTION_TITLE_AND_DESCRIPTION'; title_text?: string; body_text?: string }[]) {
    return this.request(`/api/slides/create_presentation`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, title, slides }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getPresentation(email: string, presentationId: string) {
    return this.request(`/api/slides/get_presentation`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, presentation_id: presentationId }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Integrations (Universal) ──────────────────────────────────────────────

  async getIntegrationsStatus(email?: string): Promise<Record<string, { connected: boolean; available: boolean }>> {
    const query = email ? `?email=${encodeURIComponent(email)}` : '';
    return this.request(`/api/integrations/status${query}`, { silent: true });
  }

  /** Start OAuth2 connect - opens a popup. Resolves when the popup posts back. */
  connectOAuth(platform: string, email: string): Promise<void> {
    const url = `${API_BASE_URL}/api/integrations/${platform}/connect?email=${encodeURIComponent(email)}`;
    return new Promise((resolve, reject) => {
      const popup = window.open(url, `connect_${platform}`, 'width=620,height=700');
      let settled = false;
      const finish = (ok: boolean, err?: string) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        window.removeEventListener('message', onMessage);
        ok ? resolve() : reject(new Error(err || 'OAuth failed'));
      };

      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'integration_connected' && e.data.platform === platform) finish(true);
        else if (e.data?.type === 'integration_error' && e.data.platform === platform) finish(false, e.data.error);
      };
      window.addEventListener('message', onMessage);

      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          // Only auto-resolve if we haven't settled yet and the popup closed without
          // a postMessage — this covers the COOP fallback (Slack/GitHub) where
          // window.opener is cleared and the backend does a redirect instead.
          // Give postMessage a brief grace period before treating close as success.
          setTimeout(() => finish(true), 200);
          return;
        }
        // Detect the COOP fallback: Slack/GitHub clear window.opener via COOP headers,
        // so the backend callback redirects the popup to /settings?connected=platform
        // instead of postMessage-ing. Detect this by checking if the popup navigated
        // back to our own origin - then close it and resolve.
        try {
          if (popup.location.origin === window.location.origin) {
            popup.close();
            finish(true);
          }
        } catch {
          // SecurityError: popup is still on a cross-origin page - keep waiting
        }
      }, 500);
    });
  }

  /** Get field config for API-key platforms before showing the form. */
  async getApiKeyConfig(platform: string, email: string): Promise<{
    fields: { name: string; label: string; placeholder: string; type: string }[];
    auth_type: string;
    instructions?: string;
    ui_flow?: any[];
    help_url?: string;
  }> {
    const cacheKey = `config_${platform}`;
    if (this.configCache[cacheKey]) {
      return this.configCache[cacheKey];
    }
    const config = await this.request<any>(`/api/integrations/${platform}/connect?email=${encodeURIComponent(email)}`, { silent: true });
    this.configCache[cacheKey] = config;
    return config;
  }

  /** Save an API key / bot token credential. */
  async saveApiKey(platform: string, email: string, fields: Record<string, string>) {
    return this.request(`/api/integrations/${platform}/api_key?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Test an existing stored credential. */
  async verifyIntegration(platform: string, email: string): Promise<{ ok: boolean; detail: string }> {
    return this.request(`/api/integrations/${platform}/verify?email=${encodeURIComponent(email)}`, {
      method: 'POST',
    });
  }

  /** Revoke / disconnect a platform. */
  async revokeIntegration(platform: string, email: string) {
    return this.request(`/api/integrations/${platform}?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
  }

  // ── Workflow Management ────────────────────────────────────────────────
  async listWorkflows(email: string) {
    return this.request<Workflow[]>(`/api/workflows/?email=${encodeURIComponent(email)}`);
  }

  async getWorkflowDetails(email: string, workflowId: number) {
    return this.request<Workflow>(`/api/workflows/${workflowId}?email=${encodeURIComponent(email)}`);
  }

  async approveWorkflowStep(
    email: string,
    workflowId: number,
    stepId: number,
    status: 'approved' | 'rejected' | 'modified',
    modifiedInput?: Record<string, unknown>
  ) {
    return this.request<{ success: boolean; new_status?: string; result?: string; message?: string; error?: string }>(
      `/api/workflows/${workflowId}/steps/${stepId}/approve?email=${encodeURIComponent(email)}`,
      {
        method: 'POST',
        body: JSON.stringify({ status, modified_input: modifiedInput }),
      }
    );
  }

  // Legacy Telegram (kept for backward compat)
  async saveTelegramConfig(botToken: string, chatId?: string) {
    return this.request(`/api/integrations/telegram/config`, {
      method: 'POST',
      body: JSON.stringify({ bot_token: botToken, chat_id: chatId }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getTelegramHistory(limit: number = 10) {
    return this.request(`/api/integrations/get_telegram_history?limit=${limit}`);
  }

  // ── BYO-AI (Model Vault) ───────────────────────────────────────────────────
  async saveLLMConfig(userEmail: string, provider: string, fields: Record<string, string>) {
    return this.request<{ success: boolean; message: string }>(`/api/integrations/${provider}/api_key?email=${encodeURIComponent(userEmail)}`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Toggle between company-managed keys and personal keys (company accounts only). */
  async setKeyMode(email: string, useCompanyKeys: boolean): Promise<{ use_company_keys: boolean; message: string }> {
    return this.request(`/api/user/key-mode?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ use_company_keys: useCompanyKeys }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getLLMConfig(userEmail: string, provider: string) {
    // We don't return the actual key, just whether it exists
    const status = await this.getIntegrationsStatus(userEmail);
    return { connected: !!status[provider]?.connected };
  }
}

export const apiService = new ApiService();
export default apiService;

export async function getAllEmails(userEmail: string, _classify: boolean) {
  // Use the new Unified POST endpoint
  const url = `${process.env.NEXT_PUBLIC_API_URL}/api/gmail/list_emails`;
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ user_email: userEmail, max_results: 50 }),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}
