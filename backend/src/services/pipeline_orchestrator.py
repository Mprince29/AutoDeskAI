"""
Agentic Sales Pipeline Orchestrator
====================================
Single-entry-point service that chains the full outreach pipeline:

  1. Parse prompt → extract ICP filters + product key
  2. Find leads (SerpAPI LinkedIn scrape)
  3. Save leads to CRM (dedup + org-level dedup)
  4. Enrich contacts (PDL / Clearbit / news signals)
  5. Generate per-contact dossier + personalized email opening
  6. Create campaign with proper HTML formatting
  7. Send campaign
       • test_mode=True  → all sends redirect to test_recipients only
       • test_mode=False → sends to real leads
  8. Auto-enroll recipients in follow-up sequence (if sequence_id provided)

Streams progress via async generator of JSON-serialisable dicts.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from loguru import logger
from sqlalchemy.orm import Session

from auth.models import (
    SalesCampaign, CampaignRecipient, SalesContact,
    SuppressedEmail, SequenceEnrollment, IcpProfile,
)
from services.lead_enrichment import find_leads, find_leads_from_icp, enrich_contact
from services.research_dossier import generate_contact_dossier
from services.bulk_mailer import (
    send_one_tracked, generate_personalized_opening,
    inject_tracking, _inject_unsubscribe, personalise,
)
from utils.llm_router import agenerate, get_text


# ── Safety gate (process-level, survives restarts via env override) ───────────
# The env var PIPELINE_LIVE_MODE=1 lets ops flip the gate without a redeploy.
# The DB-persisted toggle (set via the API) takes precedence at runtime.
_LIVE_MODE: bool = os.getenv("PIPELINE_LIVE_MODE", "0") == "1"


def get_live_mode() -> bool:
    return _LIVE_MODE


def set_live_mode(enabled: bool) -> None:
    global _LIVE_MODE
    _LIVE_MODE = enabled
    logger.info(f"Pipeline live mode: {'ON — sending to real recipients' if enabled else 'OFF — test mode active'}")


# ── HTML email wrapper ────────────────────────────────────────────────────────
_HTML_WRAPPER = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body {{ margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; }}
  .wrap {{ max-width:600px; margin:32px auto; background:#ffffff; border-radius:6px;
           border:1px solid #e0e0e0; overflow:hidden; }}
  .body {{ padding:32px 36px; font-size:15px; line-height:1.7; color:#222222; }}
  .body p {{ margin:0 0 16px; }}
  .body ul {{ margin:0 0 16px; padding-left:20px; }}
  .body li {{ margin-bottom:6px; }}
  .footer {{ padding:16px 36px; background:#f9f9f9; border-top:1px solid #e8e8e8;
             font-size:12px; color:#888888; }}
</style>
</head>
<body>
<div class="wrap">
  <div class="body">{body_html}</div>
  <div class="footer">{footer_html}</div>
</div>
</body>
</html>
"""


def _plain_to_html(text: str) -> str:
    """Convert plain-text email template to clean HTML paragraphs."""
    lines = text.split("\n")
    html_parts: list[str] = []
    in_list = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_list:
                html_parts.append("</ul>")
                in_list = False
            html_parts.append("")
            continue

        if stripped.startswith("•") or stripped.startswith("-") or stripped.startswith("*"):
            if not in_list:
                html_parts.append("<ul>")
                in_list = True
            item = stripped.lstrip("•-* ").strip()
            html_parts.append(f"<li>{item}</li>")
        else:
            if in_list:
                html_parts.append("</ul>")
                in_list = False
            html_parts.append(f"<p>{stripped}</p>")

    if in_list:
        html_parts.append("</ul>")

    return "\n".join(p for p in html_parts if p != "")


def wrap_email_html(plain_or_html: str, sender_name: str = "", sender_title: str = "") -> str:
    """Wrap a plain-text or minimal HTML email body in the branded HTML shell."""
    if plain_or_html.strip().lower().startswith("<!doctype") or "<html" in plain_or_html.lower():
        body_html = plain_or_html
    else:
        body_html = _plain_to_html(plain_or_html)

    sig_parts = []
    if sender_name:
        sig_parts.append(f"<strong>{sender_name}</strong>")
    if sender_title:
        sig_parts.append(sender_title)

    footer_html = " | ".join(sig_parts) if sig_parts else "M37 Labs"
    footer_html += (
        ' &nbsp;·&nbsp; <a href="{unsubscribe_url}" style="color:#888;">Unsubscribe</a>'
    )

    return _HTML_WRAPPER.format(body_html=body_html, footer_html=footer_html)


# ── Step event helpers ────────────────────────────────────────────────────────
def _evt(step: str, status: str, message: str, data: dict | None = None) -> dict:
    return {
        "step": step,
        "status": status,   # "running" | "done" | "error" | "skipped"
        "message": message,
        "data": data or {},
        "ts": datetime.now(timezone.utc).isoformat(),
    }


