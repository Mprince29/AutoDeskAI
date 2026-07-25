"""Company-account helpers.

Identifies organization-managed ("company") accounts by email domain.
The domain is configured entirely via the COMPANY_DOMAIN environment
variable so no domain is hardcoded anywhere in the codebase.

Examples:
    COMPANY_DOMAIN=example.com   → user@example.com is a company user
    COMPANY_DOMAIN unset/empty   → there are no company users (safe default)
"""
import os
from typing import List


def get_company_domain() -> str:
    """Return the configured company email domain (lowercased, no leading '@').

    Returns an empty string when COMPANY_DOMAIN is unset, which disables all
    company-account behavior.
    """
    return os.getenv("COMPANY_DOMAIN", "").strip().lower().lstrip("@")


def is_company_user(email: str) -> bool:
    """True if the email belongs to the configured company domain."""
    domain = get_company_domain()
    if not email or not domain:
        return False
    return email.lower().endswith(f"@{domain}")


def get_trusted_domains() -> List[str]:
    """Domains trusted for outbound data (exfiltration allow-list).

    Combines the company domain with any extra domains supplied via
    TRUSTED_EMAIL_DOMAINS (comma-separated). All values are lowercased and
    de-duplicated; empty entries are ignored.
    """
    domains: List[str] = []
    company = get_company_domain()
    if company:
        domains.append(company)

    extra = os.getenv("TRUSTED_EMAIL_DOMAINS", "")
    for d in extra.split(","):
        d = d.strip().lower().lstrip("@")
        if d:
            domains.append(d)

    # De-duplicate while preserving order.
    seen = set()
    result = []
    for d in domains:
        if d not in seen:
            seen.add(d)
            result.append(d)
    return result
