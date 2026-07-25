"""
Network Guardian Tools - Phase 3
PII redaction, outbound content scanning, sensitivity flagging, and audit log queries.
All tools are self-contained - uses regex-based PII detection, no external APIs.
"""

import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from loguru import logger

from mcp_servers.core.mcp_tools import mcp_tool

# ── PII regex patterns ────────────────────────────────────────────────────────
_PII_PATTERNS: Dict[str, str] = {
    "email":       r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    "phone":       r"\b(\+?\d[\d\-\s\(\)]{7,14}\d)\b",
    "ssn":         r"\b\d{3}-\d{2}-\d{4}\b",
    "credit_card": r"\b(?:\d[ \-]?){13,16}\b",
    "ip_address":  r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
}

_SENSITIVITY_LEVELS = ("LOW", "MEDIUM", "HIGH", "CRITICAL")


def _scan_pii(text: str, types: Optional[List[str]] = None) -> Dict[str, int]:
    """Return count of each PII type found."""
    patterns = {k: v for k, v in _PII_PATTERNS.items() if not types or k in types}
    return {ptype: len(re.findall(pattern, text)) for ptype, pattern in patterns.items()}


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp_tool(
    name="redact_pii",
    description=(
        "Scan text and replace detected PII (email, phone, SSN, credit card, IP address) "
        "with [REDACTED:type] placeholders. Returns redacted text and counts of what was found."
    ),
    parameters={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to scan and redact."},
            "pii_types": {
                "type": "array",
                "items": {"type": "string"},
                "description": "PII types to redact: email, phone, ssn, credit_card, ip_address. Defaults to all.",
            },
        },
        "required": ["text"],
    },
    provider="all",
    category="guardian",
    approval_required=False,
    credentials_required=False,
)
async def tool_redact_pii(
    user_email: str, db, text: str, pii_types: Optional[List[str]] = None
) -> dict:
    patterns = {k: v for k, v in _PII_PATTERNS.items() if not pii_types or k in pii_types}
    redacted = text
    findings: Dict[str, int] = {}
    for ptype, pattern in patterns.items():
        matches = re.findall(pattern, redacted)
        if matches:
            findings[ptype] = len(matches)
            redacted = re.sub(pattern, f"[REDACTED:{ptype.upper()}]", redacted)
        else:
            findings[ptype] = 0
    return {
        "redacted_text": redacted,
        "findings": findings,
        "total_redactions": sum(findings.values()),
        "original_length": len(text),
        "redacted_length": len(redacted),
    }


@mcp_tool(
    name="scan_outbound_content",
    description=(
        "Scan content about to be sent externally. Checks for PII exposure and "
        "returns a safety verdict with warnings. Use before sending emails or posting to APIs."
    ),
    parameters={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "Text content to scan."},
            "recipient_emails": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of recipient email addresses to validate.",
            },
        },
        "required": ["content"],
    },
    provider="all",
    category="guardian",
    approval_required=False,
    credentials_required=False,
)
async def tool_scan_outbound_content(
    user_email: str,
    db,
    content: str,
    recipient_emails: Optional[List[str]] = None,
) -> dict:
    pii_found = _scan_pii(content)
    warnings = []
    safe = True

    high_risk = ["ssn", "credit_card"]
    for ptype in high_risk:
        if pii_found.get(ptype, 0) > 0:
            warnings.append(f"HIGH RISK: {pii_found[ptype]} {ptype.replace('_', ' ')}(s) detected in outbound content.")
            safe = False

    if pii_found.get("email", 0) > 3:
        warnings.append(f"NOTICE: {pii_found['email']} email addresses detected - verify intentional disclosure.")

    # Validate recipient domains if provided
    domain_violations = []
    if recipient_emails:
        for addr in recipient_emails:
            if "@" not in addr:
                domain_violations.append(f"Invalid email format: {addr}")
        if domain_violations:
            warnings.extend(domain_violations)
            safe = False

    # Attempt to reuse existing exfiltration validator if available
    try:
        from services.exfiltration_validator import GLOBAL_EXFILTRATION_VALIDATOR
        if hasattr(GLOBAL_EXFILTRATION_VALIDATOR, "validate"):
            result = GLOBAL_EXFILTRATION_VALIDATOR.validate(content)
            if result and not result.get("safe", True):
                warnings.append(f"Exfiltration validator: {result.get('reason', 'blocked')}")
                safe = False
    except Exception:
        pass

    return {
        "safe": safe,
        "pii_found": pii_found,
        "total_pii_count": sum(pii_found.values()),
        "domain_violations": domain_violations,
        "warnings": warnings,
    }


@mcp_tool(
    name="flag_sensitive_data",
    description=(
        "Classify the sensitivity level of text as LOW, MEDIUM, HIGH, or CRITICAL "
        "based on PII density and data type. Use to decide if content needs redaction."
    ),
    parameters={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to classify."},
        },
        "required": ["text"],
    },
    provider="all",
    category="guardian",
    approval_required=False,
    credentials_required=False,
)
async def tool_flag_sensitive_data(user_email: str, db, text: str) -> dict:
    pii = _scan_pii(text)
    total = sum(pii.values())

    has_ssn = pii.get("ssn", 0) > 0
    has_cc = pii.get("credit_card", 0) > 0

    if has_ssn and has_cc and total >= 5:
        level = "CRITICAL"
        reason = "Multiple high-risk PII types (SSN + credit card) with high density detected."
    elif has_ssn or has_cc:
        level = "HIGH"
        reason = f"{'SSN' if has_ssn else 'Credit card number'} detected - requires redaction before sharing."
    elif total >= 3:
        level = "MEDIUM"
        reason = f"{total} PII instances detected across types: {', '.join(k for k, v in pii.items() if v > 0)}."
    else:
        level = "LOW"
        reason = "No high-risk PII detected." if total == 0 else f"Minor PII detected ({total} instance(s))."

    return {
        "sensitivity_level": level,
        "reason": reason,
        "pii_counts": pii,
        "total_pii": total,
    }