# ── LLM prompt parser ─────────────────────────────────────────────────────────
async def _parse_pipeline_prompt(prompt: str, product_key: str | None) -> dict:
    """
    Extract structured pipeline parameters from a natural-language prompt.
    Returns dict with: product_key, job_titles, industries, locations,
    company_sizes, keywords, lead_limit, email_number, send_hour_local, timezone_name
    """
    system = (
        "You are a sales pipeline configurator. Extract structured outreach parameters "
        "from the user's request. Return ONLY valid JSON, nothing else.\n\n"
        "Output schema:\n"
        "{\n"
        '  "product_key": string or null,   // ebic | ebic-agency | retailio | example | null\n'
        '  "job_titles": [string],\n'
        '  "industries": [string],\n'
        '  "locations": [string],\n'
        '  "company_sizes": [string],\n'
        '  "keywords": [string],\n'
        '  "lead_limit": int,               // default 50, max 200\n'
        '  "email_number": 1 or 2,          // which email template to use\n'
        '  "send_hour_local": int,           // 0-23, local hour to send, default 9\n'
        '  "timezone_name": string           // e.g. "Asia/Kolkata", default "UTC"\n'
        "}"
    )
    raw = await agenerate(
        role="classifier",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )
    text = get_text(raw).strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        parsed = json.loads(text)
    except Exception:
        parsed = {}

    # Override product_key if explicitly supplied
    if product_key:
        parsed["product_key"] = product_key

    parsed.setdefault("lead_limit", 50)
    parsed.setdefault("email_number", 1)
    parsed.setdefault("send_hour_local", 9)
    parsed.setdefault("timezone_name", "UTC")
    parsed["lead_limit"] = min(int(parsed.get("lead_limit") or 50), 200)
    return parsed


# ── Core per-contact email personalisation ────────────────────────────────────
async def _build_recipient(
    contact: SalesContact,
    html_template: str,
    subject_template: str,
    sender_name: str,
    sender_title: str,
    cta_link: str,
    email_number: int,
    db: Session,
) -> dict:
    """
    Generate a fully personalised email for one contact.
    Returns {email, name, subject, html_body, variables, token}.
    """
    dossier = contact.dossier or {}

    # Generate dossier if missing
    if not dossier.get("pain_points"):
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
                signals=[],
            )
            contact.dossier = dossier
            db.commit()
        except Exception as e:
            logger.warning(f"Dossier failed for {contact.contact_name}: {e}")

    # Generate personalized opening
    try:
        opening = await generate_personalized_opening(
            contact_dossier=dossier,
            recipient_name=contact.contact_name,
            company=contact.company,
            role=contact.role or "",
        )
    except Exception:
        first = contact.contact_name.split()[0] if contact.contact_name else "there"
        opening = f"I came across {contact.company}'s work and wanted to reach out to you, {first}."

    first_name = contact.contact_name.split()[0] if contact.contact_name else "there"
    variables = {
        "FirstName": first_name,
        "first_name": first_name,
        "Personalisation": opening,
        "CalLink": cta_link or "",
        "SenderName": sender_name or "",
        "DeckLink": "",
        "VideoLink": "",
        "company": contact.company or "",
        "role": contact.role or "",
    }

    subject = personalise(subject_template, variables)
    html_body = personalise(html_template, variables)

    return {
        "email": (contact.contact_email or "").strip().lower(),
        "name": contact.contact_name,
        "subject": subject,
        "html_body": html_body,
        "variables": variables,
        "token": str(uuid.uuid4()),
        "dossier": dossier,
    }


