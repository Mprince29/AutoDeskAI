from loguru import logger
from .outlook_tools import MSGraphService

async def ms_list_events(user_email: str, db, time_min: str = None, time_max: str = None, max_results: int = 50) -> dict:
    """Implementation of list_events for Microsoft Graph"""
    svc = MSGraphService(user_email, db)
    
    params = {
        "$top": min(max_results, 50),
        "$select": "id,subject,start,end,location,attendees",
        "$orderby": "start/dateTime"
    }
    
    # MS Graph Calendar View requires start and end times to query a range
    # If not provided, we query the events endpoint directly which just lists ALL events
    endpoint = "me/events"
    
    if time_min and time_max:
        endpoint = "me/calendarView"
        params["startDateTime"] = time_min
        params["endDateTime"] = time_max
    elif time_min:
        # If only time_min is provided, we can use filtering on the events endpoint
        params["$filter"] = f"start/dateTime ge '{time_min}'"
        
    try:
        data = await svc.get(endpoint, params=params)
        
        events = []
        for evt in data.get("value", []):
            attendees = [
                a.get("emailAddress", {}).get("address") 
                for a in evt.get("attendees", [])
            ]
            
            events.append({
                "id": evt.get("id"),
                "summary": evt.get("subject", "(No Subject)"),
                "start": evt.get("start", {}).get("dateTime"),
                "end": evt.get("end", {}).get("dateTime"),
                "location": evt.get("location", {}).get("displayName", ""),
                "attendees": attendees,
                # MS Graph doesn't always provide a direct "Meet" link in the same way,
                # but it has onlineMeeting details if it's a Teams meeting
                "meet_link": evt.get("onlineMeeting", {}).get("joinUrl", "")
            })
            
        return {"events": events, "total": len(events)}
    except Exception as e:
        logger.error(f"Error in ms_list_events: {e}")
        return {"error": str(e)}

async def ms_create_event(
    user_email: str, db, summary: str, start_time: str, end_time: str,
    description: str = "", attendees: list = None, location: str = None
) -> dict:
    """Implementation of create_event for Microsoft Graph"""
    svc = MSGraphService(user_email, db)
    
    event = {
        "subject": summary,
        "body": {
            "contentType": "HTML",
            "content": description
        },
        "start": {
            "dateTime": start_time,
            "timeZone": "UTC" # Assuming UTC for simpler mapping, could map to user.timezone
        },
        "end": {
            "dateTime": end_time,
            "timeZone": "UTC"
        }
    }
    
    if location:
        event["location"] = {"displayName": location}
        
    if attendees:
        event["attendees"] = [
            {
                "emailAddress": {"address": email.strip()},
                "type": "required"
            }
            for email in attendees if email.strip()
        ]
        # Automatically make it an online meeting (Teams) if there are attendees
        event["isOnlineMeeting"] = True
        event["onlineMeetingProvider"] = "teamsForBusiness"
        
    try:
        data = await svc.post("me/events", event)
        # Handle the case where the post method returns just {"status": "success"} if no content
        event_id = data.get("id", "unknown_id")
        meet_link = data.get("onlineMeeting", {}).get("joinUrl", "")
        
        return {
            "status": "success",
            "event_id": event_id,
            "meet_link": meet_link,
            "message": f"Event '{summary}' created successfully."
        }
    except Exception as e:
        logger.error(f"Error in ms_create_event: {e}")
        return {"error": str(e)}

async def ms_delete_event(user_email: str, db, event_id: str) -> dict:
    """Implementation of delete_event for Microsoft Graph"""
    svc = MSGraphService(user_email, db)
    try:
        await svc.delete(f"me/events/{event_id}")
        return {"status": "success", "message": f"Event {event_id} deleted successfully"}
    except Exception as e:
        logger.error(f"Error in ms_delete_event: {e}")
        return {"error": str(e)}