@mcp_tool(
    name="audit_tool_call_log",
    description=(
        "Query the tool call audit log. Filter by agent_id, tool_name, or time window. "
        "Useful for security reviews and usage monitoring."
    ),
    parameters={
        "type": "object",
        "properties": {
            "agent_id": {"type": "integer", "description": "Filter by agent ID (optional)."},
            "tool_name": {"type": "string", "description": "Filter by tool name (optional)."},
            "hours_back": {"type": "integer", "description": "How many hours back to query (default 24)."},
            "limit": {"type": "integer", "description": "Max entries to return (default 50)."},
        },
        "required": [],
    },
    provider="all",
    category="guardian",
    approval_required=False,
    credentials_required=False,
)
async def tool_audit_tool_call_log(
    user_email: str,
    db,
    agent_id: Optional[int] = None,
    tool_name: Optional[str] = None,
    hours_back: int = 24,
    limit: int = 50,
) -> dict:
    # Forward-compat guard: AgentToolCallLog is created in Phase 4.
    # Until then, return an empty result rather than crashing.
    try:
        from models import AgentToolCallLog
        since = datetime.utcnow() - timedelta(hours=hours_back)

        q = db.query(AgentToolCallLog).filter(
            AgentToolCallLog.user_email == user_email,
            AgentToolCallLog.called_at >= since,
        )
        if agent_id is not None:
            q = q.filter(AgentToolCallLog.agent_id == agent_id)
        if tool_name:
            q = q.filter(AgentToolCallLog.tool_name == tool_name)

        rows = q.order_by(AgentToolCallLog.called_at.desc()).limit(limit).all()
        entries = [
            {
                "id": r.id,
                "tool_name": r.tool_name,
                "agent_id": r.agent_id,
                "was_blocked": r.was_blocked,
                "error_message": r.error_message,
                "duration_ms": r.duration_ms,
                "called_at": r.called_at.isoformat() if r.called_at else None,
            }
            for r in rows
        ]
        return {"entries": entries, "count": len(entries), "hours_back": hours_back}

    except Exception as e:
        if "no such table" in str(e).lower() or "AgentToolCallLog" in str(e):
            return {
                "entries": [],
                "count": 0,
                "warning": "Audit log table not yet initialized (Phase 4 pending). No data available.",
            }
        return {"error": f"Audit log query failed: {e}"}


@mcp_tool(
    name="generate_audit_report",
    description=(
        "Generate a structured markdown audit report of agent tool calls for a time period. "
        "Shows total calls, tools used, blocked calls, and error rates."
    ),
    parameters={
        "type": "object",
        "properties": {
            "hours_back": {"type": "integer", "description": "Time window in hours (default 24)."},
            "agent_id": {"type": "integer", "description": "Restrict report to a specific agent (optional)."},
        },
        "required": [],
    },
    provider="all",
    category="guardian",
    approval_required=False,
    credentials_required=False,
)
async def tool_generate_audit_report(
    user_email: str, db, hours_back: int = 24, agent_id: Optional[int] = None
) -> dict:
    # Reuse audit_tool_call_log logic directly
    audit = await tool_audit_tool_call_log(
        user_email=user_email, db=db, agent_id=agent_id,
        hours_back=hours_back, limit=1000,
    )
    if "error" in audit:
        return audit

    entries = audit.get("entries", [])
    if not entries:
        return {
            "report_text": f"## Audit Report - Last {hours_back}h\n\nNo tool calls recorded.",
            "total_calls": 0,
            "tools_used": {},
            "blocked_calls": 0,
            "error_calls": 0,
        }

    tools_used: Dict[str, int] = {}
    blocked = 0
    errors = 0
    for e in entries:
        tools_used[e["tool_name"]] = tools_used.get(e["tool_name"], 0) + 1
        if e.get("was_blocked"):
            blocked += 1
        if e.get("error_message"):
            errors += 1

    top_tools = sorted(tools_used.items(), key=lambda x: x[1], reverse=True)
    tools_table = "\n".join(f"| `{name}` | {count} |" for name, count in top_tools)

    scope = f"Agent ID {agent_id}" if agent_id else "All agents"
    report = (
        f"## Audit Report - Last {hours_back}h ({scope})\n\n"
        f"**Total calls:** {len(entries)}  \n"
        f"**Blocked (HMAC gate):** {blocked}  \n"
        f"**Errors:** {errors}  \n\n"
        f"### Tools Used\n"
        f"| Tool | Calls |\n|------|-------|\n{tools_table}\n"
    )
    if blocked > 0:
        report += f"\n> ⚠️ {blocked} tool call(s) were blocked by the security gate - review required.\n"

    return {
        "report_text": report,
        "total_calls": len(entries),
        "tools_used": tools_used,
        "blocked_calls": blocked,
        "error_calls": errors,
    }
