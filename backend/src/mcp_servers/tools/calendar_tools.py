import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pytz
from fastapi import APIRouter
from pydantic import BaseModel

from mcp_servers.core.google_auth import GoogleAuthManager

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _to_rfc3339(value: str, end_of_day: bool = False) -> str:
    """Ensure a date/datetime string is in RFC3339 / ISO-8601 with timezone.

    Accepts:
      - '2026-04-14'                → '2026-04-14T00:00:00Z' (or T23:59:59Z if end_of_day=True)
      - '2026-04-14T10:00:00'       → '2026-04-14T10:00:00Z'
      - '2026-04-14T10:00:00Z'      → unchanged
      - '2026-04-14T10:00:00+05:30' → unchanged

    Use end_of_day=True for time_max so that a bare date like '2026-04-14'
    becomes '2026-04-14T23:59:59Z' (end of that day) rather than midnight,
    which would make timeMax == timeMin and cause a Google API 'Bad Request'.
    """
    if not value:
        return value
    v = value.strip()
    # Date-only: YYYY-MM-DD
    if len(v) == 10 and v[4] == '-' and v[7] == '-':
        suffix = "T23:59:59Z" if end_of_day else "T00:00:00Z"
        return v + suffix
    # Has a time component
    if 'T' in v:
        # Already has timezone offset (Z or ±HH:MM)
        if v.endswith('Z'):
            return v
        after_date = v[10:]
        if '+' in after_date or after_date.count('-') > 0:
            return v
        # No timezone - assume UTC
        return v + "Z"
    return v


# ── Request schemas ──────────────────────────────────────────────────────────

class EventListRequest(BaseModel):
    user_email: str
    time_min: Optional[str] = None
    time_max: Optional[str] = None
    max_results: int = 50
    calendar_id: str = "primary"


class AvailabilityRequest(BaseModel):
    user_email: str
    start_time: str
    end_time: str
    attendees: Optional[List[str]] = None
    calendar_id: str = "primary"


class CreateEventRequest(BaseModel):
    user_email: str
    summary: str
    description: str
    start_time: str
    end_time: str
    attendees: Optional[List[str]] = None
    location: Optional[str] = None
    calendar_id: str = "primary"


class DeleteEventRequest(BaseModel):
    user_email: str
    event_id: str
    calendar_id: str = "primary"


class UpdateEventRequest(BaseModel):
    user_email: str
    event_id: str
    summary: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    attendees: Optional[List[str]] = None
    location: Optional[str] = None
    calendar_id: str = "primary"


