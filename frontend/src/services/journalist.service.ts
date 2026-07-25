import { API_BASE } from "@/constants/journalist";
import { ArticleData, GroundingSource, SocialKit, SessionEntry } from "@/types/journalist.types";

export interface ContentRequest {
  query: string;
  category: string;
  tone: string;
  persona: string;
  enable_web_search: boolean;
  target_audience: string;
  sources: string[];
  grounding_sources: { name: string; content: string }[];
  history: { role: string; content: string }[];
  brand_voice?: string;
  language?: string;
  report_id?: number;
  session_id?: string;
}

export function getAuthHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function getErrorMessage(resp: Response, fallback: string): Promise<string> {
  try {
    const data = await resp.clone().json();
    if (typeof data?.detail === "string" && data.detail.trim()) return data.detail;
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
    if (typeof data?.error === "string" && data.error.trim()) return data.error;
  } catch {
    try {
      const text = await resp.text();
      if (text.trim()) return text;
    } catch {
      // ignore
    }
  }
  return fallback;
}

export async function generateContent(
  email: string,
  request: ContentRequest,
  onStatus: (msg: string) => void,
  onDelta?: (chunk: string) => void,
  signal?: AbortSignal,
  onProgress?: (percentage: number) => void
): Promise<ArticleData> {
  const resp = await fetch(`${API_BASE}/api/journalist/generate-content?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(request),
    signal,
  });
  if (!resp.ok) {
    throw new Error(await getErrorMessage(resp, `Server error ${resp.status}`));
  }
  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ArticleData | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "status") onStatus(evt.message);
        else if (evt.type === "progress") onProgress?.(evt.percentage);
        else if (evt.type === "delta") onDelta?.(evt.message);
        else if (evt.type === "result") result = evt.payload as ArticleData;
        else if (evt.type === "report_saved" && result) { const r: ArticleData = result; result = { ...r, id: evt.id }; }
        else if (evt.type === "error") {
          throw new Error(evt.message || "AI Journalist generation failed");
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message) {
          throw parseErr;
        }
      }
    }
  }
  if (!result) throw new Error("No result received from pipeline");
  return result;
}

export async function uploadFile(file: File, email: string): Promise<GroundingSource> {
  const form = new FormData();
  form.append("file", file);
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const resp = await fetch(`${API_BASE}/api/journalist/upload?email=${encodeURIComponent(email)}`, { method: "POST", headers, body: form });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Upload failed"));
  return resp.json();
}

export async function generateImage(topic: string, category: string, email: string, articleContent?: string, reportId?: number): Promise<string> {
  const resp = await fetch(`${API_BASE}/api/journalist/generate-image?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ 
      topic, 
      category, 
      article_content: articleContent,
      report_id: reportId
    }),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Image generation failed"));
  const data = await resp.json();
  return data.image_url || "";
}

export async function generateSocialKit(articleContent: string, email: string, reportId?: number, options?: { platforms: string[], moreHashtags: boolean, prompt?: string }): Promise<SocialKit> {
  const resp = await fetch(`${API_BASE}/api/journalist/generate-social-kit?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ 
      article_content: articleContent,
      report_id: reportId,
      platforms: options?.platforms,
      more_hashtags: options?.moreHashtags,
      refinement_prompt: options?.prompt
    }),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Social kit generation failed"));
  return resp.json();
}

export async function getReports(email: string): Promise<ArticleData[]> {
  const resp = await fetch(`${API_BASE}/api/journalist/reports?email=${encodeURIComponent(email)}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Failed to fetch reports from DB"));
  return resp.json();
}

export async function getSessions(email: string): Promise<SessionEntry[]> {
  const resp = await fetch(`${API_BASE}/api/journalist/sessions?email=${encodeURIComponent(email)}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Failed to fetch sessions from DB"));
  return resp.json();
}

export async function deleteReport(id: number, email: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/journalist/reports/${id}?email=${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Failed to delete report from DB"));
}

export async function saveReport(id: number, email: string, content: string, topic?: string, category?: string): Promise<{ id: number, version_count: number }> {
  const resp = await fetch(`${API_BASE}/api/journalist/reports/${id}/save?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ markdown_content: content, topic, category }),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Failed to save report edits"));
  return resp.json();
}

export async function translateArticle(
  content: string,
  targetLanguage: string,
  email: string
): Promise<{ translated_content: string; language: string }> {
  const resp = await fetch(`${API_BASE}/api/journalist/translate?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ content, target_language: targetLanguage }),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Translation failed"));
  return resp.json();
}

export async function generateAudioBriefing(
  content: string,
  email: string,
  reportId?: number
): Promise<{ audio_b64: string; script: string }> {
  const resp = await fetch(`${API_BASE}/api/journalist/generate-audio?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ content, report_id: reportId }),
  });
  if (!resp.ok) throw new Error(await getErrorMessage(resp, "Audio briefing generation failed"));
  return resp.json();
}
