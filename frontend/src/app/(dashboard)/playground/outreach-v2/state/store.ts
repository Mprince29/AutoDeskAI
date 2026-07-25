import { create } from "zustand";
import { salesService } from "@/services/sales.service";
import type {
  Lead as BackendLead,
  Campaign as BackendCampaign,
  Signal,
  LeadFinderFilters,
  LeadFinderResponse,
  BulkValidateResult,
  CreateLeadPayload,
  ObjectionResult,
  ObjectionLog,
  EscalationEvent,
  ReengagementEntry,
  OutreachMemory,
  Product,
  Sequence,
  SequenceStep,
  SequenceEnrollment,
  EnrollRecipient,
  PipelineMode,
  NextAction,
  RecipientPayload,
} from "@/services/sales.service";
import type {
  Campaign,
  CreateProjectInput,
  EmailDraft,
  EmailTemplateSetup,
  FollowUpBoard,
  FollowUpLeadState,
  FollowUpStrategy,
  GoogleWorkspaceState,
  Lead,
  MeetingProposal,
  OutreachEvent,
  PipelineStage,
  Project,
  ReviewStatus,
  ScheduledMeeting,
  SavedTemplate,
  TemplateAsset,
  TemplateValidationIssue,
  TrackingSummary
} from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const wait = (ms = 320) => new Promise((resolve) => setTimeout(resolve, ms));

function getStoredEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("user_info");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string };
    return typeof parsed.email === "string" ? parsed.email : null;
  } catch {
    return null;
  }
}

// ── Backend ↔ V2 Adapters ─────────────────────────────────────────────────────

function backendLeadToV2(c: BackendLead, campaignId: string): Lead {
  const parts = (c.contact_name ?? "").trim().split(/\s+/);
  const firstName = parts[0] || "Unknown";
  const lastName = parts.slice(1).join(" ");

  const emailConf: Lead["emailConfidence"] =
    c.email_verified === "valid" ? "verified" :
    c.email_verified === "risky" ? "likely" : "unknown";

  const geo = ((): Lead["geography"] => {
    const g = (c.geo_tag ?? c.company_location ?? "").toLowerCase();
    if (/\bus\b|united states|america/.test(g)) return "US";
    if (/\buk\b|united kingdom|britain/.test(g)) return "UK";
    if (/india/.test(g)) return "India";
    if (/europe|germany|france|netherlands/.test(g)) return "Europe";
    return "Other";
  })();

  const triggerReason = (() => {
    if (c.signals?.length) {
      const s = c.signals[0];
      const summary = s.metadata?.summary as string | undefined;
      return summary ?? s.type;
    }
    if (c.company_news) return c.company_news.slice(0, 120);
    return `${c.company} matches the active ICP.`;
  })();

  return {
    id: String(c.id),
    campaignId,
    firstName,
    lastName,
    title: c.role ?? "",
    company: c.company ?? "",
    companySize: c.company_size ?? "",
    geography: geo,
    linkedinUrl: c.linkedin_url ?? "",
    triggerReason,
    personalizationPreview: `Hi ${firstName} — ${triggerReason.charAt(0).toLowerCase()}${triggerReason.slice(1)}`,
    personalizationMode: (c.intent_score ?? 0) >= 7 ? "strong" : "fallback",
    email: c.contact_email ?? "",
    emailConfidence: emailConf,
    qualityScore: Math.round(c.intent_score ?? 0),
    context: c.notes ?? c.company_description ?? "",
    status: "pending",
    owner: "",
    outreachOwner: "",
    generatedBy: "AutoDeskAI Agent",
    followedBy: [],
  };
}

function backendCampaignToV2(bc: BackendCampaign, projectId: string): Campaign {
  return {
    id: String(bc.id),
    projectId,
    name: bc.name,
    brief: bc.subject_template ?? "",
    status: "brief",
    activeStage: "parse",
    duplicateCount: 0,
    parsedIcp: {
      roles: [],
      industries: [],
      geographies: [],
      companySize: "",
      intentSignals: [],
      template: "",
      sendWindow: "",
    },
  };
}

function backendTrackingToV2(bc: BackendCampaign, leads: Lead[]): TrackingSummary {
  const hotLeads = [...leads]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 2)
    .map((l) => l.id);
  return {
    sent: bc.sent_count ?? 0,
    queued: 0,
    pendingApproval: leads.length,
    openRate: Math.round((bc.open_rate ?? 0) * 100),
    clickRate: Math.round((bc.click_rate ?? 0) * 100),
    replyRate: 0,
    hotLeads,
  };
}

// ── Dynamic Workspace Helpers ────────────────────────────────────────────────

const initialPipelineStages: PipelineStage[] = [
  { key: "parse", label: "Parse", estimate: "5 sec", status: "waiting", detail: "Extracting ICP and send constraints" },
  { key: "discover", label: "Discover", estimate: "2 min", status: "waiting", detail: "Searching Apollo and public company signals" },
  { key: "enrich", label: "Enrich", estimate: "4 min", status: "waiting", detail: "Verifying email and collecting recent context" },
  { key: "deduplicate", label: "Deduplicate", estimate: "20 sec", status: "waiting", detail: "Checking team outreach history" },
  { key: "draft", label: "Draft", estimate: "3 min", status: "waiting", detail: "Preparing draft emails for approval" }
];

const toSlug = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const normalizeProjectToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const emptyTrackingSummary: TrackingSummary = { sent: 0, queued: 0, pendingApproval: 0, openRate: 0, clickRate: 0, replyRate: 0, hotLeads: [] };

const titleCase = (value: string) =>
  value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
    .replace(/\bAi\b/g, "AI")
    .replace(/\bPr\b/g, "PR")
    .replace(/\bIo\b/g, "IO");

const projectTokensMatch = (...values: string[]) => {
  const normalized = values.map(normalizeProjectToken).filter(Boolean);
  return normalized.some((left, index) => normalized.some((right, innerIndex) => index !== innerIndex && (left.includes(right) || right.includes(left))));
};

function campaignMatchesProject(project: Project, campaign: BackendCampaign) {
  return (
    String(campaign.id) === project.activeCampaignId ||
    campaign.product_key === project.id ||
    campaign.outreach_tag === project.id ||
    projectTokensMatch(project.id, campaign.outreach_tag ?? "", campaign.product_key ?? "", campaign.name)
  );
}

function productMatchesProject(project: Project, product: Product) {
  return product.product_key === project.id || normalizeProjectToken(project.name) === normalizeProjectToken(product.display_name);
}

function deriveProjectsFromBackend(campaigns: BackendCampaign[], products: Product[]): Project[] {
  const projects = products.map((product) => {
    const matchedCampaigns = campaigns
      .filter((campaign) =>
        campaign.product_key === product.product_key ||
        campaign.outreach_tag === product.product_key ||
        projectTokensMatch(product.product_key, product.display_name, campaign.product_key ?? "", campaign.outreach_tag ?? "", campaign.name)
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at));

    const primaryCampaign = matchedCampaigns[0];
    return {
      id: product.product_key,
      name: product.display_name,
      product: product.display_name,
      regionFocus: product.icp_locations?.join(", ") || "General ICP Focus",
      activeCampaignId: primaryCampaign ? String(primaryCampaign.id) : `camp-${product.product_key}`,
    };
  });

  const unmatchedCampaignProjects = campaigns
    .filter((campaign) => {
      const campaignKey = campaign.product_key || campaign.outreach_tag || "";
      return !projects.some((project) => campaignMatchesProject(project, campaign) || project.id === campaignKey);
    })
    .map((campaign) => {
      const id = campaign.product_key || campaign.outreach_tag || toSlug(campaign.name);
      return {
        id,
        name: campaign.name || titleCase(id),
        product: campaign.subject_template || campaign.name || "Untitled product",
        regionFocus: "General ICP Focus",
        activeCampaignId: String(campaign.id),
      };
    });

  return [...projects, ...unmatchedCampaignProjects]
    .sort((left, right) => left.name.localeCompare(right.name));
}

const buildCampaignFromProject = (project: Project): Campaign => {
  const regionLabel = project.regionFocus || "target accounts";
  return {
    id: project.activeCampaignId,
    projectId: project.id,
    name: `${project.name} outreach`,
    brief: `Find 40 senior leads in ${regionLabel}. Position ${project.product} with recent market or company triggers. Use the default outreach template and schedule the first send window early next week.`,
    status: "brief",
    duplicateCount: 0,
    activeStage: "parse",
    parsedIcp: {
      roles: [],
      industries: [project.product, regionLabel, "B2B teams"],
      geographies: [regionLabel],
      companySize: "",
      intentSignals: [],
      template: `${project.name} outreach template`,
      sendWindow: "",
    }
  };
};

