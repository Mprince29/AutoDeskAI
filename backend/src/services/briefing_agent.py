"""
Morning Briefing Agent Service
Runs on a schedule (or on-demand) to assemble a personalized briefing:
  - Unread email summary with urgency tiers
  - Today's calendar agenda
  - Pending follow-ups (from follow_up_hunter)
  - Delivers as text + optional TTS audio
"""
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from loguru import logger


async def generate_briefing(user_email: str, db) -> Dict[str, Any]:
    """
    Assemble the full morning briefing for a user.
    Returns a structured dict with sections ready to render or convert to speech.
    """
    logger.info(f"briefing_agent: starting generation for {user_email}...")
    from auth.models import User
    try:
        user = db.query(User).filter(User.email == user_email).first()
        timezone_str = user.timezone if user else "UTC"
    except Exception:
        timezone_str = "UTC"

    # Run all data collection in parallel
    email_task = _get_email_summary(user_email, db)
    calendar_task = _get_calendar_summary(user_email, timezone_str, db)
    followup_task = _get_followup_count(user_email, db)

    email_section, calendar_section, followup_count = await asyncio.gather(
        email_task, calendar_task, followup_task, return_exceptions=True
    )

    # Gracefully handle partial failures
    if isinstance(email_section, Exception):
        logger.warning(f"briefing_agent: email section failed: {email_section}")
        email_section = {"unread_count": 0, "urgent": [], "summary": "Unable to fetch emails."}

    if isinstance(calendar_section, Exception):
        logger.warning(f"briefing_agent: calendar section failed: {calendar_section}")
        calendar_section = {"events_today": [], "summary": "Unable to fetch calendar."}

    if isinstance(followup_count, Exception):
        followup_count = 0

    briefing = {
        "generated_at": datetime.utcnow().isoformat(),
        "user_email": user_email,
        "email": email_section,
        "calendar": calendar_section,
        "follow_ups": {"count": followup_count},
        "narrative": _build_narrative(email_section, calendar_section, followup_count, timezone_str),
    }
    return briefing


async def _get_email_summary(user_email: str, db) -> Dict[str, Any]:
    """Fetch unread emails and classify by urgency."""
    from mcp_servers.tools.gmail_tools import list_emails, ListEmailRequest

    req = ListEmailRequest(
        user_email=user_email,
        max_results=20,
        label_ids=["INBOX"],
        query="is:unread",
    )
    result = await list_emails(req)
    emails = result.get("emails", [])

    urgent, normal = [], []
    urgent_keywords = ["urgent", "asap", "immediately", "action required", "deadline", "overdue", "critical", "time-sensitive"]

    for e in emails:
        text = (e.get("subject", "") + " " + e.get("snippet", "")).lower()
        if any(kw in text for kw in urgent_keywords):
            urgent.append({"subject": e.get("subject"), "from": e.get("from"), "snippet": e.get("snippet", "")[:120]})
        else:
            normal.append({"subject": e.get("subject"), "from": e.get("from")})

    logger.info(f"briefing_agent: fetched {len(emails)} unread emails")
    return {
        "unread_count": len(emails),
        "urgent_count": len(urgent),
        "urgent": urgent[:3],
        "normal": normal,
        "normal_count": len(normal),
        "summary": f"{len(emails)} unread emails, {len(urgent)} urgent.",
    }


