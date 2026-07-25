"""
Sales Intelligence Routes

Tracking:
  GET  /api/sales/track/open/{token}          — 1x1 pixel, logs open
  GET  /api/sales/track/click/{token}         — logs click, redirects to original URL

Contacts:
  GET  /api/sales/contacts                    — list all contacts
  POST /api/sales/contacts                    — create contact
  GET  /api/sales/contacts/{id}               — get contact + dossier
  PUT  /api/sales/contacts/{id}               — update contact
  DELETE /api/sales/contacts/{id}             — delete contact
  POST /api/sales/contacts/{id}/refresh       — run signal refresh
  GET  /api/sales/contacts/{id}/signals       — get signal history
  GET  /api/sales/contacts/{id}/next-action   — LLM next best action

Campaigns:
  GET  /api/sales/campaigns                   — list campaigns
  POST /api/sales/campaigns                   — create campaign
  GET  /api/sales/campaigns/{id}              — get campaign + analytics
  POST /api/sales/campaigns/{id}/send         — trigger bulk send
  GET  /api/sales/campaigns/{id}/recipients   — recipient-level tracking
"""
import asyncio
import base64
import json as _json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import csv
import io
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, RedirectResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, object_session
from loguru import logger

from auth.database import get_db
from auth.models import (
    SalesContact, SignalEvent, SalesCampaign, CampaignRecipient,
    SuppressedEmail, SequenceEnrollment, ObjectionLog, EscalationEvent,
    ReengagementEntry, OutreachMemory, IcpProfile, ProductKnowledgeBase, User,
)
from services.sales_intelligence import (
    refresh_contact_signals,
    compute_intent_score,
    get_next_best_action,
)
from services.lead_enrichment import (
    find_leads, find_leads_from_icp, enrich_contact, verify_email,
)
from services.research_dossier import generate_contact_dossier
from services.bulk_mailer import send_campaign, personalise, generate_personalized_opening
from utils.llm_router import agenerate, get_text
from mcp_servers.core.google_auth import GoogleAuthManager
from utils.activity_logger import record_activity

router = APIRouter()


def _guess_domain_from_company(company: str) -> Optional[str]:
    """
    Resolve a company name to its website domain.
    Waterfall: Clearbit Autocomplete (free) → SerpAPI Google search fallback.
    """
    if not company:
        return None
    import urllib.parse, urllib.request, json as _j

    # Clean company name — remove suffixes like Inc, LLC, Ltd that confuse autocomplete
    clean = re.sub(r"\b(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|group|holdings?)\b", "", company, flags=re.I).strip(" ,.")

    # 1. Clearbit Autocomplete (free, no key)
    for q_str in [clean, company]:
        try:
            q = urllib.parse.quote(q_str)
            url = f"https://autocomplete.clearbit.com/v1/companies/suggest?query={q}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                results = _j.loads(resp.read())
            if results and isinstance(results, list):
                # Try to find exact or close match, not just first result
                q_lower = q_str.lower()
                for r in results[:3]:
                    name = (r.get("name") or "").lower()
                    domain = r.get("domain")
                    if domain and (q_lower in name or name in q_lower):
                        return domain
                # Fall back to first result if no close match
                if results[0].get("domain"):
                    return results[0]["domain"]
        except Exception:
            pass

    # 2. SerpAPI fallback — search for official company website
    api_key = os.getenv("SERPAPI_API_KEY") or os.getenv("SERPAPI_KEY")
    if api_key:
        try:
            params = urllib.parse.urlencode({
                "engine": "google",
                "q": f"{company} official website",
                "api_key": api_key,
                "num": 3,
                "hl": "en",
                "gl": "us",
            })
            req = urllib.request.Request(
                f"https://serpapi.com/search.json?{params}",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = _j.loads(resp.read())
            for result in (data.get("organic_results") or [])[:3]:
                link = result.get("link", "")
                # Skip social media / directories
                skip = ("linkedin.com", "facebook.com", "twitter.com", "crunchbase.com",
                        "bloomberg.com", "zoominfo.com", "wikipedia.org", "glassdoor.com")
                if any(s in link for s in skip):
                    continue
                domain = re.sub(r"https?://(www\.)?", "", link).split("/")[0]
                if domain and "." in domain:
                    return domain
        except Exception:
            pass

    return None


async def _background_enrich(contact_id: int, user_email: str) -> None:
    """Run the full enrichment waterfall for a contact in the background after save."""
    from datetime import datetime, timezone
    from auth.database import SessionLocal
    from services.sales_intelligence import compute_intent_score
    db = SessionLocal()
    try:
        contact = db.query(SalesContact).filter_by(id=contact_id, user_email=user_email).first()
        if not contact:
            return
        contact.enrichment_status = "pending"
        db.commit()

        # Infer domain if missing — needed for PDL, Clearbit, email guessing
        domain = contact.domain
        if not domain and contact.company:
            domain = await asyncio.to_thread(_guess_domain_from_company, contact.company)
            if domain:
                contact.domain = domain
                db.commit()

        updates = await enrich_contact(
            contact_name=contact.contact_name,
            company=contact.company,
            domain=domain,
            contact_email=contact.contact_email,
            linkedin_url=contact.linkedin_url,
        )

        buying_signals = updates.pop("_buying_signals", [])
        # URL/headline fields: never overwrite a saved value with an empty string from enrichment
        _no_blank_overwrite = {"linkedin_url", "linkedin_headline", "company_logo", "domain"}
        for field, value in updates.items():
            if not hasattr(contact, field) or value is None:
                continue
            if field in _no_blank_overwrite and value == "" and getattr(contact, field):
                continue
            setattr(contact, field, value)
        contact.enriched_at = datetime.now(timezone.utc)

        existing_titles: set[str] = {
            (s.signal_metadata or {}).get("title", "").lower()[:60]
            for s in db.query(SignalEvent).filter_by(contact_id=contact_id).all()
        }
        for sig in buying_signals:
            title_key = sig.get("title", "").lower()[:60]
            if title_key and title_key in existing_titles:
                continue
            existing_titles.add(title_key)
            db.add(SignalEvent(
                contact_id=contact_id,
                user_email=user_email,
                signal_type=sig["type"],
                signal_metadata=sig,
            ))

        all_signals = db.query(SignalEvent).filter_by(contact_id=contact_id).all()
        open_count = sum(1 for s in all_signals if s.signal_type == "email_open")
        contact.intent_score = compute_intent_score(_score_inputs(all_signals), open_count)
        db.commit()
        logger.info(f"Auto-enriched contact {contact_id} ({contact.contact_name})")
    except Exception as e:
        logger.warning(f"Auto-enrich failed for contact {contact_id}: {e}")
        try:
            contact = db.query(SalesContact).filter_by(id=contact_id).first()
            if contact:
                contact.enrichment_status = "failed"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# 1x1 transparent GIF bytes
_PIXEL_GIF = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)

def _get_base_url() -> str:
    return os.getenv("BACKEND_URL") or os.getenv("BASE_URL") or "http://localhost:8000"


def _score_inputs(signals: list[SignalEvent]) -> list[dict]:
    """Preserve signal metadata so recency-weighted intent scoring can work."""
    return [
        {
            "type": s.signal_type,
            "metadata": s.signal_metadata or {},
        }
        for s in signals
    ]


# ── Timezone inference from location string ───────────────────────────────────
_LOCATION_TZ_MAP: list[tuple[str, str]] = [
    # (lowercase keyword, IANA timezone)
    ("new york", "America/New_York"), ("boston", "America/New_York"),
    ("washington", "America/New_York"), ("miami", "America/New_York"),
    ("atlanta", "America/New_York"), ("toronto", "America/Toronto"),
    ("montreal", "America/Toronto"), ("chicago", "America/Chicago"),
    ("houston", "America/Chicago"), ("dallas", "America/Chicago"),
    ("minneapolis", "America/Chicago"), ("denver", "America/Denver"),
    ("phoenix", "America/Phoenix"), ("los angeles", "America/Los_Angeles"),
    ("san francisco", "America/Los_Angeles"), ("seattle", "America/Los_Angeles"),
    ("vancouver", "America/Vancouver"), ("mexico city", "America/Mexico_City"),
    ("sao paulo", "America/Sao_Paulo"), ("buenos aires", "America/Argentina/Buenos_Aires"),
    ("london", "Europe/London"), ("dublin", "Europe/Dublin"),
    ("paris", "Europe/Paris"), ("amsterdam", "Europe/Amsterdam"),
    ("berlin", "Europe/Berlin"), ("frankfurt", "Europe/Berlin"),
    ("madrid", "Europe/Madrid"), ("rome", "Europe/Rome"),
    ("milan", "Europe/Rome"), ("stockholm", "Europe/Stockholm"),
    ("oslo", "Europe/Oslo"), ("copenhagen", "Europe/Copenhagen"),
    ("helsinki", "Europe/Helsinki"), ("warsaw", "Europe/Warsaw"),
    ("prague", "Europe/Prague"), ("vienna", "Europe/Vienna"),
    ("zurich", "Europe/Zurich"), ("moscow", "Europe/Moscow"),
    ("istanbul", "Europe/Istanbul"), ("dubai", "Asia/Dubai"),
    ("abu dhabi", "Asia/Dubai"), ("riyadh", "Asia/Riyadh"),
    ("mumbai", "Asia/Kolkata"), ("bangalore", "Asia/Kolkata"),
    ("delhi", "Asia/Kolkata"), ("hyderabad", "Asia/Kolkata"),
    ("kolkata", "Asia/Kolkata"), ("chennai", "Asia/Kolkata"),
    ("karachi", "Asia/Karachi"), ("lahore", "Asia/Karachi"),
    ("dhaka", "Asia/Dhaka"), ("colombo", "Asia/Colombo"),
    ("kathmandu", "Asia/Kathmandu"), ("bangkok", "Asia/Bangkok"),
    ("jakarta", "Asia/Jakarta"), ("singapore", "Asia/Singapore"),
    ("kuala lumpur", "Asia/Kuala_Lumpur"), ("ho chi minh", "Asia/Ho_Chi_Minh"),
    ("manila", "Asia/Manila"), ("hong kong", "Asia/Hong_Kong"),
    ("shenzhen", "Asia/Shanghai"), ("guangzhou", "Asia/Shanghai"),
    ("beijing", "Asia/Shanghai"), ("shanghai", "Asia/Shanghai"),
    ("taipei", "Asia/Taipei"), ("seoul", "Asia/Seoul"),
    ("tokyo", "Asia/Tokyo"), ("osaka", "Asia/Tokyo"),
    ("sydney", "Australia/Sydney"), ("melbourne", "Australia/Melbourne"),
    ("brisbane", "Australia/Brisbane"), ("perth", "Australia/Perth"),
    ("auckland", "Pacific/Auckland"), ("united states", "America/New_York"),
    ("usa", "America/New_York"), ("united kingdom", "Europe/London"),
    ("uk", "Europe/London"), ("india", "Asia/Kolkata"),
    ("australia", "Australia/Sydney"), ("canada", "America/Toronto"),
    ("germany", "Europe/Berlin"), ("france", "Europe/Paris"),
    ("japan", "Asia/Tokyo"), ("china", "Asia/Shanghai"),
    ("brazil", "America/Sao_Paulo"), ("russia", "Europe/Moscow"),
]


def _infer_timezone(location: Optional[str]) -> Optional[str]:
    """Infer an IANA timezone from a free-form location string."""
    if not location:
        return None
    loc = location.lower()
    for keyword, tz in _LOCATION_TZ_MAP:
        if keyword in loc:
            return tz
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Tracking endpoints — no auth required (called by email clients)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/track/open/{token}", include_in_schema=False)
async def track_open(token: str, db: Session = Depends(get_db)):
    """Serve a 1x1 transparent pixel and record an open event."""
    recipient = db.query(CampaignRecipient).filter_by(tracking_token=token).first()
    if recipient:
        now = datetime.now(timezone.utc)
        is_first_open = not recipient.first_opened_at
        recipient.open_count = (recipient.open_count or 0) + 1
        recipient.last_opened_at = now
        if is_first_open:
            recipient.first_opened_at = now

        # Only count unique opens toward campaign total (first open per recipient)
        campaign = db.query(SalesCampaign).filter_by(id=recipient.campaign_id).first()
        if campaign and is_first_open:
            campaign.open_count = (campaign.open_count or 0) + 1

        # Log signal event on the linked contact (if exists)
        contact = db.query(SalesContact).filter_by(
            user_email=recipient.user_email,
            contact_email=recipient.recipient_email,
        ).first()
        if contact:
            db.add(SignalEvent(
                contact_id=contact.id,
                user_email=recipient.user_email,
                signal_type="email_open",
                signal_metadata={
                    "campaign_id": recipient.campaign_id, 
                    "campaign_name": campaign.name if campaign else "Unknown",
                    "open_count": recipient.open_count
                },
            ))
            contact.last_signal_at = now

        db.commit()

    return Response(content=_PIXEL_GIF, media_type="image/gif", headers={
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
    })


@router.get("/track/click/{token}", include_in_schema=False)
async def track_click(token: str, u: Optional[str] = None, db: Session = Depends(get_db)):
    """Log a click event and redirect to the original URL."""
    original_url = "#"
    if u:
        try:
            # Strip any existing padding then re-add correct amount
            u_clean = u.rstrip("=")
            padding = (4 - len(u_clean) % 4) % 4
            original_url = base64.urlsafe_b64decode(u_clean + "=" * padding).decode()
        except Exception as e:
            logger.warning(f"Click tracking decode failed for token={token}: {e}")
            pass

    recipient = db.query(CampaignRecipient).filter_by(tracking_token=token).first()
    if recipient:
        now = datetime.now(timezone.utc)
        recipient.click_count = (recipient.click_count or 0) + 1
        if not recipient.first_clicked_at:
            recipient.first_clicked_at = now

        campaign = db.query(SalesCampaign).filter_by(id=recipient.campaign_id).first()
        if campaign:
            campaign.click_count = (campaign.click_count or 0) + 1

        contact = db.query(SalesContact).filter_by(
            user_email=recipient.user_email,
            contact_email=recipient.recipient_email,
        ).first()
        if contact:
            db.add(SignalEvent(
                contact_id=contact.id,
                user_email=recipient.user_email,
                signal_type="email_click",
                signal_metadata={
                    "url": original_url, 
                    "campaign_id": recipient.campaign_id,
                    "campaign_name": campaign.name if campaign else "Unknown"
                },
            ))
            contact.last_signal_at = now

        db.commit()

    return RedirectResponse(url=original_url, status_code=302)


@router.get("/unsubscribe/{token}", include_in_schema=False)
async def unsubscribe(token: str, db: Session = Depends(get_db)):
    """
    One-click unsubscribe. Token is either a campaign tracking_token (UUID)
    or a sequence token (seq_{enrollment_id}_{step}).
    Adds the recipient to the sender's suppression list and marks any active
    sequence enrollment as unsubscribed.
    """
    recipient_email: Optional[str] = None
    user_email: Optional[str] = None

    if token.startswith("seq_"):
        # Sequence token: seq_{enrollment_id}_{step_number}
        parts = token.split("_")
        if len(parts) >= 2:
            try:
                enrollment_id = int(parts[1])
                enrollment = db.query(SequenceEnrollment).filter_by(id=enrollment_id).first()
                if enrollment:
                    recipient_email = enrollment.recipient_email
                    user_email = enrollment.user_email
                    enrollment.status = "unsubscribed"
            except (ValueError, IndexError):
                pass
    else:
        recipient = db.query(CampaignRecipient).filter_by(tracking_token=token).first()
        if recipient:
            recipient_email = recipient.recipient_email
            user_email = recipient.user_email

    if recipient_email and user_email:
        # Upsert into suppression list
        existing = db.query(SuppressedEmail).filter_by(
            user_email=user_email, suppressed_email=recipient_email
        ).first()
        if not existing:
            db.add(SuppressedEmail(
                user_email=user_email,
                suppressed_email=recipient_email,
                reason="unsubscribe",
            ))
        # Stop any active sequence enrollments for this recipient
        db.query(SequenceEnrollment).filter_by(
            user_email=user_email,
            recipient_email=recipient_email,
            status="active",
        ).update({"status": "unsubscribed"})
        db.commit()
        logger.info(f"Unsubscribed {recipient_email} from {user_email}")

    # Serve a simple confirmation page
    html = (
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px;'>"
        "<h2>You've been unsubscribed.</h2>"
        "<p>You won't receive any more emails from this sender.</p>"
        "</body></html>"
    )
    return Response(content=html, media_type="text/html")


@router.get("/suppressed")
async def list_suppressed(email: str = Query(...), db: Session = Depends(get_db)):
    rows = db.query(SuppressedEmail).filter_by(user_email=email).order_by(SuppressedEmail.suppressed_at.desc()).all()
    return [{"email": r.suppressed_email, "reason": r.reason, "suppressed_at": r.suppressed_at.isoformat() if r.suppressed_at else None} for r in rows]


@router.delete("/suppressed/{suppressed_email}")
async def remove_suppression(suppressed_email: str, email: str = Query(...), db: Session = Depends(get_db)):
    row = db.query(SuppressedEmail).filter_by(user_email=email, suppressed_email=suppressed_email.lower()).first()
    if not row:
        raise HTTPException(404, "Not found in suppression list")
    db.delete(row)
    db.commit()
    return {"removed": suppressed_email}



# ─────────────────────────────────────────────────────────────────────────────
# Contacts
# ─────────────────────────────────────────────────────────────────────────────

class ContactCreate(BaseModel):
    contact_name: str
    contact_email: Optional[str] = None
    company: str
    role: Optional[str] = None
    domain: Optional[str] = None
    notes: Optional[str] = None
    list_tag: Optional[str] = None
    geo_tag: Optional[str] = None


class ContactUpdate(BaseModel):
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    company: Optional[str] = None
    role: Optional[str] = None
    domain: Optional[str] = None
    notes: Optional[str] = None
    lead_timezone: Optional[str] = None
    list_tag: Optional[str] = None
    geo_tag: Optional[str] = None


