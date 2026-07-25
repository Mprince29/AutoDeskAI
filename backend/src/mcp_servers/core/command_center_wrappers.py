from typing import Optional, List
from loguru import logger
from mcp_servers.core.mcp_tools import mcp_tool

# Guard each platform import independently - a missing library only disables that platform,
# it does NOT crash the entire tool registry on startup.
try:
    from mcp_servers.tools.github_tools import (
        RepoRequest, CreateIssueRequest, SearchIssueRequest, GetFileRequest,
        get_repository_context, create_issue, search_issues, get_file_content,
    )
    _GITHUB_AVAILABLE = True
except ImportError as _e:
    logger.warning(f"[command_center] GitHub tools unavailable - PyGithub not installed: {_e}")
    _GITHUB_AVAILABLE = False

# Jira integration disabled
_JIRA_AVAILABLE = False

try:
    from mcp_servers.tools.trello_tools import (
        GetBoardsRequest, CreateCardRequest, UpdateCardStatusRequest,
        get_trello_boards, create_trello_card, move_trello_card,
    )
    _TRELLO_AVAILABLE = True
except ImportError as _e:
    logger.warning(f"[command_center] Trello tools unavailable - py-trello not installed: {_e}")
    _TRELLO_AVAILABLE = False

try:
    from mcp_servers.tools.slack_tools import (
        SlackMessageRequest, SlackHistoryRequest, SlackReactionRequest,
        send_slack_message, get_slack_history, add_slack_reaction,
    )
    _SLACK_AVAILABLE = True
except ImportError as _e:
    logger.warning(f"[command_center] Slack tools unavailable - slack_sdk not installed: {_e}")
    _SLACK_AVAILABLE = False

try:
    from mcp_servers.tools.discord_tools import (
        DiscordMessageRequest,
        send_discord_message, get_discord_history,
    )
    _DISCORD_AVAILABLE = True
except ImportError as _e:
    logger.warning(f"[command_center] Discord tools unavailable - httpx not installed: {_e}")
    _DISCORD_AVAILABLE = False

try:
    from mcp_servers.tools.telegram_tools import (
        get_telegram_history, send_telegram_message,
    )
    _TELEGRAM_AVAILABLE = True
except ImportError as _e:
    logger.warning(f"[command_center] Telegram tools unavailable: {_e}")
    _TELEGRAM_AVAILABLE = False


# ── GitHub Tools ─────────────────────────────────────────────────────────────

if _GITHUB_AVAILABLE:

    @mcp_tool(
        name="github_get_repo_context",
        category="engineering",
        description="Fetch repository context like stars, description, and open issues.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "repo_name": {"type": "string", "description": "e.g., 'owner/repo'"}
            },
            "required": ["repo_name"]
        }
    )
    async def tool_github_get_repo_context(user_email: str, db, repo_name: str) -> dict:
        req = RepoRequest(repo_name=repo_name)
        return await get_repository_context(req)

    @mcp_tool(
        name="github_create_issue",
        category="engineering",
        description="Creates a new issue in a GitHub repository.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "repo_name": {"type": "string", "description": "e.g., 'owner/repo'"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "labels": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["repo_name", "title", "body"]
        }
    )
    async def tool_github_create_issue(user_email: str, db, repo_name: str, title: str, body: str, labels: list = None) -> dict:
        req = CreateIssueRequest(repo_name=repo_name, title=title, body=body, labels=labels)
        return await create_issue(req)

    @mcp_tool(
        name="github_search_issues",
        category="engineering",
        description="Search issues in a GitHub repository. Query matches issue title and description.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "repo_name": {"type": "string", "description": "e.g., 'owner/repo'"},
                "query": {"type": "string"}
            },
            "required": ["repo_name", "query"]
        }
    )
    async def tool_github_search_issues(user_email: str, db, repo_name: str, query: str) -> dict:
        req = SearchIssueRequest(repo_name=repo_name, query=query)
        return await search_issues(req)

    @mcp_tool(
        name="github_get_file",
        category="engineering",
        description="Reads the content of a specific file in a GitHub repository. Content is truncated at 8000 characters.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "repo_name": {"type": "string", "description": "e.g., 'owner/repo'"},
                "file_path": {"type": "string", "description": "Path to file inside the repository."}
            },
            "required": ["repo_name", "file_path"]
        }
    )
    async def tool_github_get_file(user_email: str, db, repo_name: str, file_path: str) -> dict:
        req = GetFileRequest(repo_name=repo_name, file_path=file_path)
        result = await get_file_content(req)
        # Guard against dumping massive files into LLM context
        if isinstance(result, dict) and "content" in result:
            content = result["content"]
            if len(content) > 8000:
                result["content"] = content[:8000]
                result["truncated"] = True
                result["original_length"] = len(content)
        return result


# ── Jira Tools ───────────────────────────────────────────────────────────────

