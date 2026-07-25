import { apiClient } from "@/lib/api-client";
import { FollowUp, FollowUpDraftRequest, BriefingResult, BriefingSummary, RelationshipCard } from "@/types/proactive.types";

export class ProactiveService {
  async getFollowUps(email: string, days: number = 14) {
    return apiClient.request<{ follow_ups: FollowUp[]; total: number; days_scanned: number }>(
      `/api/proactive/follow-ups?email=${encodeURIComponent(email)}&days=${days}`
    );
  }

  async getPendingFollowUps(email: string) {
    return apiClient.request<{ follow_ups: FollowUp[]; total: number }>(
      `/api/proactive/follow-ups/pending?email=${encodeURIComponent(email)}`
    );
  }

  async approveFollowUp(email: string, id: number, editedDraft?: string) {
    return apiClient.request<{ success: boolean; status: string }>(
      `/api/proactive/follow-ups/${id}/approve?email=${encodeURIComponent(email)}`,
      {
        method: 'POST',
        body: JSON.stringify({ edited_draft: editedDraft ?? null }),
      }
    );
  }

  async cancelFollowUp(email: string, id: number) {
    return apiClient.request<{ success: boolean }>(
      `/api/proactive/follow-ups/${id}/cancel?email=${encodeURIComponent(email)}`,
      { method: 'POST', body: '{}' }
    );
  }

  async generateFollowUpDraft(email: string, item: FollowUpDraftRequest) {
    return apiClient.request<{ draft: string; suggested_subject: string; recipient: string }>(
      `/api/proactive/follow-ups/draft?email=${encodeURIComponent(email)}`,
      { method: 'POST', body: JSON.stringify(item) }
    );
  }

  async getBriefing(email: string) {
    return apiClient.request<BriefingResult>(`/api/proactive/briefing?email=${encodeURIComponent(email)}`);
  }

  async runBriefing(email: string) {
    return apiClient.request<{ success: boolean; narrative: string; email_sent: boolean; summary: BriefingSummary }>(
      `/api/proactive/briefing/run?email=${encodeURIComponent(email)}`,
      { method: 'POST' }
    );
  }

  async getBriefingSettings(email: string) {
    return apiClient.request<{ enabled: boolean; time: string }>(
      `/api/proactive/briefing/settings?email=${encodeURIComponent(email)}`
    );
  }

  async updateBriefingSettings(email: string, enabled: boolean, time: string) {
    return apiClient.request<{ success: boolean; message: string }>(
      `/api/proactive/briefing/settings?email=${encodeURIComponent(email)}`,
      { method: 'PUT', body: JSON.stringify({ enabled, time }) }
    );
  }

  async getRelationshipIntel(email: string, contact: string, days: number = 60) {
    return apiClient.request<RelationshipCard>(
      `/api/proactive/relationship?email=${encodeURIComponent(email)}&contact=${encodeURIComponent(contact)}&days=${days}`
    );
  }

  async startEmailMonitoring(email: string) {
    return apiClient.request<{ success: boolean; message: string }>(
      `/api/proactive/monitoring/start?email=${encodeURIComponent(email)}`,
      { method: 'POST' }
    );
  }

  async stopEmailMonitoring(email: string) {
    return apiClient.request<{ success: boolean; message: string }>(
      `/api/proactive/monitoring/stop?email=${encodeURIComponent(email)}`,
      { method: 'POST' }
    );
  }
}

export const proactiveService = new ProactiveService();
