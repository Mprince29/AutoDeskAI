import { create } from 'zustand';
import {
    salesService, Lead, Campaign, Signal, Product
} from '@/services/sales.service';

interface OutreachState {
    leads: Lead[];
    campaigns: Campaign[];
    campaignTags: string[];
    globalSignals: { lead: Lead; signal: Signal }[];
    products: Product[];
    isLoading: boolean;
    hasInitialLoaded: boolean;
    selectedTag: string | null;
    selectedProductFilter: string | null;  // filter campaigns by product key
    // contact-level project filter
    selectedContactCampaignId: number | null;
    selectedContactTag: string | null;
    selectedContactListTag: string | null;
    selectedContactGeoTag: string | null;
    selectedContactProductKey: string | null;
    availableListTags: string[];
    availableGeoTags: string[];
    escalations: any[];
    reengagementEntries: any[];
    sequences: any[];

    // Actions
    setLeads: (leads: Lead[]) => void;
    setCampaigns: (campaigns: Campaign[]) => void;
    fetchData: (email: string) => Promise<void>;
    fetchProducts: (email: string) => Promise<void>;
    fetchLeads: (
        email: string,
        campaignId?: number | null,
        outreachTag?: string | null,
        listTag?: string | null,
        geoTag?: string | null
    ) => Promise<void>;
    addLead: (lead: Lead) => void;
    addLeads: (newLeads: Lead[]) => void;
    updateLead: (leadId: number, updates: Partial<Lead>) => void;
    refreshLead: (leadId: number, email: string) => Promise<{ new_signals: number }>;
    removeLead: (leadId: number) => void;
    removeLeads: (leadIds: number[]) => void;
    addCampaign: (campaign: Campaign) => void;
    removeCampaign: (campaignId: number) => void;
    setSelectedTag: (tag: string | null) => void;
    setSelectedProductFilter: (key: string | null) => void;
    setSelectedContactProductKey: (key: string | null) => void;
    setSelectedContactListTag: (tag: string | null) => void;
    setSelectedContactGeoTag: (tag: string | null) => void;
    setContactFilter: (campaignId: number | null, tag: string | null) => void;
    fetchTags: (email: string) => Promise<void>;
    fetchCampaigns: (email: string, tag?: string | null) => Promise<void>;
    fetchEscalations: (email: string) => Promise<void>;
    fetchReengagement: (email: string, status?: string) => Promise<void>;
    fetchSequences: (email: string) => Promise<void>;
    addSequence: (sequence: any) => void;
    updateSequence: (id: number, updates: any) => void;

    // Computed (logic moved from Page)
    getHotLeads: () => Lead[];
}

