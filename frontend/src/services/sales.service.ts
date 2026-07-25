import apiService from './api';

export interface Signal {
  id: number;
  type: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface Lead {
  id: number;
  contact_name: string;
  contact_email: string | null;
  company: string;
  role: string | null;
  domain?: string | null;
  linkedin_url?: string | null;
  linkedin_headline?: string | null;
  company_size?: string | null;
  company_industry?: string | null;
  company_location?: string | null;
  company_founded?: string | null;
  company_description?: string | null;
  company_logo?: string | null;
  tech_stack?: string[] | null;
  email_verified?: 'valid' | 'risky' | 'invalid' | null;
  enrichment_status?: 'none' | 'pending' | 'enriched' | 'failed';
  lead_timezone?: string | null;
  notes?: string | null;
  dossier?: Record<string, any> | null;
  intent_score: number;
  last_signal_at: string | null;
  last_contacted_at: string | null;
  signals?: Signal[];
  list_tag?: string | null;
  geo_tag?: string | null;
  product_key?: string | null;
  company_news?: string | null;
  campaign_names?: string[];
  replied?: boolean;
}

export interface LeadFinderFilters {
  job_titles?: string[];
  seniority_levels?: string[];
  departments?: string[];
  industries?: string[];
  locations?: string[];
  company_sizes?: string[];
  keywords?: string[];
  limit?: number;
  icp_description?: string;
  product_description?: string;
  product_key?: string;
}

export interface LeadFinderResponse {
  leads: any[];
  count: number;
  parsed_filters?: any;
}

export interface Campaign {
  id: number;
  name: string;
  status: string;
  subject_template: string;
  html_template?: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  open_count: number;          // total pixel fires
  unique_open_count: number;   // unique recipients who opened
  click_count: number;
  reply_count: number;
  open_rate: number;
  click_rate: number;
  created_at: string;
  sent_at: string | null;
  outreach_tag?: string | null;
  product_key?: string | null;
}

export interface CampaignRecipient {
  id: number;
  email: string;
  name: string | null;
  send_status: string;
  open_count: number;
  click_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;   // when they most recently opened
  first_clicked_at: string | null;
  sent_at: string | null;
  lead_timezone?: string | null;
  replied?: boolean;
}

export interface GeneratedTemplate {
  subject_template: string;
  html_template: string;
  variables: string[];
}

export interface BulkValidateRow {
  row: number;
  contact_name: string;
  contact_email: string;
  company: string;
  role: string;
  domain: string;
  valid: boolean;
  issues: string[];
}

export interface BulkValidateResult {
  total: number;
  valid: number;
  invalid: number;
  rows: BulkValidateRow[];
}

export interface NextAction {
  action: string;
  reason: string;
  suggested_subject: string | null;
  urgency: 'high' | 'medium' | 'low';
}

export interface ObjectionResult {
  contact_id: number;
  sentiment: 'positive' | 'neutral' | 'objection';
  objection_type: string | null;
  summary: string;
  suggested_reply: string;
  subject: string;
}

export interface ObjectionLog {
  id: number;
  objection_type: string;
  sentiment: string;
  reply_text: string;
  suggested_reply: string;
  rebuttal_used: string | null;
  was_sent: boolean;
  created_at: string;
}

export interface EscalationEvent {
  id: number;
  contact_id: number;
  contact_name: string | null;
  company: string | null;
  contact_email?: string | null;
  intent_score_at_escalation: number;
  context_brief: string | null;
  human_took_over: boolean;
  created_at: string;
  signals?: Signal[];
}

export interface ReengagementEntry {
  id: number;
  contact_id: number;
  contact_name: string | null;
  company: string | null;
  scheduled_at: string;
  hook_theme: string | null;
  status: 'pending' | 'sent' | 'cancelled';
  draft_subject: string | null;
  created_at: string;
}

export interface OutreachMemory {
  id: number;
  angle: string;
  message_summary: string;
  channel: string;
  used_at: string;
}

export interface CreateLeadPayload {
  contact_name: string;
  contact_email?: string;
  company: string;
  role?: string;
  domain?: string;
  notes?: string;
  list_tag?: string;
  geo_tag?: string;
}

export interface CreateCampaignPayload {
  name: string;
  subject_template: string;
  html_template: string;
  text_template?: string;
  outreach_tag?: string;
}

export interface RecipientPayload {
  email: string;
  name?: string;
  variables?: Record<string, string>;
}

export interface Product {
  product_key: string;
  display_name: string;
  icp_job_titles: string[];
  icp_seniority_levels: string[];
  icp_industries: string[];
  icp_company_sizes: string[];
  icp_locations: string[];
  icp_keywords: string[];
  icp_segments: any[];
  icp_persona_description: string | null;
  product_description: string | null;
  pain_points: string[];
  social_proof: string[];
  cal_link: string | null;
  video_link: string | null;
  deck_link: string | null;
  email1_template: string | null;
  email2_template: string | null;
  sender_name: string | null;
  sender_title: string | null;
}

// ── Sequence types ────────────────────────────────────────────────────────────
export interface SequenceStep {
  id?: number;
  step_number: number;
  delay_days: number;
  subject_template: string;
  html_template: string;
  text_template?: string;
  stop_on: 'reply' | 'open' | 'click' | 'none';
}

export interface Sequence {
  id: number;
  name: string;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
  steps: SequenceStep[];
  stats: { active: number; completed: number; stopped: number };
}

export interface SequenceEnrollment {
  id: number;
  recipient_email: string;
  recipient_name: string | null;
  current_step: number;
  status: 'active' | 'completed' | 'stopped' | 'unsubscribed';
  next_send_at: string | null;
  replied: boolean;
  opened: boolean;
  clicked: boolean;
  enrolled_at: string;
  last_sent_at: string | null;
}

export interface EnrollRecipient {
  email: string;
  name?: string;
  variables?: Record<string, string>;
  timezone?: string;
}

export interface PipelineMode {
  live_mode: boolean;
  label: string;
  warning: string | null;
}

export interface PipelineRunRequest {
  prompt: string;
  product_key?: string | null;
  test_recipients?: string[];
  follow_up_sequence_id?: number | null;
}

export interface PipelineEvent {
  step: string;
  status: 'running' | 'done' | 'error' | 'skipped';
  message: string;
  data: Record<string, any>;
  ts: string;
}

export interface PipelineStepState {
  step: string;
  label: string;
  status: 'idle' | 'running' | 'done' | 'error' | 'skipped';
  message: string;
  data: Record<string, any>;
  ts?: string;
}

export interface PipelineRunSummary {
  leads_found?: number;
  contacts_created?: number;
  contacts_saved?: number;
  emails_sent?: number;
  failed?: number;
  live_mode?: boolean;
  campaign_id?: number;
  campaign_name?: string;
  no_email_leads?: number;
  job_id?: string;
}

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function getResponseError(resp: Response, fallback: string): Promise<string> {
  try {
    const data = await resp.clone().json();
    if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail;
    if (typeof data?.message === 'string' && data.message.trim()) return data.message;
    if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  } catch {
    try {
      const text = await resp.text();
      if (text.trim()) return text;
    } catch {
      // ignore
    }
  }
  return fallback;
}

export const salesService = {
  getLeads: async (
    email: string,
    campaignId?: number | null,
    outreachTag?: string | null,
    listTag?: string | null,
    geoTag?: string | null,
    productKey?: string | null
  ): Promise<Lead[]> => {
    let qs = `email=${encodeURIComponent(email)}`;
    if (campaignId != null) qs += `&campaign_id=${campaignId}`;
    else if (productKey) qs += `&product_key=${encodeURIComponent(productKey)}`;
    else if (outreachTag) qs += `&outreach_tag=${encodeURIComponent(outreachTag)}`;
    if (listTag) qs += `&list_tag=${encodeURIComponent(listTag)}`;
    if (geoTag) qs += `&geo_tag=${encodeURIComponent(geoTag)}`;
    return apiService.get(`/api/sales/contacts?${qs}`);
  },
  getLeadDetails: async (id: number, email: string): Promise<Lead> => {
    return apiService.get(`/api/sales/contacts/${id}?email=${encodeURIComponent(email)}`);
  },

  createLead: async (email: string, payload: CreateLeadPayload): Promise<Lead> => {
    return apiService.post(`/api/sales/contacts?email=${encodeURIComponent(email)}`, payload);
  },

  updateLead: async (id: number, email: string, payload: Partial<Lead>): Promise<Lead> => {
    return apiService.request(`/api/sales/contacts/${id}?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteLead: async (id: number, email: string): Promise<void> => {
    return apiService.request(`/api/sales/contacts/${id}?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
  },
  
  bulkDeleteLeads: async (email: string, contactIds: number[]): Promise<{ deleted: number }> => {
    return apiService.post(`/api/sales/contacts/bulk-delete?email=${encodeURIComponent(email)}`, { contact_ids: contactIds });
  },

  findLeads: async (email: string, filters: LeadFinderFilters): Promise<LeadFinderResponse> => {
    return apiService.post(`/api/sales/leads/find?email=${encodeURIComponent(email)}`, filters);
  },

  saveLeads: async (
    email: string,
    leads: any[],
    listTag?: string | null,
    geoTag?: string | null,
    ignoreDuplicates?: boolean,
    productKey?: string | null,
  ): Promise<{ created: number; updated: number; skipped: number; contacts: Lead[]; org_duplicates?: any[] }> => {
    return apiService.post(`/api/sales/leads/save?email=${encodeURIComponent(email)}`, {
      leads,
      list_tag: listTag || undefined,
      geo_tag: geoTag || undefined,
      ignore_duplicates: ignoreDuplicates,
      product_key: productKey || undefined,
    });
  },

  webEnrichLeads: (
    leads: any[],
    icpFilters: Record<string, any> | null,
    onUpdate: (index: number, updates: Record<string, any>) => void,
    onDone: () => void,
  ): () => void => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
    const ctrl = new AbortController();
    fetch(`${API_BASE_URL}/api/sales/leads/web-enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads, icp_filters: icpFilters }),
      signal: ctrl.signal,
    }).then(async (res) => {
      const reader = res.body?.getReader();
      if (!reader) { onDone(); return; }
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const obj = JSON.parse(line.slice(6));
            if (obj.done) { onDone(); return; }
            if (typeof obj.index === 'number') {
              const updates = { ...(obj.updates ?? {}) };
              if (typeof obj.icp_score === 'number') updates.icp_score = obj.icp_score;
              onUpdate(obj.index, updates);
            }
          } catch { /* skip malformed */ }
        }
      }
      onDone();
    }).catch((e) => {
      if (e.name !== 'AbortError') console.error('web-enrich stream error', e);
      onDone();
    });
    return () => ctrl.abort();
  },

  enrichContact: async (id: number, email: string): Promise<Lead & { new_signals: number }> => {
    return apiService.post(`/api/sales/contacts/${id}/enrich?email=${encodeURIComponent(email)}`);
  },

  generateDossier: async (id: number, email: string): Promise<{ contact_id: number; dossier: any }> => {
    return apiService.post(`/api/sales/contacts/${id}/dossier?email=${encodeURIComponent(email)}`);
  },

  bulkEnrich: async (email: string, contactIds: number[]): Promise<any> => {
    return apiService.post(`/api/sales/contacts/bulk-enrich?email=${encodeURIComponent(email)}`, { contact_ids: contactIds });
  },

  bulkTagContacts: async (
    email: string,
    contactIds: number[],
    listTag?: string | null,
    geoTag?: string | null,
  ): Promise<{ updated: number }> => {
    const body: Record<string, unknown> = { contact_ids: contactIds };
    if (listTag !== undefined) body.list_tag = listTag ?? null;
    if (geoTag !== undefined) body.geo_tag = geoTag ?? null;
    return apiService.request(
      `/api/sales/contacts/bulk-tag?email=${encodeURIComponent(email)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },

  getCampaigns: async (email: string, tag?: string, productKey?: string): Promise<Campaign[]> => {
    let qs = '';
    if (tag) qs += `&outreach_tag=${encodeURIComponent(tag)}`;
    if (productKey) qs += `&product_key=${encodeURIComponent(productKey)}`;
    return apiService.get(`/api/sales/campaigns?email=${encodeURIComponent(email)}${qs}`);
  },

  getCampaign: async (id: number, email: string): Promise<Campaign> => {
    return apiService.get(`/api/sales/campaigns/${id}?email=${encodeURIComponent(email)}`);
  },

  createCampaign: async (email: string, payload: CreateCampaignPayload): Promise<Campaign> => {
    return apiService.post(`/api/sales/campaigns?email=${encodeURIComponent(email)}`, payload);
  },

  sendCampaign: async (id: number, email: string, recipients: RecipientPayload[], product_name?: string): Promise<{ message: string }> => {
    return apiService.post(`/api/sales/campaigns/${id}/send?email=${encodeURIComponent(email)}`, { recipients, product_name });
  },

  getCampaignTags: async (email: string): Promise<{ tags: string[] }> => {
    return apiService.get(`/api/sales/campaigns/tags?email=${encodeURIComponent(email)}`);
  },

  uploadRecipients: async (id: number, email: string, file: File): Promise<{ message: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/sales/campaigns/${id}/upload-recipients?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },

  refreshSignals: async (id: number, email: string): Promise<{ new_signals: number; intent_score: number; signals: Signal[] }> => {
    return apiService.post(`/api/sales/contacts/${id}/refresh?email=${encodeURIComponent(email)}`);
  },

  getNextAction: async (id: number, email: string): Promise<{ contact_id: number; intent_score: number; recommendation: NextAction }> => {
    return apiService.get(`/api/sales/contacts/${id}/next-action?email=${encodeURIComponent(email)}`);
  },

  getSignals: async (id: number, email: string): Promise<Signal[]> => {
    return apiService.get(`/api/sales/contacts/${id}/signals?email=${encodeURIComponent(email)}`);
  },

  getGlobalSignals: async (email: string): Promise<{ lead: Lead; signal: Signal }[]> => {
    return apiService.get(`/api/sales/contacts/signals?email=${encodeURIComponent(email)}`);
  },

  bulkImportLeads: async (email: string, file: File): Promise<{ created: number; skipped: number; contacts: Lead[] }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/sales/contacts/bulk-import?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Bulk import failed');
    }
    return res.json();
  },

  bulkValidateLeads: async (email: string, file: File): Promise<BulkValidateResult> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/sales/contacts/bulk-validate?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Bulk validation failed');
    }
    return res.json();
  },

  generateTemplate: async (email: string, rawEmail: string): Promise<GeneratedTemplate> => {
    return apiService.post(`/api/sales/campaigns/generate-template?email=${encodeURIComponent(email)}`, { raw_email: rawEmail });
  },

  getCampaignRecipients: async (id: number, email: string): Promise<CampaignRecipient[]> => {
    return apiService.get(`/api/sales/campaigns/${id}/recipients?email=${encodeURIComponent(email)}`);
  },

  handleObjection: async (
    id: number,
    email: string,
    payload: { reply_text: string; contact_name?: string; company?: string; original_subject?: string }
  ): Promise<ObjectionResult> => {
    return apiService.post(`/api/sales/contacts/${id}/handle-objection?email=${encodeURIComponent(email)}`, payload);
  },

  // ── Sequences ──────────────────────────────────────────────────────────────
  getSequences: async (email: string): Promise<Sequence[]> => {
    return apiService.get(`/api/sequences?email=${encodeURIComponent(email)}`);
  },

  createSequence: async (email: string, payload: { name: string; steps: SequenceStep[] }): Promise<Sequence> => {
    return apiService.post(`/api/sequences?email=${encodeURIComponent(email)}`, payload);
  },

  updateSequence: async (id: number, email: string, payload: { name?: string; status?: string }): Promise<Sequence> => {
    return apiService.request(`/api/sequences/${id}?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  deleteSequence: async (id: number, email: string): Promise<void> => {
    return apiService.request(`/api/sequences/${id}?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
  },

  enrollToSequence: async (
    id: number,
    email: string,
    recipients: EnrollRecipient[],
    send_hour?: number,
  ): Promise<{ enrolled: number; skipped: number }> => {
    return apiService.post(`/api/sequences/${id}/enroll?email=${encodeURIComponent(email)}`, {
      recipients,
      send_hour: send_hour ?? 9,
    });
  },

  getSequenceEnrollments: async (id: number, email: string, status?: string): Promise<SequenceEnrollment[]> => {
    const qs = status ? `&status=${status}` : '';
    return apiService.get(`/api/sequences/${id}/enrollments?email=${encodeURIComponent(email)}${qs}`);
  },

  pauseSequence: async (id: number, email: string): Promise<void> => {
    return apiService.post(`/api/sequences/${id}/pause?email=${encodeURIComponent(email)}`);
  },

  resumeSequence: async (id: number, email: string): Promise<void> => {
    return apiService.post(`/api/sequences/${id}/resume?email=${encodeURIComponent(email)}`);
  },

  generateEmail: async (
    id: number,
    email: string,
    payload: {
      product_name: string;
      product_description: string;
      sender_name: string;
      sender_title: string;
      cta: string;
    }
  ): Promise<{
    contact_id: number;
    contact_name: string;
    company: string;
    subject: string;
    text_body: string;
    html_body: string;
    opening_sentence: string;
    hook_source: string;
  }> => {
    return apiService.post(`/api/sales/contacts/${id}/generate-email?email=${encodeURIComponent(email)}`, payload);
  },

  getBookingLink: async (id: number, email: string, eventTypeSlug: string): Promise<{
    contact_id: number;
    booking_link: string;
    event_type_slug: string;
    prefilled_for: string;
  }> => {
    return apiService.get(`/api/sales/contacts/${id}/booking-link?email=${encodeURIComponent(email)}&event_type_slug=${encodeURIComponent(eventTypeSlug)}`);
  },

  getEscalations: async (email: string): Promise<EscalationEvent[]> => {
    return apiService.get(`/api/sales/escalations?email=${encodeURIComponent(email)}`);
  },

  resolveEscalation: async (id: number, email: string, action: 'resume' | 'cancel'): Promise<any> => {
    return apiService.post(`/api/sales/escalations/${id}/resolve?email=${encodeURIComponent(email)}`, { action });
  },

  getReengagement: async (email: string, status?: string): Promise<ReengagementEntry[]> => {
    const qs = status ? `&status=${status}` : '';
    return apiService.get(`/api/sales/reengagement?email=${encodeURIComponent(email)}${qs}`);
  },

  cancelReengagement: async (id: number, email: string): Promise<void> => {
    return apiService.request(`/api/sales/reengagement/${id}?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
  },

  sendReengagementNow: async (id: number, email: string): Promise<any> => {
    return apiService.post(`/api/sales/reengagement/${id}/send-now?email=${encodeURIComponent(email)}`);
  },

  getOutreachMemory: async (id: number, email: string): Promise<OutreachMemory[]> => {
    return apiService.get(`/api/sales/contacts/${id}/memory?email=${encodeURIComponent(email)}`);
  },

  getObjectionHistory: async (id: number, email: string): Promise<ObjectionLog[]> => {
    return apiService.get(`/api/sales/contacts/${id}/objection-history?email=${encodeURIComponent(email)}`);
  },

  // ── Products ───────────────────────────────────────────────────────────────
  getProducts: async (email: string): Promise<Product[]> => {
    return apiService.get(`/api/sales/products?email=${encodeURIComponent(email)}`);
  },

  getProduct: async (productKey: string, email: string): Promise<Product> => {
    return apiService.get(`/api/sales/products/${productKey}?email=${encodeURIComponent(email)}`);
  },

  createProduct: async (email: string, payload: {
    display_name: string;
    product_description?: string;
    icp_job_titles?: string[];
    icp_industries?: string[];
    icp_locations?: string[];
    pain_points?: string[];
    social_proof?: string[];
    cal_link?: string;
    sender_name?: string;
    sender_title?: string;
  }): Promise<Product> => {
    return apiService.post(`/api/sales/products?email=${encodeURIComponent(email)}`, payload);
  },

  updateProduct: async (productKey: string, email: string, payload: Partial<Product>): Promise<Product> => {
    return apiService.request(`/api/sales/products/${productKey}?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  getPipelineMode: async (_email?: string): Promise<PipelineMode> => {
    return apiService.get('/api/pipeline/mode');
  },

  setPipelineMode: async (payload: { live_mode: boolean; confirm: string }): Promise<{ live_mode: boolean; message: string }> => {
    return apiService.post('/api/pipeline/mode', payload);
  },

  runPipeline: (
    email: string,
    payload: PipelineRunRequest,
    handlers: {
      onEvent?: (event: PipelineEvent) => void;
      onError?: (error: Error) => void;
      onDone?: () => void;
      signal?: AbortSignal;
    } = {},
  ): AbortController => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
    const ctrl = new AbortController();
    const signal = handlers.signal ?? ctrl.signal;

    fetch(`${API_BASE_URL}/api/pipeline/run?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await getResponseError(res, `Pipeline request failed (${res.status})`));
      }
      if (!res.body) {
        throw new Error('Pipeline stream did not return a response body.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let evt: PipelineEvent;
          try {
            evt = JSON.parse(trimmed) as PipelineEvent;
          } catch {
            continue;
          }

          handlers.onEvent?.(evt);

          if (evt.status === 'error') {
            throw new Error(evt.message || 'Pipeline failed.');
          }
        }
      }

      if (buf.trim()) {
        try {
          const evt = JSON.parse(buf.trim()) as PipelineEvent;
          handlers.onEvent?.(evt);
          if (evt.status === 'error') {
            throw new Error(evt.message || 'Pipeline failed.');
          }
        } catch (error) {
          if (error instanceof Error) throw error;
        }
      }

      handlers.onDone?.();
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      const normalized = error instanceof Error
        ? error
        : new Error('Pipeline failed unexpectedly. Please try again.');
      handlers.onError?.(normalized);
    });

    return ctrl;
  },

  findLeadsPipeline: (
    email: string,
    payload: { prompt: string; product_key?: string | null },
    handlers: {
      onEvent?: (event: PipelineEvent) => void;
      onError?: (error: Error) => void;
      onDone?: () => void;
      signal?: AbortSignal;
    } = {},
  ): AbortController => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
    const ctrl = new AbortController();
    const signal = handlers.signal ?? ctrl.signal;

    fetch(`${API_BASE_URL}/api/pipeline/find-leads?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await getResponseError(res, `Pipeline request failed (${res.status})`));
      }
      if (!res.body) {
        throw new Error('Pipeline stream did not return a response body.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let evt: PipelineEvent;
          try {
            evt = JSON.parse(trimmed) as PipelineEvent;
          } catch {
            continue;
          }

          handlers.onEvent?.(evt);

          if (evt.status === 'error') {
            throw new Error(evt.message || 'Pipeline failed.');
          }
        }
      }

      if (buf.trim()) {
        try {
          const evt = JSON.parse(buf.trim()) as PipelineEvent;
          handlers.onEvent?.(evt);
          if (evt.status === 'error') {
            throw new Error(evt.message || 'Pipeline failed.');
          }
        } catch (error) {
          if (error instanceof Error) throw error;
        }
      }

      handlers.onDone?.();
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      const normalized = error instanceof Error
        ? error
        : new Error('Pipeline failed unexpectedly. Please try again.');
      handlers.onError?.(normalized);
    });

    return ctrl;
  },

  sendOutreachPipeline: (
    email: string,
    payload: {
      job_id: string;
      decision: 'send_with_email_export_rest' | 'export_all';
      test_recipients?: string[];
      force_live?: boolean;
      follow_up_sequence_id?: number | null;
    },
    handlers: {
      onEvent?: (event: PipelineEvent) => void;
      onError?: (error: Error) => void;
      onDone?: () => void;
      signal?: AbortSignal;
    } = {},
  ): AbortController => {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
    const ctrl = new AbortController();
    const signal = handlers.signal ?? ctrl.signal;

    fetch(`${API_BASE_URL}/api/pipeline/send-outreach?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await getResponseError(res, `Pipeline request failed (${res.status})`));
      }
      if (!res.body) {
        throw new Error('Pipeline stream did not return a response body.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let evt: PipelineEvent;
          try {
            evt = JSON.parse(trimmed) as PipelineEvent;
          } catch {
            continue;
          }

          handlers.onEvent?.(evt);

          if (evt.status === 'error') {
            throw new Error(evt.message || 'Pipeline failed.');
          }
        }
      }

      if (buf.trim()) {
        try {
          const evt = JSON.parse(buf.trim()) as PipelineEvent;
          handlers.onEvent?.(evt);
          if (evt.status === 'error') {
            throw new Error(evt.message || 'Pipeline failed.');
          }
        } catch (error) {
          if (error instanceof Error) throw error;
        }
      }

      handlers.onDone?.();
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      const normalized = error instanceof Error
        ? error
        : new Error('Pipeline failed unexpectedly. Please try again.');
      handlers.onError?.(normalized);
    });

    return ctrl;
  },
};