const buildDraftsForLeads = (project: Project, leads: Lead[]): EmailDraft[] => {
  return leads.map((lead) => ({
    id: `draft-${lead.id.replace(/^lead-/, "")}`,
    campaignId: project.activeCampaignId,
    leadId: lead.id,
    subject: `${project.name} for ${lead.company}`,
    opener: `Hi ${lead.firstName} - noticed ${lead.triggerReason.charAt(0).toLowerCase()}${lead.triggerReason.slice(1)}`,
    body:
      `${project.product} helps teams like ${lead.company} reduce manual research and turn live signals into faster outreach decisions.\n\n` +
      `Given ${lead.context.toLowerCase()}, I thought a short example tailored to ${lead.company} might be useful.\n\n` +
      `Open to a quick look next week?`,
    approvalStatus: "pending"
  }));
};

const buildTrackingSummary = (leads: Lead[], drafts: EmailDraft[]): TrackingSummary => ({
  sent: 0,
  queued: 0,
  pendingApproval: drafts.length,
  openRate: 0,
  clickRate: 0,
  replyRate: 0,
  hotLeads: leads.slice(0, 2).map((lead) => lead.id)
});

const buildEventsForLeads = (leads: Lead[]): OutreachEvent[] => {
  const eventSeed = [
    { type: "generated" as const, service: "apollo" as const, detail: "Lead discovered from the active ICP", status: "ok" as const, latencyMs: 840, timestamp: "09:01:14" },
    { type: "generated" as const, service: "hunter" as const, detail: "Email confidence check completed", status: "ok" as const, latencyMs: 410, timestamp: "09:02:03" },
    { type: "queued" as const, service: "claude" as const, detail: "Draft created and ready for review", status: "watch" as const, latencyMs: 1290, timestamp: "09:03:22" },
    { type: "sent" as const, service: "gmail" as const, detail: "Scheduled send completed", status: "ok" as const, latencyMs: 620, timestamp: "09:06:11" },
    { type: "opened" as const, service: "tracking" as const, detail: "Open pixel fired", status: "ok" as const, latencyMs: 92, timestamp: "09:18:49" },
    { type: "clicked" as const, service: "tracking" as const, detail: "Clicked primary CTA", status: "ok" as const, latencyMs: 118, timestamp: "09:26:31" }
  ];
  return leads.flatMap((lead, leadIndex) =>
    eventSeed
      .filter((_, eventIndex) => leadIndex === 0 || eventIndex < 3)
      .map((seed, eventIndex) => ({
        id: `evt-${lead.id}-${eventIndex + 1}`,
        timestamp: seed.timestamp,
        type: seed.type,
        leadId: lead.id,
        owner: lead.owner,
        service: seed.service,
        latencyMs: seed.latencyMs,
        status: seed.status,
        detail: eventIndex === 0 ? `${seed.detail} for ${lead.company}` : seed.detail
      }))
  );
};

const buildFollowUpBoard = (campaignId: string, leads: Lead[], strategy = defaultFollowUpStrategy(), workspace: GoogleWorkspaceState): FollowUpBoard => {
  const leadStates: FollowUpLeadState[] = leads.slice(0, 4).map((lead, index) => {
    if (index === 0) {
      return {
        leadId: lead.id,
        status: "responded",
        interestLevel: "hot",
        interestReason: "Enthusiastic response and a direct ask for a demo time.",
        strategy,
        openedCount: 3,
        repliedCount: 1,
        followUpsSent: 0,
        lastTouchAt: "2026-05-23T14:30:00.000Z",
        reply: {
          id: `reply-${lead.id}-1`,
          leadId: lead.id,
          from: lead.email,
          subject: `Re: ${lead.company}`,
          snippet: `This is interesting. Could we do next Tuesday at 11am ET for a quick demo of ${lead.company}'s workflow?`,
          receivedAt: "2026-05-23T14:30:00.000Z",
          intent: "meeting_request",
          read: true
        },
        meetingProposal: {
          leadId: lead.id,
          replyId: `reply-${lead.id}-1`,
          suggestedDate: "2026-05-26",
          suggestedTime: "11:00",
          timezone: "America/New_York",
          durationMinutes: 30,
          provider: "google_meet",
          attendees: [lead.email, "agasthya.d98@gmail.com"],
          notes: `${lead.firstName} asked for a quick demo next Tuesday at 11am ET.`,
          confidence: 92
        }
      };
    }
    if (index === 1) {
      return {
        leadId: lead.id,
        status: "read_no_reply",
        interestLevel: "medium",
        interestReason: "Opened twice but has not replied yet; keep the cadence helpful.",
        strategy,
        openedCount: 2,
        repliedCount: 0,
        followUpsSent: 1,
        lastTouchAt: "2026-05-22T16:05:00.000Z",
        nextFollowUpAt: addDays(strategy.startDate, strategy.frequencyDays)
      };
    }
    return {
      leadId: lead.id,
      status: "no_response",
      interestLevel: "low",
      interestReason: index === 2 ? "No opens or replies captured from Gmail." : "No response after multiple touches.",
      strategy,
      openedCount: 0,
      repliedCount: 0,
      followUpsSent: index === 2 ? 1 : 2,
      lastTouchAt: index === 2 ? "2026-05-21T13:00:00.000Z" : "2026-05-20T09:40:00.000Z",
      nextFollowUpAt: addDays(strategy.startDate, strategy.frequencyDays * (index === 2 ? 2 : 3))
    };
  });
  return {
    campaignId,
    strategy,
    workspace,
    leads: leadStates,
    summary: {
      sent: leadStates.length,
      responded: leadStates.filter((s) => s.status === "responded").length,
      readNoReply: leadStates.filter((s) => s.status === "read_no_reply").length,
      noResponse: leadStates.filter((s) => s.status === "no_response").length,
      meetingsProposed: leadStates.filter((s) => s.meetingProposal && !s.scheduledMeeting).length,
      converted: leadStates.filter((s) => s.status === "converted").length,
      archived: leadStates.filter((s) => s.status === "archived_no_response").length
    }
  };
};

const requiredVariables = ["firstName", "company", "personalizedOpener", "body", "ctaUrl", "repName"];

const extractVariables = (html: string) => {
  const matches = html.matchAll(/{{\s*([\w.]+)\s*}}/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1]))).sort();
};

