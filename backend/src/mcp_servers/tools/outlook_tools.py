from typing import Dict, Any, List, Optional
from loguru import logger
import httpx
from pydantic import BaseModel

class MSGraphService:
    """Service to interact with Microsoft Graph API"""
    
    BASE_URL = "https://graph.microsoft.com/v1.0"
    
    def __init__(self, user_email: str, db_session):
        self.user_email = user_email
        self.db = db_session
        self.token = self._get_access_token()
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        
    def _get_access_token(self) -> str:
        from auth.models import User
        from datetime import datetime, timedelta
        import os

        user = self.db.query(User).filter(User.email == self.user_email).first()
        if not user or not user.microsoft_access_token:
            raise Exception("Microsoft account not connected. Please connect via Settings.")

        try:
            from utils.token_encryption import token_encryption
            _enc = True
        except ImportError:
            _enc = False

        def _decrypt(val):
            return token_encryption.decrypt_token(val) if _enc else val

        def _encrypt(val):
            return token_encryption.encrypt_token(val) if _enc else val

        # If token is still valid (with 5-min buffer), use it directly
        if (user.microsoft_token_expires_at and
                user.microsoft_token_expires_at > datetime.utcnow() + timedelta(minutes=5)):
            return _decrypt(user.microsoft_access_token)

        # Token expired - attempt silent refresh via MSAL
        if not user.microsoft_refresh_token:
            raise Exception("Microsoft session expired. Please reconnect via Settings.")

        import msal
        CLIENT_ID = os.environ.get("AZURE_CLIENT_ID")
        CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET")
        TENANT_ID = os.environ.get("AZURE_TENANT_ID", "common")

        if not CLIENT_ID or not CLIENT_SECRET:
            raise Exception("Microsoft OAuth is not configured on this server.")

        app = msal.ConfidentialClientApplication(
            CLIENT_ID,
            authority=f"https://login.microsoftonline.com/{TENANT_ID}",
            client_credential=CLIENT_SECRET,
        )
        result = app.acquire_token_by_refresh_token(
            _decrypt(user.microsoft_refresh_token),
            scopes=["User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"],
        )

        if "error" in result:
            raise Exception(
                f"Microsoft token refresh failed: {result.get('error_description', result.get('error'))}. "
                "Please reconnect via Settings."
            )

        # Persist refreshed tokens
        user.microsoft_access_token = _encrypt(result["access_token"])
        if result.get("refresh_token"):
            user.microsoft_refresh_token = _encrypt(result["refresh_token"])
        user.microsoft_token_expires_at = datetime.utcnow() + timedelta(seconds=result.get("expires_in", 3600))
        self.db.commit()

        logger.info(f"Microsoft token refreshed for {self.user_email}")
        return result["access_token"]
            
    async def get(self, endpoint: str, params: dict = None) -> dict:
        url = f"{self.BASE_URL}/{endpoint}"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=self.headers, params=params)
            if resp.status_code >= 400:
                raise Exception(f"MS Graph Error ({resp.status_code}): {resp.text}")
            return resp.json()
            
    async def post(self, endpoint: str, json_data: dict = None) -> dict:
        url = f"{self.BASE_URL}/{endpoint}"
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=self.headers, json=json_data)
            if resp.status_code >= 400:
                raise Exception(f"MS Graph Error ({resp.status_code}): {resp.text}")
            # Some post endpoints (like sendMail) return 202 Accepted with no content
            return resp.json() if resp.content else {"status": "success"}
            
    async def patch(self, endpoint: str, json_data: dict = None) -> dict:
        url = f"{self.BASE_URL}/{endpoint}"
        async with httpx.AsyncClient() as client:
            resp = await client.patch(url, headers=self.headers, json=json_data)
            if resp.status_code >= 400:
                raise Exception(f"MS Graph Error ({resp.status_code}): {resp.text}")
            return resp.json()
            
    async def delete(self, endpoint: str) -> dict:
        url = f"{self.BASE_URL}/{endpoint}"
        async with httpx.AsyncClient() as client:
            resp = await client.delete(url, headers=self.headers)
            if resp.status_code >= 400:
                raise Exception(f"MS Graph Error ({resp.status_code}): {resp.text}")
            return {"status": "success"}

# Note: We don't use @mcp_tool decorators here directly. 
# We implement the handlers and register them dynamically or in mcp_tools.py to avoid duplicates.
# However, to keep it clean, we'll implement the logic here and then hook it up in mcp_tools.py.