# ── Main pipeline ─────────────────────────────────────────────────────────────
async def run_pipeline(
    *,
    prompt: str,
    user_email: str,
    product_key: str | None,
    test_recipients: list[str],
    db: Session,
    follow_up_sequence_id: int | None = None,
    force_live: bool = False,
) -> AsyncGenerator[str, None]:
    """
    Full agentic pipeline. Yields newline-delimited JSON strings (NDJSON).

    Safety gate:
      • If _LIVE_MODE is False AND force_live is False → sends only to test_recipients
      • If _LIVE_MODE is True OR force_live is True   → sends to real leads
    """
    live = _LIVE_MODE or force_live
    base_url = os.getenv("BASE_URL", "http://localhost:8000")

    async def emit(evt: dict) -> str:
        return json.dumps(evt) + "\n"

    # ── Step 1: Parse prompt ──────────────────────────────────────────────────
    yield await emit(_evt("parse", "running", "Parsing your prompt..."))
    try:
        params = await _parse_pipeline_prompt(prompt, product_key)
        yield await emit(_evt("parse", "done", "Prompt parsed.", {"params": params}))
    except Exception as e:
        yield await emit(_evt("parse", "error", f"Failed to parse prompt: {e}"))
        return

    resolved_product_key = params.get("product_key") or product_key or "example"

    # Load product KB
    from routes.sales_routes import _load_product, _M37_DEFAULT_ICP
    pkb = _load_product(resolved_product_key, user_email, db)
    if not pkb:
        icp = db.query(IcpProfile).filter_by(user_email=user_email).first()
        pkb = None
        icp_defaults = _M37_DEFAULT_ICP
    else:
        icp_defaults = None

    sender_name  = (pkb or {}).get("sender_name") or ""
    sender_title = (pkb or {}).get("sender_title") or ""
    cta_link     = (pkb or {}).get("cal_link") or (icp_defaults or {}).get("cal_link") or ""
    email_number = params.get("email_number", 1)
    tpl_key      = "email2_template" if email_number == 2 else "email1_template"
    email_tpl    = (pkb or icp_defaults or {}).get(tpl_key) or ""
    product_name = (pkb or {}).get("display_name") or resolved_product_key

    # Build HTML template from plain-text PKB template
    html_template = wrap_email_html(email_tpl, sender_name, sender_title) if email_tpl else ""
    subject_template = f"Quick question, {{{{FirstName}}}} — {product_name}"

    # ── Step 2: Find leads ────────────────────────────────────────────────────
    yield await emit(_evt("find_leads", "running", "Searching for leads matching your ICP..."))
    try:
        job_titles     = params.get("job_titles") or (pkb or {}).get("icp_job_titles") or []
        industries     = params.get("industries") or (pkb or {}).get("icp_industries") or []
        locations      = params.get("locations") or (pkb or {}).get("icp_locations") or []
        company_sizes  = params.get("company_sizes") or (pkb or {}).get("icp_company_sizes") or []
        keywords       = params.get("keywords") or (pkb or {}).get("icp_keywords") or []
        lead_limit     = params.get("lead_limit", 50)

        if not job_titles and not industries:
            # Fall back to natural-language ICP description
            icp_desc = (pkb or {}).get("icp_persona_description") or prompt
            _, leads = await find_leads_from_icp(icp_desc, limit=lead_limit)
        else:
            leads = await find_leads(
                job_titles=job_titles,
                industries=industries,
                locations=locations,
                company_sizes=company_sizes,
                seniority_levels=(pkb or {}).get("icp_seniority_levels") or [],
                keywords=keywords,
                limit=lead_limit,
            )

        if not leads:
            yield await emit(_evt("find_leads", "error", "No leads found for the given ICP."))
            return

        yield await emit(_evt("find_leads", "done", f"Found {len(leads)} leads.", {"count": len(leads)}))
    except Exception as e:
        yield await emit(_evt("find_leads", "error", f"Lead search failed: {e}"))
        return

    # ── Step 3: Save leads to CRM (dedup) ────────────────────────────────────
    yield await emit(_evt("save_leads", "running", f"Saving {len(leads)} leads to CRM (deduplicating)..."))
    try:
        from routes.sales_routes import _guess_domain_from_company
        org_domain = user_email.split("@")[-1] if "@" in user_email else None
        _PUBLIC = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"}
        is_private_org = org_domain and org_domain not in _PUBLIC

        saved_contacts: list[SalesContact] = []
        created_count = 0
        skipped_count = 0

        for lead in leads:
            contact_email = (lead.get("contact_email") or "").strip().lower() or None
            company = (lead.get("company") or "").strip()
            name = (lead.get("contact_name") or "").strip()
            if not name or not company:
                skipped_count += 1
                continue

            # Dedup: same user
            existing = None
            if contact_email:
                existing = db.query(SalesContact).filter_by(
                    user_email=user_email, contact_email=contact_email
                ).first()
            if not existing:
                existing = db.query(SalesContact).filter_by(
                    user_email=user_email, contact_name=name, company=company
                ).first()

            # Org-level dedup
            if not existing and is_private_org and contact_email:
                org_claim = db.query(SalesContact).filter(
                    SalesContact.contact_email == contact_email,
                    SalesContact.user_email.like(f"%@{org_domain}"),
                    SalesContact.user_email != user_email,
                ).first()
                if org_claim:
                    skipped_count += 1
                    continue

            if existing:
                saved_contacts.append(existing)
                continue

            domain = lead.get("domain") or _guess_domain_from_company(company) or ""
            contact = SalesContact(
                user_email=user_email,
                contact_name=name,
                contact_email=contact_email,
                company=company,
                role=lead.get("role") or lead.get("title") or "",
                domain=domain,
                linkedin_url=lead.get("linkedin_url") or "",
                company_size=lead.get("company_size") or "",
                company_industry=lead.get("industry") or "",
                company_location=lead.get("location") or "",
                product_key=resolved_product_key,
                enrichment_status="pending",
            )
            db.add(contact)
            db.flush()
            saved_contacts.append(contact)
            created_count += 1

        db.commit()
        yield await emit(_evt("save_leads", "done",
            f"Saved {created_count} new contacts, {skipped_count} skipped (duplicates).",
            {"created": created_count, "skipped": skipped_count, "total": len(saved_contacts)},
        ))
    except Exception as e:
        db.rollback()
        yield await emit(_evt("save_leads", "error", f"Failed to save leads: {e}"))
        return

    if not saved_contacts:
        yield await emit(_evt("save_leads", "skipped", "No new contacts to process — all were duplicates."))
        return

    # ── Step 4: Enrich contacts (background, limited concurrency) ────────────
    yield await emit(_evt("enrich", "running", f"Enriching {len(saved_contacts)} contacts..."))
    enriched_count = 0
    sem = asyncio.Semaphore(3)

    async def _enrich_one(c: SalesContact):
        nonlocal enriched_count
        async with sem:
            try:
                updates = await enrich_contact(
                    contact_name=c.contact_name,
                    company=c.company,
                    domain=c.domain or "",
                    role=c.role or "",
                    linkedin_url=c.linkedin_url or "",
                )
                for k, v in updates.items():
                    if v and hasattr(c, k):
                        setattr(c, k, v)
                c.enrichment_status = "enriched"
                enriched_count += 1
            except Exception as e:
                logger.warning(f"Enrichment failed for {c.contact_name}: {e}")

    await asyncio.gather(*[_enrich_one(c) for c in saved_contacts])
    try:
        db.commit()
    except Exception:
        db.rollback()

    yield await emit(_evt("enrich", "done",
        f"Enriched {enriched_count}/{len(saved_contacts)} contacts.",
        {"enriched": enriched_count},
    ))

    # ── Step 5: Filter — only contacts with a valid email ────────────────────
    suppressed_set = {
        row.suppressed_email
        for row in db.query(SuppressedEmail).filter_by(user_email=user_email).all()
    }
    sendable = [
        c for c in saved_contacts
        if c.contact_email and "@" in c.contact_email
        and c.contact_email.strip().lower() not in suppressed_set
    ]

    if not sendable:
        yield await emit(_evt("email_gen", "error",
            "No contacts have verified email addresses — cannot send campaign."))
        return

    yield await emit(_evt("email_gen", "running",
        f"Generating personalised emails for {len(sendable)} contacts..."))

    # ── Step 6: Generate personalised email per contact ───────────────────────
    recipients: list[dict] = []
    gen_sem = asyncio.Semaphore(5)

    async def _gen_one(c: SalesContact):
        async with gen_sem:
            try:
                r = await _build_recipient(
                    contact=c,
                    html_template=html_template,
                    subject_template=subject_template,
                    sender_name=sender_name,
                    sender_title=sender_title,
                    cta_link=cta_link,
                    email_number=email_number,
                    db=db,
                )
                if r["email"]:
                    recipients.append(r)
            except Exception as e:
                logger.warning(f"Email gen failed for {c.contact_name}: {e}")

    await asyncio.gather(*[_gen_one(c) for c in sendable])
    yield await emit(_evt("email_gen", "done",
        f"Generated {len(recipients)} personalised emails.",
        {"count": len(recipients)},
    ))

    # ── Step 7: Create campaign record ───────────────────────────────────────
    yield await emit(_evt("create_campaign", "running", "Creating campaign record..."))
    try:
        campaign_name = (
            f"[{'TEST' if not live else 'LIVE'}] {product_name} "
            f"— {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC"
        )
        campaign = SalesCampaign(
            user_email=user_email,
            name=campaign_name,
            subject_template=subject_template,
            html_template=html_template,
            text_template=None,
            outreach_tag=resolved_product_key,
            product_key=resolved_product_key,
            status="sending",
            total_recipients=len(recipients),
        )
        db.add(campaign)
        db.commit()
        db.refresh(campaign)
        yield await emit(_evt("create_campaign", "done",
            f"Campaign '{campaign_name}' created (ID {campaign.id}).",
            {"campaign_id": campaign.id, "name": campaign_name},
        ))
    except Exception as e:
        db.rollback()
        yield await emit(_evt("create_campaign", "error", f"Failed to create campaign: {e}"))
        return

    # ── Step 8: Send ──────────────────────────────────────────────────────────
    mode_label = "TEST MODE — sending to test recipients only" if not live else "LIVE MODE"
    yield await emit(_evt("send", "running",
        f"Sending emails ({mode_label})...",
        {"live": live, "recipient_count": len(recipients)},
    ))

    sent_count = 0
    failed_count = 0

    for r in recipients:
        actual_to = r["email"]

        if not live:
            # Safety gate: redirect to test recipients
            if not test_recipients:
                yield await emit(_evt("send", "error",
                    "Test mode is ON but no test_recipients provided. Aborting send."))
                campaign.status = "paused"
                db.commit()
                return
            actual_to = test_recipients[sent_count % len(test_recipients)]

        token = r["token"]
        html_body = inject_tracking(r["html_body"], token, base_url)
        html_body = _inject_unsubscribe(html_body, token, base_url)

        try:
            db.add(CampaignRecipient(
                campaign_id=campaign.id,
                user_email=user_email,
                recipient_email=r["email"],      # always store real email
                recipient_name=r["name"],
                variables=r["variables"],
                tracking_token=token,
                send_status="pending",
            ))
            db.commit()
        except Exception:
            db.rollback()

        send_result = await send_one_tracked(
            user_email=user_email,
            to_email=actual_to,
            subject=r["subject"],
            html_body=html_body,
        )

        if send_result["ok"]:
            sent_count += 1
            try:
                row = db.query(CampaignRecipient).filter_by(tracking_token=token).first()
                if row:
                    row.send_status = "sent"
                    row.sent_at = datetime.now(timezone.utc)
                    row.gmail_thread_id = send_result.get("thread_id")
                db.commit()
            except Exception:
                db.rollback()
        else:
            failed_count += 1
            try:
                row = db.query(CampaignRecipient).filter_by(tracking_token=token).first()
                if row:
                    row.send_status = "failed"
                db.commit()
            except Exception:
                db.rollback()

        await asyncio.sleep(1.2)   # respect Gmail rate limits

    campaign.sent_count = sent_count
    campaign.failed_count = failed_count
    campaign.status = "sent"
    campaign.sent_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except Exception:
        db.rollback()

    yield await emit(_evt("send", "done",
        f"Sent {sent_count} emails, {failed_count} failed. "
        f"{'[TEST MODE — real recipients NOT contacted]' if not live else '[LIVE SEND]'}",
        {"sent": sent_count, "failed": failed_count, "live": live, "campaign_id": campaign.id},
    ))

    # ── Step 9: Auto-enroll in follow-up sequence ─────────────────────────────
    if follow_up_sequence_id and sent_count > 0:
        yield await emit(_evt("sequence_enroll", "running",
            f"Enrolling {sent_count} recipients in follow-up sequence {follow_up_sequence_id}..."))
        try:
            from routes.sequence_routes import _next_send_utc
            send_hour = params.get("send_hour_local", 9)
            tz_name = params.get("timezone_name", "UTC")
            enrolled = 0

            for r in recipients:
                if not r["email"]:
                    continue
                already = db.query(SequenceEnrollment).filter_by(
                    sequence_id=follow_up_sequence_id,
                    recipient_email=r["email"],
                    user_email=user_email,
                ).first()
                if already:
                    continue
                next_send = _next_send_utc(tz_name, send_hour, delay_days=3)
                db.add(SequenceEnrollment(
                    sequence_id=follow_up_sequence_id,
                    user_email=user_email,
                    recipient_email=r["email"],
                    recipient_name=r["name"],
                    variables=r["variables"],
                    timezone=tz_name,
                    current_step=1,
                    status="active",
                    next_send_at=next_send,
                ))
                enrolled += 1

            db.commit()
            yield await emit(_evt("sequence_enroll", "done",
                f"Enrolled {enrolled} recipients in follow-up sequence.",
                {"enrolled": enrolled},
            ))
        except Exception as e:
            db.rollback()
            yield await emit(_evt("sequence_enroll", "error", f"Sequence enroll failed: {e}"))

    # ── Done ──────────────────────────────────────────────────────────────────
    yield await emit(_evt("pipeline_complete", "done",
        f"Pipeline complete. {sent_count} emails sent via "
        f"{'TEST MODE' if not live else 'LIVE MODE'}. Campaign ID: {campaign.id}.",
        {
            "campaign_id": campaign.id,
            "leads_found": len(leads),
            "contacts_created": created_count,
            "emails_sent": sent_count,
            "live_mode": live,
        },
    ))


