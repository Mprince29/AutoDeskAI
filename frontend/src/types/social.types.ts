export type DigestGeo = "us" | "eu" | "india" | "all";
export type DigestStatus = "pending" | "done" | "failed";

export interface NewsStory {
  id: number;
  headline: string;
  source: string | null;
  url: string | null;
  plain_summary: string | null;
  company_info: string | null;
  relevance_tag: string | null;
  geo_tag: string | null;
  published_at: string | null;
}

export interface NewsDigestListItem {
  id: number;
  user_email: string;
  geo: DigestGeo;
  status: DigestStatus;
  story_count: number;
  created_at: string | null;
}

export interface NewsDigestDetail extends NewsDigestListItem {
  stories: NewsStory[];
}

export interface CreateDigestRequest {
  email: string;
  geo: DigestGeo;
}

export interface CreateDigestResponse {
  digest_id: number;
  status: DigestStatus;
  message: string;
}

export type OrmPlatform = "linkedin" | "twitter" | "instagram";
export type OrmPostStatus = "pending" | "approved" | "rejected";
export type OrmScanStatus = "running" | "done" | "failed";
export type OrmPlatformFilter = OrmPlatform | "all";
export type OrmPostStatusFilter = OrmPostStatus | "all";

export interface OrmSuggestion {
  id: number;
  tone: string | null;
  comment_text: string;
  generated_at: string | null;
}

export interface OrmPostListItem {
  id: number;
  platform: OrmPlatform;
  post_url: string | null;
  post_author: string | null;
  post_content: string | null;
  relevance_score: number;
  relevance_reason: string | null;
  status: OrmPostStatus;
  scan_keyword: string | null;
  approved_comment: string | null;
  discovered_at: string | null;
  actioned_at: string | null;
}

export interface OrmPostDetail extends OrmPostListItem {
  suggestions: OrmSuggestion[];
}

export interface OrmPostsResponse {
  total: number;
  posts: OrmPostListItem[];
}

export interface OrmScanLog {
  id: number;
  status: OrmScanStatus;
  keywords: string[];
  platforms: OrmPlatform[];
  geo: DigestGeo | null;
  posts_found: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateScanRequest {
  email: string;
  keywords: string[];
  platforms: OrmPlatform[];
  geo: DigestGeo;
  brand_name: string;
  brand_context: string;
  brand_voice: string;
}

export interface CreateScanResponse {
  scan_id: number;
  status: OrmScanStatus;
  message: string;
}

export interface RegenerateSuggestionsRequest {
  email: string;
  brand_voice: string;
  brand_name: string;
}

export interface RegenerateSuggestionsResponse {
  suggestions: OrmSuggestion[];
}

export interface ApproveSuggestionRequest {
  email: string;
  suggestion_id: number;
}

export interface ApproveSuggestionResponse {
  status: "approved";
  approved_comment: string;
  post_url: string | null;
  platform: OrmPlatform;
}

export interface RejectPostRequest {
  email: string;
}

export interface RejectPostResponse {
  status: "rejected";
}
