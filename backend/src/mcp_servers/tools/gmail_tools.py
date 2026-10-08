import asyncio
import base64
import io
import re
import time
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from googleapiclient.errors import HttpError
from loguru import logger
from pydantic import BaseModel

from mcp_servers.core.google_auth import GoogleAuthManager
from services.redis_service import cache_google_api
from services.exfiltration_validator import GLOBAL_EXFILTRATION_VALIDATOR
from utils.google_api_utils import execute_with_retry, execute_with_retry_async

router = APIRouter()


# ── Request schemas ──────────────────────────────────────────────────────────

class EmailRequest(BaseModel):
    user_email: str
    message_id: str


class ListEmailRequest(BaseModel):
    user_email: str
    max_results: int = 50
    label_ids: Optional[List[str]] = None
    query: Optional[str] = None
    page_token: Optional[str] = None


class SendEmailRequest(BaseModel):
    user_email: str
    to: str
    subject: str
    body: str
    thread_id: Optional[str] = None
    # List of Google Doc/Drive file IDs to attach as PDFs
    attachment_doc_ids: Optional[List[str]] = None
    # Internal marker used by the durable external-action ledger. It is not
    # exposed in the MCP schema and is absent for direct API sends.
    action_marker: Optional[str] = None


class ModifyLabelsRequest(BaseModel):
    user_email: str
    message_id: str
    add_labels: Optional[List[str]] = None
    remove_labels: Optional[List[str]] = None


class DraftRequest(BaseModel):
    user_email: str
    max_results: int = 50


class DraftIdRequest(BaseModel):
    user_email: str
    draft_id: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _extract_body(payload: Dict[str, Any]) -> str:
    def decode_b64(data: str) -> str:
        # Add padding if needed
        data += "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(data).decode("utf-8")

    body = ""
    if "body" in payload and payload["body"].get("data"):
        body = decode_b64(payload["body"]["data"])
    elif "parts" in payload:
        # Prioritize plain text
        for part in payload["parts"]:
            if part["mimeType"] == "text/plain" and "data" in part.get("body", {}):
                return decode_b64(part["body"]["data"])
        
        # Fallback to html if no plain text
        for part in payload["parts"]:
            if part["mimeType"] == "text/html" and "data" in part.get("body", {}):
                body = decode_b64(part["body"]["data"])
                break
            elif "parts" in part: # Recurse for nested parts (e.g. multipart/related)
                res = _extract_body(part)
                if res: return res

    # Strip HTML tags if it looks like HTML
    if body and ("<html" in body.lower() or "<div" in body.lower() or "<body" in body.lower()):
        # Simple regex to strip tags, more robust than before
        body = re.sub(r'<(script|style|title)[^>]*>.*?</\1>', '', body, flags=re.DOTALL | re.IGNORECASE)
        body = re.sub(r'<[^>]+>', ' ', body)
        # Clean up whitespace
        body = re.sub(r'\s+', ' ', body).strip()
        
    return body


async def _export_doc_as_pdf(user_email: str, file_id: str) -> tuple[bytes, str]:
    """Export a Google Doc/file from Drive as PDF bytes. Returns (pdf_bytes, filename)."""
    drive_svc, _ = await GoogleAuthManager.get_service_async("drive", "v3", user_email)

    def _fetch():
        # Get file metadata to build a good filename
        meta = execute_with_retry(drive_svc.files().get(fileId=file_id, fields="name,mimeType"))
        filename = meta.get("name", file_id)
        mime = meta.get("mimeType", "")

        if mime.startswith("application/vnd.google-apps"):
            # Native Google Doc/Sheet/Slide - export to PDF
            data = execute_with_retry(drive_svc.files().export(
                fileId=file_id, mimeType="application/pdf"
            ))
        else:
            # Binary file already in Drive (e.g. uploaded PDF) - download directly
            import googleapiclient.http as ghttp
            buf = io.BytesIO()
            req = drive_svc.files().get_media(fileId=file_id)
            downloader = ghttp.MediaIoBaseDownload(buf, req)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            data = buf.getvalue()

        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        return data, filename

    try:
        result = await asyncio.to_thread(_fetch)
        logger.info(f"Successfully exported file {file_id} as PDF ({len(result[0])} bytes)")
        return result
    except HttpError as error:
        logger.error(f"Google API Error exporting file {file_id}: {error}")
        raise
    except Exception as e:
        logger.error(f"Error exporting file {file_id} as PDF: {e}")
        raise