# ─────────────────────────────────────────────────────────────────────────────
# Two-phase pipeline: find_leads_phase → user decision → send_outreach_phase
# ─────────────────────────────────────────────────────────────────────────────

import time as _time

# In-memory store keyed by job_id. Expires after 30 minutes.
_LEAD_JOBS: dict[str, dict] = {}
_JOB_TTL = 1800  # seconds


def _cleanup_expired_jobs():
    now = _time.time()
    expired = [k for k, v in _LEAD_JOBS.items() if v.get("expires_at", 0) < now]
    for k in expired:
        del _LEAD_JOBS[k]


async def find_leads_phase(
    *,
    prompt: str,
    user_email: str,
    product_key: str | None,
    db,
) -> AsyncGenerator[str, None]:
    """
    Phase 1 of the two-step pipeline.

    Steps: parse → find_leads → save_leads
    Ends with a "decision_required" event containing a job_id.
    The frontend stores the job_id and lets the user pick:
      - "send_with_email_export_rest": send outreach to leads that have emails, export the rest as CSV
      - "export_all": export all leads as CSV (don't send anything)

    The resulting SSE stream also includes per-step events identical to run_pipeline.
    """
    _cleanup_expired_jobs()

    async def emit(evt: dict) -> str:
        return json.dumps(evt) + "\n"

    yield await emit(_evt("parse", "running", "Parsing your prompt..."))
    try:
        params = await _parse_pipeline_prompt(prompt, product_key)
        yield await emit(_evt("parse", "done", "Prompt parsed.", {"params": params}))
    except Exception as e:
        yield await emit(_evt("parse", "error", f"Failed to parse prompt: {e}"))
        return

    resolved_product_key = params.get("product_key") or product_key or "example"
    from routes.sales_routes import _load_product, _M37_DEFAULT_ICP
    pkb = _load_product(resolved_product_key, user_email, db)
    icp_defaults = None if pkb else _M37_DEFAULT_ICP

    yield await emit(_evt("find_leads", "running", "Searching for leads matching your ICP..."))
    try:
        job_titles    = params.get("job_titles") or (pkb or {}).get("icp_job_titles") or []
        industries    = params.get("industries") or (pkb or {}).get("icp_industries") or []
        locations     = params.get("locations") or (pkb or {}).get("icp_locations") or []
        company_sizes = params.get("company_sizes") or (pkb or {}).get("icp_company_sizes") or []
        keywords      = params.get("keywords") or (pkb or {}).get("icp_keywords") or []
        lead_limit    = params.get("lead_limit", 50)

        if not job_titles and not industries:
            icp_desc = (pkb or {}).get("icp_persona_description") or prompt
            _, leads = await find_leads_from_icp(icp_desc, limit=lead_limit)
        else:
            leads = await find_leads(
                job_titles=job_titles,
                industries=industries,
                locations=locations,
                company_sizes=company_sizes,
                seniority_levels=(pkb or {}).get("icp_seniority_levels") or [],
                keywords=keywords,
                limit=lead_limit,
            )

        if not leads:
            yield await emit(_evt("find_leads", "error", "No leads found for the given ICP."))
            return

        yield await emit(_evt("find_leads", "done", f"Found {len(leads)} leads.", {"count": len(leads)}))
    except Exception as e:
        yield await emit(_evt("find_leads", "error", f"Lead search failed: {e}"))
        return

    yield await emit(_evt("save_leads", "running", f"Saving {len(leads)} leads to CRM..."))
    try:
        from routes.sales_routes import _guess_domain_from_company
        org_domain = user_email.split("@")[-1] if "@" in user_email else None
        _PUBLIC = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"}
        is_private_org = org_domain and org_domain not in _PUBLIC

        saved_contacts: list[SalesContact] = []
        created_count = 0
        skipped_count = 0

        for lead in leads:
            contact_email = (lead.get("contact_email") or "").strip().lower() or None
            company = (lead.get("company") or "").strip()
            name = (lead.get("contact_name") or "").strip()
            if not name or not company:
                skipped_count += 1
                continue

            existing = None
            if contact_email:
                existing = db.query(SalesContact).filter_by(
                    user_email=user_email, contact_email=contact_email
                ).first()
            if not existing:
                existing = db.query(SalesContact).filter_by(
                    user_email=user_email, contact_name=name, company=company
                ).first()
            if not existing and is_private_org and contact_email:
                org_claim = db.query(SalesContact).filter(
                    SalesContact.contact_email == contact_email,
                    SalesContact.user_email.like(f"%@{org_domain}"),
                    SalesContact.user_email != user_email,
                ).first()
                if org_claim:
                    skipped_count += 1
                    continue

            if existing:
                saved_contacts.append(existing)
                continue

            domain = lead.get("domain") or _guess_domain_from_company(company) or ""
            contact = SalesContact(
                user_email=user_email,
                contact_name=name,
                contact_email=contact_email,
                company=company,
                role=lead.get("role") or lead.get("title") or "",
                domain=domain,
                linkedin_url=lead.get("linkedin_url") or "",
                company_size=lead.get("company_size") or "",
                company_industry=lead.get("industry") or "",
                company_location=lead.get("location") or "",
                product_key=resolved_product_key,
                enrichment_status="pending",
            )
            db.add(contact)
            db.flush()
            saved_contacts.append(contact)
            created_count += 1

        db.commit()
        yield await emit(_evt("save_leads", "done",
            f"Saved {created_count} new contacts, {skipped_count} skipped.",
            {"created": created_count, "skipped": skipped_count, "total": len(saved_contacts)},
        ))
    except Exception as e:
        db.rollback()
        yield await emit(_evt("save_leads", "error", f"Failed to save leads: {e}"))
        return

    # Split contacts into has-email vs no-email
    contacts_with_email = [c for c in saved_contacts if c.contact_email and "@" in c.contact_email]
    contacts_without_email = [c for c in saved_contacts if not (c.contact_email and "@" in c.contact_email)]

    job_id = str(uuid.uuid4())
    _LEAD_JOBS[job_id] = {
        "expires_at": _time.time() + _JOB_TTL,
        "contact_ids_with_email": [c.id for c in contacts_with_email],
        "contact_ids_without_email": [c.id for c in contacts_without_email],
        "params": params,
        "resolved_product_key": resolved_product_key,
        "user_email": user_email,
        "leads_total": len(saved_contacts),
    }

    def _contact_preview(c: SalesContact) -> dict:
        return {
            "id": c.id,
            "contact_name": c.contact_name,
            "contact_email": c.contact_email or None,
            "company": c.company,
            "role": c.role or "",
            "linkedin_url": c.linkedin_url or "",
            "location": c.company_location or "",
            "has_email": bool(c.contact_email and "@" in c.contact_email),
        }

    yield await emit(_evt("decision_required", "waiting",
        f"Found {len(saved_contacts)} leads: {len(contacts_with_email)} have email addresses, "
        f"{len(contacts_without_email)} don't. What would you like to do?",
        {
            "job_id": job_id,
            "total_leads": len(saved_contacts),
            "with_email": len(contacts_with_email),
            "without_email": len(contacts_without_email),
            # All saved contacts included so the frontend can render them immediately
            # without a separate API call — they are already committed to DB.
            "contacts": [_contact_preview(c) for c in saved_contacts],
            "options": [
                {
                    "id": "send_with_email_export_rest",
                    "label": f"Send outreach to {len(contacts_with_email)} leads with emails, export {len(contacts_without_email)} as CSV",
                },
                {
                    "id": "export_all",
                    "label": f"Export all {len(saved_contacts)} leads as CSV (don't send emails)",
                },
            ],
        },
    ))


