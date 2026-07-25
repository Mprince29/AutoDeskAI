"""
Bulk Mailer Service
- Sends personalized emails via Gmail API (existing user OAuth)
- Injects a tracking pixel per recipient (open tracking)
- Rewrites links with redirect URLs (click tracking)
- Injects unsubscribe footer
- Per-user send rate cap: max 500/day, 40/min (in-memory, resets on restart)
"""
import asyncio
import base64
import os
import re
from collections import deque
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional
from loguru import logger

from mcp_servers.core.google_auth import GoogleAuthManager


# ── Per-user rate limiter (in-memory) ────────────────────────────────────────
# Stores UTC timestamps of recent sends per sender email.
_SEND_TIMESTAMPS: dict[str, deque] = {}   # email → deque of UTC timestamps
_DAY_CAP = int(os.getenv("MAIL_DAY_CAP", "500"))
_MIN_CAP  = int(os.getenv("MAIL_MIN_CAP", "40"))


def _rate_check(user_email: str) -> Optional[str]:
    """
    Returns an error string if the user is over their rate limit, else None.
    Prunes old timestamps on each call.
    """
    now = datetime.now(timezone.utc).timestamp()
    ts = _SEND_TIMESTAMPS.setdefault(user_email, deque())

    # Prune older than 24h
    while ts and ts[0] < now - 86400:
        ts.popleft()

    # Day cap
    if len(ts) >= _DAY_CAP:
        return f"Daily send limit ({_DAY_CAP}) reached for {user_email}. Resets in 24h."

    # Minute cap — count last 60s
    recent = sum(1 for t in ts if t > now - 60)
    if recent >= _MIN_CAP:
        return f"Per-minute send limit ({_MIN_CAP}/min) reached. Will auto-resume."

    return None


def _record_send(user_email: str):
    now = datetime.now(timezone.utc).timestamp()
    _SEND_TIMESTAMPS.setdefault(user_email, deque()).append(now)


# ── Plain-text → HTML converter ─────────────────────────────────────────────

