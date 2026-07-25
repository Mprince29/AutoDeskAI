import { apiClient } from "@/lib/api-client";
import { Workflow, WorkflowStep } from "@/types/workflow.types";

export class WorkflowService {
  async listWorkflows(email: string) {
    return apiClient.request<Workflow[]>(`/api/workflows/?email=${encodeURIComponent(email)}`);
  }

  async getWorkflowDetails(email: string, workflowId: number) {
    return apiClient.request<Workflow>(`/api/workflows/${workflowId}?email=${encodeURIComponent(email)}`);
  }

  async approveWorkflowStep(
    email: string,
    workflowId: number,
    stepId: number,
    status: 'approved' | 'rejected' | 'modified',
    modifiedInput?: Record<string, unknown>
  ) {
    return apiClient.request<{
      success: boolean;
      new_status?: string;
      result?: string;
      message?: string;
      error?: string;
    }>(
      `/api/workflows/${workflowId}/steps/${stepId}/approve?email=${encodeURIComponent(email)}`,
      {
        method: 'POST',
        body: JSON.stringify({ status, modified_input: modifiedInput }),
      }
    );
  }
}

export const workflowService = new WorkflowService();