def get_leads_csv(job_id: str, which: str = "no_email") -> bytes | None:
    """
    Generate a CSV of leads from a stored job.
    which: "all" | "no_email" | "with_email"
    Returns CSV bytes or None if job not found / expired.
    """
    import csv
    import io

    job = _LEAD_JOBS.get(job_id)
    if not job or job.get("expires_at", 0) < _time.time():
        return None

    from auth.database import SessionLocal
    db = SessionLocal()
    try:
        if which == "no_email":
            ids = job["contact_ids_without_email"]
        elif which == "with_email":
            ids = job["contact_ids_with_email"]
        else:
            ids = job["contact_ids_with_email"] + job["contact_ids_without_email"]

        if not ids:
            return b"contact_name,contact_email,company,role,linkedin_url\n"

        contacts = db.query(SalesContact).filter(SalesContact.id.in_(ids)).all()
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=["contact_name", "contact_email", "company", "role", "linkedin_url", "location"])
        writer.writeheader()
        for c in contacts:
            writer.writerow({
                "contact_name": c.contact_name or "",
                "contact_email": c.contact_email or "",
                "company": c.company or "",
                "role": c.role or "",
                "linkedin_url": c.linkedin_url or "",
                "location": c.company_location or "",
            })
        return buf.getvalue().encode("utf-8")
    finally:
        db.close()


