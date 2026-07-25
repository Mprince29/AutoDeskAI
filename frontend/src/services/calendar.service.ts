import { apiClient } from "@/lib/api-client";
import { CalendarEvent, MeetingDetails, CalendarReminder, CalendarReminderStatus } from "@/types/calendar.types";

export class CalendarService {
  async getEvents(email: string, timeMin?: string, timeMax?: string, maxResults: number = 50) {
    return apiClient.request<{ events: CalendarEvent[]; total: number }>(`/api/calendar/list_events`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        time_min: timeMin,
        time_max: timeMax,
        max_results: maxResults,
      }),
    });
  }

  async createEvent(email: string, meetingDetails: MeetingDetails, startTime: string, endTime: string) {
    return apiClient.request(`/api/calendar/create_event`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        summary: meetingDetails.summary,
        description: meetingDetails.description,
        start_time: startTime,
        end_time: endTime,
        attendees: meetingDetails.attendees,
        location: meetingDetails.location
      }),
    });
  }

  async updateEvent(email: string, eventId: string, fields: {
    summary?: string; description?: string; start_time?: string;
    end_time?: string; attendees?: string[]; location?: string;
  }) {
    return apiClient.request(`/api/calendar/update_event`, {
      method: 'PATCH',
      body: JSON.stringify({ user_email: email, event_id: eventId, ...fields }),
    });
  }

  async deleteEvent(email: string, eventId: string) {
    return apiClient.request(`/api/calendar/delete_event`, {
      method: 'POST',
      body: JSON.stringify({ user_email: email, event_id: eventId }),
    });
  }

  async checkAvailability(email: string, startTime: string, endTime: string, attendees?: string) {
    return apiClient.request(`/api/calendar/check_availability`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        start_time: startTime,
        end_time: endTime,
        attendees: attendees ? attendees.split(',').map(a => a.trim()) : [],
      }),
    });
  }

  async suggestTimes(email: string, startTime: string, endTime: string, attendees?: string, maxSuggestions: number = 5) {
    return apiClient.request(`/api/calendar/suggest_times`, {
      method: 'POST',
      body: JSON.stringify({
        user_email: email,
        start_date: startTime,
        end_date: endTime,
        duration_minutes: 30,
        attendees: attendees ? attendees.split(',').map(a => a.trim()) : [],
        max_suggestions: maxSuggestions
      }),
    });
  }

  // Intelligent (Agent-backed) Calendar methods
  async scheduleMeetingIntelligent(email: string, emailId: string, proposedTimes?: string[]) {
    const timesStr = proposedTimes && proposedTimes.length > 0 ? ` Proposed times: ${proposedTimes.join(', ')}.` : '';
    const task = `Look at the email with ID ${emailId} and schedule the requested meeting.${timesStr} Send an invite.`;
    return apiClient.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
    });
  }

  async rescheduleMeetingIntelligent(email: string, emailId: string, originalTime?: string, reason: string = "scheduling conflict") {
    const task = `Look at the email with ID ${emailId}. The meeting scheduled at ${originalTime || 'the original time'} needs to be rescheduled because of: ${reason}. Please find an alternative time and reply to reschedule.`;
    return apiClient.request(`/api/agents/execute?email=${encodeURIComponent(email)}`, {
      method: 'POST',
      body: JSON.stringify({ task_description: task }),
    });
  }

  // Reminders
  async getReminders(email: string) {
    return apiClient.request<CalendarReminder[]>(`/api/calendar/reminders?email=${encodeURIComponent(email)}`);
  }

  async getReminderStatus(email: string) {
    return apiClient.request<CalendarReminderStatus>(`/api/calendar/reminders/status?email=${encodeURIComponent(email)}`);
  }
}

export const calendarService = new CalendarService();
