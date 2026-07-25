"""
CSV Cleaner Service
Detects and fixes common issues in messy CSV files:
- Encoding issues / delimiter auto-detection
- Inconsistent headers (normalises to snake_case)
- Unnamed / phantom columns from Excel exports
- Duplicate rows
- Empty rows
- Non-standard null representations ("N/A", "na", "-", etc.)
- Numeric columns stored as strings (currency symbols, commas, %)
- Inconsistent date formats (normalises to ISO-8601)
- Leading / trailing whitespace in string cells
"""

from __future__ import annotations

import re
import io
from datetime import datetime
from typing import Any

import pandas as pd


# ── Null aliases that should become NaN ──────────────────────────────────────

_NULL_STRINGS = {
    "", "n/a", "na", "nan", "null", "none", "nil", "-", "--",
    "?", "unknown", "#n/a", "#null!", "missing",
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def _to_snake(name: str) -> str:
    """Convert any column header to snake_case."""
    name = str(name).strip()
    name = re.sub(r"[^\w\s]", "_", name)       # special chars → _
    name = re.sub(r"\s+", "_", name)            # spaces → _
    name = re.sub(r"_+", "_", name)             # collapse multiple _
    name = name.lower().strip("_")
    return name or "col"


def _looks_numeric(series: pd.Series) -> bool:
    """True when a string column looks like it holds numbers with formatting."""
    sample = series.dropna().astype(str).head(200)
    cleaned = sample.str.replace(r"[\$€£¥,\s%]", "", regex=True)
    numeric_count = pd.to_numeric(cleaned, errors="coerce").notna().sum()
    return len(sample) > 0 and numeric_count / len(sample) > 0.7


def _looks_date(series: pd.Series) -> bool:
    """True when a string column seems to hold dates."""
    sample = series.dropna().astype(str).head(100)
    if len(sample) == 0:
        return False
    parsed = pd.to_datetime(sample, format="mixed", errors="coerce")
    return parsed.notna().sum() / len(sample) > 0.7


# ── Main cleaner ─────────────────────────────────────────────────────────────

def clean_csv(raw_bytes: bytes) -> dict[str, Any]:
    """
    Accept raw CSV bytes, clean the data, and return:
      {
        "cleaned_csv": <str>,          # cleaned CSV as a string
        "original_shape": [rows, cols],
        "cleaned_shape":  [rows, cols],
        "issues": [ {type, detail, action, count?} ]
      }
    """
    issues: list[dict] = []

    # ── 1. Load - auto-detect delimiter & encoding ────────────────────────────
    text = None
    for enc in ("utf-8", "latin-1", "utf-16", "cp1252"):
        try:
            text = raw_bytes.decode(enc)
            break
        except (UnicodeDecodeError, ValueError):
            continue
    if text is None:
        text = raw_bytes.decode("utf-8", errors="replace")

    # Auto-detect delimiter
    import csv as _csv
    try:
        # sniff only the first 4kb
        sample = text[:4096]
        dialect = _csv.Sniffer().sniff(sample, delimiters=",;\t|")
        sep = dialect.delimiter
    except _csv.Error:
        sep = ","

    try:
        # Attempt standard read with detected separator
        df = pd.read_csv(io.StringIO(text), sep=sep, dtype=str, keep_default_na=False)
    except (pd.errors.ParserError, ValueError):
        # Fallback 1: Identified bad lines - skip them and report it
        try:
            df = pd.read_csv(
                io.StringIO(text), 
                sep=sep, 
                dtype=str, 
                keep_default_na=False, 
                on_bad_lines='skip'
            )
            issues.append({
                "type": "malformed_rows",
                "detail": "File contains rows with inconsistent column counts. Malformed rows were skipped to complete processing.",
                "action": "skipped",
            })
        except Exception:
            # Fallback 2: Total failure with detected sep, try default comma with skipping
            try:
                df = pd.read_csv(
                    io.StringIO(text), 
                    dtype=str, 
                    keep_default_na=False, 
                    on_bad_lines='skip'
                )
                issues.append({
                    "type": "malformed_rows",
                    "detail": "Severe formatting issues detected. Used default comma separator and skipped malformed rows.",
                    "action": "skipped",
                })
            except Exception as final_e:
                raise ValueError(f"CRITICAL: Resource buffer is critically malformed and unreadable: {str(final_e)}")

    original_shape = list(df.shape)

    # ── 2. Drop fully-empty rows & columns ───────────────────────────────────
    empty_rows_before = len(df)
    df.replace("", pd.NA, inplace=True)
    df.dropna(how="all", inplace=True)
    empty_rows_removed = empty_rows_before - len(df)
    if empty_rows_removed:
        issues.append({
            "type": "empty_rows",
            "detail": f"{empty_rows_removed} completely empty row(s) removed",
            "action": "removed",
            "count": empty_rows_removed,
        })

    phantom_cols = [c for c in df.columns if re.match(r"^unnamed", str(c).lower())]
    if phantom_cols:
        df.drop(columns=phantom_cols, inplace=True)
        issues.append({
            "type": "phantom_columns",
            "detail": f"Removed Excel-generated unnamed columns: {phantom_cols}",
            "action": "removed",
            "count": len(phantom_cols),
        })

    # ── 3. Normalise headers ──────────────────────────────────────────────────
    renamed: dict[str, str] = {}
    seen: dict[str, int] = {}
    new_cols = []
    for col in df.columns:
        snake = _to_snake(str(col))
        if snake in seen:
            seen[snake] += 1
            snake = f"{snake}_{seen[snake]}"
        else:
            seen[snake] = 0
        if snake != str(col):
            renamed[str(col)] = snake
        new_cols.append(snake)
    df.columns = new_cols
    if renamed:
        issues.append({
            "type": "headers_normalised",
            "detail": f"{len(renamed)} header(s) normalised to snake_case",
            "action": "renamed",
            "count": len(renamed),
            "mapping": renamed,
        })

    # ── 4. Standardise null representations ──────────────────────────────────
    null_fixes: dict[str, int] = {}
    for col in df.columns:
        mask = df[col].astype(str).str.strip().str.lower().isin(_NULL_STRINGS)
        count = int(mask.sum())
        if count:
            df.loc[mask, col] = pd.NA
            null_fixes[col] = count
    if null_fixes:
        total = sum(null_fixes.values())
        issues.append({
            "type": "nulls_standardised",
            "detail": f"{total} non-standard null value(s) converted to blank (e.g. 'N/A', '-', 'null')",
            "action": "standardised",
            "count": total,
            "by_column": null_fixes,
        })

    # ── 5. Strip whitespace ───────────────────────────────────────────────────
    ws_cols = []
    for col in df.columns:
        before = df[col].copy()
        df[col] = df[col].astype(str).str.strip().replace("nan", pd.NA)
        if not before.equals(df[col]):
            ws_cols.append(col)
    if ws_cols:
        issues.append({
            "type": "whitespace_stripped",
            "detail": f"Leading/trailing whitespace removed in {len(ws_cols)} column(s)",
            "action": "cleaned",
            "count": len(ws_cols),
        })

    # ── 6. Remove duplicate rows ──────────────────────────────────────────────
    dup_count = int(df.duplicated().sum())
    if dup_count:
        df.drop_duplicates(inplace=True)
        issues.append({
            "type": "duplicates",
            "detail": f"{dup_count} exact duplicate row(s) removed",
            "action": "removed",
            "count": dup_count,
        })

    # ── 7. Clean numeric columns (remove $, commas, %) ───────────────────────
    numeric_cleaned = []
    for col in df.columns:
        str_col = df[col].dropna().astype(str)
        if len(str_col) == 0:
            continue
        if _looks_numeric(df[col]):
            cleaned = df[col].astype(str).str.replace(r"[\$€£¥,\s%]", "", regex=True)
            converted = pd.to_numeric(cleaned, errors="coerce")
            success_rate = converted.notna().sum() / max(len(df[col].dropna()), 1)
            if success_rate > 0.7:
                df[col] = converted
                numeric_cleaned.append(col)
    if numeric_cleaned:
        issues.append({
            "type": "numeric_cleaned",
            "detail": f"Currency/number formatting removed in {len(numeric_cleaned)} column(s): {numeric_cleaned}",
            "action": "converted",
            "count": len(numeric_cleaned),
        })

    # ── 8. Standardise date columns to ISO-8601 ───────────────────────────────
    date_cols = []
    for col in df.columns:
        if col in numeric_cleaned:
            continue
        if df[col].dtype == object and _looks_date(df[col]):
            try:
                converted = pd.to_datetime(df[col], format="mixed", errors="coerce")
                if converted.notna().sum() / max(len(df[col].dropna()), 1) > 0.7:
                    df[col] = converted.dt.strftime("%Y-%m-%d").where(converted.notna(), pd.NA)
                    date_cols.append(col)
            except Exception:
                pass
    if date_cols:
        issues.append({
            "type": "dates_normalised",
            "detail": f"Date columns standardised to YYYY-MM-DD in {len(date_cols)} column(s): {date_cols}",
            "action": "normalised",
            "count": len(date_cols),
        })

    # ── 9. Report missing values per column ──────────────────────────────────
    missing = df.isnull().sum()
    missing = missing[missing > 0]
    if len(missing):
        missing_report = {
            col: {"count": int(n), "pct": round(100 * n / len(df), 1)}
            for col, n in missing.items()
        }
        issues.append({
            "type": "missing_values",
            "detail": f"{len(missing)} column(s) still have missing values after cleaning",
            "action": "flagged",
            "by_column": missing_report,
        })

    # ── 10. Export cleaned CSV ────────────────────────────────────────────────
    cleaned_csv = df.to_csv(index=False)

    return {
        "cleaned_csv": cleaned_csv,
        "original_shape": original_shape,
        "cleaned_shape": list(df.shape),
        "issues": issues,
        "rows_removed": original_shape[0] - df.shape[0],
        "cols_removed": original_shape[1] - df.shape[1],
    }