def _build_raw_message(
    to: str,
    subject: str,
    body: str,
    thread_id: Optional[str] = None,
    attachments: Optional[List[tuple[bytes, str]]] = None,
    action_marker: Optional[str] = None,
) -> str:
    """Build a base64url-encoded RFC 2822 message, optionally with PDF attachments.

    attachments: list of (pdf_bytes, filename) tuples
    """
    if attachments:
        msg = MIMEMultipart("mixed")
        alt = MIMEMultipart("alternative")
        clean_body = re.sub("<[^<]+?>", "", body)
        alt.attach(MIMEText(clean_body, "plain", "utf-8"))
        msg.attach(alt)
        for pdf_bytes, filename in attachments:
            part = MIMEApplication(pdf_bytes, _subtype="pdf")
            part.add_header("Content-Disposition", "attachment", filename=filename)
            msg.attach(part)
    else:
        msg = MIMEMultipart("alternative")
        clean_body = re.sub("<[^<]+?>", "", body)
        msg.attach(MIMEText(clean_body, "plain", "utf-8"))

    msg["to"] = to
    msg["subject"] = subject
    msg["date"] = formatdate(time.time(), localtime=True)
    if action_marker:
        msg["message-id"] = f"<autodeskai-{action_marker}@autodeskai.local>"
        msg["X-AutoDeskAI-Action"] = action_marker
    else:
        msg["message-id"] = f"<{int(time.time())}@gmail.com>"

    if thread_id:
        ref = f"<{thread_id}@gmail.com>"
        msg["References"] = ref
        msg["In-Reply-To"] = ref
        if not subject.lower().startswith("re:"):
            msg["subject"] = f"Re: {subject}"

    return base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/get_email")
async def get_email(req: EmailRequest):
    try:
        service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
        msg = await execute_with_retry_async(
            service.users().messages().get(
                userId="me", id=req.message_id, format="full"
            )
        )
    except Exception as e:
        logger.error(f"Gmail retrieval failed for {req.user_email}: {e}")
        return {"id": req.message_id, "error": str(e), "body": "Failed to retrieve email content. Please re-authenticate."}

    headers = msg["payload"]["headers"]
    return {
        "id": msg["id"],
        "threadId": msg["threadId"],
        "subject": next(
            (h["value"] for h in headers if h["name"].lower() == "subject"),
            "No Subject",
        ),
        "from": next(
            (h["value"] for h in headers if h["name"].lower() == "from"), "Unknown"
        ),
        "body": _extract_body(msg["payload"]),
    }