class SuggestTimesRequest(BaseModel):
    user_email: str
    start_date: str
    end_date: str
    duration_minutes: int = 60
    attendees: Optional[List[str]] = None
    max_suggestions: int = 5
    calendar_id: str = "primary"


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/list_events")
async def list_events(req: EventListRequest):
    service, timezone_str = await GoogleAuthManager.get_service_async(
        "calendar", "v3", req.user_email
    )

    # Normalise to RFC3339 - Google Calendar rejects bare dates or tz-naive datetimes.
    # time_max uses end_of_day=True so "2026-04-14" → T23:59:59Z, not T00:00:00Z.
    # If both were T00:00:00Z the API would reject the request (timeMax must be > timeMin).
    time_min = _to_rfc3339(req.time_min) if req.time_min else datetime.now(timezone.utc).isoformat()
    time_max = _to_rfc3339(req.time_max, end_of_day=True) if req.time_max else None

    params: Dict[str, Any] = {
        "calendarId": req.calendar_id,
        "maxResults": req.max_results,
        "singleEvents": True,
        "orderBy": "startTime",
        "timeMin": time_min,
    }
    if time_max:
        params["timeMax"] = time_max

    result = await asyncio.to_thread(service.events().list(**params).execute)
    events = result.get("items", [])

    def _extract_meet_link(e: dict) -> str:
        """Return the video join URL for an event, or empty string."""
        # Google Meet - fastest path
        if e.get("hangoutLink"):
            return e["hangoutLink"]
        # Generic conference entry points (Zoom, Teams, etc.)
        for ep in e.get("conferenceData", {}).get("entryPoints", []):
            if ep.get("entryPointType") == "video" and ep.get("uri"):
                return ep["uri"]
        # Fallback: scan location / description for a joinable URL
        for field in (e.get("location", ""), e.get("description", "")):
            if field:
                import re
                m = re.search(r'https?://[^\s<>"]+(?:meet\.google|zoom\.us/j|teams\.microsoft|webex|gotomeeting)[^\s<>"]*', field)
                if m:
                    return m.group(0)
        return ""

    try:
        display_tz = pytz.timezone(timezone_str or "UTC")
    except Exception:
        display_tz = pytz.UTC

    def _fmt(iso: str, tz) -> str:
        """Convert ISO datetime to the user's saved timezone and show its label."""
        if not iso:
            return iso
        try:
            if len(iso) == 10 and iso[4] == "-" and iso[7] == "-":
                dt = datetime.strptime(iso, "%Y-%m-%d")
                return dt.strftime("%a, %b %-d")
            normalized = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = pytz.UTC.localize(dt)
            local_dt = dt.astimezone(tz)
            tz_label = local_dt.tzname() or (timezone_str or "UTC")
            return local_dt.strftime("%a, %b %-d · %-I:%M %p") + f" {tz_label}"
        except Exception:
            return iso

    formatted = [
        {
            "id": e["id"],
            "summary": e.get("summary", "No Title"),
            "description": e.get("description", ""),
            "start": e["start"].get("dateTime", e["start"].get("date")),
            "end": e["end"].get("dateTime", e["end"].get("date")),
            "start_display": _fmt(e["start"].get("dateTime", e["start"].get("date", "")), display_tz),
            "end_display": _fmt(e["end"].get("dateTime", e["end"].get("date", "")), display_tz),
            "attendees": [a["email"] for a in e.get("attendees", [])],
            "status": e.get("status", "confirmed"),
            "location": e.get("location", ""),
            "htmlLink": e.get("htmlLink", ""),
            "meetLink": _extract_meet_link(e),
        }
        for e in events
    ]
    return {
        "events": formatted,
        "total": len(formatted),
        "nextPageToken": result.get("nextPageToken"),
    }


@router.post("/check_availability")
async def check_availability(req: AvailabilityRequest):
    service, _ = await GoogleAuthManager.get_service_async(
        "calendar", "v3", req.user_email
    )

    body: Dict[str, Any] = {
        "timeMin": _to_rfc3339(req.start_time),
        "timeMax": _to_rfc3339(req.end_time),
        "items": [{"id": req.calendar_id}],
    }
    if req.attendees:
        body["attendees"] = [{"email": e} for e in req.attendees]

    result = await asyncio.to_thread(service.freebusy().query(body=body).execute)
    busy = result.get("calendars", {}).get(req.calendar_id, {}).get("busy", [])

    return {
        "is_available": len(busy) == 0,
        "busy_periods": busy,
        "start_time": req.start_time,
        "end_time": req.end_time,
    }


