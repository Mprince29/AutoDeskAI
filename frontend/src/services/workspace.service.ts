export interface WorkspaceAsset {
  id: string;
  name: string;
  webViewLink: string;
  modifiedTime: string;
  iconLink?: string;
  thumbnailLink?: string;
  mimeType?: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  updated: string;
  status: string;
  notes?: string;
}

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL}/api`;

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const workspaceService = {
  getAssets: async (email: string, type: string): Promise<WorkspaceAsset[]> => {
    const url = new URL(`${API_BASE}/workspace/list`);
    url.searchParams.append('type', type);
    url.searchParams.append('max_results', '50');

    try {
      const response = await fetch(url.toString(), { headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return data.files || data.documents || [];
    } catch (error) {
      console.error(`Error fetching ${type} assets:`, error);
      return [];
    }
  },

  getTasks: async (email: string): Promise<{ tasks: GoogleTask[]; error?: string }> => {
    const url = new URL(`${API_BASE}/workspace/list`);
    url.searchParams.append('type', 'tasks');
    url.searchParams.append('max_results', '50');

    try {
      const response = await fetch(url.toString(), { credentials: 'include', headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success === false) return { tasks: [], error: data.error || 'Failed to load tasks' };
      return { tasks: data.tasks || [] };
    } catch (error) {
      console.error('Error fetching tasks:', error);
      return { tasks: [], error: String(error) };
    }
  },

  updateTask: async (email: string, taskId: string, data: { title?: string, notes?: string, status?: string }): Promise<{ success: boolean; task?: GoogleTask; error?: string }> => {
    const url = new URL(`${API_BASE}/workspace/tasks/${taskId}`);

    try {
      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
        credentials: 'include'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error updating task:', error);
      return { success: false, error: String(error) };
    }
  }
};
