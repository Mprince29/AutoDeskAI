"""
Department-Aware Tool Assignment - OpenClaw Architecture

Maps departments and core agent types to appropriate tool subsets so that
dynamically created agents are scoped to their business function rather than
having access to the entire tool catalog.

Usage:
    from services.department_tools import get_tools_for_department_and_type

    tools = get_tools_for_department_and_type(
        department="SALES",
        core_type="RESEARCHER",
        user_email=user_email,
        db_session=db,
    )

The returned list is OpenAI-compatible function schema format, ready to pass
directly to MCPClient or get_tools_for_agent().
"""

from typing import Dict, List, Optional
from loguru import logger


# ── Department → base tool set ───────────────────────────────────────────────
# These are the tools a department naturally needs regardless of agent role.
# Names must match keys in _TOOL_REGISTRY (mcp_tools.py).

DEPARTMENT_TOOL_MAP: Dict[str, List[str]] = {
    "SALES": [
        # Communication
        "list_emails", "get_email", "send_email",
        "create_draft", "send_draft", "get_drafts",
        # Scheduling
        "list_events", "create_calendar_event", "check_availability", "suggest_times",
        # Research
        "web_search", "fetch_webpage",
        # Documents
        "create_sales_proposal_workflow",
        "list_emails", "get_email", "send_email", "create_draft",
        "create_document", "create_presentation", "create_spreadsheet",
        "list_events", "create_calendar_event",
        "web_search", "resolve_contact",
    ],

    "CONTENT": [
        "create_content_campaign_workflow",
        "create_document", "create_presentation",
        "web_search", "generate_image",
        "create_draft", "send_email",
        "list_emails", "get_email",
    ],

    "ECOMMERCE": [
        "create_product_listing_workflow",
        "create_spreadsheet", "create_document",
        "web_search", "generate_image",
        "list_emails", "get_email", "send_email",
    ],

    "BUSINESS_OPS": [
        "create_qbr_report_workflow",
        # Communication
        "list_emails", "get_email", "send_email", "create_draft",
        # Scheduling
        "list_events", "create_calendar_event", "update_event",
        # Documents & planning
        "create_document", "create_spreadsheet", "create_presentation",
        # Analytics
        "analyze_csv", "run_statistical_summary",
        # Drive
        "create_folder", "share_file",
        # Utility
        "read_uploaded_document",
    ],
    "HR": [
        "create_hiring_workflow",
        "create_document",
        "send_email",
        "create_draft",
        "list_events",
        "create_calendar_event",
        "web_search",
        "resolve_contact",
    ],

    "PR_COMMS": [
        # Research & intelligence
        "web_search", "fetch_webpage",
        # Content creation
        "create_document", "create_spreadsheet", "create_presentation",
        # Communication & outreach
        "send_email", "create_draft", "list_emails", "get_email",
        # Media assets
        "generate_image", "resolve_contact",
    ],

    # GLOBAL and CUSTOM → no restriction (all tools returned)
    "GLOBAL": [],
    "CUSTOM": [],
}


# ── Core type → recommended additional tools ─────────────────────────────────
# Layered on top of department tools.  Union of both sets becomes the agent's
# allowed catalog.