async def _get_calendar_summary(user_email: str, timezone_str: str, db) -> Dict[str, Any]:
    """Fetch today's calendar events based on user's timezone."""
    from mcp_servers.tools.calendar_tools import list_events, EventListRequest
    import pytz

    # Normalise timezone - fall back gracefully on None / invalid values
    tz_str = timezone_str if isinstance(timezone_str, str) and timezone_str.strip() else "UTC"
    logger.info(f"briefing_agent: fetching calendar events for timezone '{tz_str}'")

    try:
        user_tz = pytz.timezone(tz_str)
    except Exception:
        logger.warning(f"briefing_agent: unknown timezone '{tz_str}', falling back to UTC")
        user_tz = pytz.UTC

    now = datetime.now(user_tz)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    time_min = start_of_day.astimezone(pytz.UTC).strftime('%Y-%m-%dT%H:%M:%SZ')
    time_max = end_of_day.astimezone(pytz.UTC).strftime('%Y-%m-%dT%H:%M:%SZ')
    logger.info(f"briefing_agent: querying calendar {time_min} → {time_max}")

    try:
        req = EventListRequest(
            user_email=user_email,
            time_min=time_min,
            time_max=time_max,
            max_results=10,
        )
        result = await list_events(req)
    except Exception as cal_err:
        logger.error(f"briefing_agent: list_events raised for {user_email}: {cal_err}")
        raise  # let asyncio.gather catch it so generate_briefing shows the right fallback

    events = result.get("events", [])
    logger.info(f"briefing_agent: fetched {len(events)} calendar events (raw result keys: {list(result.keys())})")

    formatted = []
    for e in events:
        start = e.get("start", "")
        if "T" in str(start):
            try:
                # If timezone is present in the string, parse it using datetime
                if start.endswith('Z'):
                    t = datetime.fromisoformat(start.replace("Z", "+00:00"))
                else: 
                    t = datetime.fromisoformat(start)
                start = t.astimezone(user_tz).strftime("%I:%M %p")
            except Exception:
                pass
        formatted.append({
            "title": e.get("summary", "Untitled"),
            "start": start,
            "attendees": len(e.get("attendees", [])),
        })

    return {
        "events_today": formatted,
        "event_count": len(formatted),
        "summary": f"{len(formatted)} meeting(s) today." if formatted else "No meetings today.",
    }


async def _get_followup_count(user_email: str, db) -> int:
    """Quick count of pending follow-ups from the DB."""
    try:
        from auth.models import FollowUp
        count = db.query(FollowUp).filter(
            FollowUp.user_email == user_email,
            FollowUp.status == "pending"
        ).count()
        return count
    except Exception as e:
        logger.error(f"briefing_agent: followup count failed: {e}")
        return 0


def _build_narrative(
    email: Dict[str, Any],
    calendar: Dict[str, Any],
    followup_count: int,
    timezone_str: str = "UTC",
) -> str:
    """Build a concise spoken/text briefing narrative with rich Markdown formatting."""
    import pytz
    try:
        user_tz = pytz.timezone(timezone_str)
    except Exception:
        user_tz = pytz.UTC

    now = datetime.now(user_tz)
    greeting = "🌅 Good morning" if now.hour < 12 else ("☀️ Good afternoon" if now.hour < 17 else "🌙 Good evening")

    narrative = f"# {greeting}\n"
    narrative += f"**{now.strftime('%A, %B %d')}**\n\n"
    narrative += "---\n\n"

    # Email section
    unread = email.get("unread_count", 0)
    urgent = email.get("urgent_count", 0)
    narrative += "### 📧 Inbox Overview\n"
    if unread == 0:
        narrative += "Your inbox is clear - no unread emails. Great job!\n\n"
    else:
        status = f"You have **{unread}** unread emails"
        if urgent > 0:
            status += f", with **{urgent}** marked as urgent."
        else:
            status += "."
        narrative += f"{status}\n"
        
        if urgent > 0:
            narrative += "\n**Urgent items needing attention:**\n"
            for u in email.get("urgent", [])[:3]:
                narrative += f"- **{u['subject']}** from {u['from']}\n"
        narrative += "\n"

    # Calendar section
    events = calendar.get("events_today", [])
    narrative += "### 📅 Today's Agenda\n"
    if not events:
        narrative += "Your calendar is wide open today - no meetings scheduled.\n\n"
    else:
        narrative += f"You have **{len(events)}** meeting{'s' if len(events) > 1 else ''} scheduled:\n"
        for e in events[:5]:
            narrative += f"- **{e['start']}**: {e['title']} ({e['attendees']} attendees)\n"
        narrative += "\n"

    # Follow-up section
    if followup_count > 0:
        narrative += "### 🔔 Pending Commitments\n"
        narrative += (
            f"Heads up: You have **{followup_count}** pending follow-up{'s' if followup_count > 1 else ''} "
            f"from the past week. Check the **Follow-Up Hunter** to resolve them.\n\n"
        )

    narrative += "---\n"
    narrative += "_That's your briefing. Have a productive and successful day!_ 🚀"

    # --- UI Enrichment: Inject structured data for BriefingCard ---
    import json
    
    # Prepare UI-friendly data structure
    ui_data = {
        "summary": calendar.get("summary", "No meetings today."),
        "stats": {
            "emails_analyzed": email.get("unread_count", 0),
            "important_emails": email.get("urgent_count", 0),
            "events_found": calendar.get("event_count", 0),
            "tasks_created": 0, # Placeholder for now
        },
        "important_emails": [
            {
                "subject": u["subject"],
                "sender": u["from"],
                "summary": u["snippet"],
                "priority": "Urgent"
            } for u in email.get("urgent", [])
        ],
        "agenda": [
            {
                "time": e["start"],
                "event": e["title"],
                "type": "Meeting"
            } for e in calendar.get("events_today", [])
        ]
    }
    
    # Append the hidden marker for the frontend to parse
    narrative += f"\n\n[BRIEFING_DATA:{json.dumps(ui_data)}]"
    
    return narrative


