import { create } from 'zustand';
import { Agent, Message } from '@/types/agent.types';
import { agentService } from '@/services/agent.service';

const AGENTS_TTL_MS = 15_000; // minimum gap between any two agent list fetches

interface AgentStore {
  agents: Agent[];
  agentsLoading: boolean;
  hasLoadedAgents: boolean;
  _agentsLastFetch: number;
  selectedAgent: Agent | null;
  messages: Message[];
  messagesLoading: boolean;
  hasLoadedHistory: boolean;

  // Actions
  setAgents: (agents: Agent[]) => void;
  setAgentsLoading: (loading: boolean) => void;
  setSelectedAgent: (agent: Agent | null) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  addMessage: (message: Message) => void;
  
  loadAgents: (email: string, force?: boolean) => Promise<void>;
  loadChatHistory: (email: string, force?: boolean) => Promise<void>;
  removeAgent: (agentId: string | number) => void;
  clearStore: () => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  agentsLoading: false,
  hasLoadedAgents: false,
  _agentsLastFetch: 0,
  selectedAgent: null,
  messages: [],
  messagesLoading: false,
  hasLoadedHistory: false,

  setAgents: (agents) => set({ agents, hasLoadedAgents: true }),
  setAgentsLoading: (loading) => set({ agentsLoading: loading }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  
  setMessages: (messages) => {
    if (typeof messages === 'function') {
      set((state) => ({ messages: messages(state.messages) }));
    } else {
      set({ messages, hasLoadedHistory: true });
    }
  },
  
  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),

  loadAgents: async (email, force = false) => {
    const now = Date.now();
    const { hasLoadedAgents, _agentsLastFetch, agentsLoading } = get();
    if (agentsLoading) return; // already in-flight
    if (hasLoadedAgents && !force) return;
    // Removed TTL check on force=true to allow immediate refresh after mutations

    const HIDDEN_AGENTS = new Set([
      "file manager", "task manager", "communication simulator",
      "negotiation advisor", "meeting intelligence",
    ]);
    const isVisible = (name: string) => !HIDDEN_AGENTS.has((name || "").toLowerCase());

    set({ agentsLoading: true });
    try {
      const [allRes, customRes] = await Promise.all([
        agentService.listAllAgents(email),
        agentService.getUserCreatedAgents(email),
      ]);

      const systemNodes: Agent[] = (allRes.agents || []).filter((a: any) => isVisible(a.name)).map((a: any) => ({
        id: a.id?.toString() || a.type || `sys-${a.name}`,
        name: a.name || '',
        description: a.description || 'Built-in assistant.',
        role: a.role || 'System',
        status: a.status || 'Active',
        is_default: true,
        industry: a.industry || 'General',
        isActive: true,
      }));

      const customNodes: Agent[] = (customRes.agents || []).filter((a: any) => isVisible(a.name)).map((a: any) => ({
        id: a.id?.toString() || '',
        name: a.name || '',
        description: a.description || 'Custom assistant.',
        role: a.role || 'Custom',
        status: a.status || 'Ready',
        is_default: a.is_default ?? false,
        industry: a.industry || '',
        isActive: true,
      }));

      const combined = [...systemNodes, ...customNodes];
      set({ agents: combined, hasLoadedAgents: true, _agentsLastFetch: Date.now() });
    } catch (error) {
      console.error("Failed to load agents:", error);
      throw error;
    } finally {
      set({ agentsLoading: false });
    }
  },

  loadChatHistory: async (email, force = false) => {
    if (get().hasLoadedHistory && !force) return;
    
    set({ messagesLoading: true });
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(
        `${API_BASE}/api/agents/chat/history?email=${encodeURIComponent(email)}&limit=30`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!data.messages?.length) {
        set({ hasLoadedHistory: true });
        return;
      }
      
      const hydrated: Message[] = data.messages.map((m: any, i: number) => ({
        id: `history-${i}`,
        type: m.role === 'assistant' ? 'agent' : 'user',
        content: m.content,
        timestamp: new Date(),
      }));
      
      set({ messages: hydrated, hasLoadedHistory: true });
    } catch (error) {
      console.error("Failed to load chat history:", error);
    } finally {
      set({ messagesLoading: false });
    }
  },

  removeAgent: (agentId) => {
    const idStr = agentId.toString();
    set((state) => ({
      agents: state.agents.filter((a) => a.id.toString() !== idStr),
      selectedAgent: state.selectedAgent?.id.toString() === idStr ? null : state.selectedAgent
    }));
  },

  clearStore: () => set({
    agents: [],
    agentsLoading: false,
    hasLoadedAgents: false,
    _agentsLastFetch: 0,
    selectedAgent: null,
    messages: [],
    messagesLoading: false,
    hasLoadedHistory: false,
  }),
}));
