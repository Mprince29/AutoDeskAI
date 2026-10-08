import { apiService } from "./api";

export interface GoogleDoc {
  id: string;
  name: string;
  webViewLink: string;
  modifiedTime: string;
  iconLink?: string;
  thumbnailLink?: string;
}

class DocsService {
  private get baseUrl() {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  private get authHeaders(): Record<string, string> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async getDocuments(email: string): Promise<GoogleDoc[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/docs/list`, {
        credentials: 'include',
        headers: this.authHeaders,
      });
      const data = await response.json();
      if (data.success) {
        return data.documents;
      }
      return [];
    } catch (error) {
      console.error("Error fetching documents:", error);
      return [];
    }
  }

  async searchDocuments(email: string, query: string): Promise<GoogleDoc[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/docs/search?query=${encodeURIComponent(query)}`, {
        credentials: 'include',
        headers: this.authHeaders,
      });
      const data = await response.json();
      if (data.success) {
        return data.files || [];
      }
      return [];
    } catch (error) {
      console.error("Error searching documents:", error);
      return [];
    }
  }
}

export const docsService = new DocsService();
