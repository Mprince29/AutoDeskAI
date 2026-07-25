"""
Playwright Browser Tools - interactive browser control for agents.
Tools: browser_navigate, browser_click, browser_type, browser_extract, browser_screenshot

Each tool spins up a shared per-user browser context (reused within a session).
Requires: playwright>=1.44.0 + `playwright install chromium`
"""

from __future__ import annotations

import asyncio
import base64
from typing import Any, Dict

from loguru import logger

from mcp_servers.core.mcp_tools import mcp_tool

# ── Shared browser pool (user_email → playwright Page) ───────────────────────
_PAGES: Dict[str, Any] = {}
_LOCK = asyncio.Lock()


async def _get_page(user_email: str):
    """Return or create a Playwright page for the user."""
    if user_email in _PAGES:
        try:
            await _PAGES[user_email].title()  # ping - raises if closed
            return _PAGES[user_email]
        except Exception:
            _PAGES.pop(user_email, None)

    from playwright.async_api import async_playwright
    async with _LOCK:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (compatible; AutoDeskAI-Agent/1.0)",
        )
        page = await ctx.new_page()
        _PAGES[user_email] = page
        return page


async def _close_page(user_email: str):
    page = _PAGES.pop(user_email, None)
    if page:
        try:
            await page.context.browser.close()
        except Exception:
            pass


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp_tool(
    name="browser_navigate",
    description="Open a URL in the browser and return the page title and current URL.",
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "Full URL to navigate to (must start with http/https)"},
        },
        "required": ["url"],
    },
)
async def tool_browser_navigate(user_email: str, db, url: str) -> dict:
    if not url.startswith(("http://", "https://")):
        return {"error": "URL must start with http:// or https://"}
    try:
        page = await _get_page(user_email)
        await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
        title = await page.title()
        return {"success": True, "title": title, "url": page.url}
    except Exception as e:
        logger.warning(f"browser_navigate error: {e}")
        return {"error": str(e)}


@mcp_tool(
    name="browser_click",
    description="Click an element on the current page using a CSS selector or visible text.",
    parameters={
        "type": "object",
        "properties": {
            "selector": {"type": "string", "description": "CSS selector OR visible text of the element to click"},
        },
        "required": ["selector"],
    },
)
async def tool_browser_click(user_email: str, db, selector: str) -> dict:
    try:
        page = await _get_page(user_email)
        # Try CSS first, fall back to text
        try:
            await page.click(selector, timeout=8_000)
        except Exception:
            await page.get_by_text(selector).first.click(timeout=8_000)
        await page.wait_for_load_state("domcontentloaded", timeout=8_000)
        return {"success": True, "url": page.url}
    except Exception as e:
        return {"error": str(e)}


@mcp_tool(
    name="browser_type",
    description="Type text into an input field on the current page.",
    parameters={
        "type": "object",
        "properties": {
            "selector": {"type": "string", "description": "CSS selector of the input field"},
            "text":     {"type": "string", "description": "Text to type"},
            "submit":   {"type": "boolean", "description": "Press Enter after typing (default false)"},
        },
        "required": ["selector", "text"],
    },
)
async def tool_browser_type(user_email: str, db, selector: str, text: str, submit: bool = False) -> dict:
    try:
        page = await _get_page(user_email)
        await page.fill(selector, text, timeout=8_000)
        if submit:
            await page.press(selector, "Enter")
            await page.wait_for_load_state("domcontentloaded", timeout=8_000)
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}


@mcp_tool(
    name="browser_extract",
    description="Extract visible text or specific content from the current page.",
    parameters={
        "type": "object",
        "properties": {
            "selector": {"type": "string", "description": "CSS selector to extract (omit for full page text)"},
            "max_chars": {"type": "integer", "description": "Max characters to return (default 8000)"},
        },
        "required": [],
    },
)
async def tool_browser_extract(user_email: str, db, selector: str = "", max_chars: int = 8000) -> dict:
    try:
        page = await _get_page(user_email)
        if selector:
            elements = await page.query_selector_all(selector)
            texts = [await el.inner_text() for el in elements[:20]]
            content = "\n".join(texts)
        else:
            content = await page.inner_text("body")
        return {"success": True, "content": content[:max_chars], "url": page.url}
    except Exception as e:
        return {"error": str(e)}


@mcp_tool(
    name="browser_screenshot",
    description="Take a screenshot of the current page and return it as a base64 PNG.",
    parameters={
        "type": "object",
        "properties": {
            "full_page": {"type": "boolean", "description": "Capture full scrollable page (default false)"},
        },
        "required": [],
    },
)
async def tool_browser_screenshot(user_email: str, db, full_page: bool = False) -> dict:
    try:
        page = await _get_page(user_email)
        png = await page.screenshot(full_page=full_page)
        b64 = base64.b64encode(png).decode()
        return {"success": True, "image_base64": b64, "url": page.url}
    except Exception as e:
        return {"error": str(e)}


@mcp_tool(
    name="browser_close",
    description="Close the browser session for the current user.",
    parameters={"type": "object", "properties": {}, "required": []},
)
async def tool_browser_close(user_email: str, db) -> dict:
    await _close_page(user_email)
    return {"success": True}
