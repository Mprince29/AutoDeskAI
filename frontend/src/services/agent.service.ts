import { apiClient } from "@/lib/api-client";
import { AgentStatus, AgentBlueprint, AgentStreamEvent, AgentExecutionResult } from "@/types/agent.types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export class AgentService {
  async getAgentStatus(email: string) {
    return apiClient.request<{
      fleet_active: boolean;
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
    return apiClient.request<{
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
    return apiClient.request<{
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
        transition: string;
      }>;
      task: string;
    }>(`/api/agents/recommend?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: taskDescription }),
    });
  }

  async streamAgentChat(
    email: string,
    request: { message: string, doc_id?: string, doc_ids?: string[], agent_id?: number, session_id?: number | null },
    onEvent: (event: AgentStreamEvent) => void
  ): Promise<{ session_id: number | null }> {
    const url = `${API_BASE_URL}/api/agents/chat/stream?email=${encodeURIComponent(email)}`;
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        task_description: request.message,
        doc_id: request.doc_id ?? null,
        doc_ids: request.doc_ids ?? null,
        agent_id: request.agent_id ?? null,
        session_id: request.session_id ?? null,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Stream error: ${response.statusText}`;
      try {
        const payload = await response.json();
        const detail = payload?.detail;
        if (typeof detail === 'string' && detail.trim()) {
          errorMessage = detail;
        } else if (payload?.message) {
          errorMessage = payload.message;
        } else if (payload?.error) {
          errorMessage = payload.error;
        }
      } catch {
        // Keep fallback statusText message
      }
      throw new Error(errorMessage);
    }

    const sessionIdHeader = response.headers.get('X-Session-Id');
    const returnedSessionId = sessionIdHeader ? parseInt(sessionIdHeader) : null;

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

    return { session_id: returnedSessionId };
  }

  async executeAgentTask(email: string, taskDescription: string, agentType?: string, _context?: Record<string, unknown>) {
    return apiClient.request<{
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
      body: JSON.stringify({ task_description: taskDescription, agent_type: agentType }),
    });
  }

  async getAgentBlueprints() {
    return apiClient.request<{
      blueprints: AgentBlueprint[];
    }>('/api/dynamic-agents/blueprints');
  }

  async createAgentFromBlueprint(
    email: string,
    blueprintId: string,
    customizationPrompt: string,
    agentName?: string,
  ) {
    return apiClient.request<{
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
      body: JSON.stringify({
        blueprint_id: blueprintId,
        customization_prompt: customizationPrompt,
        agent_name: agentName,
      }),
    });
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
  async getDynamicAgentStatus(email: string, agentId: number) {
    return apiClient.request<{
      id: number;
      name: string;
      description: string;
      is_active: boolean;
      status: string;
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
    return apiClient.request<{
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
    return apiClient.request<{ success: boolean; message: string }>(
      `/api/dynamic-agents/${agentId}/knowledge-docs/${docId}?email=${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    );
  }

  async getUserCreatedAgents(email: string) {
    return apiClient.request<{
      agents: Array<{
        id: number;
        name: string;
        description: string;
        role: string;
        is_active: boolean;
        is_default: boolean;
        industry?: string;
      }>;
      total_count: number;
    }>(`/api/dynamic-agents/user-agents?email=${encodeURIComponent(email)}`);
  }

  async deleteUserAgent(email: string, agentId: number) {
    return apiClient.request<{ success: boolean; message: string }>(
      `/api/dynamic-agents/user-agents/${agentId}?email=${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    );
  }

  async submitAgentFeedback(email: string, agentId: number, quality: number, text?: string, category?: string) {
    return apiClient.request<{ success: boolean; message: string }>(
      `/api/dynamic-agents/${agentId}/feedback?email=${encodeURIComponent(email)}`,
      {
        method: 'POST',
        body: JSON.stringify({ response_quality: quality, feedback_text: text, feedback_category: category }),
      }
    );
  }
}

export const agentService = new AgentService();
