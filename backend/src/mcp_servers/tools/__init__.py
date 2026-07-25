# Import all tool modules to trigger @mcp_tool decorator registration.
# Order does not matter - each module self-registers on import.

# Phase 3 - self-contained tools (no external credentials)
from . import data_science_tools    # noqa: F401
from . import librarian_tools       # noqa: F401
from . import guardian_tools        # noqa: F401
from . import browser_watcher_tools # noqa: F401
from . import draft_tools           # noqa: F401

# Phase 4 - approval-gated system tools
from . import system_tools          # noqa: F401

# Phase D - departmental / HR org tools
from . import org_tools             # noqa: F401

# Microsoft tools (outlook, calendar via Graph API)
from . import outlook_tools         # noqa: F401

# CCC platform tools - Slack, Discord, GitHub, Jira, Trello
# Each file registers @mcp_tool wrappers that are vault-aware (Phase B creds)
# with env-var fallback for legacy deployments.
from . import slack_tools           # noqa: F401
from . import discord_tools         # noqa: F401
from . import github_tools          # noqa: F401
# from . import jira_tools          # noqa: F401  -- Jira integration disabled
from . import trello_tools          # noqa: F401