async def run_briefing_and_email(user_email: str, db) -> Dict[str, Any]:
    """
    Generate the briefing. Email delivery is currently disabled by user preference.
    Used by the scheduler and the manual-trigger route.
    """
    try:
        briefing = await generate_briefing(user_email, db)
        logger.info(f"briefing_agent: Briefing generated successfully for {user_email}")
        briefing["email_sent"] = False
    except Exception as e:
        logger.error(f"briefing_agent: Failed to generate briefing for {user_email}: {e}")
        briefing = {
            "email_sent": False, 
            "email_error": str(e),
            "narrative": "Failed to generate briefing.",
            "email": {},
            "calendar": {},
            "follow_ups": {}
        }

    return briefing


# ── APScheduler integration ────────────────────────────────────────────────


def init_briefing_scheduler(app_state=None):
    """
    Initialize APScheduler. Called once from main.py lifespan startup.
    Schedules a job that checks every minute if any user has a briefing due.
    """
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.add_job(
            _check_and_run_due_briefings,
            trigger="cron",
            minute="*",           # every minute - checks if any user's briefing time matches
            id="briefing_scheduler",
            replace_existing=True,
            misfire_grace_time=30,  # allow up to 30 s late before considering it missed
            coalesce=True,          # if several runs were missed, fire only once on catchup
            max_instances=1,        # never run two instances concurrently
        )
        scheduler.start()
        return scheduler
    except Exception as e:
        logger.warning(f"APScheduler init failed - briefing cron disabled: {e}")
        return None


async def _check_and_run_due_briefings():
    """
    Called every minute by the scheduler.
    Finds users who have briefing enabled and whose scheduled time matches 
    now in their respective local timezones.
    """
    from auth.database import SessionLocal
    from auth.models import User
    import pytz

    # Use UTC as the base for comparison
    now_utc = datetime.utcnow().replace(tzinfo=pytz.UTC)

    # Fetch all users with briefings enabled
    lookup_db = SessionLocal()
    due_emails = []
    try:
        active_briefing_users = lookup_db.query(User).filter(
            User.is_active == True,
            User.briefing_enabled == True
        ).all()

        for u in active_briefing_users:
            try:
                # Determine user's local time
                user_tz = pytz.timezone(u.timezone or "UTC")
                local_now = now_utc.astimezone(user_tz)
                local_hhmm = local_now.strftime("%H:%M")

                # Support multiple times (comma-separated)
                scheduled_times = [t.strip() for t in (u.briefing_time or "06:00").split(",") if t.strip()]
                
                if local_hhmm in scheduled_times:
                    due_emails.append(u.email)
            except Exception as tz_err:
                logger.error(f"Timezone/Schedule error for user {u.email}: {tz_err}")
                continue

    except Exception as e:
        logger.error(f"_check_and_run_due_briefings error: {e}")
        return
    finally:
        lookup_db.close()

    # Run each briefing with its own isolated session so one failure doesn't
    # poison the shared session for other users.
    for email in due_emails:
        logger.info(f"Running scheduled briefing for {email}")
        user_db = SessionLocal()
        try:
            await run_briefing_and_email(email, user_db)
        except Exception as e:
            logger.error(f"Scheduled briefing failed for {email}: {e}")
        finally:
            user_db.close()