const validateTemplateHtml = (html: string, assets: TemplateAsset[]): TemplateValidationIssue[] => {
  const issues: TemplateValidationIssue[] = [];
  const variables = extractVariables(html);
  const assetNames = new Set(assets.map((asset) => asset.name.toLowerCase()));
  const addIssue = (severity: TemplateValidationIssue["severity"], id: string, message: string) => {
    issues.push({ id, severity, message });
  };
  if (/<script[\s>]/i.test(html)) addIssue("error", "script", "Scripts are not allowed in email templates.");
  if (/<form[\s>]/i.test(html)) addIssue("error", "form", "Forms are unreliable in email clients and are blocked.");
  if (/<iframe[\s>]/i.test(html)) addIssue("error", "iframe", "Iframes are blocked because most email clients strip them.");
  if (/\son\w+=/i.test(html)) addIssue("error", "events", "Inline JavaScript event handlers are not email-safe.");
  if (!/<body[\s>]/i.test(html)) addIssue("warning", "body", "Add a body tag so the preview and future send pipeline can parse the template reliably.");
  requiredVariables.filter((v) => !variables.includes(v)).forEach((v) => addIssue("error", `missing-${v}`, `Missing required placeholder {{${v}}}.`));
  const sourceMatches = Array.from(html.matchAll(/\s(?:src|background)=["']([^"']+)["']/gi), (m) => m[1]);
  sourceMatches
    .filter((src) => !/^(https?:|cid:|data:|{{\s*asset\.)/i.test(src))
    .forEach((src) => {
      const fileName = src.split("/").pop()?.toLowerCase() ?? src.toLowerCase();
      if (!assetNames.has(fileName)) addIssue("error", `relative-${src}`, `Relative asset "${src}" must match an uploaded brand asset or use a hosted URL.`);
    });
  if (html.length > 180_000) addIssue("warning", "large-html", "This HTML is large; test deliverability before using it in a full campaign.");
  return issues;
};

const defaultTemplateSetup = (projectId: string): EmailTemplateSetup => ({
  projectId,
  sentFolder: { status: "not_connected", scope: "all_sent", indexedCount: 0 },
  assets: [],
  isActive: false
});

const TEMPLATE_STATE_STORAGE_KEY = "outreach-v2-template-state";

type StoredTemplateProjectState = {
  templateSetup: EmailTemplateSetup;
  savedTemplates: SavedTemplate[];
};

function readTemplateProjectState(projectId: string): StoredTemplateProjectState | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const raw = localStorage.getItem(TEMPLATE_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, StoredTemplateProjectState>;
    return parsed[projectId] ?? null;
  } catch {
    return null;
  }
}

function writeTemplateProjectState(projectId: string, value: StoredTemplateProjectState) {
  if (typeof window === "undefined" || !projectId) return;
  try {
    const raw = localStorage.getItem(TEMPLATE_STATE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, StoredTemplateProjectState>) : {};
    parsed[projectId] = value;
    localStorage.setItem(TEMPLATE_STATE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore persistence failures and keep in-memory state authoritative.
  }
}

function persistCurrentTemplateProjectState(projectId: string, templateSetup: EmailTemplateSetup, savedTemplates: SavedTemplate[]) {
  writeTemplateProjectState(projectId, { templateSetup, savedTemplates });
}

function buildInitialTemplateSetup(projectId: string, htmlTemplate?: { html: string; uploadedAt?: string; fileName?: string }): EmailTemplateSetup {
  const base = defaultTemplateSetup(projectId);
  if (!htmlTemplate?.html) return base;

  return {
    ...base,
    htmlTemplate: {
      fileName: htmlTemplate.fileName ?? "campaign-template.html",
      uploadedAt: htmlTemplate.uploadedAt ?? new Date().toISOString(),
      html: htmlTemplate.html,
      variables: extractVariables(htmlTemplate.html),
      issues: validateTemplateHtml(htmlTemplate.html, []),
    },
  };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T09:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};

const defaultFollowUpStrategy = (): FollowUpStrategy => ({
  followUpCount: 3,
  frequencyDays: 4,
  startDate: todayIso(),
  tone: "warm",
  autoArchiveAfterFinal: true,
  updatedAt: new Date().toISOString()
});

// ── Store Interface ───────────────────────────────────────────────────────────

interface OutreachStore {
  projects: Project[];
  productsCatalog: Product[];
  productsLoading: boolean;
  projectId: string;
  campaign: Campaign | null;
  pipelineStages: PipelineStage[];
  leads: Lead[];
  drafts: EmailDraft[];
  tracking: TrackingSummary;
  events: OutreachEvent[];
  googleWorkspace: GoogleWorkspaceState;
  followUpBoard: FollowUpBoard | null;
  templateSetup: EmailTemplateSetup;
  savedTemplates: SavedTemplate[];

  userEmail: string | null;
  activeTab: string;
  briefSubmitted: boolean;
  pipelineStarted: boolean;
  pipelineComplete: boolean;
  actionLog: string[];
  activeIndex: number;
  expandedLeadId: string | null;
  selectedProductKey: string | null;

  setUserEmail: (email: string) => void;
  setActiveTab: (tab: string) => void;
  setActiveIndex: (index: number) => void;
  setExpandedLeadId: (id: string | null) => void;
  setSelectedProductKey: (key: string | null) => void;
  setBriefSubmitted: (submitted: boolean) => void;
  startPipeline: () => void;
  completePipeline: () => void;
  addAction: (action: string) => void;
  resetDemo: () => Promise<void>;
  hydrateWorkspace: () => Promise<void>;

  selectProject: (id: string) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  loadProducts: () => Promise<Product[]>;
  reviewLead: (leadId: string, status: ReviewStatus) => Promise<Lead>;
  assignLeadOwner: (leadId: string, owner: string) => Promise<Lead>;
  assignLeadOutreachOwner: (leadId: string, outreachOwner: string) => Promise<Lead>;
  reviewDraft: (draftId: string, status: ReviewStatus | "edited", updates?: Partial<Pick<EmailDraft, "subject" | "opener" | "body">>) => Promise<EmailDraft>;
  approveAllDrafts: () => Promise<EmailDraft[]>;
  sendQueued: () => Promise<TrackingSummary>;
  setGoogleWorkspaceService: (service: Exclude<keyof GoogleWorkspaceState, "calendarName">, connected: boolean) => Promise<GoogleWorkspaceState>;
  readCampaignReplies: () => Promise<FollowUpBoard>;
  saveFollowUpStrategy: (leadId: string, strategy: Pick<FollowUpStrategy, "followUpCount" | "frequencyDays" | "startDate" | "tone" | "autoArchiveAfterFinal">) => Promise<FollowUpBoard>;
  confirmCalendarMeeting: (proposal: MeetingProposal) => Promise<ScheduledMeeting>;
  markLeadConverted: (leadId: string, conversion: { stage: "demo_booked" | "qualified" | "customer"; value: number; notes: string }) => Promise<FollowUpBoard>;
  archiveFollowUpLead: (leadId: string, reason: string) => Promise<FollowUpBoard>;
  simulateFollowUpRun: () => Promise<FollowUpBoard>;
  uploadGuideline: (fileName: string, sizeKb: number) => Promise<EmailTemplateSetup>;
  indexSentFolder: () => Promise<EmailTemplateSetup>;
  clearSentFolder: () => Promise<EmailTemplateSetup>;
  uploadHtmlTemplate: (fileName: string, html: string) => Promise<EmailTemplateSetup>;
  uploadBrandAsset: (asset: Omit<TemplateAsset, "id">) => Promise<EmailTemplateSetup>;
  generateTemplatePreview: () => Promise<EmailTemplateSetup>;
  activateTemplate: () => Promise<EmailTemplateSetup>;
  saveTemplate: (name: string) => Promise<SavedTemplate>;
  loadTemplate: (templateId: string) => Promise<EmailTemplateSetup>;
  deleteTemplate: (templateId: string) => Promise<void>;
  renameTemplate: (templateId: string, name: string) => Promise<SavedTemplate>;

  // ── Backend endpoint wrappers (not yet wired to UI) ──────────────────────
  // Contacts
  createLead: (payload: CreateLeadPayload) => Promise<BackendLead>;
  deleteLead: (leadId: number) => Promise<void>;
  bulkDeleteLeads: (leadIds: number[]) => Promise<{ deleted: number }>;
  enrichContact: (leadId: number) => Promise<BackendLead & { new_signals: number }>;
  bulkEnrich: (leadIds: number[]) => Promise<any>;
  bulkImportLeads: (file: File) => Promise<{ created: number; skipped: number; contacts: BackendLead[] }>;
  bulkTagContacts: (contactIds: number[], tag: string, action: "add" | "remove") => Promise<any>;
  bulkValidateLeads: (file: File) => Promise<BulkValidateResult>;
  generateDossier: (leadId: number) => Promise<{ contact_id: number; dossier: any }>;
  findLeads: (filters: LeadFinderFilters) => Promise<LeadFinderResponse>;
  saveLeads: (leads: any[]) => Promise<{ created: number; updated: number; skipped: number; contacts: BackendLead[] }>;
  webEnrichLeads: (leads: any[], icpFilters: Record<string, any> | null, onUpdate: (index: number, updates: Record<string, any>) => void, onDone: () => void) => () => void;
  refreshSignals: (leadId: number) => Promise<{ new_signals: number; intent_score: number; signals: Signal[] }>;
  getSignals: (leadId: number) => Promise<Signal[]>;
  getGlobalSignals: () => Promise<{ lead: BackendLead; signal: Signal }[]>;
  getNextAction: (leadId: number) => Promise<{ contact_id: number; intent_score: number; recommendation: NextAction }>;
  getOutreachMemory: (leadId: number) => Promise<OutreachMemory[]>;
  getObjectionHistory: (leadId: number) => Promise<ObjectionLog[]>;
  handleObjection: (leadId: number, payload: { reply_text: string; contact_name?: string; company?: string; original_subject?: string }) => Promise<ObjectionResult>;
  getBookingLink: (leadId: number, eventTypeSlug: string) => Promise<{ contact_id: number; booking_link: string; event_type_slug: string; prefilled_for: string }>;
  // Campaigns
  getCampaignTags: () => Promise<string[]>;
  getCampaign: (campaignId: number) => Promise<BackendCampaign>;
  uploadRecipients: (campaignId: number, file: File) => Promise<{ message: string }>;
  // Escalations
  getEscalations: () => Promise<EscalationEvent[]>;
  resolveEscalation: (escalationId: number, action: "resume" | "cancel") => Promise<any>;
  // Re-engagement
  getReengagement: (status?: string) => Promise<ReengagementEntry[]>;
  cancelReengagement: (entryId: number) => Promise<void>;
  sendReengagementNow: (entryId: number) => Promise<any>;
  // Sequences
  createSequence: (name: string, steps: SequenceStep[]) => Promise<Sequence>;
  deleteSequence: (seqId: number) => Promise<void>;
  pauseSequence: (seqId: number) => Promise<void>;
  enrollToSequence: (seqId: number, recipients: EnrollRecipient[]) => Promise<any>;
  getSequenceEnrollments: (seqId: number, status?: string) => Promise<SequenceEnrollment[]>;
  // Products
  getProducts: () => Promise<Product[]>;
  getProduct: (productKey: string) => Promise<Product>;
  createProduct: (payload: { display_name: string; product_description?: string; icp_job_titles?: string[]; icp_industries?: string[]; icp_locations?: string[]; pain_points?: string[]; social_proof?: string[]; cal_link?: string; sender_name?: string; sender_title?: string }) => Promise<Product>;
  updateProduct: (productKey: string, payload: Partial<Product>) => Promise<Product>;
  // Pipeline mode
  getPipelineMode: () => Promise<PipelineMode>;
  setPipelineMode: (livMode: boolean, confirm: string) => Promise<{ live_mode: boolean; message: string }>;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useOutreachStore = create<OutreachStore>((set, get) => {
  const initialWorkspace: GoogleWorkspaceState = {
    drive: false,
    sheets: false,
    gmail: false,
    calendar: false,
    calendarName: "AutoDeskAI Follow-ups"
  };

  const initialTemplateSetup = defaultTemplateSetup("");
  const initialBoard = buildFollowUpBoard("", [], defaultFollowUpStrategy(), initialWorkspace);

  return {
    projects: [],
    productsCatalog: [],
    productsLoading: false,
    projectId: "",
    campaign: null,
    pipelineStages: initialPipelineStages,
    leads: [],
    drafts: [],
    tracking: emptyTrackingSummary,
    events: [],
    googleWorkspace: initialWorkspace,
    followUpBoard: initialBoard,
    templateSetup: initialTemplateSetup,
    savedTemplates: [],

    userEmail: null,
    activeTab: "brief",
    briefSubmitted: false,
    pipelineStarted: false,
    pipelineComplete: false,
    actionLog: ["Demo loaded"],
    activeIndex: 0,
    expandedLeadId: null,
    selectedProductKey: null,

    setUserEmail: (userEmail) => set({ userEmail }),
    setActiveTab: (activeTab) => set({ activeTab }),
    setActiveIndex: (activeIndex) => set({ activeIndex }),
    setExpandedLeadId: (expandedLeadId) => set({ expandedLeadId }),
    setSelectedProductKey: (selectedProductKey) => set({ selectedProductKey }),
    setBriefSubmitted: (briefSubmitted) =>
      set((state) => ({
        briefSubmitted,
        actionLog: briefSubmitted ? ["Brief parsed", ...state.actionLog].slice(0, 5) : state.actionLog
      })),

    startPipeline: () => {
      set((state) => ({
        pipelineStarted: true,
        pipelineComplete: false,
        actionLog: ["Pipeline started", ...state.actionLog].slice(0, 5)
      }));

      // Kick off the real pipeline in the background
      const { campaign, projectId } = get();
      const email = getStoredEmail();
      if (email && campaign?.brief) {
        salesService.runPipeline(email, { prompt: campaign.brief }, {
          onDone: async () => {
            try {
              // After pipeline completes, load real contacts for this project tag
              const contacts = await salesService.getLeads(email, null, projectId);
              if (contacts.length > 0) {
                const v2Leads = contacts.map((c) => backendLeadToV2(c, campaign.id));
                const project = get().projects.find((p) => p.id === projectId);
                const v2Drafts = project ? buildDraftsForLeads(project, v2Leads) : get().drafts;
                const events = buildEventsForLeads(v2Leads);
                set({ leads: v2Leads, drafts: v2Drafts, events });
              }
            } catch {
              // Leave mock leads in place if fetch fails
            }
          },
          onError: (e) => console.warn("[outreach-v2] pipeline error:", e),
        });
      }
    },

    completePipeline: () =>
      set((state) => ({
        pipelineStarted: true,
        pipelineComplete: true,
        actionLog: ["Draft batch ready", ...state.actionLog].slice(0, 5)
      })),

    addAction: (action) => set((state) => ({ actionLog: [action, ...state.actionLog].slice(0, 5) })),

    resetDemo: async () => {
      await wait(180);
      set({
        pipelineStages: initialPipelineStages.map((s) => ({ ...s, status: "waiting" })),
        googleWorkspace: initialWorkspace,
        savedTemplates: [],
        briefSubmitted: false,
        pipelineStarted: false,
        pipelineComplete: false,
        activeTab: "brief",
        activeIndex: 0,
        expandedLeadId: null,
        selectedProductKey: null,
        actionLog: ["Workspace refreshed"]
      });
      await get().hydrateWorkspace();
    },

    hydrateWorkspace: async () => {
      const email = get().userEmail || getStoredEmail();
      if (!email) return;

      try {
        set({ productsLoading: true });
        const [campaigns, productsCatalog] = await Promise.all([
          salesService.getCampaigns(email),
          salesService.getProducts(email).catch(() => [] as Product[]),
        ]);

        const projects = deriveProjectsFromBackend(campaigns, productsCatalog);
        const activeProjectId = get().projectId && projects.some((project) => project.id === get().projectId)
          ? get().projectId
          : projects[0]?.id ?? "";

        set({
          projects,
          productsCatalog,
          productsLoading: false,
          projectId: activeProjectId,
        });

        if (!activeProjectId) {
          set({
            campaign: null,
            leads: [],
            drafts: [],
            tracking: emptyTrackingSummary,
            events: [],
            followUpBoard: buildFollowUpBoard("", [], defaultFollowUpStrategy(), get().googleWorkspace),
            templateSetup: defaultTemplateSetup(""),
          });
          return;
        }

        await get().selectProject(activeProjectId);
      } catch (error) {
        set({ productsLoading: false, projects: [], productsCatalog: [], projectId: "", campaign: null, leads: [], drafts: [], tracking: emptyTrackingSummary, events: [] });
        console.warn("[outreach-v2] hydrateWorkspace: backend fetch failed", error);
      }
    },

    // ── Project Management ────────────────────────────────────────────────────

    selectProject: async (id) => {
      await wait(200);
      const project = get().projects.find((p) => p.id === id);
      if (!project) return;

      const email = get().userEmail || getStoredEmail();
      if (email) {
        try {
          const [backendCampaigns, productsCatalog] = await Promise.all([
            salesService.getCampaigns(email),
            get().productsCatalog.length > 0 ? Promise.resolve(get().productsCatalog) : salesService.getProducts(email).catch(() => [] as Product[]),
          ]);

          const matchedCampaigns = backendCampaigns
            .filter((campaign) => campaignMatchesProject(project, campaign))
            .sort((left, right) => right.created_at.localeCompare(left.created_at));
          const matchedProducts = productsCatalog.filter((product) => productMatchesProject(project, product));
          const activeCampaign = matchedCampaigns[0];

          let backendContacts: BackendLead[] = [];
          if (activeCampaign) {
            backendContacts = await salesService.getLeads(email, activeCampaign.id).catch(async () => {
              if (activeCampaign.outreach_tag) {
                return salesService.getLeads(email, null, activeCampaign.outreach_tag);
              }
              if (activeCampaign.product_key) {
                return salesService.getLeads(email, null, null, null, null, activeCampaign.product_key);
              }
              return [];
            });
          } else if (matchedProducts[0]?.product_key) {
            backendContacts = await salesService.getLeads(email, null, null, null, null, matchedProducts[0].product_key).catch(() => []);
          }

          const campaign = activeCampaign ? backendCampaignToV2(activeCampaign, id) : buildCampaignFromProject(project);
          const campaignId = activeCampaign ? String(activeCampaign.id) : project.activeCampaignId;
          const leads = backendContacts.map((contact) => backendLeadToV2(contact, campaignId));
          const drafts = buildDraftsForLeads(project, leads);
          const tracking = activeCampaign ? backendTrackingToV2(activeCampaign, leads) : buildTrackingSummary(leads, drafts);
          const events = buildEventsForLeads(leads);

          const persistedTemplateState = readTemplateProjectState(id);
          const initialTemplateSetup = persistedTemplateState?.templateSetup
            ? { ...persistedTemplateState.templateSetup, projectId: id }
            : buildInitialTemplateSetup(id, activeCampaign?.html_template
                ? {
                    html: activeCampaign.html_template,
                    uploadedAt: activeCampaign.created_at,
                    fileName: `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "campaign"}-template.html`,
                  }
                : undefined);

          set({
            projectId: id,
            productsCatalog,
            campaign,
            leads,
            drafts,
            tracking,
            events,
            templateSetup: initialTemplateSetup,
            savedTemplates: persistedTemplateState?.savedTemplates ?? [],
            followUpBoard: buildFollowUpBoard(campaign.id, leads, defaultFollowUpStrategy(), get().googleWorkspace),
            activeTab: "brief",
            activeIndex: 0,
            expandedLeadId: null,
            selectedProductKey: null,
            briefSubmitted: false,
            pipelineStarted: false,
            pipelineComplete: false,
          });
          return;
        } catch (e) {
          console.warn("[outreach-v2] selectProject: backend fetch failed", e);
        }
      }

      const campaign = buildCampaignFromProject(project);
      const leads: Lead[] = [];
      const drafts: EmailDraft[] = [];
      const tracking = emptyTrackingSummary;
      const events: OutreachEvent[] = [];
      const persistedTemplateState = readTemplateProjectState(id);
      set({
        projectId: id,
        campaign,
        leads,
        drafts,
        tracking,
        events,
        templateSetup: persistedTemplateState?.templateSetup ? { ...persistedTemplateState.templateSetup, projectId: id } : defaultTemplateSetup(id),
        savedTemplates: persistedTemplateState?.savedTemplates ?? [],
        followUpBoard: buildFollowUpBoard(campaign.id, leads, defaultFollowUpStrategy(), get().googleWorkspace),
        activeTab: "brief",
        activeIndex: 0,
        expandedLeadId: null,
        selectedProductKey: null,
        briefSubmitted: false,
        pipelineStarted: false,
        pipelineComplete: false,
      });
    },

    createProject: async (input) => {
      await wait(220);
      const idBase = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const id = idBase || `project-${get().projects.length + 1}`;
      const uniqueId = get().projects.some((p) => p.id === id) ? `${id}-${get().projects.length + 1}` : id;

      const project: Project = {
        id: uniqueId,
        name: input.name.trim() || "Untitled project",
        product: input.product.trim() || "New outreach campaign",
        regionFocus: input.regionFocus.trim() || "General ICP Focus",
        activeCampaignId: `camp-${uniqueId}`,
      };

      // Create real backend campaign tagged with this project's slug
      const email = getStoredEmail();
      if (email) {
        try {
          const bc = await salesService.createCampaign(email, {
            name: project.name,
            subject_template: project.product,
            html_template: `<body><p>Hi {{firstName}},</p><p>{{personalizedOpener}}</p><p>{{body}}</p><p>Best,<br>{{repName}}</p></body>`,
            outreach_tag: uniqueId,
          });
          project.activeCampaignId = String(bc.id);
        } catch (e) {
          console.warn("[outreach-v2] createProject: campaign create failed", e);
        }
      }

      const campaign = buildCampaignFromProject(project);

      set((state) => ({
        projects: [project, ...state.projects],
        projectId: uniqueId,
        campaign,
        leads: [],
        drafts: [],
        tracking: emptyTrackingSummary,
        events: [],
        templateSetup: defaultTemplateSetup(uniqueId),
        followUpBoard: buildFollowUpBoard(campaign.id, [], defaultFollowUpStrategy(), state.googleWorkspace),
        briefSubmitted: false,
        pipelineStarted: false,
        pipelineComplete: false,
        activeIndex: 0,
        expandedLeadId: null,
        selectedProductKey: null,
      }));
      return project;
    },

    loadProducts: async () => {
      const email = get().userEmail || getStoredEmail();
      if (!email) {
        set({ productsCatalog: [], productsLoading: false, projects: [] });
        return [];
      }

      set({ productsLoading: true });
      try {
        const [campaigns, productsCatalog] = await Promise.all([
          salesService.getCampaigns(email).catch(() => [] as BackendCampaign[]),
          salesService.getProducts(email),
        ]);
        const projects = deriveProjectsFromBackend(campaigns, productsCatalog);
        set({ productsCatalog, productsLoading: false, projects });
        return productsCatalog;
      } catch (error) {
        set({ productsCatalog: [], productsLoading: false, projects: [] });
        throw error;
      }
    },

    // ── Lead Review ───────────────────────────────────────────────────────────

    reviewLead: async (leadId, status) => {
      await wait(180);

      // Fire-and-forget backend update — stores approval status in notes field
      const email = getStoredEmail();
      const numId = parseInt(leadId);
      if (email && !isNaN(numId)) {
        salesService.updateLead(numId, email, { notes: JSON.stringify({ _v2status: status }) })
          .catch(() => { /* ignore — local state is authoritative for UI */ });
      }

      let updatedLead: Lead | null = null;
      set((state) => {
        const nextLeads = state.leads.map((l) => {
          if (l.id === leadId) { updatedLead = { ...l, status }; return updatedLead; }
          return l;
        });
        return { leads: nextLeads, actionLog: [`${updatedLead?.firstName ?? "Lead"} ${status}`, ...state.actionLog].slice(0, 5) };
      });
      return updatedLead!;
    },

    assignLeadOwner: async (leadId, owner) => {
      await wait(160);

      const email = getStoredEmail();
      const numId = parseInt(leadId);
      if (email && !isNaN(numId)) {
        salesService.updateLead(numId, email, { notes: JSON.stringify({ _v2owner: owner }) })
          .catch(() => { });
      }

      let updatedLead: Lead | null = null;
      set((state) => {
        const nextLeads = state.leads.map((l) => {
          if (l.id === leadId) { updatedLead = { ...l, owner, outreachOwner: owner }; return updatedLead; }
          return l;
        });
        return { leads: nextLeads, actionLog: [`${updatedLead?.firstName ?? "Lead"} assigned to ${owner}`, ...state.actionLog].slice(0, 5) };
      });
      return updatedLead!;
    },

    assignLeadOutreachOwner: async (leadId, outreachOwner) => {
      await wait(160);

      const email = getStoredEmail();
      const numId = parseInt(leadId);
      if (email && !isNaN(numId)) {
        salesService.updateLead(numId, email, { notes: JSON.stringify({ _v2outreachOwner: outreachOwner }) })
          .catch(() => { });
      }

      let updatedLead: Lead | null = null;
      set((state) => {
        const nextLeads = state.leads.map((l) => {
          if (l.id === leadId) { updatedLead = { ...l, owner: outreachOwner, outreachOwner }; return updatedLead; }
          return l;
        });
        return { leads: nextLeads, actionLog: [`${updatedLead?.firstName ?? "Lead"} rep changed to ${outreachOwner}`, ...state.actionLog].slice(0, 5) };
      });
      return updatedLead!;
    },

    // ── Draft Approval ────────────────────────────────────────────────────────

    reviewDraft: async (draftId, status, updates) => {
      await wait(180);
      let updatedDraft: EmailDraft | null = null;
      set((state) => {
        const nextDrafts = state.drafts.map((d) => {
          if (d.id === draftId) { updatedDraft = { ...d, ...updates, approvalStatus: status }; return updatedDraft; }
          return d;
        });
        const campaignId = get().campaign?.id ?? "";
        const campaignDrafts = nextDrafts.filter((d) => d.campaignId === campaignId);
        const approved = campaignDrafts.filter((d) => d.approvalStatus === "approved" || d.approvalStatus === "edited").length;
        return {
          drafts: nextDrafts,
          tracking: { ...state.tracking, queued: approved, pendingApproval: Math.max(0, campaignDrafts.length - approved) },
          actionLog: [`Draft ${status}`, ...state.actionLog].slice(0, 5)
        };
      });
      return updatedDraft!;
    },

    approveAllDrafts: async () => {
      await wait(260);
      const campaignId = get().campaign?.id ?? "";
      const approvedLeadIds = new Set(get().leads.filter((l) => l.status === "approved").map((l) => l.id));
      set((state) => {
        const nextDrafts = state.drafts.map((d) => {
          if (d.campaignId === campaignId && d.approvalStatus !== "rejected" && approvedLeadIds.has(d.leadId)) {
            return { ...d, approvalStatus: "approved" as const };
          }
          return d;
        });
        const campaignDrafts = nextDrafts.filter((d) => d.campaignId === campaignId);
        const approved = campaignDrafts.filter((d) => d.approvalStatus === "approved" || d.approvalStatus === "edited").length;
        return {
          drafts: nextDrafts,
          tracking: { ...state.tracking, queued: approved, pendingApproval: Math.max(0, campaignDrafts.length - approved) },
          actionLog: ["All ready drafts queued", ...state.actionLog].slice(0, 5)
        };
      });
      return get().drafts.filter((d) => d.campaignId === campaignId);
    },

    // ── Send ──────────────────────────────────────────────────────────────────

    sendQueued: async () => {
      await wait(380);
      const { campaign, drafts, leads } = get();
      const email = getStoredEmail();
      const campaignNumId = campaign ? parseInt(campaign.id) : NaN;

      if (email && !isNaN(campaignNumId)) {
        const approvedDrafts = drafts.filter(
          (d) => d.campaignId === campaign!.id && (d.approvalStatus === "approved" || d.approvalStatus === "edited")
        );
        const recipients = approvedDrafts
          .flatMap((d) => {
            const lead = leads.find((l) => l.id === d.leadId);
            if (!lead?.email) return [];
            return [{
              email: lead.email,
              name: `${lead.firstName} ${lead.lastName}`.trim(),
              variables: {
                firstName: lead.firstName,
                company: lead.company,
                personalizedOpener: d.opener,
                body: d.body,
                ctaUrl: "",
                repName: lead.outreachOwner || "",
              },
            }];
          });

        if (recipients.length > 0) {
          salesService.sendCampaign(campaignNumId, email, recipients, campaign!.name)
            .catch((e) => console.warn("[outreach-v2] sendQueued: send failed", e));
        }
      }

      const sentCount = (drafts ?? []).filter(
        (d) => d.campaignId === campaign?.id && (d.approvalStatus === "approved" || d.approvalStatus === "edited")
      ).length;

      set((state) => ({
        tracking: {
          ...state.tracking,
          sent: sentCount,
          queued: 0,
          openRate: sentCount > 0 ? 42 : 0,
          clickRate: sentCount > 0 ? 16 : 0,
          replyRate: sentCount > 0 ? 8 : 0
        },
        actionLog: [`${sentCount} emails sent`, ...state.actionLog].slice(0, 5)
      }));
      return get().tracking;
    },

    // ── Google Workspace ──────────────────────────────────────────────────────

    setGoogleWorkspaceService: async (service, connected) => {
      await wait(260);
      set((state) => {
        const nextWorkspace = { ...state.googleWorkspace, [service]: connected };
        const nextBoard = state.followUpBoard ? { ...state.followUpBoard, workspace: nextWorkspace } : null;
        return { googleWorkspace: nextWorkspace, followUpBoard: nextBoard };
      });
      return get().googleWorkspace;
    },

    // ── Follow-Up Board ───────────────────────────────────────────────────────

    readCampaignReplies: async () => {
      await wait(760);
      const { campaign, leads, followUpBoard } = get();
      const email = getStoredEmail();
      const campaignNumId = campaign ? parseInt(campaign.id) : NaN;

      if (email && !isNaN(campaignNumId) && followUpBoard) {
        try {
          // Fetch real recipient engagement stats from backend
          const recipients = await salesService.getCampaignRecipients(campaignNumId, email);
          if (recipients.length > 0) {
            const nextLeads = followUpBoard.leads.map((leadState) => {
              const lead = leads.find((l) => l.id === leadState.leadId);
              if (!lead) return leadState;
              const recipient = recipients.find((r) => r.email === lead.email);
              if (!recipient) return leadState;

              if (recipient.replied) {
                return {
                  ...leadState,
                  status: "responded" as const,
                  interestLevel: "hot" as const,
                  interestReason: "Replied to the outreach email.",
                  repliedCount: 1,
                  openedCount: recipient.open_count,
                  lastTouchAt: recipient.last_opened_at ?? new Date().toISOString(),
                  reply: {
                    id: `reply-${lead.id}-1`,
                    leadId: lead.id,
                    from: lead.email,
                    subject: `Re: Campaign`,
                    snippet: "Replied to your message.",
                    receivedAt: new Date().toISOString(),
                    intent: "interested" as const,
                    read: true,
                  },
                };
              }
              if (recipient.open_count > 0) {
                return {
                  ...leadState,
                  status: "read_no_reply" as const,
                  interestLevel: "medium" as const,
                  interestReason: `Opened ${recipient.open_count} time(s) but hasn't replied.`,
                  openedCount: recipient.open_count,
                  lastTouchAt: recipient.last_opened_at ?? leadState.lastTouchAt,
                };
              }
              return leadState;
            });

            const nextBoard: FollowUpBoard = {
              ...followUpBoard,
              leads: nextLeads,
              summary: {
                ...followUpBoard.summary,
                responded: nextLeads.filter((s) => s.status === "responded").length,
                readNoReply: nextLeads.filter((s) => s.status === "read_no_reply").length,
                noResponse: nextLeads.filter((s) => s.status === "no_response").length,
                meetingsProposed: nextLeads.filter((s) => s.meetingProposal && !s.scheduledMeeting).length,
              },
            };
            set({ followUpBoard: nextBoard, actionLog: ["Gmail replies synced", ...get().actionLog].slice(0, 5) });
            return nextBoard;
          }
        } catch (e) {
          console.warn("[outreach-v2] readCampaignReplies: backend fetch failed, using mock", e);
        }
      }

      // Fallback: mock progression of the read_no_reply lead
      set((state) => {
        if (!state.followUpBoard) return {};
        const followUpTarget = state.followUpBoard.leads.find((leadState) => leadState.status === "read_no_reply");
        if (!followUpTarget) return {};
        const lead = state.leads.find((item) => item.id === followUpTarget.leadId);
        if (!lead) return {};

        const nextLeads = state.followUpBoard.leads.map((leadState) => {
          if (leadState.leadId !== followUpTarget.leadId) return leadState;
          const snippet = `Worth a look. Thursday afternoon is open if you can send a calendar hold for ${lead.company}.`;
          return {
            ...leadState,
            status: "responded" as const,
            interestLevel: "hot" as const,
            interestReason: "Positive reply with clear meeting intent.",
            repliedCount: 1,
            lastTouchAt: new Date().toISOString(),
            reply: {
              id: `reply-${lead.id}-1`,
              leadId: lead.id,
              from: lead.email,
              subject: `Re: ${lead.company}`,
              snippet,
              receivedAt: new Date().toISOString(),
              intent: "meeting_request" as const,
              read: true
            },
            meetingProposal: {
              leadId: lead.id,
              replyId: `reply-${lead.id}-1`,
              suggestedDate: addDays(todayIso(), 3),
              suggestedTime: "15:00",
              timezone: "America/New_York",
              durationMinutes: 30,
              provider: "google_meet" as const,
              attendees: [lead.email, "agasthya.d98@gmail.com"],
              notes: `${lead.firstName} asked for a Thursday afternoon calendar hold.`,
              confidence: 86
            }
          };
        });

        const nextBoard: FollowUpBoard = {
          ...state.followUpBoard,
          leads: nextLeads,
          summary: {
            ...state.followUpBoard.summary,
            responded: nextLeads.filter((s) => s.status === "responded").length,
            readNoReply: nextLeads.filter((s) => s.status === "read_no_reply").length,
            noResponse: nextLeads.filter((s) => s.status === "no_response").length,
            meetingsProposed: nextLeads.filter((s) => s.meetingProposal && !s.scheduledMeeting).length
          }
        };

        return { followUpBoard: nextBoard, actionLog: ["Gmail replies processed", ...state.actionLog].slice(0, 5) };
      });
      return get().followUpBoard!;
    },

    saveFollowUpStrategy: async (leadId, strategy) => {
      await wait(240);
      set((state) => {
        if (!state.followUpBoard) return {};
        const nextStrategy = { ...strategy, updatedAt: new Date().toISOString() };
        const nextLeads = state.followUpBoard.leads.map((leadState) =>
          leadState.leadId === leadId
            ? {
                ...leadState,
                strategy: nextStrategy,
                nextFollowUpAt:
                  leadState.status === "read_no_reply" || leadState.status === "no_response"
                    ? addDays(nextStrategy.startDate, Math.max(1, leadState.followUpsSent) * nextStrategy.frequencyDays)
                    : leadState.nextFollowUpAt
              }
            : leadState
        );
        return { followUpBoard: { ...state.followUpBoard, leads: nextLeads } };
      });
      return get().followUpBoard!;
    },

    confirmCalendarMeeting: async (proposal) => {
      await wait(340);
      const meeting: ScheduledMeeting = {
        ...proposal,
        id: `meet-${Date.now()}`,
        calendarId: "primary",
        calendarName: get().googleWorkspace.calendarName,
        status: "confirmed",
        createdAt: new Date().toISOString(),
        meetingUrl: `https://meet.google.com/mock-${proposal.leadId.replace("lead-", "")}-${Date.now().toString().slice(-4)}`
      };

      set((state) => {
        if (!state.followUpBoard) return {};
        const nextLeads = state.followUpBoard.leads.map((leadState) =>
          leadState.leadId === proposal.leadId
            ? { ...leadState, scheduledMeeting: meeting, meetingProposal: proposal, lastTouchAt: meeting.createdAt }
            : leadState
        );
        return {
          followUpBoard: {
            ...state.followUpBoard,
            leads: nextLeads,
            summary: {
              ...state.followUpBoard.summary,
              meetingsProposed: nextLeads.filter((s) => s.meetingProposal && !s.scheduledMeeting).length
            }
          },
          actionLog: ["Meeting added to calendar", ...state.actionLog].slice(0, 5)
        };
      });
      return meeting;
    },

    markLeadConverted: async (leadId, conversion) => {
      await wait(240);

      // Update backend contact to reflect conversion
      const email = getStoredEmail();
      const numId = parseInt(leadId);
      if (email && !isNaN(numId)) {
        salesService.updateLead(numId, email, { notes: JSON.stringify({ _v2conversion: conversion }) })
          .catch(() => { });
      }

      set((state) => {
        if (!state.followUpBoard) return {};
        const nextLeads = state.followUpBoard.leads.map((leadState) =>
          leadState.leadId === leadId
            ? { ...leadState, status: "converted" as const, conversion: { ...conversion, convertedAt: new Date().toISOString() } }
            : leadState
        );
        return {
          followUpBoard: {
            ...state.followUpBoard,
            leads: nextLeads,
            summary: {
              ...state.followUpBoard.summary,
              responded: nextLeads.filter((s) => s.status === "responded").length,
              converted: nextLeads.filter((s) => s.status === "converted").length
            }
          },
          actionLog: ["Lead marked converted", ...state.actionLog].slice(0, 5)
        };
      });
      return get().followUpBoard!;
    },

    archiveFollowUpLead: async (leadId, reason) => {
      await wait(220);

      // Update backend contact to reflect archive
      const email = getStoredEmail();
      const numId = parseInt(leadId);
      if (email && !isNaN(numId)) {
        salesService.updateLead(numId, email, { notes: JSON.stringify({ _v2archived: true, archiveReason: reason }) })
          .catch(() => { });
      }

      set((state) => {
        if (!state.followUpBoard) return {};
        const nextLeads = state.followUpBoard.leads.map((leadState) =>
          leadState.leadId === leadId
            ? { ...leadState, status: "archived_no_response" as const, archiveReason: reason, archivedAt: new Date().toISOString() }
            : leadState
        );
        return {
          followUpBoard: {
            ...state.followUpBoard,
            leads: nextLeads,
            summary: {
              ...state.followUpBoard.summary,
              responded: nextLeads.filter((s) => s.status === "responded").length,
              noResponse: nextLeads.filter((s) => s.status === "no_response").length,
              readNoReply: nextLeads.filter((s) => s.status === "read_no_reply").length,
              archived: nextLeads.filter((s) => s.status === "archived_no_response").length
            }
          },
          actionLog: ["Lead archived", ...state.actionLog].slice(0, 5)
        };
      });
      return get().followUpBoard!;
    },

    simulateFollowUpRun: async () => {
      await wait(520);

      // Trigger resume on the sequence tied to this campaign if one exists
      const email = getStoredEmail();
      const { campaign } = get();
      const campaignNumId = campaign ? parseInt(campaign.id) : NaN;
      if (email && !isNaN(campaignNumId)) {
        // Attempt to fetch sequence enrollments and advance them
        salesService.getSequences(email).then((sequences) => {
          const campaignSeq = sequences.find((s) => s.name.includes(campaign!.name));
          if (campaignSeq && campaignSeq.status === "paused") {
            salesService.resumeSequence(campaignSeq.id, email).catch(() => { });
          }
        }).catch(() => { });
      }

      set((state) => {
        if (!state.followUpBoard) return {};
        const nextLeads = state.followUpBoard.leads.map((leadState) => {
          if (leadState.status !== "no_response" && leadState.status !== "read_no_reply") return leadState;
          const followUpsSent = leadState.followUpsSent + 1;
          if (leadState.strategy.autoArchiveAfterFinal && followUpsSent >= leadState.strategy.followUpCount && leadState.status === "no_response") {
            return {
              ...leadState,
              followUpsSent,
              status: "archived_no_response" as const,
              archiveReason: "No response after final follow-up",
              archivedAt: new Date().toISOString(),
              lastTouchAt: new Date().toISOString()
            };
          }
          return {
            ...leadState,
            followUpsSent,
            openedCount: leadState.status === "read_no_reply" ? leadState.openedCount + 1 : leadState.openedCount,
            nextFollowUpAt: addDays(todayIso(), leadState.strategy.frequencyDays),
            lastTouchAt: new Date().toISOString()
          };
        });

        return {
          followUpBoard: {
            ...state.followUpBoard,
            leads: nextLeads,
            summary: {
              ...state.followUpBoard.summary,
              noResponse: nextLeads.filter((s) => s.status === "no_response").length,
              readNoReply: nextLeads.filter((s) => s.status === "read_no_reply").length,
              archived: nextLeads.filter((s) => s.status === "archived_no_response").length
            }
          },
          actionLog: ["Follow-ups processed", ...state.actionLog].slice(0, 5)
        };
      });
      return get().followUpBoard!;
    },

    // ── Template Management ───────────────────────────────────────────────────

    uploadGuideline: async (fileName, sizeKb) => {
      await wait(240);
      set((state) => ({
        templateSetup: {
          ...state.templateSetup,
          guideline: { fileName, sizeKb, uploadedAt: new Date().toISOString() },
          isActive: false
        }
      }));
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    indexSentFolder: async () => {
      await wait(780);

      // Fetch real sent campaign count from backend to use as indexedCount
      const email = getStoredEmail();
      let indexedCount = 426;
      if (email) {
        try {
          const campaigns = await salesService.getCampaigns(email);
          const totalSent = campaigns.reduce((sum, c) => sum + (c.sent_count ?? 0), 0);
          if (totalSent > 0) indexedCount = totalSent;
        } catch { /* use default */ }
      }

      set((state) => ({
        templateSetup: {
          ...state.templateSetup,
          sentFolder: {
            status: "ready",
            scope: "all_sent",
            indexedCount,
            lastIndexedAt: new Date().toISOString(),
            summary: "Concise opening, specific proof in the first two sentences, plain-spoken CTA, and a warm sign-off. Avoid hype, long claims, and generic AI language."
          },
          isActive: false
        }
      }));
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    clearSentFolder: async () => {
      await wait(180);
      set((state) => ({
        templateSetup: {
          ...state.templateSetup,
          sentFolder: { status: "not_connected", scope: "all_sent", indexedCount: 0 },
          isActive: false
        }
      }));
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    uploadHtmlTemplate: async (fileName, html) => {
      await wait(260);

      // Validate the template against the backend-generated template structure
      const email = getStoredEmail();
      let backendVariables: string[] | undefined;
      if (email) {
        try {
          const result = await salesService.generateTemplate(
            email,
            html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800)
          );
          backendVariables = result.variables;
        } catch { /* use local extraction */ }
      }

      set((state) => {
        const variables = backendVariables ?? extractVariables(html);
        const issues = validateTemplateHtml(html, state.templateSetup.assets);
        return {
          templateSetup: {
            ...state.templateSetup,
            htmlTemplate: { fileName, uploadedAt: new Date().toISOString(), html, variables, issues },
            previewHtml: undefined,
            previewGeneratedAt: undefined,
            isActive: false
          }
        };
      });
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    uploadBrandAsset: async (asset) => {
      await wait(220);
      set((state) => {
        const nextAsset: TemplateAsset = { ...asset, id: `asset-${Date.now()}` };
        const nextAssets = [nextAsset, ...state.templateSetup.assets];
        const nextHtmlTemplate = state.templateSetup.htmlTemplate
          ? { ...state.templateSetup.htmlTemplate, issues: validateTemplateHtml(state.templateSetup.htmlTemplate.html, nextAssets) }
          : undefined;
        return {
          templateSetup: { ...state.templateSetup, assets: nextAssets, htmlTemplate: nextHtmlTemplate, isActive: false }
        };
      });
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    generateTemplatePreview: async () => {
      await wait(360);
      const setup = get().templateSetup;
      if (!setup.htmlTemplate) return setup;

      // Try to get a real AI-generated preview via backend
      const email = getStoredEmail();
      if (email) {
        try {
          const result = await salesService.generateTemplate(
            email,
            setup.htmlTemplate.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800)
          );
          if (result.html_template) {
            set((state) => ({
              templateSetup: {
                ...state.templateSetup,
                previewHtml: result.html_template,
                previewGeneratedAt: new Date().toISOString(),
                isActive: false
              }
            }));
            persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
            return get().templateSetup;
          }
        } catch { /* fall through to local render */ }
      }

      // Local render using sample data
      const sampleCopy = {
        firstName: "Sarah",
        company: "Mint PR",
        personalizedOpener: "Saw that Mint PR has been publishing thoughtful takes on AI-assisted media monitoring, especially around how agencies keep the human judgment layer intact.",
        body: "We built eBic for PR teams that want sharper intelligence without turning outreach into generic automation. It helps teams spot relevant signals, draft better context-aware notes, and keep approvals human before anything sends.",
        ctaUrl: "https://example.com/ebic",
        repName: "Ranu"
      };

      const renderedPreview = Object.entries(sampleCopy).reduce(
        (nextHtml, [key, value]) => nextHtml.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value),
        setup.htmlTemplate.html
      );

      set((state) => ({
        templateSetup: { ...state.templateSetup, previewHtml: renderedPreview, previewGeneratedAt: new Date().toISOString(), isActive: false }
      }));
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    activateTemplate: async () => {
      await wait(260);
      const setup = get().templateSetup;
      const hasErrors = setup.htmlTemplate?.issues.some((issue) => issue.severity === "error") ?? true;
      const canActivate = Boolean(setup.guideline && setup.sentFolder.status === "ready" && setup.previewHtml && !hasErrors);

      set((state) => ({ templateSetup: { ...state.templateSetup, isActive: canActivate } }));
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    saveTemplate: async (name) => {
      await wait(260);
      const saved: SavedTemplate = {
        id: `tpl-${Date.now()}`,
        name,
        createdAt: new Date().toISOString(),
        setup: { ...get().templateSetup }
      };
      set((state) => ({ savedTemplates: [saved, ...state.savedTemplates] }));
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return saved;
    },

    loadTemplate: async (templateId) => {
      await wait(200);
      const saved = get().savedTemplates.find((t) => t.id === templateId);
      if (!saved) return get().templateSetup;
      set({ templateSetup: { ...saved.setup } });
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return get().templateSetup;
    },

    deleteTemplate: async (templateId) => {
      await wait(180);
      set((state) => ({ savedTemplates: state.savedTemplates.filter((t) => t.id !== templateId) }));
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
    },

    renameTemplate: async (templateId, name) => {
      await wait(180);
      let updated: SavedTemplate | null = null;
      set((state) => {
        const nextSaved = state.savedTemplates.map((t) => {
          if (t.id === templateId) { updated = { ...t, name }; return updated; }
          return t;
        });
        return { savedTemplates: nextSaved };
      });
      persistCurrentTemplateProjectState(get().projectId, get().templateSetup, get().savedTemplates);
      return updated!;
    },

    // ── Backend endpoint wrappers (not yet wired to UI) ────────────────────

    createLead: (payload) => {
      const email = getStoredEmail()!;
      return salesService.createLead(email, payload);
    },

    deleteLead: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.deleteLead(leadId, email);
    },

    bulkDeleteLeads: (leadIds) => {
      const email = getStoredEmail()!;
      return salesService.bulkDeleteLeads(email, leadIds);
    },

    enrichContact: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.enrichContact(leadId, email);
    },

    bulkEnrich: (leadIds) => {
      const email = getStoredEmail()!;
      return salesService.bulkEnrich(email, leadIds);
    },

    bulkImportLeads: (file) => {
      const email = getStoredEmail()!;
      return salesService.bulkImportLeads(email, file);
    },

    bulkTagContacts: (contactIds, listTag, geoTag) => {
      const email = getStoredEmail()!;
      return salesService.bulkTagContacts(email, contactIds, listTag, geoTag);
    },

    bulkValidateLeads: (file) => {
      const email = getStoredEmail()!;
      return salesService.bulkValidateLeads(email, file);
    },

    generateDossier: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.generateDossier(leadId, email);
    },

    findLeads: (filters) => {
      const email = getStoredEmail()!;
      return salesService.findLeads(email, filters);
    },

    saveLeads: (leads) => {
      const email = getStoredEmail()!;
      return salesService.saveLeads(email, leads as Parameters<typeof salesService.saveLeads>[1]);
    },

    webEnrichLeads: (leads, icpFilters, onUpdate, onDone) => {
      return salesService.webEnrichLeads(leads, icpFilters, onUpdate, onDone);
    },

    refreshSignals: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.refreshSignals(leadId, email);
    },

    getSignals: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.getSignals(leadId, email);
    },

    getGlobalSignals: () => {
      const email = getStoredEmail()!;
      return salesService.getGlobalSignals(email);
    },

    getNextAction: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.getNextAction(leadId, email);
    },

    getOutreachMemory: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.getOutreachMemory(leadId, email);
    },

    getObjectionHistory: (leadId) => {
      const email = getStoredEmail()!;
      return salesService.getObjectionHistory(leadId, email);
    },

    handleObjection: (leadId: number, payload) => {
      const email = getStoredEmail()!;
      return salesService.handleObjection(leadId, email, payload);
    },

    getBookingLink: (leadId, eventTypeSlug) => {
      const email = getStoredEmail()!;
      return salesService.getBookingLink(leadId, email, eventTypeSlug);
    },

    getCampaignTags: () => {
      const email = getStoredEmail()!;
      return salesService.getCampaignTags(email).then((res) => res.tags);
    },

    getCampaign: (campaignId) => {
      const email = getStoredEmail()!;
      return salesService.getCampaign(campaignId, email);
    },

    uploadRecipients: (campaignId, file) => {
      const email = getStoredEmail()!;
      return salesService.uploadRecipients(campaignId, email, file);
    },

    getEscalations: () => {
      const email = getStoredEmail()!;
      return salesService.getEscalations(email);
    },

    resolveEscalation: (escalationId, action) => {
      const email = getStoredEmail()!;
      return salesService.resolveEscalation(escalationId, email, action);
    },

    getReengagement: (status) => {
      const email = getStoredEmail()!;
      return salesService.getReengagement(email, status);
    },

    cancelReengagement: (entryId) => {
      const email = getStoredEmail()!;
      return salesService.cancelReengagement(entryId, email);
    },

    sendReengagementNow: (entryId) => {
      const email = getStoredEmail()!;
      return salesService.sendReengagementNow(entryId, email);
    },

    createSequence: (name, steps) => {
      const email = getStoredEmail()!;
      return salesService.createSequence(email, { name, steps });
    },

    deleteSequence: (seqId) => {
      const email = getStoredEmail()!;
      return salesService.deleteSequence(seqId, email);
    },

    pauseSequence: (seqId) => {
      const email = getStoredEmail()!;
      return salesService.pauseSequence(seqId, email);
    },

    enrollToSequence: (seqId, recipients) => {
      const email = getStoredEmail()!;
      return salesService.enrollToSequence(seqId, email, recipients);
    },

    getSequenceEnrollments: (seqId, status) => {
      const email = getStoredEmail()!;
      return salesService.getSequenceEnrollments(seqId, email, status);
    },

    getProducts: () => {
      const email = getStoredEmail()!;
      return salesService.getProducts(email);
    },

    getProduct: (productKey) => {
      const email = getStoredEmail()!;
      return salesService.getProduct(productKey, email);
    },

    createProduct: (payload) => {
      const email = getStoredEmail()!;
      return salesService.createProduct(email, payload).then((created) => {
        const nextProducts = [created, ...get().productsCatalog.filter((p) => p.product_key !== created.product_key)];
        return salesService.getCampaigns(email).catch(() => [] as BackendCampaign[]).then((campaigns) => {
          set({
            productsCatalog: nextProducts,
            projects: deriveProjectsFromBackend(campaigns, nextProducts),
          });
          return created;
        });
      });
    },

    updateProduct: (productKey, payload) => {
      const email = getStoredEmail()!;
      return salesService.updateProduct(productKey, email, payload).then((updated) => {
        const nextProducts = get().productsCatalog.map((p) => (p.product_key === updated.product_key ? updated : p));
        return salesService.getCampaigns(email).catch(() => [] as BackendCampaign[]).then((campaigns) => {
          set({
            productsCatalog: nextProducts,
            projects: deriveProjectsFromBackend(campaigns, nextProducts),
          });
          return updated;
        });
      });
    },

    getPipelineMode: () => {
      const email = getStoredEmail()!;
      return salesService.getPipelineMode(email);
    },

    setPipelineMode: (liveMode, confirm) => {
      return salesService.setPipelineMode({ live_mode: liveMode, confirm });
    },
  };
});
