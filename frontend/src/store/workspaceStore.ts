import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { workspaceService, WorkspaceAsset, GoogleTask } from '@/services/workspace.service';
import { calendarService } from '@/services/calendar.service';
import { docsService, GoogleDoc } from '@/services/docs.service';
import { Email, apiService } from '@/services/api';

interface WorkspaceState {
  // --- General Assets (Sheets, Slides, Forms, Drive) ---
  assets: Record<string, WorkspaceAsset[]>;
  fetching: Record<string, boolean>;
  initialLoadDone: Record<string, boolean>;
  
  // --- Google Docs ---
  docs: GoogleDoc[];
  fetchingDocs: boolean;
  docsLoaded: boolean;

  // --- Google Tasks ---
  tasks: GoogleTask[];
  fetchingTasks: boolean;
  tasksLoaded: boolean;
  tasksError: string | null;

  // --- Google Calendar ---
  events: any[];
  fetchingCalendar: boolean;
  calendarLoadedMonths: Record<string, boolean>;
  currentDate: Date;

  // --- Smart Inbox (Gmail) ---
  emails: Email[];
  isMonitoring: boolean;
  monitoringLoading: boolean;
  notificationsCount: number;
  autoReplyEnabled: boolean;
  inboxLoaded: boolean;

  // --- Actions: Assets ---
  fetchAssets: (email: string, type: string) => Promise<void>;
  
  // --- Actions: Docs ---
  fetchDocs: (email: string) => Promise<void>;

  // --- Actions: Tasks ---
  fetchTasks: (email: string) => Promise<void>;
  updateTask: (email: string, taskId: string, data: { title?: string, notes?: string, status?: string }) => Promise<void>;

  // --- Actions: Calendar ---
  setCurrentDate: (date: Date) => void;
  fetchEvents: (email: string, timeMin?: string, timeMax?: string) => Promise<void>;
  loadEvents: (email: string, date: Date, force?: boolean) => Promise<void>;
  deleteEvent: (email: string, eventId: string) => Promise<void>;

  // --- Actions: Inbox ---
  setEmails: (emails: Email[] | ((prev: Email[]) => Email[])) => void;
  setIsMonitoring: (val: boolean) => void;
  setMonitoringLoading: (val: boolean) => void;
  setNotificationsCount: (val: number) => void;
  setAutoReplyEnabled: (val: boolean) => void;
  fetchInboxOnly: (email: string, force?: boolean) => Promise<void>;
  fetchSecondaryCategories: (email: string) => Promise<void>;
  fetchMonitoringStatus: (email: string) => Promise<void>;
  fetchNotifications: (email: string) => Promise<void>;
  fetchAutoReplySettings: (email: string) => Promise<void>;
  
