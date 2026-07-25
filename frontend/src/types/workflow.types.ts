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