@router.get("/contacts")
async def list_contacts(
    email: str = Query(...),
    campaign_id: Optional[int] = Query(None),
    outreach_tag: Optional[str] = Query(None),
    product_key: Optional[str] = Query(None),
    list_tag: Optional[str] = Query(None),
    geo_tag: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(SalesContact).filter_by(user_email=email)

    if campaign_id is not None:
        sub = (
            db.query(CampaignRecipient.recipient_email)
            .filter(CampaignRecipient.campaign_id == campaign_id, CampaignRecipient.user_email == email)
            .scalar_subquery()
        )
        q = q.filter(SalesContact.contact_email.in_(sub))
    elif product_key:
        # Match contacts saved directly with this product_key OR emailed in a campaign with this product_key
        campaign_sub = (
            db.query(CampaignRecipient.recipient_email)
            .join(SalesCampaign, SalesCampaign.id == CampaignRecipient.campaign_id)
            .filter(SalesCampaign.user_email == email, SalesCampaign.product_key == product_key)
            .scalar_subquery()
        )
        from sqlalchemy import or_
        q = q.filter(
            or_(
                SalesContact.product_key == product_key,
                SalesContact.contact_email.in_(campaign_sub),
            )
        )
    elif outreach_tag:
        sub = (
            db.query(CampaignRecipient.recipient_email)
            .join(SalesCampaign, SalesCampaign.id == CampaignRecipient.campaign_id)
            .filter(SalesCampaign.user_email == email, SalesCampaign.outreach_tag == outreach_tag)
            .scalar_subquery()
        )
        q = q.filter(SalesContact.contact_email.in_(sub))

    if list_tag:
        q = q.filter(SalesContact.list_tag == list_tag)
    if geo_tag:
        q = q.filter(SalesContact.geo_tag == geo_tag)

    contacts = q.order_by(SalesContact.intent_score.desc()).all()
    return [_contact_dict(c) for c in contacts]


@router.get("/contacts/download")
async def download_contacts(
    email: str = Query(...),
    format: str = Query("csv", regex="^(csv|xlsx)$"),
    contact_ids: Optional[str] = Query(None),
    product_key: Optional[str] = Query(None),
    list_tag: Optional[str] = Query(None),
    geo_tag: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Download all saved leads as CSV or XLSX."""
    q = db.query(SalesContact).filter_by(user_email=email)
    if contact_ids:
        try:
            ids = [int(raw_id) for raw_id in contact_ids.split(",") if raw_id.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="contact_ids must be a comma-separated list of IDs")
        if ids:
            q = q.filter(SalesContact.id.in_(ids))
    if product_key:
        q = q.filter(SalesContact.product_key == product_key)
    if list_tag:
        q = q.filter(SalesContact.list_tag == list_tag)
    if geo_tag:
        q = q.filter(SalesContact.geo_tag == geo_tag)
    contacts = q.order_by(SalesContact.intent_score.desc()).all()

    COLUMNS = [
        ("Name", "contact_name"),
        ("Email", "contact_email"),
        ("Company", "company"),
        ("Role", "role"),
        ("Domain", "domain"),
        ("LinkedIn", "linkedin_url"),
        ("Company Size", "company_size"),
        ("Industry", "company_industry"),
        ("Location", "company_location"),
        ("Founded", "company_founded"),
        ("Tech Stack", "tech_stack"),
        ("Intent Score", "intent_score"),
        ("Email Verified", "email_verified"),
        ("Enrichment Status", "enrichment_status"),
        ("List Tag", "list_tag"),
        ("Geo Tag", "geo_tag"),
        ("Product Key", "product_key"),
        ("Notes", "notes"),
        ("Created At", "created_at"),
    ]

    def _val(c, attr):
        v = getattr(c, attr, None)
        if isinstance(v, list):
            return ", ".join(str(x) for x in v)
        if v is None:
            return ""
        return str(v)

    if format == "xlsx":
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill
        except ImportError:
            raise HTTPException(status_code=500, detail="openpyxl not installed; use format=csv")

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Leads"

        header_fill = PatternFill("solid", fgColor="4F46E5")
        header_font = Font(bold=True, color="FFFFFF")
        headers = [col[0] for col in COLUMNS]
        ws.append(headers)
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font

        for c in contacts:
            ws.append([_val(c, attr) for _, attr in COLUMNS])

        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = 20

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return Response(
            content=buf.read(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=leads.xlsx"},
        )

    # CSV
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([col[0] for col in COLUMNS])
    for c in contacts:
        writer.writerow([_val(c, attr) for _, attr in COLUMNS])
    buf.seek(0)
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),  # utf-8-sig adds BOM for Excel compat
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads.csv"},
    )


@router.get("/contacts/signals")
async def get_global_signals(
    email: str = Query(...), 
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db)
):
    """Get the most recent signals across all contacts for a specific user."""
    signals = db.query(SignalEvent).filter_by(user_email=email).order_by(
        SignalEvent.created_at.desc()
    ).limit(limit).all()
    
    # We need to link each signal back to its contact for the frontend to show names
    result = []
    for s in signals:
        contact = db.query(SalesContact).filter_by(id=s.contact_id, user_email=email).first()
        if contact:
            sig_data = _signal_dict(s)
            
            # Retroactively add campaign_name if missing but campaign_id exists
            if not sig_data["metadata"].get("campaign_name") and sig_data["metadata"].get("campaign_id"):
                camp = db.query(SalesCampaign).filter_by(id=sig_data["metadata"]["campaign_id"]).first()
                if camp:
                    sig_data["metadata"]["campaign_name"] = camp.name
            
            result.append({
                "signal": sig_data,
                "lead": _contact_dict(contact)
            })
    return result


@router.post("/contacts", status_code=201)
async def create_contact(
    body: ContactCreate,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    contact = SalesContact(
        user_email=email,
        contact_name=body.contact_name,
        contact_email=body.contact_email,
        company=body.company,
        role=body.role,
        domain=body.domain,
        notes=body.notes,
        list_tag=body.list_tag,
        geo_tag=body.geo_tag,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return _contact_dict(contact)


@router.post("/contacts/bulk-import", status_code=201)
async def bulk_import_contacts(
    file: UploadFile = File(...),
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Bulk import leads from a CSV or plain-text file.

    CSV columns (first row auto-detected as header if it contains text):
      contact_name, contact_email, company, role, domain

    Falls back to positional order: name, email, company, role, domain
    """
    content = await file.read()

    # Decode bytes
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    filename_lower = (file.filename or "").lower()

    rows: list[dict] = []

    # ── XLSX / Excel ────────────────────────────────────────────────────────
    if filename_lower.endswith((".xlsx", ".xls")):
        try:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(content))
            df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
            rows = df.fillna("").astype(str).to_dict(orient="records")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Could not parse Excel file: {e}")

    # ── CSV ─────────────────────────────────────────────────────────────────
    elif filename_lower.endswith(".csv") or "," in text[:500]:
        reader = csv.DictReader(io.StringIO(text))
        # Normalise header keys
        for row in reader:
            rows.append({k.strip().lower().replace(" ", "_"): v.strip() for k, v in row.items()})

        # If DictReader found no fieldnames (no header row), parse positionally
        if not rows or not any(rows[0].values()):
            rows = []
            for line in text.splitlines():
                parts = [p.strip() for p in line.split(",")]
                if not parts[0]:
                    continue
                rows.append({
                    "contact_name": parts[0] if len(parts) > 0 else "",
                    "contact_email": parts[1] if len(parts) > 1 else "",
                    "company": parts[2] if len(parts) > 2 else "",
                    "role": parts[3] if len(parts) > 3 else "",
                    "domain": parts[4] if len(parts) > 4 else "",
                })

    # ── Plain text / unknown — one person per line ───────────────────────────
    else:
        for line in text.splitlines():
            parts = [p.strip() for p in line.split(",")]
            if not parts[0]:
                continue
            rows.append({
                "contact_name": parts[0],
                "contact_email": parts[1] if len(parts) > 1 else "",
                "company": parts[2] if len(parts) > 2 else "",
                "role": parts[3] if len(parts) > 3 else "",
                "domain": parts[4] if len(parts) > 4 else "",
            })

    if not rows:
        raise HTTPException(status_code=422, detail="No data rows found in file.")

    # ── Column name aliases ─────────────────────────────────────────────────
    _ALIASES = {
        "name": "contact_name", "full_name": "contact_name", "fullname": "contact_name",
        "email": "contact_email", "email_address": "contact_email",
        "title": "role", "job_title": "role", "position": "role",
        "website": "domain", "url": "domain",
    }

    def _normalise(row: dict) -> dict:
        out = {}
        for k, v in row.items():
            key = _ALIASES.get(k, k)
            out[key] = v
        return out

    created = []
    skipped = 0
    for raw_row in rows:
        row = _normalise(raw_row)
        name = row.get("contact_name", "").strip()
        company = row.get("company", "").strip()
        if not name or not company:
            skipped += 1
            continue

        contact = SalesContact(
            user_email=email,
            contact_name=name,
            contact_email=row.get("contact_email", "").strip() or None,
            company=company,
            role=row.get("role", "").strip() or None,
            domain=row.get("domain", "").strip() or None,
            list_tag=row.get("list_tag", "").strip() or None,
            geo_tag=row.get("geo_tag", "").strip() or None,
        )
        db.add(contact)
        db.flush()  # get id without committing
        created.append(_contact_dict(contact))

    db.commit()
    logger.info(f"Bulk import: {len(created)} created, {skipped} skipped for {email}")
    return {"created": len(created), "skipped": skipped, "contacts": created}


@router.get("/contacts/{contact_id}")
async def get_contact(contact_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    contact = _get_contact_or_404(db, contact_id, email)
    signals = db.query(SignalEvent).filter_by(contact_id=contact_id).order_by(
        SignalEvent.created_at.desc()
    ).limit(20).all()
    result = _contact_dict(contact)
    result["signals"] = [_signal_dict(s) for s in signals]
    return result


@router.put("/contacts/{contact_id}")
async def update_contact(
    contact_id: int,
    body: ContactUpdate,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    contact = _get_contact_or_404(db, contact_id, email)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return _contact_dict(contact)


@router.delete("/contacts/{contact_id}", status_code=204)
async def delete_contact(
    contact_id: int, 
    request: Request,
    email: str = Query(...), 
    db: Session = Depends(get_db)
):
    contact = _get_contact_or_404(db, contact_id, email)
    name = contact.contact_name
    db.delete(contact)
    db.commit()
    record_activity(
        db, email, "delete_sales_contact",
        entity_type="sales_contact", entity_id=contact_id,
        details={"name": name},
        request=request
    )


@router.post("/contacts/bulk-delete")
async def bulk_delete_contacts(
    body: dict,
    request: Request,
    email: str = Query(...),
    db: Session = Depends(get_db)
):
    contact_ids = body.get("contact_ids", [])
    if not contact_ids:
        return {"deleted": 0}
    
    deleted_count = db.query(SalesContact).filter(
        SalesContact.user_email == email,
        SalesContact.id.in_(contact_ids)
    ).delete(synchronize_session=False)
    
    db.commit()
    record_activity(
        db, email, "bulk_delete_sales_contacts",
        entity_type="sales_contact",
        details={"count": deleted_count, "ids": contact_ids},
        request=request
    )
    return {"deleted": deleted_count}


@router.patch("/contacts/bulk-tag")
async def bulk_tag_contacts(
    body: dict,
    request: Request,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Set list_tag and/or geo_tag on multiple contacts at once. Pass null to clear a tag."""
    contact_ids = body.get("contact_ids", [])
    if not contact_ids:
        return {"updated": 0}

    updates: dict = {}
    if "list_tag" in body:
        updates["list_tag"] = body["list_tag"]  # None clears it
    if "geo_tag" in body:
        updates["geo_tag"] = body["geo_tag"]    # None clears it

    if not updates:
        return {"updated": 0}

    updated_count = (
        db.query(SalesContact)
        .filter(SalesContact.user_email == email, SalesContact.id.in_(contact_ids))
        .update(updates, synchronize_session=False)
    )
    db.commit()
    record_activity(
        db, email, "bulk_tag_sales_contacts",
        entity_type="sales_contact",
        details={"count": updated_count, "ids": contact_ids, **{k: v for k, v in updates.items()}},
        request=request,
    )
    return {"updated": updated_count}


@router.post("/contacts/{contact_id}/refresh")
async def refresh_signals(contact_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    """Collect fresh external signals for a contact and update their intent score."""
    contact = _get_contact_or_404(db, contact_id, email)

    signals = await refresh_contact_signals(contact.company, domain=contact.domain)

    # Build dedup keys from existing DB signals
    existing_signals = db.query(SignalEvent).filter_by(contact_id=contact.id).all()
    seen_urls: set[str] = {
        s.signal_metadata.get("url", "").split("?")[0]
        for s in existing_signals if s.signal_metadata and s.signal_metadata.get("url")
    }
    seen_titles: set[str] = {
        s.signal_metadata.get("title", "").lower()[:60]
        for s in existing_signals if s.signal_metadata and s.signal_metadata.get("title")
    }

    new_signals = []
    for sig in signals:
        url_key = sig.get("url", "").split("?")[0]
        title_key = sig.get("title", "").lower()[:60]
        # Skip if duplicate URL (strip query params) or near-identical title
        if (url_key and url_key in seen_urls) or (title_key and title_key in seen_titles):
            continue
        if url_key:
            seen_urls.add(url_key)
        if title_key:
            seen_titles.add(title_key)
        new_signals.append(sig)
        db.add(SignalEvent(
            contact_id=contact.id,
            user_email=email,
            signal_type=sig["type"],
            signal_metadata=sig,
        ))
    signals = new_signals

    # Recompute score using all signals ever collected
    all_signals = db.query(SignalEvent).filter_by(contact_id=contact_id).all()
    all_signal_dicts = _score_inputs(all_signals)
    open_count = sum(1 for s in all_signals if s.signal_type == "email_open")
    old_score = contact.intent_score
    contact.intent_score = compute_intent_score(all_signal_dicts, open_count)
    contact.last_signal_at = datetime.now(timezone.utc)
    db.commit()

    # Check high-intent escalation after score update
    if contact.intent_score != old_score:
        try:
            from services.escalation_service import check_and_escalate
            await check_and_escalate(contact, db, email)
        except Exception as esc_exc:
            logger.warning(f"Escalation check failed for contact {contact_id}: {esc_exc}")

    return {
        "new_signals": len(signals),
        "intent_score": contact.intent_score,
        "signals": signals,
    }


@router.get("/contacts/{contact_id}/signals")
async def get_signals(
    contact_id: int,
    email: str = Query(...),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    _get_contact_or_404(db, contact_id, email)
    signals = db.query(SignalEvent).filter_by(contact_id=contact_id).order_by(
        SignalEvent.created_at.desc()
    ).limit(limit).all()
    return [_signal_dict(s) for s in signals]


@router.get("/contacts/{contact_id}/next-action")
async def next_action(contact_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    """Get LLM-powered next best action recommendation for a contact."""
    contact = _get_contact_or_404(db, contact_id, email)

    all_signals = db.query(SignalEvent).filter_by(contact_id=contact_id).order_by(
        SignalEvent.created_at.desc()
    ).limit(20).all()

    open_count = sum(1 for s in all_signals if s.signal_type == "email_open")

    last_contact_days = None
    if contact.last_contacted_at:
        delta = datetime.now(timezone.utc) - contact.last_contacted_at
        last_contact_days = delta.days

    signal_dicts = [_signal_dict(s) for s in all_signals]

    # Recompute intent score fresh from current signals
    fresh_score = compute_intent_score(
        _score_inputs(all_signals), open_count
    )
    # Persist if it changed
    if fresh_score != contact.intent_score:
        contact.intent_score = fresh_score
        db.commit()

    recommendation = await get_next_best_action(
        contact_name=contact.contact_name,
        company=contact.company,
        intent_score=fresh_score,
        signals=signal_dicts,
        last_contact_days=last_contact_days,
        open_count=open_count,
    )

    return {
        "contact_id": contact_id,
        "intent_score": fresh_score,
        "recommendation": recommendation,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Hyper-personalized Email 1 generation
# ─────────────────────────────────────────────────────────────────────────────

class GenerateEmailRequest(BaseModel):
    product_name: str = ""          # e.g. "EBIC", "Retailio", "Enterprise AI"
    product_description: str = ""  # 1-2 sentence value prop
    sender_name: str = ""           # sales rep name
    sender_title: str = ""          # sales rep title
    cta: str = ""                   # call-to-action / Cal.com link override
    email_number: int = 1           # 1 = Email 1, 2 = Email 2 (follow-up)


@router.post("/contacts/{contact_id}/generate-email")
async def generate_outreach_email(
    contact_id: int,
    body: GenerateEmailRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Draft a fully personalized Email 1 for this contact.

    - Unique first sentence referencing a campaign they ran, client they serve,
      award they won, or a recent buying signal — never generic.
    - Pain-point value prop woven into the body, tied to their specific role/stage.
    - Subject line crafted around the same hook.
    - Returns subject + html_body + text_body + the hook used (for audit/logging).

    If the contact has no dossier yet, generates one on the fly first.
    """
    contact = _get_contact_or_404(db, contact_id, email)
    _user = db.query(User).filter(User.email == email).first()
    _user_id = _user.id if _user else None

    # ── 0. Resolve product context ────────────────────────────────────────────
    # Priority: ProductKnowledgeBase (by product_key) → IcpProfile → AutoDeskAI defaults
    product_key = (body.product_name or "").lower().replace(" ", "").replace(".", "")
    pkb = _load_product(product_key, email, db) if product_key else None

    if pkb:
        # Full product KB found — use it as the authoritative source
        product_name        = pkb["display_name"]
        product_description = body.product_description or pkb["product_description"] or ""
        sender_name         = body.sender_name or pkb["sender_name"] or ""
        sender_title        = body.sender_title or pkb["sender_title"] or ""
        cta_link            = body.cta or pkb["cal_link"] or ""
        pkb_pain_points     = pkb["pain_points"] or []
        pkb_social_proof    = pkb["social_proof"] or []
        pkb_video_link      = pkb.get("video_link") or ""
        pkb_deck_link       = pkb.get("deck_link") or ""
        email_tpl = pkb["email2_template"] if body.email_number == 2 else pkb["email1_template"]
        email_tpl = email_tpl or ""
        # Inject video/deck links into template placeholders if present
        if email_tpl:
            email_tpl = email_tpl.replace(
                "{{VideoLink}}", f': <a href="{pkb_video_link}">{pkb_video_link}</a>' if pkb_video_link else ""
            ).replace(
                "{{DeckLink}}", f': <a href="{pkb_deck_link}">{pkb_deck_link}</a>' if pkb_deck_link else ""
            )
    else:
        # Fall back to ICP profile or AutoDeskAI defaults
        icp = db.query(IcpProfile).filter_by(user_email=email).first()
        icp_defaults = _icp_dict(icp) if icp else _M37_DEFAULT_ICP
        product_name        = body.product_name or icp_defaults.get("product_name", "")
        product_description = body.product_description or icp_defaults.get("product_description", "")
        sender_name         = body.sender_name or icp_defaults.get("sender_name", "")
        sender_title        = body.sender_title or icp_defaults.get("sender_title", "")
        cta_link            = body.cta or icp_defaults.get("cal_link", "")
        pkb_pain_points     = []
        pkb_social_proof    = []
        email_tpl = icp_defaults.get("email2_template", "") if body.email_number == 2 \
                    else icp_defaults.get("email1_template", "")

    # ── 1. Ensure dossier exists ──────────────────────────────────────────────
    dossier = contact.dossier or {}
    if not dossier.get("pain_points"):
        signals = db.query(SignalEvent).filter_by(contact_id=contact_id).order_by(
            SignalEvent.created_at.desc()
        ).limit(10).all()
        signal_dicts = [_signal_dict(s) for s in signals]
        try:
            dossier = await generate_contact_dossier(
                contact_name=contact.contact_name,
                role=contact.role or "",
                company=contact.company,
                domain=contact.domain,
                linkedin_url=contact.linkedin_url,
                company_size=contact.company_size,
                industry=contact.company_industry,
                location=contact.company_location,
                description=contact.company_description,
                tech_stack=contact.tech_stack or [],
                signals=signal_dicts,
                user_id=_user_id,
                db=db,
            )
            contact.dossier = dossier
            db.commit()
        except Exception as exc:
            logger.warning(f"Dossier generation failed for contact {contact_id}: {exc}")

    # ── 2. Generate unique opening sentence ───────────────────────────────────
    opening = await generate_personalized_opening(
        contact_dossier=dossier,
        recipient_name=contact.contact_name,
        company=contact.company,
        role=contact.role or "",
        user_id=_user_id,
        db=db,
    )

    # Identify which hook was used for transparency
    hook_source = "fallback"
    if dossier.get("recent_campaigns"):
        hook_source = "recent_campaign"
    elif dossier.get("notable_clients"):
        hook_source = "notable_client"
    elif dossier.get("awards"):
        hook_source = "award"
    elif dossier.get("icebreakers"):
        hook_source = "icebreaker"
    elif dossier.get("buying_signals"):
        hook_source = "buying_signal"

    # ── 3. Build email body ───────────────────────────────────────────────────
    first_name   = contact.contact_name.split()[0]
    pain_points  = dossier.get("pain_points") or []
    comp_context = dossier.get("competitive_context") or ""
    overview     = dossier.get("company_overview") or ""

    if email_tpl:
        # ── Path A: PKB template exists — substitute directly, never pass to LLM ──
        # Build all variable values up front so every placeholder is replaced.
        variables = {
            "FirstName":        first_name,
            "Personalisation":  opening,
            "CalLink":          cta_link or "cal.com/info-example",
            "SenderName":       (
                f"{sender_name}, {sender_title}" if sender_name and sender_title
                else sender_name or sender_title or ""
            ),
            # Strip {{VideoLink}} and {{DeckLink}} cleanly — replace with empty string
            # so "video here{{VideoLink}}." becomes "video here." not "video here{{}}."
            "VideoLink":        "",
            "DeckLink":         "",
        }

        # Replace placeholders — both {{Key}} and {{ Key }} variants
        text_body = email_tpl
        for key, value in variables.items():
            text_body = text_body.replace(f"{{{{{key}}}}}", value)
            text_body = text_body.replace(f"{{{{ {key} }}}}", value)

        # Clean up "here." artifacts from empty VideoLink/DeckLink
        # e.g. "overview video here.\n\n" stays clean
        import re as _re
        text_body = _re.sub(r" here\s*\.\s*\n", " here.\n", text_body)

        # Generate subject with LLM only (short, cheap call)
        subject_prompt = (
            f"Write a subject line for a cold email to {first_name} at {contact.company}.\n\n"
            f"Opening hook: {opening}\n"
            f"Pain point: {pain_points[0] if pain_points else ''}\n"
            f"Product: {product_name or 'our solution'}\n\n"
            "Rules:\n"
            "- Under 7 words\n"
            "- Sounds like a human typed it — specific, not corporate\n"
            "- No emoji, no 'Quick question', no 'Following up', no 'Checking in'\n"
            "Return ONLY the subject line text."
        )
        try:
            subject_resp = await agenerate(
                role="validator",
                messages=[{"role": "user", "content": subject_prompt}],
                temperature=0.5,
                max_tokens=30,
                user_id=_user_id,
                db=db,
            )
            subject = get_text(subject_resp).strip().strip('"').strip("'")
        except Exception:
            subject = f"Quick question, {first_name}"

    else:
        # ── Path B: No template — LLM writes the full email body ─────────────
        pain_str = "\n".join(f"- {p}" for p in pain_points[:2]) if pain_points else "scaling efficiently"
        product_pain_block = (
            "\nProblems this solves:\n" + "\n".join(f"- {p}" for p in pkb_pain_points[:2])
            if pkb_pain_points else ""
        )
        social_proof_block = (
            "\nResults we've seen:\n" + "\n".join(f"- {s}" for s in pkb_social_proof[:2])
            if pkb_social_proof else ""
        )
        email_label = "follow-up email" if body.email_number > 1 else "first cold email"
        email_prompt = (
            f"Write a {email_label} FROM a real human to {first_name} at {contact.company}.\n\n"
            f"TONE: Conversational and direct. Like something a thoughtful person dashed off "
            f"in 5 minutes — not a polished marketing email. Short sentences. No buzzwords.\n\n"
            f"BANNED WORDS / PHRASES: 'leverage', 'synergy', 'innovative', 'cutting-edge', "
            f"'game-changer', 'transformative', 'hope this finds you well', 'I wanted to reach out', "
            f"'excited to connect', 'passionate', 'world-class', 'best-in-class', 'seamlessly'.\n\n"
            f"STRUCTURE:\n"
            f"1. Start with: Hi {first_name},\n\n"
            f"   Then this specific opening (use it verbatim, it's already personalised): {opening}\n\n"
            f"2. One short paragraph (2-3 sentences) on the problem you think they have — "
            f"no hype, just what you observed. Pain: {pain_str}\n\n"
            f"3. One short paragraph on what {product_name or 'we'} does about it. "
            f"Plain language. {product_description}{product_pain_block}{social_proof_block}\n\n"
            f"4. A single CTA sentence — invite them to a quick call, link: {cta_link or 'cal.com'}. "
            f"Don't oversell it, just offer the option.\n\n"
            f"5. Sign off: Best,\n{sender_name or 'the team'}\n\n"
            f"PROSPECT CONTEXT: {first_name}, {contact.role or 'leader'} at {contact.company}. "
            f"Overview: {overview}\n\n"
            f"Write ONLY the email body. Plain text, no markdown, no subject line."
        )
        subject_prompt = (
            f"Write a subject line for a cold email to {first_name} at {contact.company}.\n"
            f"Hook: {opening}\n"
            f"Pain: {pain_points[0] if pain_points else ''}\n"
            f"Product: {product_name or 'our solution'}\n\n"
            "Rules: Under 7 words. Conversational — sounds like a human wrote it. "
            "No generic phrases like 'Quick question' or 'Following up'. No emoji. "
            "Return ONLY the subject line text."
        )
        try:
            email_resp, subject_resp = await asyncio.gather(
                agenerate(
                    role="drafter",
                    messages=[{"role": "user", "content": email_prompt}],
                    temperature=0.7,
                    max_tokens=600,
                    user_id=_user_id,
                    db=db,
                ),
                agenerate(
                    role="validator",
                    messages=[{"role": "user", "content": subject_prompt}],
                    temperature=0.5,
                    max_tokens=30,
                    user_id=_user_id,
                    db=db,
                ),
            )
            text_body = get_text(email_resp).strip()
            subject   = get_text(subject_resp).strip().strip('"').strip("'")
        except Exception as exc:
            logger.error(f"Email generation LLM failed for contact {contact_id}: {exc}")
            raise HTTPException(status_code=500, detail="Email generation failed. Please try again.")

    # ── 4. Render as clean HTML ───────────────────────────────────────────────
    def _text_to_html(text: str) -> str:
        lines = text.split("\n")
        parts: list[str] = []
        in_list = False
        for line in lines:
            s = line.strip()
            if not s:
                if in_list:
                    parts.append("</ul>")
                    in_list = False
                continue
            if s.startswith("•") or (s.startswith("-") and len(s) > 2):
                if not in_list:
                    parts.append('<ul style="margin:8px 0;padding-left:20px;">')
                    in_list = True
                parts.append(f'<li style="margin-bottom:4px;">{s.lstrip("•- ").strip()}</li>')
            else:
                if in_list:
                    parts.append("</ul>")
                    in_list = False
                parts.append(f'<p style="margin:0 0 14px;">{s}</p>')
        if in_list:
            parts.append("</ul>")
        return "\n".join(parts)

    html_body = (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;'
        'line-height:1.7;color:#1a1a1a;max-width:600px;padding:0;">\n'
        + _text_to_html(text_body)
        + "\n</div>"
    )

    return {
        "contact_id": contact_id,
        "contact_name": contact.contact_name,
        "company": contact.company,
        "email_number": body.email_number,
        "subject": subject,
        "text_body": text_body,
        "html_body": html_body,
        "opening_sentence": opening,
        "hook_source": hook_source,
        "pain_points_used": pain_points[:2],
        "dossier_confidence": dossier.get("confidence", "low"),
        "cal_link": cta_link,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ICP Profile — persistent Ideal Customer Profile per user
# ─────────────────────────────────────────────────────────────────────────────

# AutoDeskAI default ICP — pre-loaded when no profile exists yet
_M37_DEFAULT_ICP = {
    "job_titles": [
        "CTO", "CIO", "CDO",
        "VP of Technology", "SVP of Technology", "Director of Technology",
        "VP of Operations", "SVP of Operations",
        "Head of Digital", "Head of Digital Transformation",
    ],
    "seniority_levels": ["c_suite", "vp", "director"],
    "industries": [],
    "company_sizes": ["201-500", "501-1000", "1001-5000"],
    "revenue_min_m": 20,
    "revenue_max_m": 200,
    "locations": ["India", "USA", "UK", "Europe"],
    "keywords": [
        "AI transformation", "digital transformation", "AI strategy",
        "machine learning", "enterprise AI", "AI pilot",
    ],
    "persona_description": (
        "VP/SVP/Director of Technology, VP of Operations, Head of Digital, CTO, CIO, or CDO "
        "at a mid-market company ($20M–$200M revenue, 150–2000 employees). "
        "They own the AI/digital transformation mandate but lack an internal ML team to execute it. "
        "Has survived at least one failed or stalled AI pilot — skeptical of vendor overpromise. "
        "Reports to a CEO or board now actively asking 'where is our AI strategy?' "
        "Measured on operational KPIs — efficiency, throughput, cost-per-unit."
    ),
    "product_name": "your-org AI Innovation Lab",
    "product_description": (
        "your-org operates as a dedicated AI Innovation Lab embedded within your organisation — "
        "we design, validate, and scale AI until it becomes a permanent internal capability. "
        "AI stops being a cost center and becomes a compounding growth advantage."
    ),
    "sender_name": "",
    "sender_title": "",
    "cal_link": "cal.com/info-example/ai-innovation-lab",
    "email1_template": (
        "Hi {{FirstName}},\n\n"
        "{{Personalisation}}\n\n"
        "Most CTOs are sitting on 10+ AI pilots that never scaled. The problem isn't the technology "
        "— it's that no one inside the org is accountable for turning AI experiments into revenue.\n\n"
        "An embedded model changes that.\n\n"
        "your-org operates as a dedicated AI Innovation Lab within your organisation. We work alongside "
        "your teams to design, validate, and scale AI until it becomes a permanent internal capability.\n\n"
        "AI stops being a cost center and becomes a compounding growth advantage your competitors can't replicate.\n\n"
        "Watch our AI Innovation Lab video here\n\n"
        "If you think this is worth a 30-min call, book your call with us at {{CalLink}}\n\n"
        "Best,\n{{SenderName}}"
    ),
    "email2_template": (
        "Hi {{FirstName}},\n\n"
        "Following up on my note from earlier this week.\n\n"
        "One pattern we see across enterprises: AI initiatives are owned by IT, but the KPIs live "
        "in the business — in revenue, operations, customer experience. That disconnect is usually "
        "why the pilots stall.\n\n"
        "When AI is embedded closer to where outcomes are measured — with clear ownership and "
        "accountability — the math changes quickly. Projects that sat in review for months start "
        "shipping in weeks. And instead of isolated wins, you start building a capability that's permanent.\n\n"
        "If that tension sounds familiar, it's probably worth a conversation.\n\n"
        "30 minutes — book here: {{CalLink}}\n\n"
        "Best,\n{{SenderName}}"
    ),
}


class IcpProfileUpdate(BaseModel):
    job_titles: Optional[list[str]] = None
    seniority_levels: Optional[list[str]] = None
    industries: Optional[list[str]] = None
    company_sizes: Optional[list[str]] = None
    revenue_min_m: Optional[int] = None
    revenue_max_m: Optional[int] = None
    locations: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    persona_description: Optional[str] = None
    product_name: Optional[str] = None
    product_description: Optional[str] = None
    sender_name: Optional[str] = None
    sender_title: Optional[str] = None
    cal_link: Optional[str] = None
    email1_template: Optional[str] = None
    email2_template: Optional[str] = None


def _icp_dict(icp: IcpProfile) -> dict:
    return {
        "job_titles": icp.job_titles or [],
        "seniority_levels": icp.seniority_levels or [],
        "industries": icp.industries or [],
        "company_sizes": icp.company_sizes or [],
        "revenue_min_m": icp.revenue_min_m,
        "revenue_max_m": icp.revenue_max_m,
        "locations": icp.locations or [],
        "keywords": icp.keywords or [],
        "persona_description": icp.persona_description,
        "product_name": icp.product_name,
        "product_description": icp.product_description,
        "sender_name": icp.sender_name,
        "sender_title": icp.sender_title,
        "cal_link": icp.cal_link,
        "email1_template": icp.email1_template,
        "email2_template": icp.email2_template,
        "updated_at": icp.updated_at.isoformat() if icp.updated_at else None,
    }


@router.get("/icp")
async def get_icp(email: str = Query(...), db: Session = Depends(get_db)):
    """Return the user's ICP profile. Returns AutoDeskAI defaults if none saved yet."""
    icp = db.query(IcpProfile).filter_by(user_email=email).first()
    if not icp:
        return {**_M37_DEFAULT_ICP, "updated_at": None}
    return _icp_dict(icp)


@router.put("/icp")
async def upsert_icp(
    body: IcpProfileUpdate,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Create or update the ICP profile. Only supplied fields are overwritten."""
    icp = db.query(IcpProfile).filter_by(user_email=email).first()
    if not icp:
        # Seed from defaults first, then apply overrides
        icp = IcpProfile(user_email=email, **{
            k: v for k, v in _M37_DEFAULT_ICP.items()
            if hasattr(IcpProfile, k)
        })
        db.add(icp)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(icp, field, value)

    db.commit()
    db.refresh(icp)
    return _icp_dict(icp)


@router.post("/icp/reset")
async def reset_icp(email: str = Query(...), db: Session = Depends(get_db)):
    """Wipe the saved ICP and revert to AutoDeskAI defaults."""
    db.query(IcpProfile).filter_by(user_email=email).delete()
    db.commit()
    return {**_M37_DEFAULT_ICP, "updated_at": None}


# ─────────────────────────────────────────────────────────────────────────────
# Product Knowledge Base — per-product outreach profiles
# ─────────────────────────────────────────────────────────────────────────────

# System-level seed data. Loaded into DB on first request if not present.
_SYSTEM_PRODUCTS: dict[str, dict] = {
    "ebic": {
        "display_name": "EBIC.AI",
        "icp_job_titles": [
            "CEO", "Managing Director", "Head of Strategy", "Head of Technology",
            "CCO", "CMO", "Chief Strategy Officer", "VP Communications",
            "VP Comms", "Chief Communications Officer",
        ],
        "icp_seniority_levels": ["c_suite", "vp", "director"],
        "icp_industries": [
            "Public Relations", "Communications", "Marketing & Advertising",
            "BFSI", "FMCG", "Technology", "Healthcare", "Retail", "Energy",
        ],
        "icp_company_sizes": ["51-200", "201-500", "501-1000", "1001-5000"],
        "icp_locations": ["India", "USA", "UK", "Europe", "Middle East", "Southeast Asia"],
        "icp_keywords": [
            "PR agency", "communications agency", "brand monitoring", "media intelligence",
            "reputation management", "crisis communications", "Meltwater", "Cision",
            "in-house comms", "corporate communications",
        ],
        "icp_segments": [
            {
                "name": "Primary Segment A — Mid-to-Large PR & Comms Agencies",
                "description": "200–2,000 staff managing multiple brand clients across 2+ geographies. "
                               "Revenue $5M–$200M. Currently using 3–6 disconnected tools (Meltwater, Cision, etc.). "
                               "Pain: manual monitoring, delayed crisis alerts, disjointed workflows.",
                "decision_makers": ["CEO", "Managing Director", "Head of Strategy", "Head of Technology"],
            },
            {
                "name": "Primary Segment B — Enterprise Corporate Communications Teams",
                "description": "In-house comms/PR departments of $500M+ revenue companies across BFSI, FMCG, Tech, "
                               "Healthcare, Retail, Energy. C-suite demanding real-time reputation dashboards. "
                               "Pain: no unified intelligence layer; slow response in reputational crises.",
                "decision_makers": ["CCO", "CMO", "Chief Strategy Officer", "VP Comms"],
                "budget_approvers": ["CFO", "CEO"],
            },
            {
                "name": "Secondary Segment — Boutique High-Growth Agencies",
                "description": "50–200 staff, growing rapidly, seeking enterprise-grade tools to win larger mandates. "
                               "Founder-led, faster buying decisions. Price-sensitive but ROI-driven.",
                "decision_makers": ["Founder", "CEO", "Managing Director"],
            },
            {
                "name": "Emerging Segment — Global Comms Consulting Firms",
                "description": "Strategy + communications hybrid firms (Edelman, Weber type) seeking AI-differentiated "
                               "service offerings. Potential white-label or embedded platform model. ACV $100K+.",
                "decision_makers": ["CEO", "Managing Director", "Chief Strategy Officer"],
            },
        ],
        "icp_persona_description": (
            "PR & communications leaders at mid-to-large agencies (200–2,000 staff, $5M–$200M revenue) OR "
            "enterprise in-house comms teams ($500M+ company revenue). They manage multiple brand clients "
            "across geographies, juggling 3–6 disconnected monitoring tools. Key pain: manual monitoring, "
            "delayed crisis response, no unified narrative intelligence layer. Measured on crisis response "
            "time, share of voice, executive reporting speed."
        ),
        "product_description": (
            "EBIC.AI is the AI Operating System for Modern PR and Communications — unifying narrative "
            "intelligence, brand monitoring, and executive reporting into a single intelligence layer. "
            "Early adopters report saving 8 hours/week on manual monitoring, achieving 15-minute crisis "
            "response, and gaining visibility across narratives, stakeholders, and reputation signals."
        ),
        "pain_points": [
            "Manual monitoring across 3–6 disconnected tools (Meltwater, Cision, etc.)",
            "Delayed crisis alerts and reactive storytelling",
            "No unified intelligence layer for narrative and reputation signals",
            "Slow assembly of leadership-ready briefs during escalations",
            "Disjointed workflows between monitoring, reporting, and response",
        ],
        "social_proof": [
            "8 hours/week saved on manual monitoring",
            "15-minute crisis response time for early adopters",
            "Agencies managing Fortune 500 accounts already onboarded",
            "Improved visibility across narratives, stakeholders, and reputation signals",
        ],
        "objection_rebuttals": {
            "price": (
                "The cost of a missed crisis or delayed response far exceeds the platform investment. "
                "Early adopters recover the cost in under 60 days through monitoring hours saved alone."
            ),
            "timing": (
                "Most teams say 'not now' right until a crisis hits. EBIC.AI takes under two weeks to "
                "deploy — so the question is really: can you afford to wait?"
            ),
            "tool_overlap": (
                "EBIC.AI doesn't replace your existing tools — it sits above them as the unified intelligence "
                "layer. Think of it as the OS, not another point solution."
            ),
            "not_a_priority": (
                "When the next reputational crisis hits, your response time and narrative clarity will be "
                "the difference between containment and escalation. That's worth 30 minutes today."
            ),
        },
        "cal_link": "https://cal.com/info-example/ebic.ai?duration=30",
        "video_link": "https://www.youtube.com/watch?v=O5P8aFnqHK0",
        "deck_link": "",
        "email1_template": (
            "Hi {{FirstName}}, hope you're well.\n\n"
            "{{Personalisation}}\n\n"
            "Communications teams today juggle an average of 11 different tools daily, with 68% citing "
            "fragmentation as a major barrier to productivity and strategic clarity.\n\n"
            "The cost isn't just inefficiency — it's missed signals, delayed crisis response, reactive "
            "storytelling and reporting.\n\n"
            "This is where EBIC.AI comes in. It is the AI Operating System for Modern PR and Comms, unifying "
            "narrative intelligence, brand monitoring and executive reporting into a single intelligence layer.\n\n"
            "Early adopters, including agencies managing Fortune 500 accounts, report:\n"
            "• Manual monitoring time saved: 8 hours per week.\n"
            "• Crisis-response time: 15 minutes.\n"
            "• Improved visibility across narratives, stakeholders, and reputation signals.\n\n"
            "Watch our EBIC.AI overview video here{{VideoLink}}.\n\n"
            "If you're open to a 30-minute call to explore this further, book a slot at {{CalLink}}.\n\n"
            "Best,\n{{SenderName}}"
        ),
        "email2_template": (
            "Hi {{FirstName}},\n\n"
            "Following up on my email about EBIC.AI. If it helps, here's a short deck that showcases what "
            "unified communications workflows can look like in practice.\n\n"
            "View EBIC.AI Deck{{DeckLink}}\n\n"
            "Two questions to understand your current position:\n\n"
            "1. Do you have a centralised brand intelligence layer in place, or are insights still derived "
            "manually from data across multiple tools?\n\n"
            "2. When a narrative, trend, or crisis escalates, how quickly can teams surface signals and "
            "assemble a leadership-ready brief?\n\n"
            "If relevant, happy to schedule a short conversation to discuss your current workflows and how "
            "teams are approaching unified communications intelligence with EBIC.AI. Book a slot at {{CalLink}}.\n\n"
            "Best,\n{{SenderName}}"
        ),
        "sender_name": "",
        "sender_title": "",
    },
    "ebic-agency": {
        "display_name": "EBIC.AI PR Agencies",
        "icp_job_titles": [
            "CEO", "Managing Director", "Founder", "Head of Strategy", "Head of Technology",
            "Chief Executive Officer", "Co-Founder",
        ],
        "icp_seniority_levels": ["c_suite", "vp", "director"],
        "icp_industries": ["Public Relations", "Communications", "Marketing & Advertising"],
        "icp_company_sizes": ["11-50", "51-200", "201-500", "501-1000", "1001-5000"],
        "icp_locations": ["India", "USA", "UK", "Europe", "Middle East", "Southeast Asia"],
        "icp_keywords": [
            "PR agency", "communications agency", "multi-client", "brand monitoring",
            "media intelligence", "Meltwater", "Cision", "tool fragmentation",
            "manual monitoring", "missed signals", "account management",
        ],
        "icp_segments": [
            {
                "name": "Mid-to-Large PR & Comms Agencies",
                "description": (
                    "50–2,000 staff managing multiple brand clients across 2+ geographies. "
                    "Running 8–11 disconnected tools (Meltwater, Cision, Sprout, etc.). "
                    "Pain: tool fragmentation across clients, missed signals between platforms, "
                    "analyst hours lost to manual monitoring instead of strategy."
                ),
                "decision_makers": ["CEO", "Managing Director", "Founder", "Head of Strategy", "Head of Technology"],
            },
            {
                "name": "Boutique High-Growth Agencies",
                "description": (
                    "10–50 staff, founder-led, growing rapidly and pitching enterprise mandates. "
                    "Need enterprise-grade monitoring to compete above their weight class. "
                    "Fast buying decisions, ROI-driven, price-conscious."
                ),
                "decision_makers": ["Founder", "CEO", "Managing Director"],
            },
        ],
        "icp_persona_description": (
            "PR agency leaders (CEO/MD/Founder/Head of Strategy or Tech) at firms with 10–2,000 staff "
            "managing multiple brand clients. They run 8–11 disconnected monitoring and reporting tools, "
            "paying the fragmentation tax daily — missed signals, duplicated work, analysts stitching "
            "platforms instead of thinking strategically. Measured on client satisfaction, crisis response "
            "speed across accounts, and analyst utilisation."
        ),
        "product_description": (
            "EBIC.AI is the AI Operating System for Modern PR and Communications — collapsing multi-client "
            "monitoring into one intelligence layer that replaces the fragmented tool stack. Agencies report "
            "saving 8 hours/week per analyst, achieving 15-minute crisis response across every account, and "
            "delivering real-time narrative visibility that clients actually see as a service differentiator."
        ),
        "pain_points": [
            "Managing 8–11 tools across multiple clients — the fragmentation tax is real and compounding",
            "Missed signals between platforms; no single view per client portfolio",
            "Manual monitoring consuming analyst hours that should go to strategy and counsel",
            "Delayed crisis alerts; reactive storytelling instead of proactive narrative management",
            "Difficulty demonstrating real-time intelligence value to clients vs. competitors",
        ],
        "social_proof": [
            "8 hours/week saved per analyst on manual monitoring",
            "15-minute crisis response across the full client portfolio",
            "Agencies managing Fortune 500 accounts already onboarded",
            "Multi-client narrative visibility in a single intelligence layer",
        ],
        "objection_rebuttals": {
            "price": (
                "The fragmentation cost — duplicated tool licences, manual analyst hours, missed client signals — "
                "typically exceeds the platform investment within 60 days. Early adopters recover on monitoring "
                "hours alone, before counting crisis-containment upside."
            ),
            "timing": (
                "Most agencies say 'not now' until a client crisis surfaces at midnight and they're stitching "
                "signals across six platforms. EBIC.AI deploys in under two weeks — the question is whether "
                "you want unified intelligence before or after the next escalation."
            ),
            "tool_overlap": (
                "EBIC.AI sits above your existing stack as the unified intelligence layer — it doesn't replace "
                "Meltwater or Cision, it ends the fragmentation tax between them."
            ),
            "not_a_priority": (
                "Every week your analysts spend stitching tools manually is a week EBIC.AI would have given "
                "back to strategy. That compounding cost is worth 30 minutes today."
            ),
        },
        "cal_link": "https://cal.com/info-example/ebic.ai?duration=30",
        "video_link": "https://www.youtube.com/watch?v=O5P8aFnqHK0",
        "deck_link": "",
        "email1_template": (
            "Hi {{FirstName}}, hope you're well.\n\n"
            "{{Personalisation}}\n\n"
            "PR agencies today manage an average of 11 tools across their client roster. The fragmentation "
            "cost isn't just inefficiency — it's missed signals, alerts arriving too late across accounts, "
            "and analysts stitching platforms instead of thinking strategically.\n\n"
            "EBIC.AI replaces that fragmented stack with a single intelligence layer: unified brand monitoring, "
            "narrative tracking, and client-ready reporting — across every account, in one workspace.\n\n"
            "Early adopters report:\n"
            "• 8 hours/week saved per analyst on manual monitoring.\n"
            "• 15-minute crisis response across the full client portfolio.\n"
            "• Real-time narrative visibility that clients see as a genuine service differentiator.\n\n"
            "If you're open to a 30-minute conversation on what this looks like for your team, book a slot "
            "at {{CalLink}}.\n\n"
            "Best,\n{{SenderName}}"
        ),
        "email2_template": (
            "Hi {{FirstName}},\n\n"
            "Following up on EBIC.AI. One question:\n\n"
            "When a brand narrative shifts or a crisis surfaces across your client portfolio — how quickly "
            "can your analysts surface it and brief the account lead?\n\n"
            "For most agencies running 8–11 tools, the honest answer is 'not fast enough.' EBIC.AI closes "
            "that gap by unifying monitoring, signals, and reporting into one layer — so no client account "
            "gets a slow response.\n\n"
            "Happy to walk you through how agencies similar to yours are using it. Book a slot at {{CalLink}}.\n\n"
            "Best,\n{{SenderName}}"
        ),
        "sender_name": "",
        "sender_title": "",
    },
    "ebic-enterprise": {
        "display_name": "EBIC.AI Enterprise Comms",
        "icp_job_titles": [
            "Chief Communications Officer", "CCO", "Chief Marketing Officer", "CMO",
            "Chief Strategy Officer", "VP Communications", "VP Comms",
            "Head of Corporate Communications", "Head of Brand",
        ],
        "icp_seniority_levels": ["c_suite", "vp"],
        "icp_industries": [
            "BFSI", "Financial Services", "FMCG", "Consumer Goods", "Technology",
            "Healthcare", "Retail", "Energy", "Pharmaceuticals",
        ],
        "icp_company_sizes": ["501-1000", "1001-5000", "5000+"],
        "icp_locations": ["India", "USA", "UK", "Europe", "Middle East", "Southeast Asia"],
        "icp_keywords": [
            "in-house comms", "corporate communications", "reputation management",
            "crisis communications", "executive reporting", "board reporting",
            "media intelligence", "brand risk", "reputational risk",
            "leadership briefing", "stakeholder management",
        ],
        "icp_segments": [
            {
                "name": "Enterprise In-House Communications Teams",
                "description": (
                    "$500M+ revenue companies across BFSI, FMCG, Tech, Healthcare, Retail, Energy. "
                    "CCO/CMO/CSO/VP Comms teams measured on crisis containment speed and board-level "
                    "reporting quality. Pain: no unified intelligence layer — signals come from disconnected "
                    "tools, leadership briefs are assembled manually under pressure, crisis containment "
                    "relies on speed they structurally don't have."
                ),
                "decision_makers": [
                    "CCO", "CMO", "Chief Strategy Officer", "VP Communications", "VP Comms",
                    "Head of Corporate Communications",
                ],
                "budget_approvers": ["CFO", "CEO"],
            },
        ],
        "icp_persona_description": (
            "CCO/CMO/CSO/VP Comms at $500M+ enterprises across BFSI, FMCG, Tech, Healthcare, Retail, "
            "Energy. Responsible for brand reputation, crisis response, and board-level communications "
            "reporting. Key pain: no unified intelligence layer — signals come from disconnected sources, "
            "leadership briefs are assembled manually under pressure, and crisis containment relies on speed "
            "they structurally don't have. Measured on crisis response time, executive reporting quality, "
            "and narrative consistency across stakeholders."
        ),
        "product_description": (
            "EBIC.AI gives enterprise communications teams a unified intelligence layer for narrative "
            "monitoring, reputational risk signals, and board-ready reporting — eliminating the manual "
            "assembly that slows leadership decisions. Early adopters achieve 15-minute crisis containment "
            "and deliver real-time executive reporting instead of retrospective briefs."
        ),
        "pain_points": [
            "No unified intelligence layer — board and leadership rely on manually assembled, retrospective briefs",
            "Slow crisis response when signals are scattered across disconnected monitoring tools",
            "Reputational risk at scale with no real-time signal aggregation across narratives and stakeholders",
            "Executive reporting speed is a liability during escalations, not a capability",
            "CCO/CMO accountable for outcomes they lack the infrastructure to predict or pre-empt",
        ],
        "social_proof": [
            "15-minute crisis response and containment for early adopters",
            "Board-level reporting delivered in real time, not retrospect",
            "Enterprise teams across BFSI and FMCG already onboarded",
            "Unified reputational risk signals across narratives, stakeholders, and media",
        ],
        "objection_rebuttals": {
            "price": (
                "The cost of a missed reputational crisis — or a delayed board briefing during an escalation — "
                "dwarfs the platform investment. Early adopters contain crises in 15 minutes vs hours. "
                "That delta is the ROI case."
            ),
            "timing": (
                "Reputational risk doesn't wait for budget cycles. EBIC.AI deploys in under two weeks. "
                "The question is whether you want unified intelligence before or after the next crisis."
            ),
            "tool_overlap": (
                "EBIC.AI doesn't replace your existing tools. It sits above them as the unified intelligence "
                "layer your board expects but your current stack structurally cannot deliver."
            ),
            "not_a_priority": (
                "Every leadership brief assembled manually under pressure is a response-time liability. "
                "When the next crisis hits, your narrative clarity and containment speed will define the outcome. "
                "That's worth 30 minutes today."
            ),
        },
        "cal_link": "https://cal.com/info-example/ebic.ai?duration=30",
        "video_link": "https://www.youtube.com/watch?v=O5P8aFnqHK0",
        "deck_link": "",
        "email1_template": (
            "Hi {{FirstName}}, hope you're well.\n\n"
            "{{Personalisation}}\n\n"
            "For enterprise communications teams at $500M+ companies, two things define performance in a "
            "crisis: how fast you surface the signal, and how quickly you can brief leadership with a "
            "complete picture.\n\n"
            "Most teams today assemble those briefs manually — pulling from disconnected tools while the "
            "situation is already moving. The result is slower containment and higher reputational risk.\n\n"
            "EBIC.AI gives in-house comms teams a unified intelligence layer: real-time narrative monitoring, "
            "reputational risk signals, and board-ready reporting — without the manual assembly.\n\n"
            "Early adopters report:\n"
            "• 15-minute crisis response and containment.\n"
            "• Board-level reporting delivered in real time, not retrospect.\n"
            "• Unified visibility across narratives, stakeholders, and reputation signals.\n\n"
            "If you're open to a 30-minute conversation, book a slot at {{CalLink}}.\n\n"
            "Best,\n{{SenderName}}"
        ),
        "email2_template": (
            "Hi {{FirstName}},\n\n"
            "Following up on EBIC.AI. Two questions:\n\n"
            "1. When a reputational risk surfaces — how long does it take your team to brief leadership "
            "with a complete picture of the narrative and recommended response?\n\n"
            "2. Is that speed fast enough for the board's expectations today?\n\n"
            "For most enterprise comms teams, the honest answer to (2) is no — because the intelligence "
            "is there, but it's fragmented across tools. EBIC.AI unifies it into a single layer so the "
            "next escalation doesn't catch anyone off guard.\n\n"
            "Happy to walk through what this looks like for a team your size. Book at {{CalLink}}.\n\n"
            "Best,\n{{SenderName}}"
        ),
        "sender_name": "",
        "sender_title": "",
    },
    "retailio": {
        "display_name": "Retailio AI",
        "icp_job_titles": [
            "Head of Visual Merchandising", "Visual Merchandising Head",
            "Director of Visual Merchandising", "Global Visual Merchandising Head",
            "Regional Visual Merchandising Head",
        ],
        "icp_seniority_levels": ["director", "vp", "c_suite"],
        "icp_industries": [
            "Retail", "Fashion & Apparel", "Consumer Goods", "FMCG",
            "Luxury Goods", "Department Stores", "Specialty Retail",
        ],
        "icp_company_sizes": ["201-500", "501-1000", "1001-5000", "5000+"],
        "icp_locations": ["India", "USA", "UK", "Europe"],
        "icp_keywords": [
            "visual merchandising", "VM guidelines", "store compliance", "planogram",
            "retail execution", "in-store experience", "VM rollout", "network compliance",
            "retail operations", "brand guidelines",
        ],
        "icp_segments": [
            {
                "name": "Primary Segment — Global & Regional Retail Brands",
                "description": "Mid-to-large retail brands with revenue above $20M operating across "
                               "multiple store locations. VM teams managing 5–6 day guideline creation "
                               "cycles and struggling with 60–70% execution accuracy across their network. "
                               "Pain: slow VM documentation, inconsistent store-level compliance, "
                               "no virtual pre-execution validation layer.",
                "decision_makers": [
                    "Head of Visual Merchandising", "Director of Visual Merchandising",
                    "Global Visual Merchandising Head", "Regional Visual Merchandising Head",
                ],
            },
        ],
        "icp_persona_description": (
            "Head/Director/Global/Regional Visual Merchandising leaders at mid-to-large retail brands "
            "($20M+ revenue) across India, USA, UK, and Europe. They oversee VM guideline creation and "
            "network-wide rollout across multiple store locations. Key pain: VM documentation takes 5–6 days, "
            "only 60–70% of guidelines are executed accurately at store level, and there is no agile virtual "
            "environment to validate execution before live rollout. Measured on store compliance rate and "
            "speed of VM guideline deployment."
        ),
        "product_description": (
            "Retailio AI is the VM-Integrated Retail OS designed to help global brands close the execution "
            "gap and lead the race to AI transformation. VM teams get real-time control of rollout plus "
            "execution in an agile virtual environment before implementation at store level. "
            "Early adopters cut VM guideline creation from 5 days to 6 hours and reach 95% network "
            "compliance within 60 days — a 24x speed advantage over manual processes."
        ),
        "pain_points": [
            "VM guideline creation takes 5–6 days manually",
            "Only 60–70% of VM guidelines are executed accurately at store level",
            "No virtual pre-execution environment to validate rollout before go-live",
            "Faster-moving competitors already closing the compliance gap",
            "Manual, disconnected processes slowing down network-wide rollout",
        ],
        "social_proof": [
            "VM guideline creation: 5 days → 6 hours (24x faster)",
            "95% network compliance achieved within 60 days",
            "Real-time rollout control before store-level implementation",
        ],
        "objection_rebuttals": {
            "price": (
                "The cost of inaccurate VM execution compounds daily — every percentage point of compliance "
                "lost is lost revenue at the shelf. Early adopters recover the investment within the first "
                "compliance cycle."
            ),
            "timing": (
                "Every week your team spends 5–6 days on a guideline doc, your competitors using AI are "
                "doing it in 6 hours. That's a 24x compounding disadvantage. The best time to close that "
                "gap is now."
            ),
            "tool_overlap": (
                "Retailio AI sits above your existing workflows as the VM intelligence and execution layer — "
                "it doesn't replace your creative process, it accelerates it and validates it before rollout."
            ),
            "not_a_priority": (
                "80% of purchase decisions happen in-store. VM execution accuracy directly drives revenue. "
                "If compliance is at 60–70%, the margin you're leaving on the table is already significant."
            ),
        },
        "cal_link": "",
        "video_link": "",
        "deck_link": "",
        "email1_template": (
            "Hi {{FirstName}},\n\n"
            "{{Personalisation}}\n\n"
            "While 80% of purchase decisions happen in-store, most brands execute only 60–70% of VM "
            "guidelines accurately — a gap that faster-moving competitors are already closing.\n\n"
            "What takes your team 5–6 days to put together a VM-guideline document, AI-enabled retailers "
            "are completing in under 6 hours.\n\n"
            "That's a 24x advantage, compounding daily for your competition.\n\n"
            "Retailio AI is the VM-Integrated Retail OS designed to help global brands close the gap and "
            "lead the race to AI transformation.\n\n"
            "To know more about Retailio AI, click here: {{DeckLink}}\n\n"
            "I'd be happy to share more about how leading retail teams are approaching this shift and "
            "explore whether this could align with your current priorities.\n\n"
            "Would you be open to a quick 20–30 minute conversation next week?\n\n"
            "Warm regards,\n{{SenderName}}"
        ),
        "email2_template": (
            "Hi {{FirstName}},\n\n"
            "Here's a quick follow up on Retailio AI. The core idea is simple: VM teams get real time "
            "control of rollout plus execution in an agile virtual environment before implementation "
            "at store level.\n\n"
            "We've seen early adopters of Retailio AI cut VM guideline creation from 5 days to 6 hours "
            "and reach 95% network compliance within 60 days.\n\n"
            "If helpful, here's the short deck on the platform's capabilities: {{DeckLink}}\n\n"
            "Open to a 15 minute chat next week to see if this maps to how your team runs rapid retail ops?\n\n"
            "Best,\n{{SenderName}}"
        ),
        "sender_name": "",
        "sender_title": "",
    },
    "example": {
        "display_name": "your-org AI Innovation Lab",
        "icp_job_titles": [
            "CTO", "CIO", "CDO",
            "VP of Technology", "SVP of Technology", "Director of Technology",
            "VP of Operations", "SVP of Operations",
            "Head of Digital", "Head of Digital Transformation",
        ],
        "icp_seniority_levels": ["c_suite", "vp", "director"],
        "icp_industries": [],
        "icp_company_sizes": ["201-500", "501-1000", "1001-5000"],
        "icp_locations": ["India", "USA", "UK", "Europe"],
        "icp_keywords": [
            "AI transformation", "digital transformation", "AI strategy",
            "machine learning", "enterprise AI", "AI pilot",
        ],
        "icp_segments": [],
        "icp_persona_description": (
            "VP/SVP/Director of Technology, VP of Operations, Head of Digital, CTO, CIO, or CDO "
            "at a mid-market company ($20M–$200M revenue, 150–2000 employees). "
            "Owns the AI/digital transformation mandate but lacks an internal ML team to execute it. "
            "Has survived at least one failed or stalled AI pilot. Reports to a CEO or board now actively "
            "asking 'where is our AI strategy?' Measured on operational KPIs."
        ),
        "product_description": (
            "your-org operates as a dedicated AI Innovation Lab embedded within your organisation — "
            "we design, validate, and scale AI until it becomes a permanent internal capability. "
            "AI stops being a cost center and becomes a compounding growth advantage."
        ),
        "pain_points": [
            "10+ AI pilots that never scaled",
            "No internal ML team to own execution",
            "AI initiatives owned by IT but KPIs live in the business",
            "Board pressure on AI strategy without a delivery roadmap",
        ],
        "social_proof": [
            "Projects shipping in weeks instead of months",
            "Permanent internal AI capability, not isolated wins",
        ],
        "objection_rebuttals": {
            "price": "The cost is fractional vs. hiring a full ML team. You get senior AI talent embedded, not consulting decks.",
            "timing": "The board is already asking. Every quarter without an answer is a quarter of compounding disadvantage.",
            "tool_overlap": "We're not a tool — we're embedded execution. We work with whatever stack you have.",
            "not_a_priority": "If your CEO is asking about AI strategy, it's already a priority. We help you answer that question.",
        },
        "cal_link": "cal.com/info-example/ai-innovation-lab",
        "video_link": "",
        "deck_link": "",
        "email1_template": _M37_DEFAULT_ICP["email1_template"],
        "email2_template": _M37_DEFAULT_ICP["email2_template"],
        "sender_name": "",
        "sender_title": "",
    },
}


_system_products_seeded: bool = False  # process-level cache — avoids DB check on every request


def _ensure_system_products(db: Session) -> None:
    """Upsert system-level product profiles on every process start. Cached per process."""
    global _system_products_seeded
    if _system_products_seeded:
        return
    needs_commit = False
    for key, data in _SYSTEM_PRODUCTS.items():
        record = db.query(ProductKnowledgeBase).filter_by(
            user_email=None, product_key=key
        ).first()
        fields = {k: v for k, v in data.items() if hasattr(ProductKnowledgeBase, k)}
        if not record:
            db.add(ProductKnowledgeBase(user_email=None, product_key=key, **fields))
            needs_commit = True
        else:
            # Always sync templates + key fields from code — DB may have stale NULLs
            for attr, val in fields.items():
                setattr(record, attr, val)
            needs_commit = True
    if needs_commit:
        db.commit()
    _system_products_seeded = True


def _pkb_dict(p: ProductKnowledgeBase) -> dict:
    return {
        "product_key": p.product_key,
        "display_name": p.display_name,
        "icp_job_titles": p.icp_job_titles or [],
        "icp_seniority_levels": p.icp_seniority_levels or [],
        "icp_industries": p.icp_industries or [],
        "icp_company_sizes": p.icp_company_sizes or [],
        "icp_locations": p.icp_locations or [],
        "icp_keywords": p.icp_keywords or [],
        "icp_segments": p.icp_segments or [],
        "icp_persona_description": p.icp_persona_description,
        "product_description": p.product_description,
        "pain_points": p.pain_points or [],
        "social_proof": p.social_proof or [],
        "objection_rebuttals": p.objection_rebuttals or {},
        "cal_link": p.cal_link,
        "video_link": p.video_link,
        "deck_link": p.deck_link,
        "email1_template": p.email1_template,
        "email2_template": p.email2_template,
        "sender_name": p.sender_name,
        "sender_title": p.sender_title,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _load_product(product_key: str, user_email: str, db: Session) -> Optional[dict]:
    """
    Load product knowledge base. User override takes priority over system default.
    Returns None if product_key is not found.
    """
    _ensure_system_products(db)
    user_rec = db.query(ProductKnowledgeBase).filter_by(
        user_email=user_email, product_key=product_key
    ).first()
    if user_rec:
        return _pkb_dict(user_rec)
    sys_rec = db.query(ProductKnowledgeBase).filter_by(
        user_email=None, product_key=product_key
    ).first()
    return _pkb_dict(sys_rec) if sys_rec else None


class ProductKBUpdate(BaseModel):
    display_name: Optional[str] = None
    icp_job_titles: Optional[list[str]] = None
    icp_seniority_levels: Optional[list[str]] = None
    icp_industries: Optional[list[str]] = None
    icp_company_sizes: Optional[list[str]] = None
    icp_locations: Optional[list[str]] = None
    icp_keywords: Optional[list[str]] = None
    icp_segments: Optional[list] = None
    icp_persona_description: Optional[str] = None
    product_description: Optional[str] = None
    pain_points: Optional[list[str]] = None
    social_proof: Optional[list[str]] = None
    objection_rebuttals: Optional[dict] = None
    cal_link: Optional[str] = None
    video_link: Optional[str] = None
    deck_link: Optional[str] = None
    email1_template: Optional[str] = None
    email2_template: Optional[str] = None
    sender_name: Optional[str] = None
    sender_title: Optional[str] = None


class ProductCreate(BaseModel):
    display_name: str
    product_description: Optional[str] = None
    icp_job_titles: Optional[list[str]] = None
    icp_seniority_levels: Optional[list[str]] = None
    icp_industries: Optional[list[str]] = None
    icp_company_sizes: Optional[list[str]] = None
    icp_locations: Optional[list[str]] = None
    icp_keywords: Optional[list[str]] = None
    pain_points: Optional[list[str]] = None
    social_proof: Optional[list[str]] = None
    cal_link: Optional[str] = None
    video_link: Optional[str] = None
    deck_link: Optional[str] = None
    sender_name: Optional[str] = None
    sender_title: Optional[str] = None


@router.post("/products", status_code=201)
async def create_product(body: ProductCreate, email: str = Query(...), db: Session = Depends(get_db)):
    """Create a new user-level product profile."""
    key = body.display_name.lower().replace(" ", "").replace(".", "").replace("-", "")
    # Ensure uniqueness per user
    existing = db.query(ProductKnowledgeBase).filter_by(user_email=email, product_key=key).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Product '{key}' already exists for this user.")
    rec = ProductKnowledgeBase(
        user_email=email,
        product_key=key,
        **{k: v for k, v in body.model_dump(exclude_none=True).items() if hasattr(ProductKnowledgeBase, k)},
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return _pkb_dict(rec)


@router.get("/products")
async def list_products(email: str = Query(...), db: Session = Depends(get_db)):
    """List all available product profiles (system defaults + user overrides)."""
    _ensure_system_products(db)
    sys_recs = db.query(ProductKnowledgeBase).filter_by(user_email=None).all()
    user_recs = db.query(ProductKnowledgeBase).filter_by(user_email=email).all()
    user_keys = {r.product_key for r in user_recs}
    result = []
    for r in sys_recs:
        result.append({**_pkb_dict(r), "has_user_override": r.product_key in user_keys})
    for r in user_recs:
        result.append({**_pkb_dict(r), "is_user_override": True})
    return result


@router.get("/products/{product_key}")
async def get_product(product_key: str, email: str = Query(...), db: Session = Depends(get_db)):
    """Get full product knowledge base for a given product key (e.g. 'ebic', 'example')."""
    data = _load_product(product_key.lower(), email, db)
    if not data:
        raise HTTPException(status_code=404, detail=f"Product '{product_key}' not found.")
    return data


@router.put("/products/{product_key}")
async def upsert_product(
    product_key: str,
    body: ProductKBUpdate,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Create or update a user-level product profile override."""
    _ensure_system_products(db)
    key = product_key.lower()
    rec = db.query(ProductKnowledgeBase).filter_by(user_email=email, product_key=key).first()
    if not rec:
        # Start from system default if it exists
        sys_rec = db.query(ProductKnowledgeBase).filter_by(user_email=None, product_key=key).first()
        if sys_rec:
            rec = ProductKnowledgeBase(user_email=email, product_key=key,
                                       **{c: getattr(sys_rec, c) for c in [
                                           "display_name", "icp_job_titles", "icp_seniority_levels",
                                           "icp_industries", "icp_company_sizes", "icp_locations",
                                           "icp_keywords", "icp_segments", "icp_persona_description",
                                           "product_description", "pain_points", "social_proof",
                                           "objection_rebuttals", "cal_link", "video_link", "deck_link",
                                           "email1_template", "email2_template", "sender_name", "sender_title",
                                       ]})
        else:
            rec = ProductKnowledgeBase(user_email=email, product_key=key,
                                       display_name=body.display_name or key)
        db.add(rec)

    for field, value in body.model_dump(exclude_none=True).items():
        if hasattr(rec, field):
            setattr(rec, field, value)

    db.commit()
    db.refresh(rec)
    return _pkb_dict(rec)


@router.delete("/products/{product_key}", status_code=204)
async def delete_product_override(
    product_key: str,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Delete a user-level override — reverts to system default."""
    deleted = db.query(ProductKnowledgeBase).filter_by(
        user_email=email, product_key=product_key.lower()
    ).delete()
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="No user override found for this product.")


# ─────────────────────────────────────────────────────────────────────────────
# Lead Finder — ICP search via SerpAPI LinkedIn
# ─────────────────────────────────────────────────────────────────────────────

class LeadFinderRequest(BaseModel):
    # Structured filters (explicit)
    job_titles: list[str] = []
    seniority_levels: list[str] = []   # "vp","director","c_suite","manager" etc.
    industries: list[str] = []
    locations: list[str] = []
    company_sizes: list[str] = []      # "1-10","11-50","51-200","201-500","501-1000","1001-5000","5000+"
    keywords: list[str] = []
    limit: int = 25                    # user-selectable; hard-capped at 1000

    # Natural language ICP — if provided, LLM parses it into the above fields
    icp_description: Optional[str] = None

    # Optional product context — improves ICP parsing and keyword targeting
    product_description: Optional[str] = None

    # If set, loads ICP filters from the product knowledge base (e.g. "ebic", "autodeskai")
    product_key: Optional[str] = None


class BulkSaveRequest(BaseModel):
    leads: list[dict]
    list_tag: Optional[str] = None   # project tag applied to all saved leads (e.g. "Ebic", "Retail I")
    geo_tag: Optional[str] = None    # geographic tag applied to all saved leads (e.g. "US", "UK", "India")
    product_key: Optional[str] = None  # link to ProductKnowledgeBase (e.g. "ebic", "retailio")
    ignore_duplicates: Optional[bool] = False


@router.post("/leads/find")
async def find_leads_route(body: LeadFinderRequest, email: str = Query(...), db: Session = Depends(get_db)):
    """
    Search for people matching ICP filters via SerpAPI LinkedIn scrape.

    If no filters are provided, falls back to the user's saved ICP profile
    (or AutoDeskAI defaults if none saved). Either provide structured filters OR
    icp_description (natural language) for LLM parsing.

    Returns leads sorted by icp_score (0-100).
    Not saved to CRM until /leads/save is called.
    """
    parsed_filters: Optional[dict] = None

    # Priority: product_key → ICP profile → AutoDeskAI defaults
    pkb_filters: dict = {}
    if body.product_key:
        pkb = _load_product(body.product_key.lower(), email, db)
        if pkb:
            pkb_filters = pkb

    if pkb_filters:
        src = pkb_filters
        src_key = "icp_"  # product KB uses icp_* prefix
    else:
        icp = db.query(IcpProfile).filter_by(user_email=email).first()
        src = _icp_dict(icp) if icp else _M37_DEFAULT_ICP
        src_key = ""  # ICP profile uses plain keys

    def _fget(key: str) -> list:
        return src.get(f"{src_key}{key}", []) if src_key else src.get(key, [])

    job_titles    = body.job_titles    or _fget("job_titles")
    seniority_levels = body.seniority_levels or _fget("seniority_levels")
    industries    = body.industries    or _fget("industries")
    locations     = body.locations     or _fget("locations")
    company_sizes = body.company_sizes or _fget("company_sizes")
    keywords      = body.keywords      or _fget("keywords")
    product_desc  = body.product_description or src.get(f"{src_key}product_description" if src_key else "product_description", "")

    effective_limit = min(body.limit, 1000)
    if body.icp_description:
        parsed_filters, leads = await find_leads_from_icp(
            body.icp_description,
            limit=effective_limit,
            product_description=product_desc,
        )
    else:
        if not job_titles and not industries and not seniority_levels:
            raise HTTPException(
                status_code=422,
                detail="Provide icp_description OR at least one of: job_titles, industries, seniority_levels.",
            )
        leads = await find_leads(
            job_titles=job_titles,
            industries=industries,
            locations=locations,
            company_sizes=company_sizes,
            seniority_levels=seniority_levels,
            keywords=keywords,
            limit=effective_limit,
            product_description=product_desc,
        )

    return {
        "leads": leads,
        "count": len(leads),
        "parsed_filters": parsed_filters,
        "product_key": body.product_key,
    }


class WebEnrichRequest(BaseModel):
    leads: list[dict]
    icp_filters: Optional[dict] = None


@router.post("/leads/web-enrich")
async def web_enrich_leads_route(body: WebEnrichRequest):
    """
    SSE endpoint — streams GPT web-search enrichment results for a list of leads.
    Each event: data: {"index": int, "updates": {...}, "icp_score": int}
    Frontend merges updates + icp_score into the lead at that index as they arrive.
    """
    from services.gpt_web_enrichment import enrich_leads_stream
    from services.lead_enrichment import score_icp_match
    import json as _json

    async def _generate():
        try:
            async for result in enrich_leads_stream(body.leads):
                # Re-score with enriched data if ICP filters were provided
                if body.icp_filters and isinstance(result.get("updates"), dict):
                    idx = result.get("index", -1)
                    if 0 <= idx < len(body.leads):
                        merged = {**body.leads[idx], **result["updates"]}
                        result["icp_score"] = score_icp_match(merged, body.icp_filters)
                yield f"data: {_json.dumps(result)}\n\n"
        except Exception as e:
            logger.warning(f"Web enrich stream error: {e}")
        yield "data: {\"done\": true}\n\n"

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/leads/save", status_code=201)
async def save_leads_route(
    body: BulkSaveRequest,
    background_tasks: BackgroundTasks,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Bulk-save selected leads from /leads/find into the CRM.
    Deduplicates by contact_email + company or name + company.
    Existing contacts are re-enriched instead of silently skipped.
    Returns counts: created / updated / skipped (incomplete data).
    """
    created = []
    updated = []
    skipped = 0
    org_duplicates: list[dict] = []   # leads already claimed by a teammate

    # Derive org domain to detect cross-user duplicates (same email domain = same org)
    org_domain = email.split("@")[-1] if "@" in email else None

    # Public / consumer email domains — org-level dedup makes no sense for these
    _PUBLIC_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"}
    _is_private_org = org_domain and org_domain not in _PUBLIC_DOMAINS

    for lead in body.leads:
        contact_email = (lead.get("contact_email") or "").strip().lower() or None
        company = (lead.get("company") or "").strip()
        name = (lead.get("contact_name") or "").strip()

        if not name or not company:
            skipped += 1
            continue

        # Dedup: same email+company or same name+company already in DB (this user)
        existing = None
        if contact_email:
            existing = db.query(SalesContact).filter_by(
                user_email=email, contact_email=contact_email, company=company
            ).first()
        if not existing:
            existing = db.query(SalesContact).filter_by(
                user_email=email, contact_name=name, company=company
            ).first()

        if existing:
            # Always re-enrich when user explicitly re-selects — they want fresh data
            if body.list_tag and not existing.list_tag:
                existing.list_tag = body.list_tag
            if body.geo_tag and not existing.geo_tag:
                existing.geo_tag = body.geo_tag
            if body.product_key and not existing.product_key:
                existing.product_key = body.product_key.lower()
            background_tasks.add_task(_background_enrich, existing.id, email)
            updated.append(_contact_dict(existing))
            continue

        # Cross-user org dedup — hard block for same-company teammates (private domains only)
        if _is_private_org:
            teammate_owner = None
            if contact_email:
                teammate_owner = (
                    db.query(SalesContact.user_email)
                    .filter(
                        SalesContact.contact_email == contact_email,
                        SalesContact.company == company,
                        SalesContact.user_email != email,
                        SalesContact.user_email.like(f"%@{org_domain}"),
                    )
                    .scalar()
                )
            if not teammate_owner:
                teammate_owner = (
                    db.query(SalesContact.user_email)
                    .filter(
                        SalesContact.contact_name == name,
                        SalesContact.company == company,
                        SalesContact.user_email != email,
                        SalesContact.user_email.like(f"%@{org_domain}"),
                    )
                    .scalar()
                )
            if teammate_owner:
                org_duplicates.append({
                    "contact_name": name,
                    "company": company,
                    "owned_by": teammate_owner,
                })
                continue  # hard block — never INSERT a lead already owned by a same-org teammate

        contact = SalesContact(
            user_email=email,
            contact_name=name,
            contact_email=contact_email,
            company=company,
            role=lead.get("role"),
            domain=lead.get("domain"),
            linkedin_url=lead.get("linkedin_url") or None,
            linkedin_headline=lead.get("linkedin_headline") or None,
            company_size=lead.get("company_size"),
            company_industry=lead.get("company_industry"),
            company_location=lead.get("company_location"),
            company_founded=lead.get("company_founded"),
            email_verified=lead.get("email_verified"),
            enrichment_status="pending",
            enrichment_source="serpapi_linkedin",
            list_tag=body.list_tag or lead.get("list_tag") or None,
            geo_tag=body.geo_tag or lead.get("geo_tag") or None,
            product_key=(body.product_key or "").lower() or None,
        )
        db.add(contact)
        db.flush()
        created.append(_contact_dict(contact))

    db.commit()

    # Fire enrichment for each newly saved contact (runs after response is returned)
    for c in created:
        background_tasks.add_task(_background_enrich, c["id"], email)

    logger.info(f"Saved {len(created)} new, re-enriching {len(updated)} existing, skipped {skipped} for {email}")
    return {
        "created": len(created),
        "updated": len(updated),
        "skipped": skipped,
        "contacts": created + updated,
        "org_duplicates": org_duplicates,   # non-empty = leads already saved by a teammate
    }


# ─────────────────────────────────────────────────────────────────────────────
# Enrichment — waterfall per contact
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/contacts/{contact_id}/enrich")
async def enrich_contact_route(
    contact_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Run enrichment waterfall (PDL → Clearbit → website scrape → SerpAPI news + signal classification)
    for a contact. Updates the contact in-place, inserts buying signals as SignalEvents,
    and returns the updated record with new intent_score.
    """
    from datetime import datetime, timezone
    contact = _get_contact_or_404(db, contact_id, email)

    contact.enrichment_status = "pending"
    db.commit()

    try:
        updates = await enrich_contact(
            contact_name=contact.contact_name,
            company=contact.company,
            domain=contact.domain,
            contact_email=contact.contact_email,
            linkedin_url=contact.linkedin_url,
        )
    except Exception as exc:
        logger.error(f"Enrichment failed for contact {contact_id}: {exc}")
        contact.enrichment_status = "failed"
        db.commit()
        raise HTTPException(status_code=500, detail="Enrichment failed. Please try again.")

    # Extract buying signals before writing to contact fields
    buying_signals = updates.pop("_buying_signals", [])

    # Write enrichment fields
    for field, value in updates.items():
        if hasattr(contact, field) and value is not None:
            setattr(contact, field, value)
    contact.enriched_at = datetime.now(timezone.utc)
    # Infer timezone from location if not already set
    if not contact.lead_timezone and contact.company_location:
        contact.lead_timezone = _infer_timezone(contact.company_location)

    # Insert buying signals as SignalEvents (dedup by title)
    existing_titles: set[str] = {
        (s.signal_metadata or {}).get("title", "").lower()[:60]
        for s in db.query(SignalEvent).filter_by(contact_id=contact.id).all()
    }
    new_signal_count = 0
    for sig in buying_signals:
        title_key = sig.get("title", "").lower()[:60]
        if title_key and title_key in existing_titles:
            continue
        existing_titles.add(title_key)
        db.add(SignalEvent(
            contact_id=contact.id,
            user_email=email,
            signal_type=sig["type"],
            signal_metadata=sig,
        ))
        new_signal_count += 1

    # Recompute intent score with new signals
    all_signals = db.query(SignalEvent).filter_by(contact_id=contact_id).all()
    open_count = sum(1 for s in all_signals if s.signal_type == "email_open")
    contact.intent_score = compute_intent_score(
        _score_inputs(all_signals), open_count
    )
    if new_signal_count:
        contact.last_signal_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(contact)
    result = _contact_dict(contact)
    result["new_signals"] = new_signal_count
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Dossier — LLM-synthesized research brief per contact
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/contacts/{contact_id}/dossier")
async def generate_dossier_route(
    contact_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Generate (or regenerate) a research dossier for a contact.
    Combines: company description (Clearbit/Wikipedia/website), tech stack,
    LinkedIn context, and all stored signals — synthesized by LLM into
    pain points, outreach angles, and icebreakers.
    Saves result to contact.dossier and returns the full dossier.
    """
    contact = _get_contact_or_404(db, contact_id, email)
    _dossier_user = db.query(User).filter(User.email == email).first()
    _dossier_user_id = _dossier_user.id if _dossier_user else None

    # Gather all stored signals for context
    all_signals = db.query(SignalEvent).filter_by(contact_id=contact_id).order_by(
        SignalEvent.created_at.desc()
    ).limit(20).all()
    signal_dicts = [
        {
            "type": s.signal_type,
            "title": (s.signal_metadata or {}).get("title", ""),
            "published_at": (s.signal_metadata or {}).get("published_at", ""),
            "metadata": s.signal_metadata or {},
        }
        for s in all_signals
    ]

    # Prefer persisted enrichment output, then fall back to any previous dossier.
    existing_dossier = contact.dossier or {}
    tech_stack = contact.tech_stack or existing_dossier.get("tech_stack") or []

    try:
        dossier = await generate_contact_dossier(
            contact_name=contact.contact_name,
            role=contact.role,
            company=contact.company,
            domain=contact.domain,
            contact_email=contact.contact_email,
            linkedin_url=contact.linkedin_url,
            company_size=contact.company_size,
            company_industry=contact.company_industry,
            company_location=contact.company_location,
            tech_stack=tech_stack,
            signals=signal_dicts,
            existing_description=contact.company_description or contact.company_news,
            user_id=_dossier_user_id,
            db=db,
        )
    except Exception as exc:
        logger.error(f"Dossier generation failed for contact {contact_id}: {exc}")
        raise HTTPException(status_code=500, detail="Dossier generation failed. Please try again.")

    contact.dossier = dossier
    db.commit()
    db.refresh(contact)
    return {"contact_id": contact_id, "dossier": dossier}


# ─────────────────────────────────────────────────────────────────────────────
# Bulk enrichment — enrich up to 50 contacts concurrently
# ─────────────────────────────────────────────────────────────────────────────

class BulkEnrichRequest(BaseModel):
    contact_ids: list[int]  # max 50


@router.post("/contacts/bulk-enrich")
async def bulk_enrich_route(
    body: BulkEnrichRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Enrich multiple contacts in parallel (max 50 at a time, concurrency=5).
    Returns per-contact results: enriched / failed, and what sources were used.
    """
    if not body.contact_ids:
        raise HTTPException(status_code=422, detail="contact_ids must not be empty.")
    ids = body.contact_ids[:50]  # hard cap

    contacts = {
        c.id: c
        for c in db.query(SalesContact).filter(
            SalesContact.id.in_(ids),
            SalesContact.user_email == email,
        ).all()
    }

    sem = asyncio.Semaphore(5)
    results = []

    async def _enrich_one(contact_id: int):
        contact = contacts.get(contact_id)
        if not contact:
            return {"contact_id": contact_id, "status": "not_found"}
        async with sem:
            try:
                updates = await enrich_contact(
                    contact_name=contact.contact_name,
                    company=contact.company,
                    domain=contact.domain,
                    contact_email=contact.contact_email,
                    linkedin_url=contact.linkedin_url,
                )
            except Exception as exc:
                logger.warning(f"Bulk enrich failed contact {contact_id}: {exc}")
                return {"contact_id": contact_id, "status": "failed", "error": str(exc)}

            buying_signals = updates.pop("_buying_signals", [])

            # Write fields to contact
            for field, value in updates.items():
                if hasattr(contact, field) and value is not None:
                    setattr(contact, field, value)
            contact.enriched_at = datetime.now(timezone.utc)
            if not contact.lead_timezone and contact.company_location:
                contact.lead_timezone = _infer_timezone(contact.company_location)

            # Insert new buying signals (dedup by title)
            existing_titles: set[str] = {
                (s.signal_metadata or {}).get("title", "").lower()[:60]
                for s in db.query(SignalEvent).filter_by(contact_id=contact.id).all()
            }
            new_signal_count = 0
            for sig in buying_signals:
                title_key = sig.get("title", "").lower()[:60]
                if title_key and title_key in existing_titles:
                    continue
                existing_titles.add(title_key)
                db.add(SignalEvent(
                    contact_id=contact.id,
                    user_email=email,
                    signal_type=sig["type"],
                    signal_metadata=sig,
                ))
                new_signal_count += 1

            # Recompute intent score
            from services.sales_intelligence import compute_intent_score
            all_signals = db.query(SignalEvent).filter_by(contact_id=contact.id).all()
            open_count = sum(1 for s in all_signals if s.signal_type == "email_open")
            contact.intent_score = compute_intent_score(
                _score_inputs(all_signals), open_count
            )

            return {
                "contact_id": contact_id,
                "status": updates.get("enrichment_status", "enriched"),
                "sources": updates.get("enrichment_source"),
                "new_signals": new_signal_count,
                "intent_score": contact.intent_score,
            }

    task_results = await asyncio.gather(*[_enrich_one(cid) for cid in ids])
    db.commit()

    enriched = sum(1 for r in task_results if r.get("status") == "enriched")
    failed = sum(1 for r in task_results if r.get("status") == "failed")
    return {
        "total": len(ids),
        "enriched": enriched,
        "failed": failed,
        "results": list(task_results),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Campaigns
# ─────────────────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    subject_template: str
    html_template: str
    text_template: Optional[str] = None
    outreach_tag: Optional[str] = None  # group campaigns by product/outreach type
    product_key: Optional[str] = None   # link to ProductKnowledgeBase


class RecipientInput(BaseModel):
    email: str
    name: Optional[str] = None
    variables: Optional[dict] = None


class CampaignSendRequest(BaseModel):
    recipients: list[RecipientInput]
    product_name: Optional[str] = None


class GenerateTemplateRequest(BaseModel):
    raw_email: str  # Plain text or raw HTML the user pastes


@router.post("/campaigns/generate-template")
async def generate_email_template(body: GenerateTemplateRequest, email: str = Query(...), db: Session = Depends(get_db)):
    """
    Takes a raw example email (plain text or HTML) and uses an LLM to:
    - Extract the structure and tone
    - Return a reusable subject_template + html_template with {{variable}} placeholders
    """
    system = (
        "You are an email marketing specialist. The user will paste an example email. "
        "Your job is to convert it into a reusable campaign template by:\n"
        "1. Replacing any personal details (recipient name, company, specific URLs, etc.) "
        "with {{variable}} placeholders like {{first_name}}, {{company}}, {{role}}, {{custom_url}}.\n"
        "2. Preserving the exact tone, structure, and formatting of the original.\n"
        "3. If the input is plain text, wrap the output in clean HTML with proper <p> tags.\n"
        "4. Also derive a subject line template.\n\n"
        "Respond with ONLY a JSON object with keys: subject_template (string), html_template (string), "
        "variables (array of strings listing all placeholder names used)."
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Here is my example email:\n\n{body.raw_email}"},
    ]
    _tpl_user = db.query(User).filter(User.email == email).first()
    _tpl_user_id = _tpl_user.id if _tpl_user else None
    try:
        response = await agenerate(
            role="drafter",
            messages=messages,
            temperature=0.2,
            max_tokens=2000,
            user_id=_tpl_user_id,
            db=db,
        )
        raw = get_text(response).strip()
        # Strip markdown code fences if model returned them
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        start = raw.find("{"); end = raw.rfind("}")
        if start != -1 and end > start:
            raw = raw[start:end + 1]
        data = _json.loads(raw)
        return {
            "subject_template": data.get("subject_template", ""),
            "html_template": data.get("html_template", ""),
            "variables": data.get("variables", []),
        }
    except Exception as e:
        logger.error(f"Template generation failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate template. Please try again.")


# ── Campaign preview (render without sending) ─────────────────────────────────

class PreviewRecipient(BaseModel):
    email: str
    name: Optional[str] = None
    variables: Optional[dict] = None


class CampaignPreviewRequest(BaseModel):
    subject_template: str
    html_template: str
    recipients: list[PreviewRecipient]


@router.post("/campaigns/preview")
async def preview_campaign(body: CampaignPreviewRequest):
    """
    Render personalised subject + html for each recipient WITHOUT sending.
    Returns up to 20 previews so the user can review before launching.
    """
    previews = []
    for r in body.recipients[:20]:
        variables = r.variables or {}
        if r.name:
            variables.setdefault("first_name", r.name.split()[0])
            variables.setdefault("name", r.name)
        variables.setdefault("email", r.email)

        subject = personalise(body.subject_template, variables)
        html_body = personalise(body.html_template, variables)

        previews.append({
            "email": r.email,
            "name": r.name or "",
            "subject": subject,
            "html": html_body,
        })

    return {"previews": previews, "total": len(body.recipients)}


# ── Objection handling ────────────────────────────────────────────────────────

class ObjectionRequest(BaseModel):
    reply_text: str
    contact_name: Optional[str] = None
    company: Optional[str] = None
    original_subject: Optional[str] = None
    product_key: Optional[str] = None   # e.g. "ebic" — loads product-specific rebuttals


@router.post("/contacts/{contact_id}/handle-objection")
async def handle_objection(
    contact_id: int,
    body: ObjectionRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Classifies a reply as objection/positive/neutral and generates a suggested
    response draft the sales rep can review and edit before sending.
    Consults OBJECTION_REBUTTALS KB for stronger responses.
    Saves to ObjectionLog and auto-pauses active sequence enrollment.
    """
    from services.objection_kb import get_rebuttal

    contact = _get_contact_or_404(db, contact_id, email)
    _obj_user = db.query(User).filter(User.email == email).first()
    _obj_user_id = _obj_user.id if _obj_user else None

    system = (
        "You are an expert sales coach who helps reps handle email replies tactfully.\n"
        "Analyse the reply and respond with a JSON object containing:\n"
        "  sentiment: 'positive' | 'neutral' | 'objection'\n"
        "  objection_type: (if sentiment=objection) one of: 'not_interested' | 'wrong_timing' | 'budget' | 'competitor' | 'no_authority' | 'other'\n"
        "  summary: one-sentence summary of what the prospect said\n"
        "  suggested_reply: a concise, professional reply email body (plain text, no subject line) "
        "that acknowledges their concern, provides value, and keeps the conversation open. "
        "Do NOT be pushy. If they are clearly not interested, offer a graceful exit.\n"
        "  subject: a short reply subject line (with Re: prefix if appropriate)"
    )
    context_parts = []
    if body.contact_name:
        context_parts.append(f"Prospect name: {body.contact_name}")
    if body.company:
        context_parts.append(f"Company: {body.company}")
    if body.original_subject:
        context_parts.append(f"Original email subject: {body.original_subject}")
    context_parts.append(f"Their reply:\n{body.reply_text}")

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(context_parts)},
    ]
    try:
        response = await agenerate(
            role="validator",
            messages=messages,
            temperature=0.3,
            response_format="json_object",
            max_tokens=600,
            user_id=_obj_user_id,
            db=db,
        )
        raw = get_text(response)
        data = _json.loads(raw)

        sentiment = data.get("sentiment", "neutral")
        objection_type = data.get("objection_type") or "other"
        summary = data.get("summary", "")
        suggested_reply = data.get("suggested_reply", "")
        subject = data.get("subject", f"Re: {body.original_subject or 'Our conversation'}")
        rebuttal_used: Optional[str] = None

        # If it's an objection, inject KB rebuttal into a second LLM pass for a stronger reply
        if sentiment == "objection":
            # Try product-specific rebuttal first
            product_rebuttal_text: Optional[str] = None
            if body.product_key:
                pkb = _load_product(body.product_key.lower(), email, db)
                if pkb and pkb.get("objection_rebuttals"):
                    # Map objection type to product KB keys
                    obj_map = {
                        "budget": "price", "not_interested": "not_a_priority",
                        "wrong_timing": "timing", "competitor": "tool_overlap",
                        "no_authority": "not_a_priority", "other": "not_a_priority",
                    }
                    pk_key = obj_map.get(objection_type, objection_type)
                    product_rebuttal_text = pkb["objection_rebuttals"].get(pk_key) or \
                                           pkb["objection_rebuttals"].get("not_a_priority")

            rebuttal = get_rebuttal(objection_type)
            rebuttal_context = (
                f"Reframe approach: {product_rebuttal_text or rebuttal['reframe']}\n"
                f"Social proof: {rebuttal['social_proof']}\n"
                f"Concession: {rebuttal['concession']}"
            )
            rebuttal_used = (product_rebuttal_text or rebuttal["reframe"])[:200]

            strengthen_prompt = (
                f"You have already analysed this sales objection.\n"
                f"Prospect name: {body.contact_name or 'the prospect'}\n"
                f"Company: {body.company or 'their company'}\n"
                f"Objection type: {objection_type}\n"
                f"Their message: {body.reply_text}\n\n"
                f"Rebuttal strategy from our playbook:\n{rebuttal_context}\n\n"
                f"Using this strategy, write a stronger, more persuasive reply email body "
                f"(plain text, 3-5 sentences, no subject line). "
                f"Be empathetic, reference a specific pain point or business outcome, "
                f"and end with a low-friction CTA. Return ONLY the email body."
            )
            try:
                strengthen_resp = await agenerate(
                    role="validator",
                    messages=[{"role": "user", "content": strengthen_prompt}],
                    temperature=0.4,
                    max_tokens=500,
                    user_id=_obj_user_id,
                    db=db,
                )
                strengthened = get_text(strengthen_resp).strip()
                if strengthened and len(strengthened) > 20:
                    suggested_reply = strengthened
            except Exception as strengthen_exc:
                logger.warning(f"Rebuttal strengthening failed: {strengthen_exc}")

            # Auto-pause any active sequence enrollment for this contact
            if contact.contact_email:
                try:
                    active_enrollments = db.query(SequenceEnrollment).filter(
                        SequenceEnrollment.user_email == email,
                        SequenceEnrollment.recipient_email == contact.contact_email,
                        SequenceEnrollment.status == "active",
                    ).all()
                    for enrollment in active_enrollments:
                        enrollment.status = "paused"
                        enrollment.pause_reason = "objection_reply"
                    if active_enrollments:
                        logger.info(
                            f"Auto-paused {len(active_enrollments)} enrollment(s) for "
                            f"contact {contact_id} due to objection"
                        )
                except Exception as pause_exc:
                    logger.warning(f"Auto-pause enrollments failed: {pause_exc}")

        # Save to ObjectionLog
        try:
            log_entry = ObjectionLog(
                contact_id=contact_id,
                user_email=email,
                objection_type=objection_type if sentiment == "objection" else "other",
                sentiment=sentiment,
                reply_text=body.reply_text,
                suggested_reply=suggested_reply,
                rebuttal_used=rebuttal_used,
                was_sent=False,
            )
            db.add(log_entry)
            db.commit()
        except Exception as log_exc:
            logger.warning(f"ObjectionLog save failed: {log_exc}")
            try:
                db.rollback()
            except Exception:
                pass

        return {
            "contact_id": contact_id,
            "sentiment": sentiment,
            "objection_type": objection_type if sentiment == "objection" else None,
            "summary": summary,
            "suggested_reply": suggested_reply,
            "subject": subject,
            "rebuttal_used": rebuttal_used,
        }
    except Exception as e:
        logger.error(f"Objection handling failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to analyse reply. Please try again.")


@router.get("/contacts/{contact_id}/objection-history")
async def get_objection_history(
    contact_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Return all ObjectionLog rows for a contact."""
    _get_contact_or_404(db, contact_id, email)
    rows = (
        db.query(ObjectionLog)
        .filter_by(contact_id=contact_id, user_email=email)
        .order_by(ObjectionLog.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "objection_type": r.objection_type,
            "sentiment": r.sentiment,
            "reply_text": r.reply_text,
            "suggested_reply": r.suggested_reply,
            "rebuttal_used": r.rebuttal_used,
            "was_sent": r.was_sent,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ── Cal.com integration ───────────────────────────────────────────────────────

@router.get("/contacts/{contact_id}/booking-link")
async def get_booking_link(
    contact_id: int,
    email: str = Query(...),
    event_type_slug: Optional[str] = Query(None, description="Cal.com event type slug; defaults to ICP cal_link"),
    db: Session = Depends(get_db),
):
    """Generate a personalized Cal.com booking link for this contact."""
    from services.calcom_service import generate_booking_link

    contact = _get_contact_or_404(db, contact_id, email)

    # Resolve slug: explicit param → ICP profile cal_link
    icp = db.query(IcpProfile).filter_by(user_email=email).first()
    icp_cal = (icp.cal_link if icp else None) or _M37_DEFAULT_ICP.get("cal_link", "")
    slug = event_type_slug or (icp_cal.split("/")[-1] if icp_cal else "")
    # cal_username: env var → username portion of icp_cal (e.g. "info-example" from "info-example/ebic-ai-demo")
    cal_username = os.getenv("CAL_USERNAME", "") or (
        "/".join(icp_cal.split("/")[:-1]) if icp_cal and "/" in icp_cal else ""
    )

    if not slug:
        raise HTTPException(status_code=422, detail="event_type_slug is required (or set cal_link in ICP profile).")

    link = await generate_booking_link(
        event_type_slug=slug,
        name=contact.contact_name,
        email=contact.contact_email or "",
        timezone=contact.lead_timezone or "UTC",
        cal_username=cal_username,
        notes=f"Company: {contact.company}",
    )
    if not link:
        raise HTTPException(status_code=422, detail="CAL_USERNAME not configured and no cal_link in ICP profile.")

    return {
        "contact_id": contact_id,
        "booking_link": link,
        "event_type_slug": slug,
        "prefilled_for": contact.contact_name,
    }


@router.get("/contacts/{contact_id}/premeeting-brief")
async def get_premeeting_brief(
    contact_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Return an LLM-generated pre-meeting brief as markdown."""
    from services.calcom_service import generate_premeeting_brief

    contact = _get_contact_or_404(db, contact_id, email)
    brief = await generate_premeeting_brief(
        contact=_contact_dict(contact),
        dossier=contact.dossier or {},
    )
    return {"contact_id": contact_id, "brief": brief}


@router.post("/calcom/webhook", include_in_schema=False)
async def calcom_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Receive Cal.com booking confirmed webhook.
    Creates a SignalEvent on the matching contact + bumps intent_score
    + pauses any active sequence enrollment.
    """
    try:
        payload = await request.json()
    except Exception:
        return {"status": "ignored"}

    trigger = payload.get("triggerEvent") or payload.get("type") or ""
    if "BOOKING_CREATED" not in trigger.upper() and "booking.created" not in trigger.lower():
        return {"status": "ignored"}

    attendees = payload.get("payload", {}).get("attendees") or payload.get("attendees") or []
    attendee_email: Optional[str] = None
    attendee_name: str = ""
    for att in attendees:
        if isinstance(att, dict) and att.get("email"):
            attendee_email = att["email"].lower()
            attendee_name = att.get("name", "")
            break

    if not attendee_email:
        return {"status": "no_attendee"}

    # Find contact by email (across all users)
    contact = db.query(SalesContact).filter(
        SalesContact.contact_email == attendee_email
    ).first()

    if contact:
        now = datetime.now(timezone.utc)
        db.add(SignalEvent(
            contact_id=contact.id,
            user_email=contact.user_email,
            signal_type="meeting_booked",
            signal_metadata={
                "attendee_email": attendee_email,
                "attendee_name": attendee_name,
                "payload_summary": str(payload)[:500],
            },
        ))
        contact.last_signal_at = now

        # Bump intent_score
        all_signals = db.query(SignalEvent).filter_by(contact_id=contact.id).all()
        open_count = sum(1 for s in all_signals if s.signal_type == "email_open")
        contact.intent_score = compute_intent_score(_score_inputs(all_signals), open_count)

        # Pause active sequence enrollments
        if contact.contact_email:
            db.query(SequenceEnrollment).filter(
                SequenceEnrollment.user_email == contact.user_email,
                SequenceEnrollment.recipient_email == contact.contact_email,
                SequenceEnrollment.status == "active",
            ).update({"status": "paused", "pause_reason": "meeting_booked"})

        db.commit()

        # Check escalation
        try:
            from services.escalation_service import check_and_escalate
            await check_and_escalate(contact, db, contact.user_email)
        except Exception as esc_exc:
            logger.warning(f"Escalation check failed on Cal.com webhook: {esc_exc}")

        logger.info(f"Cal.com booking recorded for contact {contact.id} ({attendee_email})")

    return {"status": "ok"}


# ── Escalation management ─────────────────────────────────────────────────────

@router.get("/escalations")
async def list_escalations(
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """List all escalation events for a user."""
    events = (
        db.query(EscalationEvent)
        .filter_by(user_email=email)
        .order_by(EscalationEvent.created_at.desc())
        .limit(100)
        .all()
    )
    result = []
    for ev in events:
        contact = db.query(SalesContact).filter_by(id=ev.contact_id, user_email=email).first()
        result.append({
            "id": ev.id,
            "contact_id": ev.contact_id,
            "contact_name": contact.contact_name if contact else None,
            "company": contact.company if contact else None,
            "intent_score_at_escalation": ev.intent_score_at_escalation,
            "context_brief": ev.context_brief,
            "notified_email": ev.notified_email,
            "notified_slack": ev.notified_slack,
            "human_took_over": ev.human_took_over,
            "created_at": ev.created_at.isoformat() if ev.created_at else None,
        })
    return result


@router.get("/escalations/{escalation_id}")
async def get_escalation(
    escalation_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Single escalation event with full contact signals."""
    event = db.query(EscalationEvent).filter_by(id=escalation_id, user_email=email).first()
    if not event:
        raise HTTPException(status_code=404, detail="Escalation event not found.")
    contact = db.query(SalesContact).filter_by(id=event.contact_id, user_email=email).first()
    signals = (
        db.query(SignalEvent)
        .filter_by(contact_id=event.contact_id, user_email=email)
        .order_by(SignalEvent.created_at.desc())
        .limit(20)
        .all()
    ) if contact else []
    return {
        "id": event.id,
        "contact_id": event.contact_id,
        "contact_name": contact.contact_name if contact else None,
        "company": contact.company if contact else None,
        "contact_email": contact.contact_email if contact else None,
        "intent_score_at_escalation": event.intent_score_at_escalation,
        "context_brief": event.context_brief,
        "notified_email": event.notified_email,
        "notified_slack": event.notified_slack,
        "human_took_over": event.human_took_over,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "signals": [_signal_dict(s) for s in signals],
    }


class EscalationResolveRequest(BaseModel):
    action: str  # "resume" | "cancel"


@router.post("/escalations/{escalation_id}/resolve")
async def resolve_escalation(
    escalation_id: int,
    body: EscalationResolveRequest,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Mark escalation as resolved (human took over) and resume or cancel sequence enrollment."""
    event = db.query(EscalationEvent).filter_by(id=escalation_id, user_email=email).first()
    if not event:
        raise HTTPException(status_code=404, detail="Escalation event not found.")

    if body.action not in ("resume", "cancel"):
        raise HTTPException(status_code=422, detail="action must be 'resume' or 'cancel'")

    event.human_took_over = True

    contact = db.query(SalesContact).filter_by(id=event.contact_id, user_email=email).first()
    affected = 0
    if contact and contact.contact_email:
        enrollments = db.query(SequenceEnrollment).filter(
            SequenceEnrollment.user_email == email,
            SequenceEnrollment.recipient_email == contact.contact_email,
            SequenceEnrollment.status == "paused",
            SequenceEnrollment.pause_reason == "escalation",
        ).all()
        new_status = "active" if body.action == "resume" else "stopped"
        for en in enrollments:
            en.status = new_status
            en.pause_reason = None
        affected = len(enrollments)

    db.commit()
    return {
        "escalation_id": escalation_id,
        "resolved": True,
        "action": body.action,
        "enrollments_affected": affected,
    }


# ── Outreach memory + re-engagement ──────────────────────────────────────────

@router.delete("/contacts/{contact_id}/memory", status_code=204)
async def reset_outreach_memory(
    contact_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Delete all OutreachMemory entries for a contact so angles can be reused."""
    _get_contact_or_404(db, contact_id, email)
    db.query(OutreachMemory).filter_by(contact_id=contact_id, user_email=email).delete()
    db.commit()


@router.get("/contacts/{contact_id}/memory")
async def get_outreach_memory(
    contact_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Return all OutreachMemory entries for a contact (used outreach angles)."""
    _get_contact_or_404(db, contact_id, email)
    rows = (
        db.query(OutreachMemory)
        .filter_by(contact_id=contact_id, user_email=email)
        .order_by(OutreachMemory.used_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "angle": r.angle,
            "message_summary": r.message_summary,
            "channel": r.channel,
            "used_at": r.used_at.isoformat() if r.used_at else None,
        }
        for r in rows
    ]


@router.get("/reengagement")
async def list_reengagement(
    email: str = Query(...),
    status: Optional[str] = Query(None, description="pending | sent | cancelled"),
    db: Session = Depends(get_db),
):
    """List upcoming re-engagement entries for a user."""
    q = db.query(ReengagementEntry).filter_by(user_email=email)
    if status:
        q = q.filter_by(status=status)
    entries = q.order_by(ReengagementEntry.scheduled_at.asc()).limit(100).all()
    result = []
    for e in entries:
        contact = db.query(SalesContact).filter_by(id=e.contact_id, user_email=email).first()
        result.append({
            "id": e.id,
            "contact_id": e.contact_id,
            "contact_name": contact.contact_name if contact else None,
            "company": contact.company if contact else None,
            "scheduled_at": e.scheduled_at.isoformat() if e.scheduled_at else None,
            "hook_theme": e.hook_theme,
            "status": e.status,
            "draft_subject": e.draft_subject,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    return result


@router.post("/reengagement/{entry_id}/send-now")
async def send_reengagement_now(
    entry_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Manually trigger a pending re-engagement entry immediately."""
    from services.reengagement_service import (
        _draft_reengagement_email, get_used_angles, record_outreach_memory,
    )
    from services.bulk_mailer import send_one_tracked

    entry = db.query(ReengagementEntry).filter_by(id=entry_id, user_email=email).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Re-engagement entry not found.")
    if entry.status != "pending":
        raise HTTPException(status_code=409, detail=f"Cannot send entry with status '{entry.status}'.")

    contact = db.query(SalesContact).filter_by(id=entry.contact_id, user_email=email).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found.")
    if not contact.contact_email:
        raise HTTPException(status_code=422, detail="Contact has no email address.")

    used_angles = get_used_angles(entry.contact_id, email, db)
    subject, body, angle_used = await _draft_reengagement_email(
        contact_name=contact.contact_name,
        company=contact.company,
        role=contact.role,
        hook_theme=entry.hook_theme or "industry_news",
        used_angles=used_angles,
        dossier=contact.dossier,
    )

    send_result = await send_one_tracked(
        user_email=email,
        to_email=contact.contact_email,
        subject=subject,
        html_body=body.replace("\n", "<br>"),
    )
    if not send_result["ok"]:
        raise HTTPException(status_code=502, detail="Email send failed.")

    entry.status = "sent"
    entry.draft_subject = subject
    entry.draft_body = body
    record_outreach_memory(
        contact_id=entry.contact_id,
        user_email=email,
        angle=angle_used,
        message_summary=f"Re-engagement ({entry.hook_theme}): {subject}",
        db=db,
        channel="reengagement_email",
    )
    db.commit()
    return {"sent": True, "subject": subject, "to": contact.contact_email}


@router.delete("/reengagement/{entry_id}", status_code=204)
async def cancel_reengagement(
    entry_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Cancel a pending re-engagement entry."""
    entry = db.query(ReengagementEntry).filter_by(id=entry_id, user_email=email).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Re-engagement entry not found.")
    if entry.status != "pending":
        raise HTTPException(status_code=409, detail=f"Cannot cancel entry with status '{entry.status}'.")
    entry.status = "cancelled"
    db.commit()


# ── Bulk validate (dry-run before import) ─────────────────────────────────────

@router.post("/contacts/bulk-validate")
async def bulk_validate_contacts(
    file: UploadFile = File(...),
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Dry-run version of bulk-import: parse the CSV/XLSX, run validation checks
    (email format, required fields, duplicate detection) and return per-row
    results WITHOUT writing anything to the database.
    """
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    filename_lower = (file.filename or "").lower()
    rows: list[dict] = []

    if filename_lower.endswith((".xlsx", ".xls")):
        try:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(content))
            df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
            rows = df.fillna("").astype(str).to_dict(orient="records")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Could not parse Excel file: {e}")
    elif filename_lower.endswith(".csv") or "," in text[:500]:
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            rows.append({k.strip().lower().replace(" ", "_"): v.strip() for k, v in row.items()})
        if not rows or not any(rows[0].values()):
            rows = []
            for line in text.splitlines():
                parts = [p.strip() for p in line.split(",")]
                if not parts[0]:
                    continue
                rows.append({
                    "contact_name": parts[0] if len(parts) > 0 else "",
                    "contact_email": parts[1] if len(parts) > 1 else "",
                    "company": parts[2] if len(parts) > 2 else "",
                    "role": parts[3] if len(parts) > 3 else "",
                    "domain": parts[4] if len(parts) > 4 else "",
                })
    else:
        for line in text.splitlines():
            parts = [p.strip() for p in line.split(",")]
            if not parts[0]:
                continue
            rows.append({
                "contact_name": parts[0],
                "contact_email": parts[1] if len(parts) > 1 else "",
                "company": parts[2] if len(parts) > 2 else "",
                "role": parts[3] if len(parts) > 3 else "",
                "domain": parts[4] if len(parts) > 4 else "",
            })

    if not rows:
        raise HTTPException(status_code=422, detail="No data rows found in file.")

    _ALIASES = {
        "name": "contact_name", "full_name": "contact_name", "fullname": "contact_name",
        "email": "contact_email", "email_address": "contact_email",
        "title": "role", "job_title": "role", "position": "role",
        "website": "domain", "url": "domain",
    }

    def _normalise(row: dict) -> dict:
        out = {}
        for k, v in row.items():
            out[_ALIASES.get(k, k)] = v
        return out

    # Load existing contact emails for this user to detect duplicates
    existing_emails = {
        row[0].lower()
        for row in db.query(SalesContact.contact_email).filter_by(user_email=email).all()
        if row[0]
    }

    email_re = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    seen_in_file: set[str] = set()

    results = []
    for i, raw_row in enumerate(rows):
        row = _normalise(raw_row)
        name = row.get("contact_name", "").strip()
        company = row.get("company", "").strip()
        contact_email = row.get("contact_email", "").strip().lower()
        role = row.get("role", "").strip()
        domain = row.get("domain", "").strip()

        issues = []
        if not name:
            issues.append("missing name")
        if not company:
            issues.append("missing company")
        if contact_email:
            if not email_re.match(contact_email):
                issues.append("invalid email format")
            elif contact_email in existing_emails:
                issues.append("duplicate (already in contacts)")
            elif contact_email in seen_in_file:
                issues.append("duplicate within file")
            else:
                seen_in_file.add(contact_email)
        else:
            issues.append("missing email")

        results.append({
            "row": i + 1,
            "contact_name": name,
            "contact_email": contact_email,
            "company": company,
            "role": role,
            "domain": domain,
            "valid": len(issues) == 0,
            "issues": issues,
        })

    valid_count = sum(1 for r in results if r["valid"])
    return {
        "total": len(results),
        "valid": valid_count,
        "invalid": len(results) - valid_count,
        "rows": results,
    }


@router.get("/campaigns/tags")
async def list_campaign_tags(email: str = Query(...), db: Session = Depends(get_db)):
    """Return all distinct outreach tags the user has used across campaigns."""
    rows = (
        db.query(SalesCampaign.outreach_tag)
        .filter(SalesCampaign.user_email == email, SalesCampaign.outreach_tag.isnot(None))
        .distinct()
        .all()
    )
    return {"tags": sorted(r[0] for r in rows if r[0])}


@router.get("/campaigns")
async def list_campaigns(
    email: str = Query(...),
    outreach_tag: Optional[str] = Query(None, description="Filter campaigns by outreach tag"),
    product_key: Optional[str] = Query(None, description="Filter campaigns by product key"),
    db: Session = Depends(get_db),
):
    q = db.query(SalesCampaign).filter_by(user_email=email)
    if outreach_tag:
        q = q.filter(SalesCampaign.outreach_tag == outreach_tag)
    if product_key:
        q = q.filter(SalesCampaign.product_key == product_key)
    campaigns = q.order_by(SalesCampaign.created_at.desc()).all()
    return [_campaign_dict(c, db) for c in campaigns]


@router.post("/campaigns", status_code=201)
async def create_campaign(
    body: CampaignCreate,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    campaign = SalesCampaign(
        user_email=email,
        name=body.name,
        subject_template=body.subject_template,
        html_template=body.html_template,
        text_template=body.text_template,
        outreach_tag=body.outreach_tag,
        product_key=body.product_key,
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return _campaign_dict(campaign)


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: int, email: str = Query(...), db: Session = Depends(get_db)):
    campaign = _get_campaign_or_404(db, campaign_id, email)
    result = _campaign_dict(campaign, db)
    result["analytics"] = _campaign_analytics(db, campaign_id)
    return result


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    outreach_tag: Optional[str] = None
    product_key: Optional[str] = None
    subject_template: Optional[str] = None
    html_template: Optional[str] = None
    text_template: Optional[str] = None


@router.put("/campaigns/{campaign_id}")
async def update_campaign(
    campaign_id: int,
    body: CampaignUpdate,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Update campaign metadata — name, outreach_tag, or templates. Use this to tag existing campaigns."""
    campaign = _get_campaign_or_404(db, campaign_id, email)
    update_data = body.model_dump(exclude_unset=True)
    # Allow explicitly clearing the tag by passing null
    if "outreach_tag" in update_data:
        campaign.outreach_tag = update_data["outreach_tag"]
    if "product_key" in update_data:
        campaign.product_key = update_data["product_key"]
    for field in ("name", "subject_template", "html_template", "text_template"):
        if field in update_data and update_data[field] is not None:
            setattr(campaign, field, update_data[field])
    db.commit()
    db.refresh(campaign)
    return _campaign_dict(campaign, db)


@router.patch("/campaigns/bulk-tag")
async def bulk_tag_campaigns(
    email: str = Query(...),
    campaign_ids: list[int] = Query(..., description="IDs of campaigns to tag"),
    tag: str = Query(..., description="Tag to apply (empty string to clear)"),
    db: Session = Depends(get_db),
):
    """Apply (or clear) an outreach_tag on multiple campaigns at once."""
    updated = (
        db.query(SalesCampaign)
        .filter(SalesCampaign.user_email == email, SalesCampaign.id.in_(campaign_ids))
        .all()
    )
    tag_value = tag.strip() or None
    for c in updated:
        c.outreach_tag = tag_value
    db.commit()
    return {"updated": len(updated), "tag": tag_value, "campaign_ids": [c.id for c in updated]}


@router.post("/campaigns/{campaign_id}/send")
async def send_campaign_route(
    campaign_id: int,
    body: CampaignSendRequest,
    background_tasks: BackgroundTasks,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Trigger bulk send for a campaign. Recipients are created here."""
    campaign = _get_campaign_or_404(db, campaign_id, email)

    if campaign.status == "sending":
        raise HTTPException(status_code=409, detail="Campaign is already sending.")

    # Verify the sender's Gmail credentials exist before kicking off background send
    try:
        GoogleAuthManager.get_user_tokens(email, api_type="gmail")
    except HTTPException as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=f"Cannot send campaign: {exc.detail}. Please reconnect Gmail in Settings.",
        )

    # Validate recipients + filter suppressed emails
    suppressed_set = {
        row.suppressed_email
        for row in db.query(SuppressedEmail).filter_by(user_email=email).all()
    }
    valid = [
        r for r in body.recipients
        if r.email and "@" in r.email and r.email.strip().lower() not in suppressed_set
    ]
    if not valid:
        raise HTTPException(status_code=422, detail="At least one valid (non-suppressed) recipient email is required.")

    # Build recipient records
    mailer_recipients = []
    for r in valid:
        token = str(uuid.uuid4())
        db.add(CampaignRecipient(
            campaign_id=campaign_id,
            user_email=email,
            recipient_email=r.email.strip().lower(),
            recipient_name=r.name,
            variables=r.variables or {},
            tracking_token=token,
            send_status="pending",
        ))
        mailer_recipients.append({
            "email": r.email.strip().lower(),
            "name": r.name,
            "variables": r.variables or {},
            "token": token,
        })

    # Commit recipients FIRST, then mark sending — avoids race with background task
    campaign.total_recipients = len(valid)
    db.commit()

    campaign.status = "sending"
    db.commit()

    # Send in background via FastAPI BackgroundTasks (survives response completion)
    background_tasks.add_task(
        _do_send,
        campaign_id=campaign_id,
        user_email=email,
        mailer_recipients=mailer_recipients,
        subject_template=campaign.subject_template,
        html_template=campaign.html_template,
        text_template=campaign.text_template,
    )

    return {"message": f"Campaign sending started for {len(valid)} recipients."}


@router.post("/campaigns/{campaign_id}/upload-recipients", status_code=201)
async def upload_campaign_recipients(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Upload a CSV/XLSX of recipients for a campaign and immediately trigger send.

    Required columns (case-insensitive, aliases supported):
      email / contact_email — recipient email address
    Optional:
      name / contact_name   — personalisation
      Any extra columns are passed as template variables ({{column_name}})

    Suppressed emails are silently skipped.
    """
    campaign = _get_campaign_or_404(db, campaign_id, email)
    if campaign.status == "sending":
        raise HTTPException(status_code=409, detail="Campaign is already sending.")

    try:
        GoogleAuthManager.get_user_tokens(email, api_type="gmail")
    except HTTPException as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=f"Cannot send campaign: {exc.detail}. Please reconnect Gmail in Settings.",
        )

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    filename_lower = (file.filename or "").lower()
    rows: list[dict] = []

    if filename_lower.endswith((".xlsx", ".xls")):
        try:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(content))
            df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
            rows = df.fillna("").astype(str).to_dict(orient="records")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Could not parse Excel file: {e}")
    else:
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            rows.append({k.strip().lower().replace(" ", "_"): (v or "").strip() for k, v in row.items()})
        if not rows:
            for line in text.splitlines():
                parts = [p.strip() for p in line.split(",")]
                if not parts[0]:
                    continue
                rows.append({"email": parts[0], "name": parts[1] if len(parts) > 1 else ""})

    if not rows:
        raise HTTPException(status_code=422, detail="No data rows found in file.")

    # Normalise email/name column aliases
    _COL_ALIASES = {
        "contact_email": "email", "email_address": "email",
        "contact_name": "name", "full_name": "name", "fullname": "name", "first_name": "name",
    }
    def _norm(row: dict) -> dict:
        out = {}
        for k, v in row.items():
            out[_COL_ALIASES.get(k, k)] = v
        return out

    suppressed_set = {
        row.suppressed_email
        for row in db.query(SuppressedEmail).filter_by(user_email=email).all()
    }

    mailer_recipients = []
    skipped = 0
    for raw_row in rows:
        row = _norm(raw_row)
        to_email = (row.pop("email", "") or "").strip().lower()
        if not to_email or "@" not in to_email:
            skipped += 1
            continue
        if to_email in suppressed_set:
            skipped += 1
            continue
        name = row.pop("name", "") or ""
        variables: dict = {k: v for k, v in row.items() if v}
        if name:
            variables.setdefault("first_name", name.split()[0])
            variables.setdefault("name", name)
        variables.setdefault("email", to_email)

        token = str(uuid.uuid4())
        db.add(CampaignRecipient(
            campaign_id=campaign_id,
            user_email=email,
            recipient_email=to_email,
            recipient_name=name or None,
            variables=variables,
            tracking_token=token,
            send_status="pending",
        ))
        mailer_recipients.append({"email": to_email, "name": name or None, "variables": variables, "token": token})

    if not mailer_recipients:
        raise HTTPException(status_code=422, detail="No valid (non-suppressed) recipients found in file.")

    campaign.total_recipients = (campaign.total_recipients or 0) + len(mailer_recipients)
    db.commit()
    campaign.status = "sending"
    db.commit()

    background_tasks.add_task(
        _do_send,
        campaign_id=campaign_id,
        user_email=email,
        mailer_recipients=mailer_recipients,
        subject_template=campaign.subject_template,
        html_template=campaign.html_template,
        text_template=campaign.text_template,
    )

    logger.info(f"CSV upload: {len(mailer_recipients)} recipients for campaign {campaign_id}, {skipped} skipped")
    return {
        "message": f"Campaign sending started for {len(mailer_recipients)} recipients.",
        "recipients_added": len(mailer_recipients),
        "skipped": skipped,
    }


@router.get("/campaigns/{campaign_id}/recipients")
async def get_recipients(
    campaign_id: int,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    _get_campaign_or_404(db, campaign_id, email)
    recipients = db.query(CampaignRecipient).filter_by(
        campaign_id=campaign_id, user_email=email
    ).all()
    return [_recipient_dict(r, db) for r in recipients]


# ─────────────────────────────────────────────────────────────────────────────
# Background send task
# ─────────────────────────────────────────────────────────────────────────────

async def _do_send(
    campaign_id: int,
    user_email: str,
    mailer_recipients: list,
    subject_template: str,
    html_template: str,
    text_template: Optional[str],
):
    """Run in background: send emails, then update DB with results."""
    from auth.database import SessionLocal
    db = SessionLocal()
    base_url = _get_base_url()
    logger.info(f"Campaign send using base_url={base_url}")
    try:
        result = await send_campaign(
            user_email=user_email,
            recipients=mailer_recipients,
            subject_template=subject_template,
            html_template=html_template,
            text_template=text_template,
            base_url=base_url,
        )

        # Update each recipient's send status + record outreach memory
        from services.reengagement_service import record_outreach_memory
        campaign_obj = db.query(SalesCampaign).filter_by(id=campaign_id).first()
        campaign_name = campaign_obj.name if campaign_obj else f"campaign_{campaign_id}"
        campaign_tag  = (campaign_obj.outreach_tag or "") if campaign_obj else ""

        for r in result["results"]:
            row = db.query(CampaignRecipient).filter_by(
                tracking_token=r["token"]
            ).first()
            if row:
                row.send_status = r["status"]
                row.sent_at = datetime.now(timezone.utc) if r["status"] == "sent" else None
                if r.get("thread_id"):
                    row.gmail_thread_id = r["thread_id"]

            # Record memory so future outreach never repeats this angle
            if r["status"] == "sent":
                contact = db.query(SalesContact).filter_by(
                    user_email=user_email,
                    contact_email=r["email"],
                ).first()
                if contact:
                    angle = campaign_tag or campaign_name
                    record_outreach_memory(
                        contact_id=contact.id,
                        user_email=user_email,
                        angle=angle,
                        message_summary=f"Sent campaign '{campaign_name}' (tag: {campaign_tag or 'none'})",
                        db=db,
                        channel=f"bulk_campaign_{campaign_id}",
                    )

        # Update campaign totals
        campaign = db.query(SalesCampaign).filter_by(id=campaign_id).first()
        if campaign:
            campaign.sent_count = result["sent"]
            campaign.failed_count = result["failed"]
            campaign.status = "sent"
            campaign.sent_at = datetime.now(timezone.utc)

        db.commit()
        logger.info(f"Campaign {campaign_id} done: {result['sent']} sent, {result['failed']} failed")

    except Exception as e:
        logger.error(f"Campaign {campaign_id} send error: {e}")
        campaign = db.query(SalesCampaign).filter_by(id=campaign_id).first()
        if campaign:
            campaign.status = "paused"
            db.commit()
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_contact_or_404(db: Session, contact_id: int, user_email: str) -> SalesContact:
    contact = db.query(SalesContact).filter_by(id=contact_id, user_email=user_email).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found.")
    return contact


def _get_campaign_or_404(db: Session, campaign_id: int, user_email: str) -> SalesCampaign:
    campaign = db.query(SalesCampaign).filter_by(id=campaign_id, user_email=user_email).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    return campaign


def _contact_dict(c: SalesContact) -> dict:
    session = object_session(c)
    campaign_names = []
    if session and c.contact_email:
        campaign_names = [
            r[0] for r in session.query(SalesCampaign.name)
            .join(CampaignRecipient, CampaignRecipient.campaign_id == SalesCampaign.id)
            .filter(CampaignRecipient.recipient_email == c.contact_email)
            .all()
        ]

    return {
        "id": c.id,
        "contact_name": c.contact_name,
        "contact_email": c.contact_email,
        "company": c.company,
        "role": c.role,
        "domain": c.domain,
        "notes": c.notes,
        "intent_score": c.intent_score,
        "last_signal_at": c.last_signal_at.isoformat() if c.last_signal_at else None,
        "last_contacted_at": c.last_contacted_at.isoformat() if c.last_contacted_at else None,
        "dossier": c.dossier,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        # enrichment
        "linkedin_url": c.linkedin_url,
        "linkedin_headline": c.linkedin_headline,
        "company_size": c.company_size,
        "company_industry": c.company_industry,
        "company_location": c.company_location,
        "company_founded": c.company_founded,
        "company_description": c.company_description,
        "company_logo": c.company_logo,
        "tech_stack": c.tech_stack,
        "company_news": c.company_news,
        "email_verified": c.email_verified,
        "enrichment_status": c.enrichment_status,
        "enrichment_source": c.enrichment_source,
        "enriched_at": c.enriched_at.isoformat() if c.enriched_at else None,
        "lead_timezone": c.lead_timezone,
        "escalated": getattr(c, "escalated", False),
        "escalated_at": c.escalated_at.isoformat() if getattr(c, "escalated_at", None) else None,
        "list_tag": c.list_tag,
        "geo_tag": c.geo_tag,
        "product_key": c.product_key,
        "campaign_names": campaign_names,
    }


def _signal_dict(s: SignalEvent) -> dict:
    return {
        "id": s.id,
        "type": s.signal_type,
        "metadata": s.signal_metadata,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _campaign_dict(c: SalesCampaign, db: Optional[Session] = None) -> dict:
    sent = c.sent_count or 0

    # Compute unique openers/clickers from recipients table for accurate rates
    unique_opens = 0
    unique_clicks = 0
    total_open_events = c.open_count or 0
    if db and sent > 0:
        recipients = db.query(CampaignRecipient).filter_by(campaign_id=c.id).all()
        unique_opens = sum(1 for r in recipients if (r.open_count or 0) > 0)
        unique_clicks = sum(1 for r in recipients if (r.click_count or 0) > 0)
    else:
        unique_opens = min(c.open_count or 0, sent)
        unique_clicks = min(c.click_count or 0, sent)

    return {
        "id": c.id,
        "name": c.name,
        "status": c.status,
        "outreach_tag": c.outreach_tag,
        "product_key": c.product_key,
        "subject_template": c.subject_template,
        "html_template": c.html_template,
        "text_template": c.text_template,
        "total_recipients": c.total_recipients or 0,
        "sent_count": sent,
        "failed_count": c.failed_count or 0,
        "open_count": total_open_events,      # total pixel fires (shows engagement depth)
        "unique_open_count": unique_opens,     # unique recipients who opened
        "click_count": unique_clicks,
        "reply_count": c.reply_count or 0,
        "open_rate": round(unique_opens / sent * 100, 1) if sent else 0,
        "click_rate": round(unique_clicks / sent * 100, 1) if sent else 0,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "sent_at": c.sent_at.isoformat() if c.sent_at else None,
    }


def _recipient_dict(r: CampaignRecipient, db: Optional[Session] = None) -> dict:
    lead_tz = None
    if db:
        contact = db.query(SalesContact).filter_by(
            user_email=r.user_email, contact_email=r.recipient_email
        ).first()
        if contact:
            lead_tz = contact.lead_timezone or _infer_timezone(contact.company_location)
    return {
        "id": r.id,
        "email": r.recipient_email,
        "name": r.recipient_name,
        "send_status": r.send_status,
        "open_count": r.open_count,
        "click_count": r.click_count,
        "first_opened_at": r.first_opened_at.isoformat() if r.first_opened_at else None,
        "last_opened_at": r.last_opened_at.isoformat() if r.last_opened_at else None,
        "first_clicked_at": r.first_clicked_at.isoformat() if r.first_clicked_at else None,
        "sent_at": r.sent_at.isoformat() if r.sent_at else None,
        "lead_timezone": lead_tz,
    }


def _campaign_analytics(db: Session, campaign_id: int) -> dict:
    recipients = db.query(CampaignRecipient).filter_by(campaign_id=campaign_id).all()
    total = len(recipients)
    sent = sum(1 for r in recipients if r.send_status == "sent")
    opened = sum(1 for r in recipients if r.open_count > 0)
    clicked = sum(1 for r in recipients if r.click_count > 0)
    multi_open = sum(1 for r in recipients if r.open_count > 2)
    return {
        "total_recipients": total,
        "sent": sent,
        "opened_unique": opened,
        "clicked_unique": clicked,
        "multiple_opens": multi_open,
        "open_rate": round(opened / sent * 100, 1) if sent else 0,
        "click_rate": round(clicked / sent * 100, 1) if sent else 0,
        "click_to_open_rate": round(clicked / opened * 100, 1) if opened else 0,
    }
