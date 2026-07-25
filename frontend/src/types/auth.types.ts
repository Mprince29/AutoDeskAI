export interface User {
  email: string;
  name: string;
}

export interface UserPreferences {
  auto_classify_emails: boolean;
  auto_schedule_meetings: boolean;
  timezone: string;
  gmail_connected: boolean;
  calendar_connected: boolean;
  llm_provider?: string;
  preferred_model?: string;
  is_monitoring?: boolean;
  is_company_user?: boolean;
  use_company_keys?: boolean | null;
}
