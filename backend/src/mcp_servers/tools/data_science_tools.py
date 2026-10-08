"""
Data Science Tools - Phase 3
Sandboxed Python execution, CSV analysis, and chart generation.
All tools are self-contained - no external credentials required.
"""

import asyncio
import csv
import hashlib
import io
import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

from mcp_servers.core.mcp_tools import mcp_tool

# ── Paths ────────────────────────────────────────────────────────────────────
_UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(Path(__file__).parent.parent.parent / "uploads")))
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Sandbox config ────────────────────────────────────────────────────────────
_FORBIDDEN_PATTERNS = [
    "import os", "import sys", "import subprocess", "import socket",
    "import shutil", "import pathlib", "import importlib", "import builtins",
    "__import__", "__builtins__", "open(", "eval(", "exec(",
    "compile(", "globals(", "locals(", "getattr(", "setattr(",
]
_MAX_CODE_LEN = 4000
_MAX_TIMEOUT = 30


def _resolve_upload_path(doc_id: str) -> Optional[Path]:
    """Find an uploaded file by doc_id prefix."""
    if _UPLOAD_DIR.exists():
        for f in _UPLOAD_DIR.iterdir():
            if f.name.startswith(doc_id):
                return f
    return None


def _sandbox_env() -> dict:
    """Return a stripped environment with no credentials."""
    blocked = {
        "GOOGLE_APPLICATION_CREDENTIALS", "GEMINI_API_KEY", "OPENAI_API_KEY",
        "GROQ_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "DATABASE_URL",
        "SECRET_KEY", "SARVAM_API_KEY", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET",
    }
    return {k: v for k, v in os.environ.items() if k not in blocked and k in ("PATH", "HOME", "TMPDIR", "TMP")}


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp_tool(
    name="execute_python",
    description=(
        "Execute a sandboxed Python code snippet and return stdout/stderr. "
        "Use for calculations, data transformations, and logic. "
        "Forbidden: filesystem access, subprocess, networking, and credential imports."
    ),
    parameters={
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": f"Python code to execute (max {_MAX_CODE_LEN} chars).",
            },
            "timeout_seconds": {
                "type": "integer",
                "description": f"Max execution time in seconds (default 10, max {_MAX_TIMEOUT}).",
            },
        },
        "required": ["code"],
    },
    provider="all",
    category="data_science",
    approval_required=False,
    credentials_required=False,
)
async def tool_execute_python(
    user_email: str, db, code: str, timeout_seconds: int = 10
) -> dict:
    if len(code) > _MAX_CODE_LEN:
        return {"error": f"Code exceeds {_MAX_CODE_LEN} character limit."}

    # Pre-check forbidden patterns
    code_lower = code.lower()
    for pattern in _FORBIDDEN_PATTERNS:
        if pattern in code_lower:
            return {"error": f"Forbidden pattern detected: '{pattern}'. Filesystem, network, and exec operations are not allowed."}

    timeout = min(int(timeout_seconds), _MAX_TIMEOUT)

    try:
        proc = await asyncio.create_subprocess_exec(
            "python3", "-c", code,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_sandbox_env(),
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return {"stdout": "", "stderr": "", "exit_code": -1, "timed_out": True}

        return {
            "stdout": stdout_b.decode("utf-8", errors="replace")[:5000],
            "stderr": stderr_b.decode("utf-8", errors="replace")[:2000],
            "exit_code": proc.returncode,
            "timed_out": False,
        }
    except Exception as e:
        return {"error": f"Execution failed: {e}"}


@mcp_tool(
    name="analyze_csv",
    description=(
        "Load a CSV file from uploads by doc_id and return row count, column names, "
        "data types, null counts, and a preview of the first 5 rows."
    ),
    parameters={
        "type": "object",
        "properties": {
            "doc_id": {"type": "string", "description": "Document ID from the uploads folder."},
        },
        "required": ["doc_id"],
    },
    provider="all",
    category="data_science",
    approval_required=False,
    credentials_required=False,
)
async def tool_analyze_csv(user_email: str, db, doc_id: str) -> dict:
    path = _resolve_upload_path(doc_id)
    if not path:
        return {"error": f"Document '{doc_id}' not found in uploads."}
    if path.suffix.lower() not in (".csv",):
        return {"error": f"File '{path.name}' is not a CSV file."}

    def _read():
        import pandas as pd
        df = pd.read_csv(path)
        return {
            "filename": path.name,
            "rows": len(df),
            "columns": list(df.columns),
            "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
            "null_counts": df.isnull().sum().to_dict(),
            "head": df.head(5).to_dict(orient="records"),
        }

    try:
        return await asyncio.to_thread(_read)
    except Exception as e:
        return {"error": f"Failed to analyze CSV: {e}"}


@mcp_tool(
    name="generate_chart",
    description=(
        "Generate a chart (bar, line, pie, scatter, histogram) from CSV data. "
        "Saves the PNG to uploads and returns the filename for download."
    ),
    parameters={
        "type": "object",
        "properties": {
            "doc_id": {"type": "string", "description": "CSV document ID from uploads."},
            "chart_type": {
                "type": "string",
                "enum": ["bar", "line", "pie", "scatter", "histogram"],
                "description": "Type of chart to generate.",
            },
            "x_column": {"type": "string", "description": "Column name for x-axis (or labels for pie)."},
            "y_column": {"type": "string", "description": "Column name for y-axis (or values for pie)."},
            "title": {"type": "string", "description": "Chart title."},
        },
        "required": ["doc_id", "chart_type"],
    },
    provider="all",
    category="data_science",
    approval_required=False,
    credentials_required=False,
)
async def tool_generate_chart(
    user_email: str,
    db,
    doc_id: str,
    chart_type: str,
    x_column: Optional[str] = None,
    y_column: Optional[str] = None,
    title: str = "Chart",
) -> dict:
    path = _resolve_upload_path(doc_id)
    if not path:
        return {"error": f"Document '{doc_id}' not found in uploads."}

    def _make_chart():
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import pandas as pd

        df = pd.read_csv(path)
        fig, ax = plt.subplots(figsize=(10, 6))

        if chart_type == "bar":
            x = x_column or df.columns[0]
            y = y_column or df.select_dtypes(include="number").columns[0]
            ax.bar(df[x].astype(str), df[y])
            ax.set_xlabel(x)
            ax.set_ylabel(y)
        elif chart_type == "line":
            x = x_column or df.columns[0]
            y = y_column or df.select_dtypes(include="number").columns[0]
            ax.plot(df[x].astype(str), df[y], marker="o")
            ax.set_xlabel(x)
            ax.set_ylabel(y)
        elif chart_type == "pie":
            labels_col = x_column or df.columns[0]
            values_col = y_column or df.select_dtypes(include="number").columns[0]
            ax.pie(df[values_col], labels=df[labels_col].astype(str), autopct="%1.1f%%")
        elif chart_type == "scatter":
            x = x_column or df.select_dtypes(include="number").columns[0]
            y = y_column or df.select_dtypes(include="number").columns[1]
            ax.scatter(df[x], df[y], alpha=0.7)
            ax.set_xlabel(x)
            ax.set_ylabel(y)
        elif chart_type == "histogram":
            col = x_column or df.select_dtypes(include="number").columns[0]
            ax.hist(df[col].dropna(), bins=20, edgecolor="black")
            ax.set_xlabel(col)
            ax.set_ylabel("Frequency")

        ax.set_title(title)
        plt.tight_layout()

        chart_filename = f"chart_{uuid.uuid4().hex[:8]}.png"
        chart_path = _UPLOAD_DIR / chart_filename
        plt.savefig(chart_path, dpi=100, bbox_inches="tight")
        plt.close(fig)
        return chart_filename, str(chart_path)

    try:
        filename, fpath = await asyncio.to_thread(_make_chart)
        return {
            "success": True,
            "chart_filename": filename,
            "chart_path": fpath,
            "message": f"Chart saved as '{filename}'. Use the download endpoint to retrieve it.",
        }
    except Exception as e:
        return {"error": f"Failed to generate chart: {e}"}


@mcp_tool(
    name="describe_dataframe",
    description="Return pandas .describe() statistics for all numeric columns in a CSV.",
    parameters={
        "type": "object",
        "properties": {
            "doc_id": {"type": "string", "description": "CSV document ID from uploads."},
        },
        "required": ["doc_id"],
    },
    provider="all",
    category="data_science",
    approval_required=False,
    credentials_required=False,
)
async def tool_describe_dataframe(user_email: str, db, doc_id: str) -> dict:
    path = _resolve_upload_path(doc_id)
    if not path:
        return {"error": f"Document '{doc_id}' not found in uploads."}

    def _describe():
        import pandas as pd
        df = pd.read_csv(path)
        desc = df.describe(include="all")
        return {
            "statistics": json.loads(desc.to_json()),
            "numeric_columns": list(df.select_dtypes(include="number").columns),
            "categorical_columns": list(df.select_dtypes(exclude="number").columns),
        }

    try:
        return await asyncio.to_thread(_describe)
    except Exception as e:
        return {"error": f"Failed to describe dataframe: {e}"}


@mcp_tool(
    name="run_statistical_summary",
    description=(
        "Compute mean, median, std, min, max, and correlation matrix "
        "for numeric columns in a CSV. Optionally restrict to specific columns."
    ),
    parameters={
        "type": "object",
        "properties": {
            "doc_id": {"type": "string", "description": "CSV document ID from uploads."},
            "columns": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of column names to include (defaults to all numeric).",
            },
        },
        "required": ["doc_id"],
    },
    provider="all",
    category="data_science",
    approval_required=False,
    credentials_required=False,
)
async def tool_run_statistical_summary(
    user_email: str, db, doc_id: str, columns: Optional[List[str]] = None
) -> dict:
    path = _resolve_upload_path(doc_id)
    if not path:
        return {"error": f"Document '{doc_id}' not found in uploads."}

    def _summarize():
        import pandas as pd
        df = pd.read_csv(path)
        numeric = df.select_dtypes(include="number")
        if columns:
            valid = [c for c in columns if c in numeric.columns]
            if not valid:
                return {"error": f"None of the requested columns {columns} are numeric."}
            numeric = numeric[valid]

        stats = {
            col: {
                "mean": round(numeric[col].mean(), 4),
                "median": round(numeric[col].median(), 4),
                "std": round(numeric[col].std(), 4),
                "min": round(numeric[col].min(), 4),
                "max": round(numeric[col].max(), 4),
                "null_count": int(numeric[col].isnull().sum()),
            }
            for col in numeric.columns
        }
        corr = json.loads(numeric.corr().round(4).to_json())
        return {"statistics": stats, "correlation_matrix": corr}

    try:
        return await asyncio.to_thread(_summarize)
    except Exception as e:
        return {"error": f"Failed to compute statistical summary: {e}"}
