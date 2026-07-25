export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: string[];
  organizer: string;
  status: string;
  location?: string;
  htmlLink?: string;
}

export interface MeetingDetails {
  summary: string;
  description: string;
  attendees: string[];
  duration: string;
  location?: string;
}

export interface CalendarReminder {
  event_id: string;
  event_summary: string;
  event_start: string;
  reminder_time: string;
  sent: boolean;
  minutes_until_event: number;
}

export interface CalendarReminderStatus {
  is_monitoring: boolean;
  active_reminders: number;
  last_update: number;
}