async def send_outreach_phase(
    *,
    job_id: str,
    decision: str,           # "send_with_email_export_rest" | "export_all"
    test_recipients: list[str],
    force_live: bool = False,
    follow_up_sequence_id: int | None = None,
    db,
) -> AsyncGenerator[str, None]:
    """
    Phase 2: execute the user's decision from find_leads_phase.

    decision="send_with_email_export_rest":
      - Enrich + email-gen + send to contacts_with_email
      - Returns CSV download URL for contacts_without_email
    decision="export_all":
      - Returns CSV download URL for all contacts (no sending)
    """
    async def emit(evt: dict) -> str:
        return json.dumps(evt) + "\n"

    job = _LEAD_JOBS.get(job_id)
    if not job or job.get("expires_at", 0) < _time.time():
        yield await emit(_evt("error", "error", "Job expired or not found. Please re-run lead search."))
        return

    user_email = job["user_email"]
    params = job["params"]
    resolved_product_key = job["resolved_product_key"]
    live = _LIVE_MODE or force_live
    base_url = os.getenv("BASE_URL", "http://localhost:8000")

    if decision == "export_all":
        yield await emit(_evt("export", "done",
            f"All {job['leads_total']} leads are ready to export as CSV.",
            {"job_id": job_id, "which": "all", "count": job["leads_total"]},
        ))
        yield await emit(_evt("pipeline_complete", "done", "Export ready. No emails were sent.",
            {"job_id": job_id, "emails_sent": 0, "live_mode": False},
        ))
        return

    # decision == "send_with_email_export_rest"
    contact_ids = job["contact_ids_with_email"]
    no_email_count = len(job["contact_ids_without_email"])

    if not contact_ids:
        yield await emit(_evt("send", "error", "None of the found leads have email addresses. Nothing to send."))
        return

    # Reload contacts from DB
    contacts = db.query(SalesContact).filter(SalesContact.id.in_(contact_ids)).all()

    # Load product KB for templates
    from routes.sales_routes import _load_product, _M37_DEFAULT_ICP
    pkb = _load_product(resolved_product_key, user_email, db)
    icp_defaults = None if pkb else _M37_DEFAULT_ICP

    sender_name  = (pkb or {}).get("sender_name") or ""
    sender_title = (pkb or {}).get("sender_title") or ""
    cta_link     = (pkb or {}).get("cal_link") or (icp_defaults or {}).get("cal_link") or ""
    email_number = params.get("email_number", 1)
    tpl_key      = "email2_template" if email_number == 2 else "email1_template"
    email_tpl    = (pkb or icp_defaults or {}).get(tpl_key) or ""
    product_name = (pkb or {}).get("display_name") or resolved_product_key
    html_template = wrap_email_html(email_tpl, sender_name, sender_title) if email_tpl else ""
    subject_template = f"Quick question, {{{{FirstName}}}} — {product_name}"

    # Enrich
    yield await emit(_evt("enrich", "running", f"Enriching {len(contacts)} contacts..."))
    enriched_count = 0
    sem = asyncio.Semaphore(3)

    async def _enrich_one(c: SalesContact):
        nonlocal enriched_count
        async with sem:
            try:
                updates = await enrich_contact(
                    contact_name=c.contact_name,
                    company=c.company,
                    domain=c.domain or "",
                    role=c.role or "",
                    linkedin_url=c.linkedin_url or "",
                )
                for k, v in updates.items():
                    if v and hasattr(c, k):
                        setattr(c, k, v)
                c.enrichment_status = "enriched"
                enriched_count += 1
            except Exception as e:
                logger.warning(f"Enrichment failed for {c.contact_name}: {e}")

    await asyncio.gather(*[_enrich_one(c) for c in contacts])
    try:
        db.commit()
    except Exception:
        db.rollback()

    yield await emit(_evt("enrich", "done",
        f"Enriched {enriched_count}/{len(contacts)} contacts.",
        {"enriched": enriched_count},
    ))

    # Filter suppressed
    from auth.models import SuppressedEmail
    suppressed_set = {
        row.suppressed_email
        for row in db.query(SuppressedEmail).filter_by(user_email=user_email).all()
    }
    sendable = [
        c for c in contacts
        if c.contact_email and c.contact_email.strip().lower() not in suppressed_set
    ]

    if not sendable:
        yield await emit(_evt("email_gen", "error", "All contacts are suppressed."))
        return

    yield await emit(_evt("email_gen", "running", f"Generating personalised emails for {len(sendable)} contacts..."))
    recipients: list[dict] = []
    gen_sem = asyncio.Semaphore(5)

    async def _gen_one(c: SalesContact):
        async with gen_sem:
            try:
                r = await _build_recipient(
                    contact=c,
                    html_template=html_template,
                    subject_template=subject_template,
                    sender_name=sender_name,
                    sender_title=sender_title,
                    cta_link=cta_link,
                    email_number=email_number,
                    db=db,
                )
                if r["email"]:
                    recipients.append(r)
            except Exception as e:
                logger.warning(f"Email gen failed for {c.contact_name}: {e}")

    await asyncio.gather(*[_gen_one(c) for c in sendable])
    yield await emit(_evt("email_gen", "done", f"Generated {len(recipients)} emails.", {"count": len(recipients)}))

    # Create campaign
    yield await emit(_evt("create_campaign", "running", "Creating campaign record..."))
    try:
        campaign_name = (
            f"[{'TEST' if not live else 'LIVE'}] {product_name} "
            f"— {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC"
        )
        from auth.models import SalesCampaign
        campaign = SalesCampaign(
            user_email=user_email,
            name=campaign_name,
            subject_template=subject_template,
            html_template=html_template,
            text_template=None,
            outreach_tag=resolved_product_key,
            product_key=resolved_product_key,
            status="sending",
            total_recipients=len(recipients),
        )
        db.add(campaign)
        db.commit()
        db.refresh(campaign)
        yield await emit(_evt("create_campaign", "done",
            f"Campaign '{campaign_name}' created (ID {campaign.id}).",
            {"campaign_id": campaign.id, "name": campaign_name},
        ))
    except Exception as e:
        db.rollback()
        yield await emit(_evt("create_campaign", "error", f"Failed to create campaign: {e}"))
        return

    # Send
    mode_label = "TEST MODE" if not live else "LIVE MODE"
    yield await emit(_evt("send", "running",
        f"Sending emails ({mode_label})...",
        {"live": live, "recipient_count": len(recipients)},
    ))

    sent_count = 0
    failed_count = 0

    for r in recipients:
        actual_to = r["email"] if live else (test_recipients[sent_count % len(test_recipients)] if test_recipients else r["email"])
        token = r["token"]
        html_body = inject_tracking(r["html_body"], token, base_url)
        html_body = _inject_unsubscribe(html_body, token, base_url)

        from auth.models import CampaignRecipient
        try:
            db.add(CampaignRecipient(
                campaign_id=campaign.id,
                user_email=user_email,
                recipient_email=r["email"],
                recipient_name=r["name"],
                variables=r["variables"],
                tracking_token=token,
                send_status="pending",
            ))
            db.commit()
        except Exception:
            db.rollback()

        send_result = await send_one_tracked(
            user_email=user_email,
            to_email=actual_to,
            subject=r["subject"],
            html_body=html_body,
        )

        if send_result["ok"]:
            sent_count += 1
            try:
                row = db.query(CampaignRecipient).filter_by(tracking_token=token).first()
                if row:
                    row.send_status = "sent"
                    row.sent_at = datetime.now(timezone.utc)
                    row.gmail_thread_id = send_result.get("thread_id")
                db.commit()
            except Exception:
                db.rollback()
        else:
            failed_count += 1
            try:
                row = db.query(CampaignRecipient).filter_by(tracking_token=token).first()
                if row:
                    row.send_status = "failed"
                db.commit()
            except Exception:
                db.rollback()

        await asyncio.sleep(1.2)

    campaign.sent_count = sent_count
    campaign.failed_count = failed_count
    campaign.status = "sent"
    campaign.sent_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except Exception:
        db.rollback()

    # Auto-enroll in follow-up sequence
    if follow_up_sequence_id and sent_count > 0:
        yield await emit(_evt("sequence_enroll", "running",
            f"Enrolling {sent_count} recipients in follow-up sequence..."))
        try:
            from routes.sequence_routes import _next_send_utc
            from auth.models import SequenceEnrollment
            send_hour = params.get("send_hour_local", 9)
            tz_name = params.get("timezone_name", "UTC")
            enrolled = 0
            for r in recipients:
                if not r["email"]:
                    continue
                already = db.query(SequenceEnrollment).filter_by(
                    sequence_id=follow_up_sequence_id,
                    recipient_email=r["email"],
                    user_email=user_email,
                ).first()
                if already:
                    continue
                next_send = _next_send_utc(tz_name, send_hour, delay_days=2)
                db.add(SequenceEnrollment(
                    sequence_id=follow_up_sequence_id,
                    user_email=user_email,
                    recipient_email=r["email"],
                    recipient_name=r["name"],
                    variables=r["variables"],
                    current_step=1,
                    status="active",
                    next_send_at=next_send,
                ))
                enrolled += 1
            db.commit()
            yield await emit(_evt("sequence_enroll", "done",
                f"Enrolled {enrolled} recipients.",
                {"enrolled": enrolled},
            ))
        except Exception as e:
            db.rollback()
            yield await emit(_evt("sequence_enroll", "error", f"Sequence enroll failed: {e}"))

    no_email_msg = f" {no_email_count} leads without emails are ready for CSV export (use job_id)." if no_email_count else ""
    yield await emit(_evt("pipeline_complete", "done",
        f"Done. {sent_count} emails sent via {mode_label}.{no_email_msg}",
        {
            "campaign_id": campaign.id,
            "emails_sent": sent_count,
            "live_mode": live,
            "no_email_leads": no_email_count,
            "job_id": job_id,
        },
    ))