@router.post("/list_emails")
@cache_google_api(ttl_seconds=300)  # 5 minute persistent cache for O(1) retrieval
async def list_emails(req: ListEmailRequest):
    """List emails with concurrent metadata fetch and Redis caching."""
    try:
        service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    except Exception as e:
        from loguru import logger
        logger.error(f"Gmail authentication failed for {req.user_email}: {e}")
        return {"emails": [], "total": 0, "error": str(e)}

    api_params: Dict[str, Any] = {"userId": "me", "maxResults": req.max_results}
    if req.query:
        api_params["q"] = req.query
    if req.label_ids:
        api_params["labelIds"] = req.label_ids
    if req.page_token:
        api_params["pageToken"] = req.page_token

    results = await asyncio.wait_for(
        execute_with_retry_async(service.users().messages().list(**api_params)),
        timeout=15.0,
    )
    messages = results.get("messages", [])
    if not messages:
        return {"emails": [], "total": 0}

    # Use Gmail batch API to fetch all metadata in a single HTTP round-trip.
    # Batch requests bundle up to 100 sub-requests; far faster than sequential fetching.
    def _fetch_batch_metadata():
        results_map: Dict[str, Any] = {}
        failed_ids: List[str] = []

        def _callback(request_id, response, exception):
            if exception or not response:
                failed_ids.append(request_id)
                return
            headers = response.get("payload", {}).get("headers", [])
            results_map[request_id] = {
                "id": request_id,
                "threadId": response.get("threadId", ""),
                "labelIds": response.get("labelIds", []),
                "snippet": response.get("snippet", ""),
                "subject": next((h["value"] for h in headers if h["name"].lower() == "subject"), None),
                "from": next((h["value"] for h in headers if h["name"].lower() == "from"), None),
                "to": next((h["value"] for h in headers if h["name"].lower() == "to"), ""),
                "date": next((h["value"] for h in headers if h["name"].lower() == "date"), ""),
            }

        # Split into chunks of 100 (Gmail batch limit)
        chunk_size = 100
        for i in range(0, len(messages), chunk_size):
            chunk = messages[i:i + chunk_size]
            batch = service.new_batch_http_request(callback=_callback)
            for msg in chunk:
                batch.add(
                    service.users().messages().get(
                        userId="me",
                        id=msg["id"],
                        format="metadata",
                        metadataHeaders=["Subject", "From", "To", "Date"],
                    ),
                    request_id=msg["id"],
                )
            execute_with_retry(batch)

        # Retry failed messages individually (transient batch errors)
        for msg_id in failed_ids:
            try:
                resp = execute_with_retry(service.users().messages().get(
                    userId="me", id=msg_id, format="metadata",
                    metadataHeaders=["Subject", "From", "To", "Date"],
                ))
                headers = resp.get("payload", {}).get("headers", [])
                results_map[msg_id] = {
                    "id": msg_id,
                    "threadId": resp.get("threadId", ""),
                    "labelIds": resp.get("labelIds", []),
                    "snippet": resp.get("snippet", ""),
                    "subject": next((h["value"] for h in headers if h["name"].lower() == "subject"), None),
                    "from": next((h["value"] for h in headers if h["name"].lower() == "from"), None),
                    "to": next((h["value"] for h in headers if h["name"].lower() == "to"), ""),
                    "date": next((h["value"] for h in headers if h["name"].lower() == "date"), ""),
                }
            except Exception:
                pass  # leave missing → fallback below

        # Return in original order, substituting fallback for permanently failed requests
        results_list = []
        for msg in messages:
            entry = results_map.get(msg["id"])
            if entry:
                entry["subject"] = entry["subject"] or "(No Subject)"
                entry["from"] = entry["from"] or ""
            results_list.append(entry if entry else {
                "id": msg["id"], "threadId": msg.get("threadId", ""), "labelIds": [],
                "snippet": "", "subject": "(No Subject)", "from": "", "to": "", "date": "",
            })
        return results_list

    emails_data = await asyncio.to_thread(_fetch_batch_metadata)
    
    return {
        "emails": emails_data,
        "total": len(emails_data),
        "nextPageToken": results.get("nextPageToken"),
        "resultSizeEstimate": results.get("resultSizeEstimate", len(emails_data)),
    }


@router.post("/send_email")
async def send_email(req: SendEmailRequest):
    emails_to_check = [e.strip() for e in req.to.split(",")]
    if not GLOBAL_EXFILTRATION_VALIDATOR.validate_outbound_emails(emails_to_check):
        return {"success": False, "error": "Security Block: Unauthorized outbound domain requested for exfiltration."}

    # Export any attached Google Docs/Drive files to PDF
    attachments: List[tuple[bytes, str]] = []
    for doc_id in (req.attachment_doc_ids or []):
        try:
            pdf_bytes, filename = await _export_doc_as_pdf(req.user_email, doc_id)
            attachments.append((pdf_bytes, filename))
            logger.info(f"send_email: attached '{filename}' ({len(pdf_bytes)} bytes)")
        except Exception as e:
            logger.warning(f"send_email: failed to export doc {doc_id} as PDF: {e}")

    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    raw = _build_raw_message(
        req.to, req.subject, req.body, req.thread_id,
        attachments=attachments or None,
        action_marker=req.action_marker,
    )
    sent = await execute_with_retry_async(
        service.users().messages().send(userId="me", body={"raw": raw})
    )
    attached_count = len(attachments)
    return {
        "success": True,
        "messageId": sent["id"],
        "threadId": sent["threadId"],
        "attachments_sent": attached_count,
    }


