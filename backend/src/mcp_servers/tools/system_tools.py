"""
System Mechanic Tools - Phase 4
Shell execution, system log reading, and filesystem management.
ALL tools in this file require explicit HMAC user approval (SENSITIVE_TOOLS).
All paths are restricted to AGENT_SANDBOX_ROOT - directory traversal is rejected.
"""

import asyncio
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

from mcp_servers.core.mcp_tools import mcp_tool

# ── Sandbox boundary ──────────────────────────────────────────────────────────
SANDBOX_ROOT = Path(os.getenv("AGENT_SANDBOX_ROOT", "/tmp/agent_sandbox")).resolve()
SANDBOX_ROOT.mkdir(parents=True, exist_ok=True)

# Credentials that must never be inherited by subprocesses
_BLOCKED_ENV_VARS = {
    "GOOGLE_APPLICATION_CREDENTIALS", "GEMINI_API_KEY", "OPENAI_API_KEY",
    "GROQ_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "DATABASE_URL",
    "SECRET_KEY", "SARVAM_API_KEY", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
}

_MAX_SHELL_TIMEOUT = 120  # hard cap in seconds


def _safe_path(raw: str) -> Optional[Path]:
    """Resolve a path and verify it is inside SANDBOX_ROOT.
    Returns None if the path escapes the sandbox.
    """
    try:
        resolved = (SANDBOX_ROOT / raw).resolve()
        # Python 3.9+ supports is_relative_to; fall back for 3.8
        try:
            resolved.relative_to(SANDBOX_ROOT)
        except ValueError:
            return None
        return resolved
    except Exception:
        return None


def _clean_env() -> dict:
    """Return the current environment minus all credential variables."""
    return {k: v for k, v in os.environ.items() if k not in _BLOCKED_ENV_VARS}


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp_tool(
    name="run_shell_command",
    description=(
        "Run a shell command inside the configured sandbox directory. "
        "Requires explicit user approval. Returns stdout, stderr, and exit code. "
        "All credential environment variables are stripped before execution."
    ),
    parameters={
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Shell command to execute.",
            },
            "timeout_seconds": {
                "type": "integer",
                "description": f"Max execution time (default 30, max {_MAX_SHELL_TIMEOUT}).",
            },
            "working_directory": {
                "type": "string",
                "description": "Subdirectory within sandbox to run from (default: sandbox root).",
            },
        },
        "required": ["command"],
    },
    provider="all",
    category="system",
    approval_required=True,
    credentials_required=False,
)
async def tool_run_shell_command(
    user_email: str,
    db,
    command: str,
    timeout_seconds: int = 30,
    working_directory: Optional[str] = None,
) -> dict:
    timeout = min(int(timeout_seconds), _MAX_SHELL_TIMEOUT)

    cwd = SANDBOX_ROOT
    if working_directory:
        resolved = _safe_path(working_directory)
        if not resolved:
            return {"error": f"Working directory '{working_directory}' is outside the permitted sandbox."}
        cwd = resolved

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd),
            env=_clean_env(),
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return {
                "stdout": "", "stderr": "",
                "exit_code": -1, "timed_out": True,
                "command": command,
            }

        return {
            "stdout": stdout_b.decode("utf-8", errors="replace")[:10000],
            "stderr": stderr_b.decode("utf-8", errors="replace")[:3000],
            "exit_code": proc.returncode,
            "timed_out": False,
            "command": command,
            "working_directory": str(cwd),
        }
    except Exception as e:
        return {"error": f"Shell execution failed: {e}"}