@router.post("/create_event")
async def create_event(req: CreateEventRequest):
    service, timezone = await GoogleAuthManager.get_service_async(
        "calendar", "v3", req.user_email
    )

    try:
        user_tz = pytz.timezone(timezone)
        start_dt = datetime.fromisoformat(req.start_time).astimezone(user_tz)
        end_dt = datetime.fromisoformat(req.end_time).astimezone(user_tz)
    except Exception:
        start_dt = req.start_time  # type: ignore[assignment]
        end_dt = req.end_time  # type: ignore[assignment]

    event: Dict[str, Any] = {
        "summary": req.summary,
        "description": req.description,
        "start": {
            "dateTime": getattr(start_dt, "isoformat", lambda: start_dt)(),
            "timeZone": timezone,
        },
        "end": {
            "dateTime": getattr(end_dt, "isoformat", lambda: end_dt)(),
            "timeZone": timezone,
        },
        "conferenceData": {
            "createRequest": {
                "requestId": f"meet-{int(datetime.now().timestamp())}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }
    if req.attendees:
        event["attendees"] = [{"email": e} for e in req.attendees]
    if req.location:
        event["location"] = req.location

    created = await asyncio.to_thread(
        service.events().insert(
            calendarId=req.calendar_id,
            body=event,
            conferenceDataVersion=1,
            sendUpdates="all",
        ).execute
    )

    meet_link = next(
        (
            ep.get("uri")
            for ep in created.get("conferenceData", {}).get("entryPoints", [])
            if ep.get("entryPointType") == "video"
        ),
        None,
    )

    return {
        "success": True,
        "event_id": created["id"],
        "summary": created.get("summary", ""),
        "meet_link": meet_link,
        "start": created["start"].get("dateTime"),
        "end": created["end"].get("dateTime"),
    }


@router.patch("/update_event")
async def update_event(req: UpdateEventRequest):
    """Patch an existing calendar event with any subset of fields."""
    service, _ = await GoogleAuthManager.get_service_async(
        "calendar", "v3", req.user_email
    )
    patch_body: Dict[str, Any] = {}
    if req.summary is not None:
        patch_body["summary"] = req.summary
    if req.description is not None:
        patch_body["description"] = req.description
    if req.location is not None:
        patch_body["location"] = req.location
    if req.start_time is not None:
        patch_body["start"] = {"dateTime": req.start_time}
    if req.end_time is not None:
        patch_body["end"] = {"dateTime": req.end_time}
    if req.attendees is not None:
        patch_body["attendees"] = [{"email": e} for e in req.attendees]

    updated = await asyncio.to_thread(
        service.events().patch(
            calendarId=req.calendar_id,
            eventId=req.event_id,
            body=patch_body,
            sendUpdates="all",
        ).execute
    )
    return {
        "success": True,
        "event_id": updated["id"],
        "summary": updated.get("summary", ""),
        "start": updated["start"].get("dateTime"),
        "end": updated["end"].get("dateTime"),
    }


@router.post("/delete_event")
async def delete_event(req: DeleteEventRequest):
    service, _ = await GoogleAuthManager.get_service_async(
        "calendar", "v3", req.user_email
    )
    await asyncio.to_thread(
        service.events().delete(
            calendarId=req.calendar_id, eventId=req.event_id
        ).execute
    )
    return {"success": True, "message": "Event deleted successfully"}


@router.post("/suggest_times")
async def suggest_times(req: SuggestTimesRequest):
    service, _ = await GoogleAuthManager.get_service_async(
        "calendar", "v3", req.user_email
    )

    start_rfc = _to_rfc3339(req.start_date)
    end_rfc = _to_rfc3339(req.end_date)

    result = await asyncio.to_thread(
        service.events().list(
            calendarId=req.calendar_id,
            timeMin=start_rfc,
            timeMax=end_rfc,
            singleEvents=True,
            orderBy="startTime",
        ).execute
    )
    events = result.get("items", [])

    suggestions: List[Dict[str, str]] = []
    base = datetime.fromisoformat(start_rfc.replace("Z", "+00:00"))
    current = base.replace(hour=11, minute=0, second=0, microsecond=0)
    end = datetime.fromisoformat(end_rfc.replace("Z", "+00:00"))

    while len(suggestions) < req.max_suggestions and current < end:
        slot_start = current
        slot_end = current + timedelta(minutes=req.duration_minutes)

        if 11 <= slot_start.hour <= 18:
            available = True
            for e in events:
                ev_s = datetime.fromisoformat(
                    e["start"].get("dateTime", e["start"].get("date")).replace(
                        "Z", "+00:00"
                    )
                )
                ev_e = datetime.fromisoformat(
                    e["end"].get("dateTime", e["end"].get("date")).replace(
                        "Z", "+00:00"
                    )
                )
                if slot_start < ev_e and slot_end > ev_s:
                    available = False
                    break
            if available:
                suggestions.append(
                    {"start": slot_start.isoformat(), "end": slot_end.isoformat()}
                )

        current += timedelta(hours=1)

    return {"suggestions": suggestions, "total_suggestions": len(suggestions)}

@router.get("/reminder-updates")
async def get_reminder_updates(email: str):
    """Return calendar events starting within the next 30 minutes."""
    try:
        auth_manager = GoogleAuthManager()
        service = await auth_manager.get_service_async(email, "calendar", "v3")
        now = datetime.now(timezone.utc)
        window_end = now + timedelta(minutes=30)
        result = await asyncio.to_thread(
            lambda: service.events().list(
                calendarId="primary",
                timeMin=now.isoformat(),
                timeMax=window_end.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=50,
            ).execute()
        )
        reminders = []
        for event in result.get("items", []):
            start = event.get("start", {})
            reminders.append({
                "id": event.get("id"),
                "title": event.get("summary", "Untitled"),
                "start": start.get("dateTime") or start.get("date"),
                "meet_link": event.get("hangoutLink"),
            })
        return {"reminders": reminders}
    except Exception:
        return {"reminders": []}
