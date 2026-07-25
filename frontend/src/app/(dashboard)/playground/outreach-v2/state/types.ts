export type EmailConfidence = "verified" | "likely" | "unknown";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type PipelineStageKey = "parse" | "discover" | "enrich" | "deduplicate" | "draft";

export interface Project {
  id: string;
  name: string;
  product: string;
  regionFocus: string;
  activeCampaignId: string;
}

export interface CreateProjectInput {
  name: string;
  product: string;
  regionFocus: string;
}

export interface IcpParameters {
  roles: string[];
  industries: string[];
  geographies: string[];
  companySize: string;
  intentSignals: string[];
  template: string;
  sendWindow: string;
}

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  estimate: string;
  status: "waiting" | "running" | "complete";
  detail: string;
}

export interface Campaign {
  id: string;
  projectId: string;
  name: string;
  brief: string;
  status: "brief" | "parsed" | "running" | "approval" | "scheduled";
  parsedIcp: IcpParameters;
  duplicateCount: number;
  activeStage: PipelineStageKey;
}

export interface Lead {
  id: string;
  campaignId: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  companySize: string;
  geography: "US" | "UK" | "India" | "Europe" | "Other";
  linkedinUrl: string;
  triggerReason: string;
  personalizationPreview: string;
  personalizationMode: "strong" | "fallback";
  email: string;
  emailConfidence: EmailConfidence;
  qualityScore: number;
  context: string;
  status: ReviewStatus;
  owner: string;
  outreachOwner: string;
  generatedBy: string;
  followedBy: string[];
}

export interface EmailDraft {
  id: string;
  campaignId: string;
  leadId: string;
  subject: string;
  opener: string;
  body: string;
  approvalStatus: ReviewStatus | "edited";
}

export interface OutreachEvent {
  id: string;
  timestamp: string;
  type: "generated" | "approved" | "queued" | "sent" | "opened" | "clicked" | "replied" | "bounced";
  leadId: string;
  owner: string;
  service: "apollo" | "hunter" | "claude" | "gmail" | "tracking";
  latencyMs: number;
  status: "ok" | "watch" | "error";
  detail: string;
}

export interface TrackingSummary {
  sent: number;
  queued: number;
  pendingApproval: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  hotLeads: string[];
}

export type TemplateValidationSeverity = "error" | "warning";

export interface TemplateValidationIssue {
  id: string;
  severity: TemplateValidationSeverity;
  message: string;
}

export interface SentFolderContext {
  status: "not_connected" | "ready";
  scope: "all_sent";
  indexedCount: number;
  lastIndexedAt?: string;
  summary?: string;
}

export interface TemplateAsset {
  id: string;
  name: string;
  type: string;
  sizeKb: number;
  url: string;
  emailSafe: boolean;
}

export interface EmailTemplateSetup {
  projectId: string;
  guideline?: {
    fileName: string;
    sizeKb: number;
    uploadedAt: string;
  };
  sentFolder: SentFolderContext;
  htmlTemplate?: {
    fileName: string;
    uploadedAt: string;
    html: string;
    variables: string[];
    issues: TemplateValidationIssue[];
  };
  assets: TemplateAsset[];
  previewHtml?: string;
  previewGeneratedAt?: string;
  isActive: boolean;
}

export interface SavedTemplate {
  id: string;
  name: string;
  createdAt: string;
  setup: EmailTemplateSetup;
}

export type LeadEngagementStatus = "responded" | "read_no_reply" | "no_response" | "converted" | "archived_no_response";
export type LeadInterestLevel = "hot" | "medium" | "low";
export type MeetingProvider = "google_meet" | "zoom";
export type FollowUpTone = "concise" | "warm" | "value-led";

export interface GmailReplyContext {
  id: string;
  leadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  intent: "meeting_request" | "interested" | "not_interested" | "out_of_office" | "none";
  read: boolean;
}

export interface MeetingProposal {
  leadId: string;
  replyId: string;
  suggestedDate: string;
  suggestedTime: string;
  timezone: string;
  durationMinutes: number;
  provider: MeetingProvider;
  attendees: string[];
  notes: string;
  confidence: number;
}

export interface ScheduledMeeting extends MeetingProposal {
  id: string;
  calendarId: string;
  calendarName: string;
  status: "confirmed";
  createdAt: string;
  meetingUrl: string;
}

export interface FollowUpStrategy {
  followUpCount: number;
  frequencyDays: number;
  startDate: string;
  tone: FollowUpTone;
  autoArchiveAfterFinal: boolean;
  updatedAt: string;
}

export interface FollowUpLeadState {
  leadId: string;
  status: LeadEngagementStatus;
  interestLevel: LeadInterestLevel;
  interestReason: string;
  strategy: FollowUpStrategy;
  openedCount: number;
  repliedCount: number;
  followUpsSent: number;
  lastTouchAt: string;
  nextFollowUpAt?: string;
  reply?: GmailReplyContext;
  meetingProposal?: MeetingProposal;
  scheduledMeeting?: ScheduledMeeting;
  conversion?: {
    stage: "demo_booked" | "qualified" | "customer";
    value: number;
    convertedAt: string;
    notes: string;
  };
  archiveReason?: string;
  archivedAt?: string;
}

export interface FollowUpSummary {
  sent: number;
  responded: number;
  readNoReply: number;
  noResponse: number;
  meetingsProposed: number;
  converted: number;
  archived: number;
}

export interface GoogleWorkspaceState {
  drive: boolean;
  sheets: boolean;
  gmail: boolean;
  calendar: boolean;
  calendarName: string;
}

export interface FollowUpBoard {
  campaignId: string;
  strategy: FollowUpStrategy;
  workspace: GoogleWorkspaceState;
  leads: FollowUpLeadState[];
  summary: FollowUpSummary;
}