@mcp_tool(
    name="read_system_log",
    description="Read the last N lines from a log file within the sandbox directory.",
    parameters={
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "Path to the log file (relative to sandbox root)."},
            "tail_lines": {"type": "integer", "description": "Number of lines to read from the end (default 100)."},
        },
        "required": ["file_path"],
    },
    provider="all",
    category="system",
    approval_required=True,
    credentials_required=False,
)
async def tool_read_system_log(
    user_email: str, db, file_path: str, tail_lines: int = 100
) -> dict:
    resolved = _safe_path(file_path)
    if not resolved:
        return {"error": f"Path '{file_path}' is outside the permitted sandbox directory."}
    if not resolved.exists():
        return {"error": f"File not found: {file_path}"}
    if not resolved.is_file():
        return {"error": f"'{file_path}' is not a file."}

    def _read():
        with open(resolved, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        tail = lines[-tail_lines:]
        return [ln.rstrip("\n") for ln in tail], len(lines)

    try:
        lines, total = await asyncio.to_thread(_read)
        return {
            "file_path": str(resolved),
            "lines": lines,
            "line_count": len(lines),
            "total_lines_in_file": total,
            "tail_lines_requested": tail_lines,
        }
    except Exception as e:
        return {"error": f"Failed to read log: {e}"}


@mcp_tool(
    name="list_directory",
    description="List files and directories at a path within the sandbox.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Directory path relative to sandbox root (default: root)."},
            "show_hidden": {"type": "boolean", "description": "Include hidden files (starting with '.')."},
        },
        "required": [],
    },
    provider="all",
    category="system",
    approval_required=True,
    credentials_required=False,
)
async def tool_list_directory(
    user_email: str, db, path: str = ".", show_hidden: bool = False
) -> dict:
    resolved = _safe_path(path)
    if not resolved:
        return {"error": f"Path '{path}' is outside the permitted sandbox directory."}
    if not resolved.exists():
        return {"error": f"Directory not found: {path}"}
    if not resolved.is_dir():
        return {"error": f"'{path}' is not a directory."}

    def _list():
        entries = []
        for item in sorted(resolved.iterdir()):
            if not show_hidden and item.name.startswith("."):
                continue
            try:
                stat = item.stat()
                entries.append({
                    "name": item.name,
                    "type": "dir" if item.is_dir() else "file",
                    "size_bytes": stat.st_size if item.is_file() else None,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
            except Exception:
                entries.append({"name": item.name, "type": "unknown"})
        return entries

    try:
        entries = await asyncio.to_thread(_list)
        return {"path": str(resolved), "entries": entries, "count": len(entries)}
    except Exception as e:
        return {"error": f"Failed to list directory: {e}"}


@mcp_tool(
    name="read_file_raw",
    description="Read the raw text content of a file within the sandbox. Returns up to 50,000 characters.",
    parameters={
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "File path relative to sandbox root."},
            "encoding": {"type": "string", "description": "File encoding (default utf-8)."},
        },
        "required": ["file_path"],
    },
    provider="all",
    category="system",
    approval_required=True,
    credentials_required=False,
)
async def tool_read_file_raw(
    user_email: str, db, file_path: str, encoding: str = "utf-8"
) -> dict:
    resolved = _safe_path(file_path)
    if not resolved:
        return {"error": f"Path '{file_path}' is outside the permitted sandbox directory."}
    if not resolved.exists() or not resolved.is_file():
        return {"error": f"File not found: {file_path}"}

    _CAP = 50_000

    def _read():
        with open(resolved, "r", encoding=encoding, errors="replace") as f:
            content = f.read(_CAP + 1)
        truncated = len(content) > _CAP
        return content[:_CAP], truncated, resolved.stat().st_size

    try:
        content, truncated, size = await asyncio.to_thread(_read)
        return {
            "file_path": str(resolved),
            "content": content,
            "size_bytes": size,
            "truncated": truncated,
        }
    except Exception as e:
        return {"error": f"Failed to read file: {e}"}


