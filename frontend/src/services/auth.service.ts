import { apiClient } from "@/lib/api-client";
import { User, UserPreferences } from "@/types/auth.types";

export class AuthService {
  async signup(data: { name: string; email: string; password: string }) {
    return apiClient.request<{ access_token: string; user: User }>('/api/auth', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { email: string; password: string }) {
    return apiClient.request<{ access_token: string; user: User }>('/api/auth', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getPreferences(email: string) {
    return apiClient.request<UserPreferences>(`/api/auth/preferences?email=${encodeURIComponent(email)}`);
  }

  async updatePreferences(email: string, preferences: Partial<UserPreferences>) {
    return apiClient.request<UserPreferences>(`/api/auth/preferences?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
  }
}

export const authService = new AuthService();