def _plain_to_html(text: str) -> str:
    """
    Convert a plain-text email body (with \\n newlines) to minimal HTML so it
    renders correctly when attached as MIME type 'html'.
    If the text already contains HTML tags, return it unchanged.
    """
    if "<" in text and ">" in text and re.search(r"<[a-zA-Z]", text):
        return text  # already HTML
    # Escape HTML special chars except we'll re-add links below
    escaped = (
        text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    # Wrap each paragraph (double-newline separated block) in <p>
    paragraphs = re.split(r'\n{2,}', escaped)
    html_parts = []
    for para in paragraphs:
        # Single newlines within a paragraph → <br>
        para = para.replace("\n", "<br>")
        html_parts.append(f"<p>{para}</p>")
    body = "\n".join(html_parts)
    # Re-linkify plain URLs (http/https)
    body = re.sub(
        r'(?<![="\'])((https?://)[^\s<&]+)',
        lambda m: f'<a href="{m.group(1)}">{m.group(1)}</a>',
        body,
    )
    return (
        '<html><body style="font-family:Arial,sans-serif;font-size:14px;'
        'line-height:1.6;color:#222;max-width:600px;margin:0 auto;">'
        f"{body}</body></html>"
    )


# ── Link rewriter ────────────────────────────────────────────────────────────
def inject_tracking(html_body: str, recipient_token: str, base_url: str) -> str:
    """
    1. Replace all href links with click-tracking redirects.
    2. Append a 1x1 tracking pixel for open tracking.
    """
    def _rewrite_link(match: re.Match) -> str:
        quote = match.group(1)
        original_url = match.group(2)
        if original_url.startswith("mailto:") or original_url.startswith("#"):
            return match.group(0)
        encoded = base64.urlsafe_b64encode(original_url.encode()).decode().rstrip("=")
        redirect = f"{base_url}/api/sales/track/click/{recipient_token}?u={encoded}"
        return f'href={quote}{redirect}{quote}'

    tracked = re.sub(r'href=(["\'])([^"\']+)\1', _rewrite_link, html_body, flags=re.IGNORECASE)

    def _linkify(m: re.Match) -> str:
        url = m.group(1)
        encoded = base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
        redirect = f"{base_url}/api/sales/track/click/{recipient_token}?u={encoded}"
        return f'<a href="{redirect}">{url}</a>'

    tracked = re.sub(
        r'(?<!=")(?<!=\')(https?://[^\s<>"\']+)',
        _linkify,
        tracked,
        flags=re.IGNORECASE,
    )

    pixel = (
        f'<img src="{base_url}/api/sales/track/open/{recipient_token}" '
        f'width="1" height="1" border="0" alt="" />'
    )
    if "</body>" in tracked.lower():
        tracked = re.sub(r"</body>", f"{pixel}</body>", tracked, flags=re.IGNORECASE)
    else:
        tracked += pixel

    return tracked


def _inject_unsubscribe(html_body: str, token: str, base_url: str) -> str:
    """Append a minimal unsubscribe footer before </body> or at the end."""
    unsub_url = f"{base_url}/api/sales/unsubscribe/{token}"
    footer = (
        f'<p style="font-size:11px;color:#aaa;text-align:center;margin-top:32px;'
        f'border-top:1px solid #eee;padding-top:12px;">'
        f'You received this email because you are on our outreach list. '
        f'<a href="{unsub_url}" style="color:#aaa;">Unsubscribe</a></p>'
    )
    if "</body>" in html_body.lower():
        return re.sub(r"</body>", f"{footer}</body>", html_body, flags=re.IGNORECASE)
    return html_body + footer


async def generate_personalized_opening(
    contact_dossier: Optional[dict],
    recipient_name: str,
    company: str,
    role: str,
    user_id: Optional[int] = None,
    db=None,
) -> str:
    """
    Generate a unique, human-sounding opening sentence per recipient.

    Priority order:
    1. Recent campaign they ran
    2. Notable client they serve
    3. Award / recognition
    4. Icebreaker from dossier
    5. Buying signal (funding/hiring/news)
    6. Fallback: role+company

    Returns a single sentence. Tone must feel like a real person typed it quickly —
    no buzzwords, no corporate phrasing, no flattery.
    """
    try:
        from utils.llm_router import agenerate, get_text

        dossier = contact_dossier or {}
        first_name = recipient_name.split()[0] if recipient_name else "there"

        recent_campaigns = dossier.get("recent_campaigns") or []
        notable_clients  = dossier.get("notable_clients") or []
        awards           = dossier.get("awards") or []
        icebreakers      = dossier.get("icebreakers") or []
        buying_signals   = dossier.get("buying_signals") or []

        _HUMAN_RULES = (
            "CRITICAL RULES for tone — this must sound like a real person, not AI:\n"
            "- Short and direct. Under 20 words.\n"
            "- No buzzwords: never use 'leverage', 'synergy', 'game-changer', 'cutting-edge', "
            "'innovative', 'transformative', 'excited to connect', 'hope this finds you well'.\n"
            "- No flattery. No 'impressive work' or 'love what you're doing'.\n"
            "- Conversational — like something you'd actually text a colleague.\n"
            "- Return ONLY the sentence. No quotes, no explanation."
        )

        async def _llm(prompt: str, temp: float = 0.7, max_tok: int = 60) -> str:
            resp = await agenerate(
                role="validator",
                messages=[{"role": "user", "content": f"{prompt}\n\n{_HUMAN_RULES}"}],
                temperature=temp,
                max_tokens=max_tok,
                user_id=user_id,
                db=db,
            )
            return get_text(resp).strip().strip('"').strip("'")

        if recent_campaigns:
            s = await _llm(
                f"Write an opening line for a cold email to {first_name} at {company}. "
                f"Reference this thing they ran: '{recent_campaigns[0]}'. "
                f"Sound like you genuinely noticed it, not like you're sucking up."
            )
            if s and len(s) > 10:
                return s

        if notable_clients:
            s = await _llm(
                f"Write an opening line for a cold email to {first_name} at {company}. "
                f"You noticed they work with {notable_clients[0]}. Just mention it naturally."
            )
            if s and len(s) > 10:
                return s

        if awards:
            s = await _llm(
                f"Write an opening line for a cold email to {first_name} at {company}. "
                f"Reference this: '{awards[0]}'. Be brief, not gushing."
            )
            if s and len(s) > 10:
                return s

        if icebreakers:
            s = await _llm(
                f"Rewrite this as a natural cold email opener for {first_name} at {company} ({role}). "
                f"Keep it under 18 words. Sound human.\n\nOriginal: {icebreakers[0]}"
            )
            if s and len(s) > 10:
                return s

        if buying_signals:
            s = await _llm(
                f"Write an opening line for a cold email to {first_name} at {company}. "
                f"You saw this recent news about them: '{buying_signals[0]}'. "
                f"Reference it briefly without being sycophantic.",
                temp=0.6,
            )
            if s and len(s) > 10:
                return s

        s = await _llm(
            f"Write a short, natural opening line for a cold email to {first_name}, "
            f"who is {role} at {company}. Specific to their context. Under 15 words."
        )
        if s and len(s) > 10:
            return s

    except Exception as e:
        logger.warning(f"generate_personalized_opening failed for {recipient_name} at {company}: {e}")

    first_name = recipient_name.split()[0] if recipient_name else "there"
    return f"Came across {company} and thought this might be relevant for you, {first_name}."


# ── Plain-text personalisation ───────────────────────────────────────────────
def personalise(template: str, variables: dict, dossier: Optional[dict] = None) -> str:
    """
    Replace {{variable}} placeholders in a template string.
    If dossier is provided and template contains {{personalized_opening}},
    the opening is generated synchronously using a cached placeholder
    (async generation must be done before calling personalise in async contexts).
    """
    for key, value in variables.items():
        template = template.replace(f"{{{{{key}}}}}", str(value))
    # Clean up double blank lines left when a placeholder resolved to "" (e.g. Personalisation)
    template = re.sub(r'\n{3,}', '\n\n', template)
    unfilled = re.findall(r"\{\{(\w+)\}\}", template)
    if unfilled:
        logger.warning(f"Unfilled placeholders in email template: {unfilled}")
    return template


async def personalise_with_opening(
    template: str,
    variables: dict,
    dossier: Optional[dict] = None,
    recipient_name: str = "",
    company: str = "",
    role: str = "",
) -> str:
    """
    Async version of personalise that also generates a unique personalized opening.
    Replaces {{personalized_opening}} with an LLM-generated sentence.
    """
    needs_opening = "{{personalized_opening}}" in template or "{{Personalisation}}" in template
    if needs_opening:
        opening = await generate_personalized_opening(dossier, recipient_name, company, role)
        variables = {**variables, "personalized_opening": opening, "Personalisation": opening}
    return personalise(template, variables, dossier)


# ── Gmail send (single message) ──────────────────────────────────────────────
async def send_one_tracked(
    user_email: str,
    to_email: str,
    subject: str,
    html_body: str,
    text_body: Optional[str] = None,
    thread_id: Optional[str] = None,
) -> dict:
    """
    Send a single pre-rendered email via the user's Gmail OAuth credentials.
    Returns {"ok": bool, "thread_id": str|None}.
    Pass thread_id to send as a reply in an existing thread.
    """
    try:
        service, _ = await GoogleAuthManager.get_service_async("gmail", "v1", user_email)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = user_email
        msg["To"] = to_email

        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        body: dict = {"raw": base64.urlsafe_b64encode(msg.as_bytes()).decode().rstrip("=")}
        if thread_id:
            body["threadId"] = thread_id

        result = await asyncio.to_thread(
            lambda: service.users().messages().send(userId="me", body=body).execute()
        )
        _record_send(user_email)
        returned_thread_id = result.get("threadId")
        return {"ok": True, "thread_id": returned_thread_id}

    except Exception as e:
        logger.error(f"Gmail send failed | sender={user_email} | to={to_email} | error={e}")
        return {"ok": False, "thread_id": None}


# Back-compat: callers that only check truthiness of the return value still work.
_send_one = send_one_tracked


# ── Bulk send campaign ───────────────────────────────────────────────────────
async def send_campaign(
    user_email: str,
    recipients: list[dict],   # [{email, name, variables, token}]
    subject_template: str,
    html_template: str,
    text_template: Optional[str],
    base_url: str,
    delay_seconds: float = 1.5,
) -> dict:
    """
    Send a campaign email to all recipients with tracking + unsubscribe injected.
    Respects per-user rate caps — queues remaining sends with short sleeps.
    """
    sent = 0
    failed = 0
    results = []

    for idx, recipient in enumerate(recipients):
        to_email = recipient["email"]
        variables = dict(recipient.get("variables", {}))
        token = recipient["token"]

        # Normalize variable aliases so PascalCase templates work with snake_case inputs
        # first_name → FirstName, name → FirstName fallback
        if "FirstName" not in variables:
            variables["FirstName"] = variables.get("first_name") or recipient.get("name") or ""
        if "first_name" not in variables:
            variables["first_name"] = variables.get("FirstName", "")
        # Personalisation placeholder — default to empty so it's cleanly removed
        variables.setdefault("Personalisation", "")
        variables.setdefault("personalisation", "")
        # Ensure Name alias
        variables.setdefault("Name", variables.get("name") or variables.get("FirstName", ""))

        # Rate cap check — wait if at per-minute limit
        for _ in range(90):   # max ~90s wait
            err = _rate_check(user_email)
            if not err:
                break
            if "Daily" in err:
                logger.warning(err)
                results.append({"email": to_email, "status": "rate_limited", "token": token})
                failed += 1
                # Skip remaining sends — day cap hit
                for remaining in recipients[idx + 1:]:
                    results.append({"email": remaining["email"], "status": "rate_limited", "token": remaining["token"]})
                    failed += 1
                return {"sent": sent, "failed": failed, "results": results}
            await asyncio.sleep(1)

        subject = personalise(subject_template, variables)
        html_body = _plain_to_html(personalise(html_template, variables))
        text_body = personalise(text_template, variables) if text_template else None

        html_body = inject_tracking(html_body, token, base_url)
        html_body = _inject_unsubscribe(html_body, token, base_url)

        result = await send_one_tracked(user_email, to_email, subject, html_body, text_body)

        if result["ok"]:
            sent += 1
            results.append({"email": to_email, "status": "sent", "token": token, "thread_id": result["thread_id"]})
        else:
            failed += 1
            results.append({"email": to_email, "status": "failed", "token": token, "thread_id": None})

        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

    return {"sent": sent, "failed": failed, "results": results}