export const useOutreachStore = create<OutreachState>((set, get) => ({
    leads: [],
    campaigns: [],
    campaignTags: [],
    globalSignals: [],
    products: [],
    isLoading: true,
    hasInitialLoaded: false,
    selectedTag: null,
    selectedProductFilter: null,
    selectedContactCampaignId: null,
    selectedContactTag: null,
    selectedContactListTag: null,
    selectedContactGeoTag: null,
    selectedContactProductKey: null,
    availableListTags: [],
    availableGeoTags: [],
    escalations: [],
    reengagementEntries: [],
    sequences: [],

    setLeads: (leads) => set({ leads }),
    setCampaigns: (campaigns) => set({ campaigns }),

    fetchData: async (email: string) => {
        set({ isLoading: true });

        try {
            const { selectedTag } = get();
            const [leadsData, campaignsData, signalsData, tagsData, sequencesData, productsData] = await Promise.all([
                salesService.getLeads(email),
                salesService.getCampaigns(email, selectedTag || undefined),
                salesService.getGlobalSignals(email),
                salesService.getCampaignTags(email),
                salesService.getSequences(email),
                salesService.getProducts(email)
            ]);
            const listTagsSet = new Set<string>();
            const geoTagsSet = new Set<string>();
            if (Array.isArray(leadsData)) {
                leadsData.forEach((l: any) => {
                    if (l.list_tag) listTagsSet.add(l.list_tag);
                    if (l.geo_tag) geoTagsSet.add(l.geo_tag);
                });
            }
            set({
                leads: Array.isArray(leadsData) ? leadsData : [],
                campaigns: Array.isArray(campaignsData) ? campaignsData : [],
                globalSignals: Array.isArray(signalsData) ? signalsData : [],
                campaignTags: (tagsData as any)?.tags || [],
                sequences: Array.isArray(sequencesData) ? sequencesData : [],
                products: Array.isArray(productsData) ? productsData : [],
                availableListTags: Array.from(listTagsSet),
                availableGeoTags: Array.from(geoTagsSet),
                hasInitialLoaded: true,
                isLoading: false
            });
        } catch (error) {
            set({ isLoading: false });
            throw error;
        }
    },

    fetchProducts: async (email: string) => {
        try {
            const productsData = await salesService.getProducts(email);
            set({ products: Array.isArray(productsData) ? productsData : [] });
        } catch (error) {
            console.error('Failed to fetch products', error);
        }
    },

    fetchLeads: async (email, campaignId, outreachTag, listTag, geoTag) => {
        try {
            const { selectedContactProductKey } = get();
            const data = await salesService.getLeads(email, campaignId, outreachTag, listTag, geoTag, selectedContactProductKey);
            set({ leads: Array.isArray(data) ? data : [] });
        } catch (error) {
            console.error('Failed to fetch leads', error);
        }
    },

    fetchTags: async (email: string) => {
        try {
            const res = await salesService.getCampaignTags(email);
            set({ campaignTags: (res as any)?.tags || [] });
        } catch (error) {
            console.error('Failed to fetch tags', error);
            set({ campaignTags: [] });
        }
    },

    fetchCampaigns: async (email: string, tag?: string | null) => {
        try {
            const { selectedProductFilter } = get();
            const campaignsData = await salesService.getCampaigns(email, tag || undefined, selectedProductFilter || undefined);
            set({ campaigns: Array.isArray(campaignsData) ? campaignsData : [] });
        } catch (error) {
            console.error('Failed to fetch campaigns', error);
            set({ campaigns: [] });
        }
    },

    fetchEscalations: async (email: string) => {
        try {
            const data = await salesService.getEscalations(email);
            set({ escalations: Array.isArray(data) ? data : [] });
        } catch (error) {
            console.error('Failed to fetch escalations', error);
        }
    },

    fetchReengagement: async (email: string, status?: string) => {
        try {
            const data = await salesService.getReengagement(email, status);
            set({ reengagementEntries: Array.isArray(data) ? data : [] });
        } catch (error) {
            console.error('Failed to fetch reengagement entries', error);
        }
    },

    fetchSequences: async (email: string) => {
        try {
            const data = await salesService.getSequences(email);
            set({ sequences: Array.isArray(data) ? data : [] });
        } catch (error) {
            console.error('Failed to fetch sequences', error);
        }
    },

    addSequence: (sequence) => set((state) => ({ sequences: [sequence, ...state.sequences] })),

    updateSequence: (id, updates) => set((state) => ({
        sequences: state.sequences.map(s => s.id === id ? { ...s, ...updates } : s)
    })),

    setSelectedTag: (tag) => set({ selectedTag: tag }),

    setSelectedProductFilter: (key) => set({ selectedProductFilter: key }),

    setSelectedContactProductKey: (key) => set({ selectedContactProductKey: key }),

    setSelectedContactListTag: (tag) => set({ selectedContactListTag: tag }),

    setSelectedContactGeoTag: (tag) => set({ selectedContactGeoTag: tag }),

    setContactFilter: (campaignId, tag) => set({
        selectedContactCampaignId: campaignId,
        selectedContactTag: tag,
    }),

    addLead: (lead) => set((state) => {
        const nextLeads = [lead, ...state.leads];
        const listTagsSet = new Set(state.availableListTags);
        const geoTagsSet = new Set(state.availableGeoTags);
        if (lead.list_tag) listTagsSet.add(lead.list_tag);
        if (lead.geo_tag) geoTagsSet.add(lead.geo_tag);
        return {
            leads: nextLeads,
            availableListTags: Array.from(listTagsSet),
            availableGeoTags: Array.from(geoTagsSet),
        };
    }),

    addLeads: (newLeads) => set((state) => {
        const nextLeads = [...newLeads, ...state.leads];
        const listTagsSet = new Set(state.availableListTags);
        const geoTagsSet = new Set(state.availableGeoTags);
        newLeads.forEach(l => {
            if (l.list_tag) listTagsSet.add(l.list_tag);
            if (l.geo_tag) geoTagsSet.add(l.geo_tag);
        });
        return {
            leads: nextLeads,
            availableListTags: Array.from(listTagsSet),
            availableGeoTags: Array.from(geoTagsSet),
        };
    }),

    updateLead: (leadId, updates) => set((state) => {
        const nextLeads = state.leads.map(l => l.id === leadId ? { ...l, ...updates } : l);
        const listTagsSet = new Set<string>();
        const geoTagsSet = new Set<string>();
        nextLeads.forEach(l => {
            if (l.list_tag) listTagsSet.add(l.list_tag);
            if (l.geo_tag) geoTagsSet.add(l.geo_tag);
        });
        return {
            leads: nextLeads,
            availableListTags: Array.from(listTagsSet),
            availableGeoTags: Array.from(geoTagsSet),
        };
    }),

    refreshLead: async (leadId, email) => {
        const result = await salesService.refreshSignals(leadId, email);
        set((state) => ({
            leads: state.leads.map(l => l.id === leadId ? {
                ...l,
                intent_score: result.intent_score,
                signals: result.signals,
                last_signal_at: new Date().toISOString()
            } : l)
        }));
        return { new_signals: result.new_signals };
    },

    removeLead: (leadId) => set((state) => {
        const nextLeads = state.leads.filter(l => l.id !== leadId);
        const listTagsSet = new Set<string>();
        const geoTagsSet = new Set<string>();
        nextLeads.forEach(l => {
            if (l.list_tag) listTagsSet.add(l.list_tag);
            if (l.geo_tag) geoTagsSet.add(l.geo_tag);
        });
        return {
            leads: nextLeads,
            availableListTags: Array.from(listTagsSet),
            availableGeoTags: Array.from(geoTagsSet),
        };
    }),

    removeLeads: (leadIds) => set((state) => {
        const nextLeads = state.leads.filter(l => !leadIds.includes(l.id));
        const listTagsSet = new Set<string>();
        const geoTagsSet = new Set<string>();
        nextLeads.forEach(l => {
            if (l.list_tag) listTagsSet.add(l.list_tag);
            if (l.geo_tag) geoTagsSet.add(l.geo_tag);
        });
        return {
            leads: nextLeads,
            availableListTags: Array.from(listTagsSet),
            availableGeoTags: Array.from(geoTagsSet),
        };
    }),

    addCampaign: (campaign) => set((state) => ({ campaigns: [campaign, ...state.campaigns] })),

    removeCampaign: (campaignId) => set((state) => ({
        campaigns: state.campaigns.filter(c => c.id !== campaignId)
    })),

    getHotLeads: () => {
        const { leads } = get();
        return [...leads]
            .sort((a, b) => (b.intent_score ?? 0) - (a.intent_score ?? 0))
            .slice(0, 3);
    }
}));