CORE_TYPE_TOOL_RECOMMENDATIONS: Dict[str, List[str]] = {
    "ROUTER": [],  # Orchestrators see everything - no restriction
    "RESEARCHER": [
        "web_search", "fetch_webpage",
        "read_uploaded_document", "semantic_search_knowledge",
        "ask_document", "execute_python", "create_document",
    ],
    "CREATOR": [
        "create_document", "generate_image", "create_presentation",
        "create_spreadsheet", "web_search",
    ],
    "SENSOR": [
        "web_search", "fetch_webpage",
        "diff_webpage", "register_url_watch",
        "list_watched_urls", "get_url_change_history",
    ],
    "DISTRIBUTOR": [
        "send_email", "create_draft", "send_draft",
        "create_calendar_event", "create_document", "generate_image", "share_file",
    ],
    "OBSERVER": [
        "analyze_csv", "run_statistical_summary", "describe_dataframe",
        "generate_chart", "execute_python", "list_emails",
        "create_document", "create_spreadsheet",
    ],
    "OPERATIONS": [
        "list_events", "create_calendar_event", "update_event", "list_emails",
        "create_document", "create_spreadsheet", "send_email",
    ],
    "FUNNEL": [
        "list_emails", "send_email", "create_draft",
        "create_spreadsheet", "web_search", "analyze_csv",
    ],
    "MEMORY": [
        "semantic_search_knowledge", "list_indexed_docs",
        "ask_document", "read_uploaded_document", "create_document",
    ],
    # ── PR & Communications archetypes ────────────────────────────────────
    "MEDIA_RESEARCHER": [
        "web_search", "fetch_webpage",
        "create_spreadsheet", "create_document",
        "send_email", "create_draft", "resolve_contact",
    ],
    "CONTENT_WRITER": [
        "web_search", "fetch_webpage",
        "create_document", "create_presentation",
        "generate_image", "create_spreadsheet",
    ],
    "STRATEGIST": [
        "web_search", "fetch_webpage",
        "create_document", "create_spreadsheet", "create_presentation",
        "analyze_csv", "run_statistical_summary", "send_email",
    ],
    "MESSAGING_TESTER": [
        "web_search", "fetch_webpage",
        "create_document", "create_spreadsheet",
        "create_presentation", "send_email",
    ],
    "CUSTOM": [],  # Unrestricted
}


def get_tools_for_department_and_type(
    department: str,
    core_type: str,
    user_email: str,
    db_session,
) -> List[Dict]:
    """Return OpenAI-compatible tool schemas for a given department + core_type.

    Decision logic:
      - GLOBAL department OR ROUTER/CUSTOM core_type → full provider-filtered set
      - Otherwise → union(department_tools, core_type_tools), filtered against
        the live MCP registry and the user's connected provider tokens.

    Args:
        department:  One of SALES, CONTENT, ECOMMERCE, BUSINESS_OPS, PR_COMMS, GLOBAL, CUSTOM
        core_type:   One of the 13 OpenClaw types (ROUTER, CREATOR, MEDIA_RESEARCHER, …) or CUSTOM
        user_email:  Used to check which providers are connected
        db_session:  SQLAlchemy session for provider token lookup
    """
    from mcp_servers.core.mcp_tools import get_tools_for_user, get_tools_for_agent

    dept = (department or "GLOBAL").upper()
    ctype = (core_type or "CUSTOM").upper()

    # ROUTER + GLOBAL/CUSTOM agents get unrestricted access - they need to see
    # everything to orchestrate or operate across the whole platform.
    if ctype in ("ROUTER", "CUSTOM") or dept in ("GLOBAL", "CUSTOM"):
        return get_tools_for_user(user_email, db_session)

    dept_tools = set(DEPARTMENT_TOOL_MAP.get(dept, []))
    type_tools = set(CORE_TYPE_TOOL_RECOMMENDATIONS.get(ctype, []))

    # Neither map has entries → fall back to full set
    if not dept_tools and not type_tools:
        logger.debug(
            f"dept_tools + type_tools both empty for {dept}/{ctype} - using full set"
        )
        return get_tools_for_user(user_email, db_session)

    allowed_names = list(dept_tools | type_tools)
    logger.debug(
        f"dept_tool_map: {dept}/{ctype} → {len(allowed_names)} allowed tools"
    )
    return get_tools_for_agent(user_email, db_session, tool_names=allowed_names)


def get_suggested_tools_for_type(core_type: str) -> List[str]:
    """Return the raw list of recommended tool names for a core type.

    Used by DynamicAgentCreator to seed agent_config['tools'] during creation
    so newly created agents inherit appropriate tooling without relying solely
    on LLM guessing.
    """
    ctype = (core_type or "CUSTOM").upper()
    return list(CORE_TYPE_TOOL_RECOMMENDATIONS.get(ctype, []))


def get_suggested_tools_for_department(department: str) -> List[str]:
    """Return the raw list of recommended tool names for a department."""
    dept = (department or "GLOBAL").upper()
    return list(DEPARTMENT_TOOL_MAP.get(dept, []))
