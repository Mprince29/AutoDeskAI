import { create } from 'zustand';
import { Message, ArticleData, SessionEntry } from '@/types/journalist.types';
import { getSessions, getReports } from '@/services/journalist.service';

interface JournalistStore {
  messages: Message[];
  dbReports: ArticleData[];       // full reports, used when restoring a session
  dbSessions: SessionEntry[];     // deduplicated sessions from backend, used for history panel
  activeReportId: number | null;
  activeSessionId: string | null;
  selectedAssistantMsgId: string | null;
  hasLoadedReports: boolean;

  // Actions
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setDbReports: (reports: ArticleData[] | ((prev: ArticleData[]) => ArticleData[])) => void;
  setDbSessions: (sessions: SessionEntry[]) => void;
  setActiveReportId: (id: number | null) => void;
  setActiveSessionId: (id: string | null) => void;
  setSelectedAssistantMsgId: (id: string | null) => void;

  loadSessions: (email: string, force?: boolean) => Promise<void>;
  loadReports: (email: string, force?: boolean) => Promise<void>;
  clearSession: () => void;
}

export const useJournalistStore = create<JournalistStore>((set, get) => ({
  messages: [],
  dbReports: [],
  dbSessions: [],
  activeReportId: null,
  activeSessionId: null,
  selectedAssistantMsgId: null,
  hasLoadedReports: false,

  setMessages: (messages) => {
    if (typeof messages === 'function') {
      set((state) => ({ messages: messages(state.messages) }));
    } else {
      set({ messages });
    }
  },

  setDbReports: (dbReports) => {
    if (typeof dbReports === 'function') {
      set((state) => ({ dbReports: dbReports(state.dbReports) }));
    } else {
      set({ dbReports, hasLoadedReports: true });
    }
  },

  setDbSessions: (dbSessions) => set({ dbSessions }),

  setActiveReportId: (activeReportId) => set({ activeReportId }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setSelectedAssistantMsgId: (selectedAssistantMsgId) => set({ selectedAssistantMsgId }),

  loadSessions: async (email, force = false) => {
    if (get().hasLoadedReports && !force) return;
    try {
      const [sessions, reports] = await Promise.all([
        getSessions(email),
        getReports(email),
      ]);
      set({ dbSessions: sessions, dbReports: reports, hasLoadedReports: true });
    } catch (err) {
      console.error("Failed to load journalist sessions:", err);
    }
  },

  loadReports: async (email, force = false) => {
    if (get().hasLoadedReports && !force) return;
    try {
      const reports = await getReports(email);
      set({ dbReports: reports, hasLoadedReports: true });
    } catch (err) {
      console.error("Failed to load journalist reports:", err);
    }
  },

  clearSession: () => set({
    messages: [],
    activeReportId: null,
    activeSessionId: null,
    selectedAssistantMsgId: null,
  }),
}));

