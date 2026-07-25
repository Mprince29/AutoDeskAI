export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  industry: string;
  status: string;
  isActive: boolean;
  is_default?: boolean;
}

export interface Message {
  id: string;
  type: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  error?: boolean;
  attachments?: { id: string; filename: string }[];
  steps?: { kind: string; label?: string; name?: string }[];
  workflowId?: number;
  workflowGoal?: string;
  workflowSteps?: unknown[];
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
  workflow_id?: number;
  is_qa?: boolean;
  evaluation?: { has_warnings: boolean; flags: string[]; requires_human_review: boolean };
  context_trace?: unknown;
  token_count?: number;
  model_used?: string;
  name?: string;
  display?: string;
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