@mcp_tool(
    name="write_file_raw",
    description=(
        "Write or append to a file within the sandbox. "
        "Creates parent directories automatically. "
        "Use mode='overwrite' to replace content or 'append' to add to the end."
    ),
    parameters={
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "File path relative to sandbox root."},
            "content": {"type": "string", "description": "Text content to write."},
            "mode": {
                "type": "string",
                "enum": ["overwrite", "append"],
                "description": "Write mode (default overwrite).",
            },
        },
        "required": ["file_path", "content"],
    },
    provider="all",
    category="system",
    approval_required=True,
    credentials_required=False,
)
async def tool_write_file_raw(
    user_email: str, db, file_path: str, content: str, mode: str = "overwrite"
) -> dict:
    resolved = _safe_path(file_path)
    if not resolved:
        return {"error": f"Path '{file_path}' is outside the permitted sandbox directory."}

    def _write():
        resolved.parent.mkdir(parents=True, exist_ok=True)
        write_mode = "a" if mode == "append" else "w"
        with open(resolved, write_mode, encoding="utf-8") as f:
            f.write(content)
        return resolved.stat().st_size

    try:
        size = await asyncio.to_thread(_write)
        return {
            "success": True,
            "file_path": str(resolved),
            "bytes_written": len(content.encode("utf-8")),
            "total_file_size": size,
            "mode": mode,
        }
    except Exception as e:
        return {"error": f"Failed to write file: {e}"}


@mcp_tool(
    name="get_disk_usage",
    description="Get disk usage statistics for the sandbox directory or a subdirectory.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path relative to sandbox root (default: root)."},
        },
        "required": [],
    },
    provider="all",
    category="system",
    approval_required=True,
    credentials_required=False,
)
async def tool_get_disk_usage(user_email: str, db, path: str = ".") -> dict:
    resolved = _safe_path(path)
    if not resolved:
        return {"error": f"Path '{path}' is outside the permitted sandbox directory."}
    if not resolved.exists():
        return {"error": f"Path not found: {path}"}

    def _usage():
        # Subtree size
        subtree = sum(f.stat().st_size for f in resolved.rglob("*") if f.is_file())
        # Partition stats
        disk = shutil.disk_usage(str(resolved))
        return subtree, disk.total, disk.used, disk.free

    try:
        subtree, total, used, free = await asyncio.to_thread(_usage)
        return {
            "path": str(resolved),
            "subtree_bytes": subtree,
            "subtree_human": f"{subtree / 1024 / 1024:.2f} MB",
            "partition_total_bytes": total,
            "partition_used_bytes": used,
            "partition_free_bytes": free,
            "partition_used_pct": round(used / total * 100, 1) if total else 0,
        }
    except Exception as e:
        return {"error": f"Failed to get disk usage: {e}"}


@mcp_tool(
    name="find_files",
    description="Find files by glob pattern within the sandbox (e.g. '**/*.log', '*.csv').",
    parameters={
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "description": "Glob pattern, e.g. '**/*.log'."},
            "search_root": {"type": "string", "description": "Root directory for search (default: sandbox root)."},
            "max_results": {"type": "integer", "description": "Maximum matches to return (default 50)."},
        },
        "required": ["pattern"],
    },
    provider="all",
    category="system",
    approval_required=True,
    credentials_required=False,
)
async def tool_find_files(
    user_email: str,
    db,
    pattern: str,
    search_root: str = ".",
    max_results: int = 50,
) -> dict:
    resolved_root = _safe_path(search_root)
    if not resolved_root:
        return {"error": f"Search root '{search_root}' is outside the permitted sandbox directory."}
    if not resolved_root.exists():
        return {"error": f"Search root not found: {search_root}"}

    def _find():
        matches = []
        for item in resolved_root.glob(pattern):
            # Double-check every match is inside sandbox
            safe = _safe_path(str(item.relative_to(SANDBOX_ROOT)))
            if not safe:
                continue
            if item.is_file():
                try:
                    matches.append({
                        "path": str(item.relative_to(SANDBOX_ROOT)),
                        "size_bytes": item.stat().st_size,
                        "modified": datetime.fromtimestamp(item.stat().st_mtime).isoformat(),
                    })
                except Exception:
                    matches.append({"path": str(item), "size_bytes": None})
            if len(matches) >= max_results:
                break
        return matches

    try:
        matches = await asyncio.to_thread(_find)
        return {
            "pattern": pattern,
            "search_root": str(resolved_root),
            "matches": matches,
            "total_found": len(matches),
            "truncated": len(matches) >= max_results,
        }
    except Exception as e:
        return {"error": f"find_files failed: {e}"}
