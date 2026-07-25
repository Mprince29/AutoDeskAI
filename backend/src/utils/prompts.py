from typing import Dict, Optional
from datetime import datetime


# Email composition parsing
def system_parse_email_prompt() -> str:
    return (
        """You are an expert at parsing email composition prompts. Your task is to extract a clear subject line and email body from a user's prompt.

Rules:
1. The subject should be concise (under 60 characters) and descriptive
2. The body should be well-formatted and professional
3. If the prompt doesn't specify a subject, create one based on the content
4. If the prompt doesn't specify a body, create one based on the subject
5. Always separate subject and body clearly

Return your response as a JSON object with "subject" and "body" fields."""
    )


def user_parse_email_prompt(prompt: str) -> str:
    return (
        f"""Please parse this email composition prompt and extract the subject and body:

{prompt}

Return only a JSON object with "subject" and "body" fields."""
    )


# Subject extraction
def system_subject_extraction() -> str:
    return (
        """You are an expert at extracting concise, descriptive email subjects from user messages. Your task is to identify what the email is about and create a clear subject line.

Rules:
1. Extract the main topic, purpose, or action from the message
2. Keep subjects under 60 characters
3. Be specific and descriptive
4. Avoid generic terms like "Message", "Email", "Update" unless no specific topic is found
5. Look for project names, topics, actions, or purposes mentioned

Examples:
- "asking for employment letter" → "Employment Letter Request"
- "about the budget review meeting" → "Budget Review Meeting"
- "checking on project status" → "Project Status Update"
- "sending the quarterly report" → "Quarterly Report"
- "discussing the new feature" → "New Feature Discussion"

Return only the subject line, nothing else."""
    )


def user_subject_extraction(message: str) -> str:
    return (
        f"""Extract a clear email subject from this message:

{message}

Subject:"""
    )


# Time extraction from email text
def system_time_extraction() -> str:
    return (
        """You are an expert at analyzing emails and extracting meeting scheduling information. Return your response strictly as a JSON object with the following schema:

{
  "has_meeting_request": "boolean",
  "confidence": "number",  // 0.0 to 1.0
  "proposed_times": [
    {
      "date": "string",         // e.g. "2025-09-01"
      "start_time": "string",   // ISO 8601, e.g. "2025-09-01T10:00:00-04:00"
      "end_time": "string",     // ISO 8601, e.g. "2025-09-01T10:30:00-04:00"
      "timezone": "string",     // e.g. "America/New_York"
      "is_range": "boolean"
    }
  ],
  "attendees": ["string"],      // email addresses
  "meeting_purpose": "string",  // short title (<= 60 chars)
  "urgency": "string",          // low, medium, high
  "extracted_text": "string"    // relevant text snippet
}

Guidelines:
- If explicit times are present, extract them exactly.
- If relative terms are present (e.g., today, tomorrow, next Monday, morning/afternoon/evening), convert them to specific datetimes in the provided timezone.
- If a meeting request is present but no explicit time is given, propose 1-3 reasonable options within business hours (09:00–18:00) over the next few days in the provided timezone (e.g., 10:00 and 15:00 tomorrow or the next business day).
- Avoid proposing times outside business hours.
- For meeting_purpose, summarize succinctly.
- Be precise and fill all fields. If a field is not applicable, use a sensible default (e.g., false, empty string, or empty list).
"""
    )


# Response validation (quality checks)
def system_response_validation() -> str:
    return (
        """You are an expert email quality validator. Your task is to evaluate email responses for:

- Correctness (addresses the request)
- Tone (professional, respectful, and appropriate)
- Clarity and structure
- Safety and compliance (no sensitive data leakage)

Return a JSON with fields: score (0-1), issues (list), suggestions (list), is_acceptable (bool)."""
    )


def user_response_validation(original_email: Dict, generated_response: str, user_email: str) -> str:
    return (
        f"""Please evaluate this email response for quality and appropriateness.

Original email:
{original_email}

User email: {user_email}

Generated response:
{generated_response}

Return a JSON object as specified."""
    )


def system_response_improvement() -> str:
    return (
        """You are an expert email writer who improves responses based on feedback. Focus on making responses more professional, clear, and helpful while maintaining the original intent."""
    )


def user_response_improvement(response_text: str, validation_feedback: Dict) -> str:
    return (
        f"""Please improve this email response based on the validation feedback.

Response:
{response_text}

Feedback:
{validation_feedback}

Return only the improved response text."""
    )


# Meeting response validation
def system_meeting_validation() -> str:
    return (
        """You are an expert at evaluating meeting scheduling responses. Focus on completeness, clarity, and professionalism. Return your response as a JSON object."""
    )


# Content safety
def system_content_safety() -> str:
    return (
        """You are a content safety checker. Analyze the email response for:
- Sensitive data
- Harmful, hateful, or unsafe language
- Compliance risks

Return a JSON with: is_safe (bool), risks (list), notes (string)."""
    )


# Improved AI agent general system message
def system_improved_agent() -> str:
    return (
        """You are an expert email assistant that generates professional, contextual, and helpful email replies.

Objectives:
- Maintain appropriate tone
- Provide concise, actionable content
- Respect user preferences and context
"""
    )