if _JIRA_AVAILABLE:

    @mcp_tool(
        name="jira_get_issue",
        category="project_management",
        description="Gets details of a specific Jira issue.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "issue_key": {"type": "string", "description": "e.g., 'PROJ-123'"}
            },
            "required": ["issue_key"]
        }
    )
    async def tool_jira_get_issue(user_email: str, db, issue_key: str) -> dict:
        req = JiraIssueRequest(issue_key=issue_key)
        return await get_jira_issue(req, user_email=user_email, db=db)

    @mcp_tool(
        name="jira_create_ticket",
        category="project_management",
        description="Creates a new Jira ticket.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "project_key": {"type": "string", "description": "e.g., 'PROJ'"},
                "summary": {"type": "string", "description": "Ticket title"},
                "description": {"type": "string", "description": "Ticket detailed description"},
                "issue_type": {"type": "string", "description": "Task, Bug, Epic, etc."}
            },
            "required": ["project_key", "summary", "description"]
        }
    )
    async def tool_jira_create_ticket(user_email: str, db, project_key: str, summary: str, description: str, issue_type: str = "Task") -> dict:
        req = CreateJiraTicketRequest(project_key=project_key, summary=summary, description=description, issue_type=issue_type)
        return await create_jira_ticket(req, user_email=user_email, db=db)

    @mcp_tool(
        name="jira_search",
        category="project_management",
        description="Searches Jira using JQL.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "jql_query": {"type": "string", "description": "JQL query string."}
            },
            "required": ["jql_query"]
        }
    )
    async def tool_jira_search(user_email: str, db, jql_query: str) -> dict:
        req = SearchJiraRequest(jql_query=jql_query)
        return await search_jira_issues(req, user_email=user_email, db=db)

    @mcp_tool(
        name="jira_add_comment",
        category="project_management",
        description="Adds a comment to an existing Jira issue.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "issue_key": {"type": "string"},
                "comment": {"type": "string"}
            },
            "required": ["issue_key", "comment"]
        }
    )
    async def tool_jira_add_comment(user_email: str, db, issue_key: str, comment: str) -> dict:
        req = CommentJiraRequest(issue_key=issue_key, comment=comment)
        return await add_jira_comment(req, user_email=user_email, db=db)


# ── Trello Tools ─────────────────────────────────────────────────────────────

if _TRELLO_AVAILABLE:

    @mcp_tool(
        name="trello_get_boards",
        category="project_management",
        description="Gets all user's Trello boards and their list IDs.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {},
            "required": []
        }
    )
    async def tool_trello_get_boards(user_email: str, db) -> dict:
        req = GetBoardsRequest()
        return await get_trello_boards(req)

    @mcp_tool(
        name="trello_create_card",
        category="project_management",
        description="Add a new card to a specific Trello list.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "list_id": {"type": "string", "description": "The Trello list ID to add the card to."},
                "name": {"type": "string", "description": "Title of the card."},
                "desc": {"type": "string", "description": "Detailed description for the card."}
            },
            "required": ["list_id", "name"]
        }
    )
    async def tool_trello_create_card(user_email: str, db, list_id: str, name: str, desc: str = "") -> dict:
        req = CreateCardRequest(list_id=list_id, name=name, desc=desc)
        return await create_trello_card(req)

    @mcp_tool(
        name="trello_move_card",
        category="project_management",
        description="Moves an existing Trello card to a different list.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "card_id": {"type": "string"},
                "list_id": {"type": "string", "description": "Destination Trello list ID."}
            },
            "required": ["card_id", "list_id"]
        }
    )
    async def tool_trello_move_card(user_email: str, db, card_id: str, list_id: str) -> dict:
        req = UpdateCardStatusRequest(card_id=card_id, list_id=list_id)
        return await move_trello_card(req)


# ── Slack Tools ──────────────────────────────────────────────────────────────