  clearStore: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  (set, get) => ({
  // --- Initial State ---
  assets: {},
  fetching: {},
  initialLoadDone: {},
  
  docs: [],
  fetchingDocs: false,
  docsLoaded: false,

  tasks: [],
  fetchingTasks: false,
  tasksLoaded: false,
  tasksError: null,

  events: [],
  fetchingCalendar: false,
  calendarLoadedMonths: {},
  currentDate: new Date(),

  emails: [],
  isMonitoring: false,
  monitoringLoading: false,
  notificationsCount: 0,
  autoReplyEnabled: false,
  inboxLoaded: false,

  // --- Implementations: Assets ---
  fetchAssets: async (email, type) => {
    set(state => ({ fetching: { ...state.fetching, [type]: true } }));
    try {
      const data = await workspaceService.getAssets(email, type);
      set(state => ({ 
        assets: { ...state.assets, [type]: data },
        initialLoadDone: { ...state.initialLoadDone, [type]: true }
      }));
    } finally {
      set(state => ({ fetching: { ...state.fetching, [type]: false } }));
    }
  },

  // --- Implementations: Docs ---
  fetchDocs: async (email) => {
    set({ fetchingDocs: true });
    try {
      const data = await docsService.getDocuments(email);
      set({ docs: data, docsLoaded: true });
    } finally {
      set({ fetchingDocs: false });
    }
  },

  // --- Implementations: Tasks ---
  fetchTasks: async (email) => {
    set({ fetchingTasks: true, tasksError: null });
    try {
      const { tasks, error } = await workspaceService.getTasks(email);
      set({ tasks, tasksLoaded: true, tasksError: error ?? null });
    } finally {
      set({ fetchingTasks: false });
    }
  },
  updateTask: async (email, taskId, data) => {
    // Optimistic UI update
    set(state => ({
      tasks: state.tasks.map(t => 
        t.id === taskId 
          ? { ...t, ...data, status: data.status || t.status } 
          : t
      )
    }));
    
    const { success } = await workspaceService.updateTask(email, taskId, data);
    if (!success) {
      // Revert/refresh on failure
      const { tasks } = await workspaceService.getTasks(email);
      set({ tasks });
    }
  },

  // --- Implementations: Calendar ---
  setCurrentDate: (date) => set({ currentDate: date }),
  fetchEvents: async (email, timeMin, timeMax) => {
    set({ fetchingCalendar: true });
    try {
      const response = await calendarService.getEvents(email, timeMin, timeMax, 250);
      set(state => {
        const newEvents = response.events || [];
        const existingEvents = state.events.filter(e => !newEvents.some((ne: any) => ne.id === e.id));
        return { events: [...existingEvents, ...newEvents] };
      });
    } finally {
      set({ fetchingCalendar: false });
    }
  },
  loadEvents: async (email, date, force = false) => {
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (get().calendarLoadedMonths[monthKey] && !force) return;
    
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

    set({ fetchingCalendar: true });
    try {
      const response = await calendarService.getEvents(email, startOfMonth.toISOString(), endOfMonth.toISOString(), 250);
      set(state => {
        const newEvents = response.events || [];
        const existingEvents = state.events.filter(e => !newEvents.some((ne: any) => ne.id === e.id));
        return { 
          events: [...existingEvents, ...newEvents],
          calendarLoadedMonths: { ...state.calendarLoadedMonths, [monthKey]: true }
        };
      });
    } finally {
      set({ fetchingCalendar: false });
    }
  },
  deleteEvent: async (email, eventId) => {
    await calendarService.deleteEvent(email, eventId);
    set(state => ({ events: state.events.filter(e => e.id !== eventId) }));
  },

  // --- Implementations: Inbox ---
  setEmails: (emails) => {
    if (typeof emails === 'function') set((state) => ({ emails: emails(state.emails) }));
    else set({ emails });
  },
  setIsMonitoring: (val) => set({ isMonitoring: val }),
  setMonitoringLoading: (val) => set({ monitoringLoading: val }),
  setNotificationsCount: (val) => set({ notificationsCount: val }),
  setAutoReplyEnabled: (val) => set({ autoReplyEnabled: val }),

  fetchInboxOnly: async (email, force = false) => {
    if (get().inboxLoaded && !force) return;
    const hasExistingEmails = get().emails.length > 0;
    if (force) {
      apiService.clearEmailCache();
      set(hasExistingEmails ? { monitoringLoading: true } : { emails: [], monitoringLoading: true });
    } else {
      set({ monitoringLoading: true });
    }
    try {
      // Phase 1: fetch 20 INBOX emails → show immediately
      const first = await apiService.getEmails(email, 20, 'INBOX', false);
      if (first?.emails) set({ emails: first.emails, inboxLoaded: true, monitoringLoading: false });

      // Phase 2: in parallel — remaining INBOX + SENT/SPAM/TRASH (all background, no spinner)
      const backgroundFetches: Promise<void>[] = [];

      if (first?.nextPageToken) {
        backgroundFetches.push(
          apiService.getEmails(email, 30, 'INBOX', false, first.nextPageToken).then((rest) => {
            if (rest?.emails?.length) {
              set((state: WorkspaceState) => {
                const seen = new Set(state.emails.map((e: Email) => e.id));
                return { emails: [...state.emails, ...rest.emails.filter((e: Email) => !seen.has(e.id))] };
              });
            }
          }).catch(() => {})
        );
      }

      // Background refresh secondary categories so all inbox sections stay warm.
      backgroundFetches.push(
        Promise.allSettled([
          apiService.getEmails(email, 20, 'SENT', false),
          apiService.getEmails(email, 20, 'SPAM', false),
          apiService.getEmails(email, 20, 'TRASH', false),
          apiService.searchEmails(email, "-label:INBOX -label:SENT -label:SPAM -label:TRASH", 20),
          apiService.searchEmails(email, "category:social", 50),
          apiService.searchEmails(email, "category:promotions", 50),
          apiService.searchEmails(email, "category:updates", 50),
          apiService.searchEmails(email, "category:forums", 50),
        ]).then((results) => {
          const secondary: Email[] = [];
          results.forEach(r => { if (r.status === 'fulfilled' && r.value?.emails) secondary.push(...r.value.emails); });
          
          set((state: WorkspaceState) => {
            const allEmails = [...state.emails, ...secondary];
            const uniqueEmails = Array.from(new Map(allEmails.map((e: Email) => [e.id, e])).values());
            return { emails: uniqueEmails, monitoringLoading: false };
          });
        })
      );

      await Promise.allSettled(backgroundFetches);
    } finally {
      set({ monitoringLoading: false });
    }
  },
  fetchSecondaryCategories: async (email) => {
    try {
      const results = await Promise.allSettled([
        apiService.getEmails(email, 20, 'SENT', false),
        apiService.getEmails(email, 20, 'SPAM', false),
        apiService.getEmails(email, 20, 'TRASH', false),
        apiService.searchEmails(email, "-label:INBOX -label:SENT -label:SPAM -label:TRASH", 50),
        apiService.searchEmails(email, "category:social", 50),
        apiService.searchEmails(email, "category:promotions", 50),
        apiService.searchEmails(email, "category:updates", 50),
        apiService.searchEmails(email, "category:forums", 50),
      ]);
      const secondary: Email[] = [];
      results.forEach(r => { if (r.status === 'fulfilled' && r.value?.emails) secondary.push(...r.value.emails); });
      
      set((state) => {
        const allEmails = [...state.emails, ...secondary];
        const uniqueEmails = Array.from(new Map(allEmails.map(e => [e.id, e])).values());
        return { emails: uniqueEmails };
      });
    } catch (err) { console.error(err); }
  },
  fetchMonitoringStatus: async (email) => {
    try {
      const status = await apiService.getAutomatedServiceStatus(email);
      set({ isMonitoring: Boolean(status.is_monitoring) });
    } catch (error) {
      console.error('Failed to fetch monitoring status:', error);
      set({ isMonitoring: false });
    }
  },
  fetchNotifications: async (email) => {
    try {
      const res = await apiService.getEmailNotifications(email);
      set({ notificationsCount: res.total || 0 });
    } catch (error) {
      console.error('Failed to fetch email notifications:', error);
      set({ notificationsCount: 0 });
    }
  },
  fetchAutoReplySettings: async (email) => {
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      const r = await fetch(`${base}/api/proactive/auto-reply/settings?email=${encodeURIComponent(email)}`, { credentials: 'include' });
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const d = await r.json();
      set({ autoReplyEnabled: Boolean(d.enabled) });
    } catch (error) {
      console.error('Failed to fetch auto-reply settings:', error);
      set({ autoReplyEnabled: false });
    }
  },

  clearStore: () => set({
    assets: {}, fetching: {}, initialLoadDone: {},
    docs: [], fetchingDocs: false, docsLoaded: false,
    tasks: [], fetchingTasks: false, tasksLoaded: false, tasksError: null,
    events: [], fetchingCalendar: false, calendarLoadedMonths: {},
    emails: [], isMonitoring: false, monitoringLoading: false, notificationsCount: 0, autoReplyEnabled: false, inboxLoaded: false
  })
  })
);
