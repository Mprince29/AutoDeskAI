import { apiClient } from "@/lib/api-client";

export class IntegrationService {
  async saveTelegramConfig(botToken: string, chatId?: string) {
    return apiClient.request(`/api/integrations/telegram/config`, {
      method: 'POST',
      body: JSON.stringify({ bot_token: botToken, chat_id: chatId }),
    });
  }

  async getTelegramHistory(limit: number = 10) {
    return apiClient.request(`/api/integrations/get_telegram_history?limit=${limit}`);
  }

  async saveLLMConfig(userEmail: string, provider: string, fields: Record<string, string>) {
    return apiClient.request<{ success: boolean; message: string }>(`/api/integrations/${provider}/api_key?email=${encodeURIComponent(userEmail)}`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  }

  async getIntegrationsStatus(email?: string): Promise<Record<string, { connected: boolean; available: boolean }>> {
    const query = email ? `?email=${encodeURIComponent(email)}` : '';
    return apiClient.request(`/api/integrations/status${query}`);
  }

  /** Start OAuth2 connect - opens a popup. Resolves when the popup posts back. */
  connectOAuth(platform: string, email: string): Promise<void> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${API_BASE_URL}/api/integrations/${platform}/connect?email=${encodeURIComponent(email)}`;
    return new Promise((resolve, reject) => {
      const popup = window.open(url, `connect_${platform}`, 'width=620,height=700');
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'integration_connected' && e.data.platform === platform) {
          window.removeEventListener('message', onMessage);
          resolve();
        } else if (e.data?.type === 'integration_error' && e.data.platform === platform) {
          window.removeEventListener('message', onMessage);
          reject(new Error(e.data.message || 'Integration failed'));
        }
      };
      window.addEventListener('message', onMessage);

      // Heartbeat to check if popup closed manually
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          window.removeEventListener('message', onMessage);
          reject(new Error('Window closed before connection finished'));
        }
      }, 1000);
    });
  }
}

export const integrationService = new IntegrationService();
