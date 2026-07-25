import { apiClient } from "@/lib/api-client";
import { Email, Draft, EmailReply, EmailNotification } from "@/types/gmail.types";
import { AgentExecutionResult } from "@/types/agent.types";

export class GmailService {
  async getEmails(email: string, maxResults: number = 50, labelIds?: string, _classify: boolean = true, pageToken?: string) {
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
    return apiClient.request<{ emails: Email[]; total: number; nextPageToken?: string; resultSizeEstimate?: number }>(
      `/api/gmail/list_emails`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async searchEmails(email: string, query: string, maxResults: number = 50) {
    return apiClient.request<{ emails: Email[]; total: number; nextPageToken?: string }>(
      `/api/gmail/list_emails`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, query, max_results: maxResults }),
    });
  }

  async getEmail(email: string, emailId: string) {
    return apiClient.request<Email>(`/api/gmail/get_email`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, message_id: emailId }),
    });
  }

  async composeEmail(email: string, to: string, subject: string, body: string) {
    return apiClient.request(`/api/gmail/send_email`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        to,
        subject,
        body,
      }),
    });
  }

  async createDraft(email: string, to: string, subject: string, body: string) {
    return apiClient.request(`/api/gmail/create_draft`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        to,
        subject,
        body,
      }),
    });
  }

  async getDrafts(email: string, maxResults: number = 50) {
    return apiClient.request<{ drafts: Draft[]; total: number }>(`/api/gmail/get_drafts`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, max_results: maxResults }),
    });
  }

  async sendDraft(email: string, draftId: string) {
    return apiClient.request(`/api/gmail/send_draft`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, draft_id: draftId }),
    });
  }

  async deleteDraft(email: string, draftId: string) {
    return apiClient.request(`/api/gmail/delete_draft`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, draft_id: draftId }),
    });
  }

  async deleteEmail(email: string, emailId: string) {
    return apiClient.request(`/api/gmail/delete_email`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, message_id: emailId }),
    });
  }

  async moveToTrash(email: string, emailId: string) {
    return apiClient.request(`/api/gmail/move_to_trash`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, message_id: emailId }),
    });
  }

  async modifyLabels(email: string, emailId: string, addLabels?: string[], removeLabels?: string[]) {
    return apiClient.request(`/api/gmail/modify_labels`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        message_id: emailId,
        add_labels: addLabels,
        remove_labels: removeLabels,
      }),
    });
  }

  async markRead(email: string, emailId: string) {
    return this.modifyLabels(email, emailId, undefined, ['UNREAD']);
  }

  async markUnread(email: string, emailId: string) {
    return this.modifyLabels(email, emailId, ['UNREAD']);
  }

  // Intelligent (Agent-backed) Gmail methods
  async composeEmailIntelligent(email: string, to: string, prompt: string) {
    const task = `Use the provided prompt to draft an email to ${to}, and then send it immediately. Prompt: ${prompt}`;
    return apiClient.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
    });
  }

  async createDraftIntelligent(email: string, to: string, prompt: string) {
    const task = `Use the provided prompt to create a draft email to ${to}. DO NOT send it. Prompt: ${prompt}`;
    return apiClient.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
    });
  }

  async generateReply(email: string, emailId: string, tone: string = 'professional', customMessage?: string) {
    const task = `Read the email with ID ${emailId} and draft a ${tone} reply. DO NOT send the reply. Just return the text of the reply you generated.${customMessage ? ` Additional instructions: ${customMessage}` : ''}`;

    const response = await apiClient.request<{ success: boolean; result?: AgentExecutionResult | string; error?: string }>(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
    });

    if (!response.success) throw new Error(response.error || "Failed to generate reply");

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
    return apiClient.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
    });
  }
}

export const gmailService = new GmailService();