async def find_email_by_action_marker(user_email: str, action_marker: str) -> Optional[Dict[str, str]]:
    """Find a previously accepted send without sending anything.

    Gmail indexes the RFC 2822 Message-ID, so the deterministic marker can be
    used to verify a provider-side send after a local timeout/cancellation.
    A missing result is deliberately inconclusive; callers must keep the
    action in ``unknown`` rather than retrying.
    """
    if not action_marker or not re.fullmatch(r"[0-9a-f]{32}", action_marker):
        raise ValueError("Invalid external-action marker")

    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", user_email)
    message_id = f"<autodeskai-{action_marker}@autodeskai.local>"
    results = await execute_with_retry_async(
        service.users().messages().list(
            userId="me",
            q=f"rfc822msgid:{message_id}",
            maxResults=1,
        )
    )
    messages = results.get("messages") or []
    if not messages:
        return None
    message = messages[0]
    return {
        "messageId": message["id"],
        "threadId": message.get("threadId", ""),
    }


@router.post("/create_draft")
async def create_draft(req: SendEmailRequest):
    emails_to_check = [e.strip() for e in req.to.split(",")]
    if not GLOBAL_EXFILTRATION_VALIDATOR.validate_outbound_emails(emails_to_check):
        return {"success": False, "error": "Security Block: Unauthorized outbound domain requested for exfiltration."}

    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    raw = _build_raw_message(req.to, req.subject, req.body)
    draft = await execute_with_retry_async(
        service.users().drafts().create(
            userId="me", body={"message": {"raw": raw}}
        )
    )
    return {"success": True, "draftId": draft["id"]}


@router.post("/get_drafts")
async def get_drafts(req: DraftRequest):
    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    results = await execute_with_retry_async(
        service.users().drafts().list(userId="me", maxResults=req.max_results)
    )
    drafts_list = results.get("drafts", [])
    if not drafts_list:
        return {"drafts": [], "total": 0}

    semaphore = asyncio.Semaphore(5)

    async def fetch_draft(draft_id: str) -> dict:
        async with semaphore:
            d = await execute_with_retry_async(
                service.users().drafts().get(
                    userId="me", id=draft_id, format="metadata"
                )
            )
            msg = d.get("message", {})
            headers = msg.get("payload", {}).get("headers", [])
            return {
                "id": d["id"],
                "messageId": msg.get("id", ""),
                "subject": next(
                    (h["value"] for h in headers if h["name"].lower() == "subject"),
                    "No Subject",
                ),
                "to": next(
                    (h["value"] for h in headers if h["name"].lower() == "to"), ""
                ),
                "snippet": msg.get("snippet", ""),
            }

    drafts = await asyncio.gather(
        *[fetch_draft(d["id"]) for d in drafts_list]
    )
    return {"drafts": list(drafts), "total": len(drafts)}


@router.post("/send_draft")
async def send_draft(req: DraftIdRequest):
    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    sent = await execute_with_retry_async(
        service.users().drafts().send(
            userId="me", body={"id": req.draft_id}
        )
    )
    return {"success": True, "messageId": sent.get("id"), "threadId": sent.get("threadId", "")}


@router.post("/delete_draft")
async def delete_draft(req: DraftIdRequest):
    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    await execute_with_retry_async(
        service.users().drafts().delete(userId="me", id=req.draft_id)
    )
    return {"success": True, "message": "Draft deleted successfully"}


@router.post("/delete_email")
async def delete_email(req: EmailRequest):
    """Permanently delete an email (bypasses Trash)."""
    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    await execute_with_retry_async(
        service.users().messages().delete(userId="me", id=req.message_id)
    )
    return {"success": True, "message": "Email permanently deleted"}


@router.post("/move_to_trash")
async def move_to_trash(req: EmailRequest):
    """Move an email to Trash (recoverable)."""
    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    await execute_with_retry_async(
        service.users().messages().trash(userId="me", id=req.message_id)
    )
    return {"success": True, "message": "Email moved to trash successfully"}


@router.post("/modify_labels")
async def modify_labels(req: ModifyLabelsRequest):
    service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", req.user_email)
    body: Dict[str, Any] = {}
    if req.add_labels:
        body["addLabelIds"] = req.add_labels
    if req.remove_labels:
        body["removeLabelIds"] = req.remove_labels

    modified = await execute_with_retry_async(
        service.users().messages().modify(
            userId="me", id=req.message_id, body=body
        )
    )
    return {"success": True, "labelIds": modified["labelIds"]}