async def ms_list_emails(user_email: str, db, max_results: int = 50, label_ids: list = None, query: str = None) -> dict:
    """Implementation of list_emails for Microsoft Graph"""
    svc = MSGraphService(user_email, db)
    
    # Map Gmail terminology to Outlook terminology
    folder_map = {
        "INBOX": "inbox",
        "SENT": "sentitems",
        "SPAM": "junkemail",
        "DRAFT": "drafts",
        "TRASH": "deleteditems"
    }
    
    folder = "messages" # default to all
    if label_ids and label_ids[0] in folder_map:
        folder = f"mailFolders/{folder_map[label_ids[0]]}/messages"
        
    params = {
        "$top": min(max_results, 50),
        "$select": "id,subject,sender,receivedDateTime,bodyPreview,isRead",
        "$orderby": "receivedDateTime desc"
    }
    
    # Basic query mapping (MS Graph uses OData $filter or $search)
    if query:
        # Very rudimentary mapping for common agent queries
        if "is:unread" in query.lower():
            params["$filter"] = "isRead eq false"
        # For more complex queries, $search is better but requires specific graph setup
        
    try:
        data = await svc.get(f"me/{folder}", params=params)
        
        emails = []
        for msg in data.get("value", []):
            sender = msg.get("sender", {}).get("emailAddress", {})
            sender_str = f"{sender.get('name', '')} <{sender.get('address', '')}>"
            
            emails.append({
                "id": msg.get("id"),
                "subject": msg.get("subject", "(No Subject)"),
                "from": sender_str,
                "snippet": msg.get("bodyPreview", ""),
                "date": msg.get("receivedDateTime"),
                "is_read": msg.get("isRead", True)
            })
            
        return {"emails": emails, "total": len(emails)}
    except Exception as e:
        logger.error(f"Error in ms_list_emails: {e}")
        return {"error": str(e)}

async def ms_get_email(user_email: str, db, message_id: str) -> dict:
    """Implementation of get_email for Microsoft Graph"""
    svc = MSGraphService(user_email, db)
    try:
        data = await svc.get(f"me/messages/{message_id}")
        
        sender = data.get("sender", {}).get("emailAddress", {})
        sender_str = f"{sender.get('name', '')} <{sender.get('address', '')}>"
        
        to_recipients = data.get("toRecipients", [])
        to_str = ", ".join([f"{r.get('emailAddress', {}).get('address', '')}" for r in to_recipients])
        
        body_content = data.get("body", {}).get("content", "")
        # Graph API usually returns HTML by default if the message was HTML
        
        return {
            "id": data.get("id"),
            "subject": data.get("subject", "(No Subject)"),
            "from": sender_str,
            "to": to_str,
            "date": data.get("receivedDateTime"),
            "body": body_content,
            "is_read": data.get("isRead", True)
        }
    except Exception as e:
        logger.error(f"Error in ms_get_email: {e}")
        return {"error": str(e)}

async def ms_send_email(user_email: str, db, to: str, subject: str, body: str, thread_id: str = None) -> dict:
    """Implementation of send_email for Microsoft Graph"""
    svc = MSGraphService(user_email, db)
    
    # Split "to" by comma if multiple recipients
    recipients = [
        {"emailAddress": {"address": email.strip()}}
        for email in to.split(",") if email.strip()
    ]
    
    message = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": "Text", # Standardizing to text for now
                "content": body
            },
            "toRecipients": recipients
        },
        "saveToSentItems": "true"
    }
    
    try:
        if thread_id:
            # Graph API replies use a different endpoint
            # POST /me/messages/{id}/reply
            reply_msg = {
                "message": {
                    "body": {
                        "contentType": "Text",
                        "content": body
                    }
                }
            }
            await svc.post(f"me/messages/{thread_id}/reply", reply_msg)
            return {"status": "success", "message": "Reply sent successfully"}
        else:
            await svc.post("me/sendMail", message)
            return {"status": "success", "message": "Email sent successfully"}
    except Exception as e:
        logger.error(f"Error in ms_send_email: {e}")
        return {"error": str(e)}

async def ms_delete_email(user_email: str, db, message_id: str) -> dict:
    """Implementation of delete_email for Microsoft Graph"""
    svc = MSGraphService(user_email, db)
    try:
        # Move to junk or delete (MS Graph uses delete to move to deleted items)
        await svc.delete(f"me/messages/{message_id}")
        return {"status": "success", "message": f"Message {message_id} moved to deleted items"}
    except Exception as e:
        logger.error(f"Error in ms_delete_email: {e}")
        return {"error": str(e)}
