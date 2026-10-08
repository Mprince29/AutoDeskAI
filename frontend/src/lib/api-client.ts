const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

function getStoredUserEmail(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user_info');
    return raw ? JSON.parse(raw)?.email || null : null;
  } catch {
    return null;
  }
}

function getRequestBodyEmail(body: BodyInit | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed?.email || parsed?.user_email || null;
  } catch {
    return null;
  }
}

export class ApiClient {
  public async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const userEmail = getRequestBodyEmail(options.body) || getStoredUserEmail();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(userEmail ? { 'X-User-Email': userEmail } : {}),
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = { detail: 'Unknown error' };
      }

      console.warn('API Error Response:', {
        status: response.status,
        statusText: response.statusText,
        errorData: errorData,
        url: url
      });

      type ErrorPayload = { detail?: unknown; message?: string; error?: string };
      let errorMessage: string;
      if (typeof errorData === 'string') {
        errorMessage = errorData;
      } else if (errorData && typeof errorData === 'object') {
        const e = errorData as ErrorPayload;
        let detailStr: string | undefined;
        if (e.detail) {
          if (typeof e.detail === 'object') {
            try { detailStr = JSON.stringify(e.detail); } catch { detailStr = String(e.detail); }
          } else {
            detailStr = String(e.detail);
          }
        }
        errorMessage = detailStr || e.message || e.error || `HTTP ${response.status}: ${response.statusText}`;
      } else {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }

      // Normalise HTTP status codes into readable messages
      if (response.status === 401) errorMessage = '401';
      else if (response.status === 403) errorMessage = '403';
      else if (response.status === 404) errorMessage = '404';
      else if (response.status === 422) errorMessage = '422';
      else if (response.status === 429) errorMessage = '429';
      else if (response.status >= 500) errorMessage = '500';

      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength === "0") {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }
}

export const apiClient = new ApiClient();