# Email classifier system message
def system_email_classifier() -> str:
    return (
        """You are an expert email classifier with advanced spam detection capabilities. Your task is to analyze emails with extreme precision and return detailed classification results.

Return your response as a JSON object with the following schema:
{
  "category": "string",           // e.g. spam, newsletter, meeting_request, important, business, personal, notification, trash, sent
  "confidence": "number",         // 0.0 to 1.0
  "reasoning": "string",          // explanation for the classification
  "is_meeting_request": "boolean",
  "urgency": "string",            // high, medium, low
  "requires_response": "boolean",
  "action_required": "string",    // e.g. schedule meeting, respond, none
  "classifier": "string",         // rule_based_primary, ai_openai, fallback, etc.
  "email_id": "string",
  "timestamp": "string",          // ISO 8601
  "spam_indicators": ["string"],
  "newsletter_indicators": ["string"],
  "sender_reputation": "string",  // trusted, suspicious, known, unknown
  "content_quality": "string",    // spam, medium, high
  "section_placement": {
    "main_inbox": "boolean",
    "spam_section": "boolean",
    "newsletter_section": "boolean",
    "sent_section": "boolean",
    "meeting_section": "boolean",
    "important_section": "boolean",
    "business_section": "boolean",
    "personal_section": "boolean",
    "notification_section": "boolean",
    "trash_section": "boolean"
  }
}

Be precise and fill all fields. If a field is not applicable, use a sensible default (e.g., false, empty string, or empty list)."""
    )


def system_conversation_context() -> str:
    return (
        """Analyze this email conversation and provide context insights. Return your response as a JSON object.

Focus on:
1. Overall conversation topic/purpose
2. Relationship between participants
3. Current status of any requests or discussions
4. Recommended next actions
5. Priority level for response
6. Whether any emails should be reclassified based on context

Return structured insights that can help with response generation as a JSON object with the following structure:
{
  "topic": "string",
  "relationship": "string",
  "status": "string",
  "next_actions": ["string"],
  "priority": "string",
  "summary": "string",
  "reclassification_suggestions": ["string"]
}"""
    )


def user_conversation_context(conversation_text: str) -> str:
    return (
        f"""Analyze this conversation and return the result as JSON:\n\n{conversation_text}"""
    )


def user_time_extraction(email_text: str) -> str:
    return (
        f"""Analyze this email for meeting scheduling information and return the result as JSON:\n\n{email_text}"""
    )


# Email reply templates (centralized)
def meeting_confirmation_reply(sender_name: str, formatted_time: str, meet_link: Optional[str], user_name: str) -> str:
    meet_link_text = (
        f"\nGoogle Meet: {meet_link}"
        if meet_link
        else "\nA calendar invitation has been sent to your email."
    )
    return f"""Hello {sender_name},

The meeting has been scheduled for {formatted_time}.{meet_link_text}

If you need to reschedule, please advise a suitable time.

Best regards,
{user_name}"""


def availability_request_reply(sender_name: str, user_name: str) -> str:
    return f"""Hi {sender_name},

Thank you for your email about scheduling a meeting. I'd be happy to meet with you.

Could you please let me know what times work best for you? I'm generally available between 9 AM and 6 PM on weekdays.

Looking forward to our conversation.

Best regards,
{user_name}"""


def meeting_invitation_ack(sender_name: str, meeting_purpose: str, meeting_time: str, user_name: str) -> str:
    return f"""Hi {sender_name},

Thank you for the meeting invitation for {meeting_purpose} on {meeting_time}. I've noted it in my calendar and will be there.

Looking forward to our discussion!

Best regards,
{user_name}"""


def fallback_meeting_reply(sender_name: Optional[str], subject: str, user_name: str) -> str:
    intro = _meeting_request_intro(sender_name, subject)
    return f"""{intro}

I'm currently unavailable to respond personally, but I'll get back to you as soon as possible to schedule our meeting.

Best regards,
{user_name}"""


def time_conflict_reply_with_slots(sender_name: Optional[str], subject: str, slots_text: str, user_name: str, many: bool) -> str:
    intro = _meeting_request_intro(sender_name, subject)
    lead = "All your suggested times are busy." if many else "The time you suggested is busy."
    return f"""{intro}

{lead} Here are some available times for our meeting:

{slots_text}
Please let me know which time works best for you, or suggest another time.

Best regards,
{user_name}"""


def time_conflict_generic(sender_name: Optional[str], subject: str, user_name: str) -> str:
    intro = _meeting_request_intro(sender_name, subject)
    return f"""{intro}

I noticed there might be a scheduling conflict. Let me check my availability and get back to you with some alternative times that work for both of us.

I'll respond shortly with available time slots.

Best regards,
{user_name}"""


def reschedule_apology(original_reason: str, formatted_time: str, user_name: str, meet_link: Optional[str] = None) -> str:
    apology = f"""Hello,

I sincerely apologize for the confusion with our meeting time. {original_reason.capitalize()}.

I've rescheduled our meeting for {formatted_time}. I hope this time works better for you.

Looking forward to our discussion.

Best regards,
{user_name}"""
    if meet_link:
        apology += f"\n\nGoogle Meet Link: {meet_link}"
    return apology

# --- Localization Helper ---
def format_datetime_local(dt: datetime, tz: Optional[str] = None, locale: Optional[str] = None) -> str:
    """
    Format a datetime object for display, respecting timezone and locale.
    """
    try:
        if tz:
            from zoneinfo import ZoneInfo
            dt = dt.astimezone(ZoneInfo(tz))
    except Exception:
        pass
    # For now, just use ISO format; for real localization, use babel or locale module
    return dt.strftime("%A, %B %d, %Y at %I:%M %p %Z")

# --- DRY Common Wording ---
def _meeting_request_intro(sender_name: str, subject: str) -> str:
    name = sender_name or 'there'
    return f"""Hi {name},

Thank you for your meeting request regarding "{subject}"."""


