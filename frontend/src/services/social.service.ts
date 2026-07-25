import { apiClient } from "@/lib/api-client";
import {
  ApproveSuggestionRequest,
  ApproveSuggestionResponse,
  CreateDigestRequest,
  CreateDigestResponse,
  CreateScanRequest,
  CreateScanResponse,
  DigestStatus,
  NewsDigestDetail,
  NewsDigestListItem,
  OrmPlatform,
  OrmPostDetail,
  OrmPostStatus,
  OrmPostsResponse,
  OrmScanLog,
  RegenerateSuggestionsRequest,
  RegenerateSuggestionsResponse,
  RejectPostRequest,
  RejectPostResponse,
} from "@/types/social.types";

export class SocialService {
  async listDigests(email: string) {
    return apiClient.request<NewsDigestListItem[]>(
      `/api/social/news/digests?email=${encodeURIComponent(email)}`
    );
  }

  async createDigest(payload: CreateDigestRequest) {
    return apiClient.request<CreateDigestResponse>(`/api/social/news/digest`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getDigest(digestId: number, email: string) {
    return apiClient.request<NewsDigestDetail>(
      `/api/social/news/digest/${digestId}?email=${encodeURIComponent(email)}`
    );
  }

  async deleteDigest(digestId: number, email: string) {
    return apiClient.request<void>(
      `/api/social/news/digest/${digestId}?email=${encodeURIComponent(email)}`,
      { method: "DELETE" }
    );
  }

  async listPosts(
    email: string,
    filters?: {
      platform?: OrmPlatform;
      status?: OrmPostStatus;
      scan_id?: number;
      limit?: number;
      offset?: number;
    }
  ) {
    const params = new URLSearchParams({ email });
    if (filters?.platform) params.set("platform", filters.platform);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.scan_id) params.set("scan_id", String(filters.scan_id));
    if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters?.offset !== undefined) params.set("offset", String(filters.offset));

    return apiClient.request<OrmPostsResponse>(`/api/social/orm/posts?${params.toString()}`);
  }

  async getPost(postId: number, email: string) {
    return apiClient.request<OrmPostDetail>(
      `/api/social/orm/posts/${postId}?email=${encodeURIComponent(email)}`
    );
  }

  async createScan(payload: CreateScanRequest) {
    return apiClient.request<CreateScanResponse>(`/api/social/orm/scan`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getScan(scanId: number, email: string) {
    return apiClient.request<OrmScanLog>(
      `/api/social/orm/scans/${scanId}?email=${encodeURIComponent(email)}`
    );
  }

  async listScans(email: string) {
    return apiClient.request<OrmScanLog[]>(
      `/api/social/orm/scans?email=${encodeURIComponent(email)}`
    );
  }

  async regenerateSuggestions(postId: number, payload: RegenerateSuggestionsRequest) {
    return apiClient.request<RegenerateSuggestionsResponse>(
      `/api/social/orm/posts/${postId}/suggest`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  }

  async approveSuggestion(postId: number, payload: ApproveSuggestionRequest) {
    return apiClient.request<ApproveSuggestionResponse>(
      `/api/social/orm/posts/${postId}/approve`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  }

  async rejectPost(postId: number, payload: RejectPostRequest) {
    return apiClient.request<RejectPostResponse>(
      `/api/social/orm/posts/${postId}/reject`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  }
}

export const socialService = new SocialService();