if _SLACK_AVAILABLE:

    @mcp_tool(
        name="slack_send_message",
        category="communication",
        description="Sends a new message to a Slack channel. Pass the channel name (e.g. 'general' or '#general') or its ID - names are resolved automatically.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "channel": {"type": "string", "description": "Channel name (e.g. 'general') or ID. Names are resolved automatically - never ask the user for an ID."},
                "text": {"type": "string"}
            },
            "required": ["channel", "text"]
        }
    )
    async def tool_slack_send_message(user_email: str, db, channel: str, text: str) -> dict:
        req = SlackMessageRequest(channel=channel, text=text)
        return await send_slack_message(req)

    @mcp_tool(
        name="slack_get_history",
        category="communication",
        description="Fetches recent message history from a Slack channel. Pass the channel name (e.g. 'general') or its ID - names are resolved automatically.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "channel": {"type": "string", "description": "Channel name (e.g. 'general') or ID. Names are resolved automatically - never ask the user for an ID."},
                "limit": {"type": "integer", "description": "Number of messages.", "default": 10}
            },
            "required": ["channel"]
        }
    )
    async def tool_slack_get_history(user_email: str, db, channel: str, limit: int = 10) -> dict:
        req = SlackHistoryRequest(channel=channel, limit=limit)
        raw = await get_slack_history(req)
        # Project to a clean shape - raw Slack objects contain user IDs, block payloads,
        # reactions, attachments, etc. that add noise to the LLM context.
        messages = [
            {
                "user": m.get("user", m.get("username", "unknown")),
                "text": m.get("text", ""),
                "ts": m.get("ts", ""),
            }
            for m in raw.get("messages", [])
        ]
        return {"messages": messages, "channel": channel}

    @mcp_tool(
        name="slack_add_reaction",
        category="communication",
        description="Adds an emoji reaction to a specific Slack message identified by channel and timestamp.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "channel": {"type": "string", "description": "Channel name (e.g. 'general') or ID. Names are resolved automatically - never ask the user for an ID."},
                "timestamp": {"type": "string", "description": "The 'ts' timestamp of the message to react to."},
                "reaction": {"type": "string", "description": "Emoji name without colons, e.g. 'thumbsup'."}
            },
            "required": ["channel", "timestamp", "reaction"]
        }
    )
    async def tool_slack_add_reaction(user_email: str, db, channel: str, timestamp: str, reaction: str) -> dict:
        req = SlackReactionRequest(channel=channel, timestamp=timestamp, reaction=reaction)
        return await add_slack_reaction(req)


# ── Discord Tools ────────────────────────────────────────────────────────────

if _DISCORD_AVAILABLE:

    @mcp_tool(
        name="discord_send_message",
        category="communication",
        description="Sends a message to a Discord channel. Pass the channel name (e.g. 'general') or its Snowflake ID - names are resolved automatically.",
        provider="all",
        approval_required=True,  # can spam real channels without confirmation
        parameters={
            "type": "object",
            "properties": {
                "channel_id": {"type": "string", "description": "Channel name (e.g. 'general') or Snowflake ID. Names are resolved automatically - never ask the user for an ID."},
                "content": {"type": "string"}
            },
            "required": ["channel_id", "content"]
        }
    )
    async def tool_discord_send_message(user_email: str, db, channel_id: str, content: str) -> dict:
        req = DiscordMessageRequest(channel_id=channel_id, content=content)
        return await send_discord_message(req)

    @mcp_tool(
        name="discord_get_history",
        category="communication",
        description="Gets recent message history from a Discord channel. Pass the channel name (e.g. 'general') or its Snowflake ID - names are resolved automatically.",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "channel_id": {"type": "string", "description": "Channel name (e.g. 'general') or Snowflake ID. Names are resolved automatically - never ask the user for an ID."},
                "limit": {"type": "integer"}
            },
            "required": ["channel_id"]
        }
    )
    async def tool_discord_get_history(user_email: str, db, channel_id: str, limit: int = 10) -> dict:
        raw = await get_discord_history(channel_id=channel_id, limit=limit)
        # Project to clean shape - raw Discord objects include member objects,
        # embeds, attachments, mentions arrays, etc.
        messages = [
            {
                "author": m.get("author", {}).get("username", "unknown"),
                "content": m.get("content", ""),
                "timestamp": m.get("timestamp", ""),
            }
            for m in raw.get("messages", [])
        ]
        return {"messages": messages, "channel_id": channel_id}


# ── Telegram Tools ───────────────────────────────────────────────────────────

if _TELEGRAM_AVAILABLE:

    @mcp_tool(
        name="telegram_send_message",
        category="communication",
        description="Sends a message via the user's personal Telegram bot. Use this to push alerts or respond to users directly on Telegram.",
        provider="all",
        approval_required=True,
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The message to send."},
                "chat_id": {"type": "string", "description": "Optional chat identifier. If not provided, it sends to the user's default chat_id discovered during setup."}
            },
            "required": ["text"]
        }
    )
    async def tool_telegram_send_message(user_email: str, db, text: str, chat_id: str = None) -> dict:
        from auth.models import User # noqa
        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            return {"success": False, "error": "User not found"}
        
        # Note: the underlying tool function expects a Session (db)
        return await send_telegram_message(text=text, chat_id=chat_id, current_user=user, db=db)

    @mcp_tool(
        name="telegram_get_history",
        category="communication",
        description="Fetches recent chat history from the user's Telegram bot interactions. This data is pulled from AutoDeskAI's internal persistence layer, not directly from Telegram (for speed and compliance).",
        provider="all",
        parameters={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of messages to retrieve.", "default": 10}
            }
        }
    )
    async def tool_telegram_get_history(user_email: str, db, limit: int = 10) -> dict:
        from auth.models import User # noqa
        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            return {"messages": [], "error": "User not found"}
            
        return await get_telegram_history(limit=limit, current_user=user, db=db)
