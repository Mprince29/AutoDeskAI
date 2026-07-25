import asyncio
import random
import re
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mcp_servers.core.google_auth import GoogleAuthManager
from utils.google_api_utils import execute_with_retry, execute_with_retry_async

router = APIRouter()

# ── A1 notation helpers ───────────────────────────────────────────────────────
# Compiled once at import time - O(1) reuse across all requests
_A1_START_RE = re.compile(r"^([A-Za-z]+)(\d+)")


def _extract_start_cell(range_str: str) -> tuple[str, str, int]:
    """Parse an A1 range into (sheet_prefix, col_letters, start_row).

    Handles:
        "Sheet1!A1:D10"  →  ("Sheet1!", "A", 1)
        "A1:Z100"        →  ("", "A", 1)
        "'My Sheet'!B3"  →  ("'My Sheet'!", "B", 3)

    Raises HTTPException(400) if the range has no row-number start cell
    (e.g. "Sheet1!A:D" - column-only ranges cannot be used for chunked writes).
    """
    if "!" in range_str:
        prefix, cell_part = range_str.rsplit("!", 1)
        sheet_prefix = prefix + "!"
    else:
        cell_part = range_str.split(":")[0]
        sheet_prefix = ""

    # Take only the start cell if a colon range was supplied
    start_cell = cell_part.split(":")[0]
    m = _A1_START_RE.match(start_cell)
    if not m:
        raise HTTPException(
            status_code=400,
            detail=f"Range '{range_str}' must start with a cell address (e.g. A1). "
                   "Column-only ranges like 'A:D' cannot be used for positional writes.",
        )
    col_letters, row_str = m.groups()
    return sheet_prefix, col_letters, int(row_str)




# ── Request models ────────────────────────────────────────────────────────────

class CreateSpreadsheetRequest(BaseModel):
    user_email: str
    title: str = Field(..., min_length=1, max_length=100)
    sheet_name: str = Field("Sheet1", min_length=1, max_length=50)
    initial_data: Optional[List[List[Any]]] = None


class SheetDataRequest(BaseModel):
    user_email: str
    spreadsheet_id: str = Field(..., min_length=1)
    range: str = Field(..., min_length=1, max_length=200)


class WriteSheetRequest(BaseModel):
    user_email: str
    spreadsheet_id: str = Field(..., min_length=1)
    range: str = Field(..., min_length=1, max_length=200)
    values: List[List[Any]]


class AppendRowsRequest(BaseModel):
    user_email: str
    spreadsheet_id: str = Field(..., min_length=1)
    range: str = Field(..., min_length=1, max_length=200)
    values: List[List[Any]]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/create_spreadsheet")
async def create_spreadsheet(req: CreateSpreadsheetRequest):
    service, _ = await GoogleAuthManager.get_service_async("sheets", "v4", req.user_email)

    spreadsheet = await execute_with_retry_async(
        service.spreadsheets().create(body={
            "properties": {"title": req.title},
            "sheets": [{"properties": {"title": req.sheet_name}}],
        })
    )
    sid = spreadsheet["spreadsheetId"]

    if req.initial_data:
        await execute_with_retry_async(
            service.spreadsheets().values().update(
                spreadsheetId=sid,
                range=f"{req.sheet_name}!A1",
                valueInputOption="USER_ENTERED",
                body={"values": req.initial_data},
            )
        )

    # ── Professional formatting ────────────────────────────────────────────────
    if req.initial_data:
        num_rows = len(req.initial_data)
        num_cols = max((len(r) for r in req.initial_data), default=0)
        sheet_id = spreadsheet["sheets"][0]["properties"]["sheetId"]

        NAVY        = {"red": 0.07, "green": 0.18, "blue": 0.46}
        WHITE_COLOR = {"red": 1.0,  "green": 1.0,  "blue": 1.0}
        LIGHT_BLUE  = {"red": 0.94, "green": 0.96, "blue": 0.99}
        GRAY_BORDER = {"red": 0.78, "green": 0.78, "blue": 0.78}

        thin_border = {"style": "SOLID", "width": 1, "color": GRAY_BORDER}

        fmt_requests = []

        # 1. Freeze header row
        fmt_requests.append({
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenRowCount": 1}
                },
                "fields": "gridProperties.frozenRowCount"
            }
        })

        # 2. Header row - navy bg, white bold text, centered
        fmt_requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0, "endRowIndex": 1,
                    "startColumnIndex": 0, "endColumnIndex": num_cols,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": NAVY,
                        "textFormat": {
                            "foregroundColor": WHITE_COLOR,
                            "bold": True,
                            "fontSize": 11,
                        },
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                        "wrapStrategy": "WRAP",
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
            }
        })

        # 3. Header row height = 32 px
        fmt_requests.append({
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": 0, "endIndex": 1},
                "properties": {"pixelSize": 32},
                "fields": "pixelSize",
            }
        })

        # 4. Alternating row banding on data rows
        if num_rows > 1:
            fmt_requests.append({
                "addBanding": {
                    "bandedRange": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 1, "endRowIndex": num_rows,
                            "startColumnIndex": 0, "endColumnIndex": num_cols,
                        },
                        "rowProperties": {
                            "headerColor": LIGHT_BLUE,
                            "firstBandColor": WHITE_COLOR,
                            "secondBandColor": LIGHT_BLUE,
                        },
                    }
                }
            })

        # 5. Borders on all cells (header + data)
        fmt_requests.append({
            "updateBorders": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0, "endRowIndex": num_rows,
                    "startColumnIndex": 0, "endColumnIndex": num_cols,
                },
                "top":           thin_border,
                "bottom":        thin_border,
                "left":          thin_border,
                "right":         thin_border,
                "innerHorizontal": thin_border,
                "innerVertical":   thin_border,
            }
        })

        # 6. Auto-resize all columns
        fmt_requests.append({
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": num_cols,
                }
            }
        })

        await execute_with_retry_async(
            service.spreadsheets().batchUpdate(
                spreadsheetId=sid,
                body={"requests": fmt_requests},
            )
        )

    return {
        "success": True,
        "spreadsheet_id": sid,
        "title": req.title,
        "url": spreadsheet.get("spreadsheetUrl"),
    }


@router.post("/get_sheet_data")
async def get_sheet_data(req: SheetDataRequest):
    service, _ = await GoogleAuthManager.get_service_async("sheets", "v4", req.user_email)

    result = await execute_with_retry_async(
        service.spreadsheets().values().get(
            spreadsheetId=req.spreadsheet_id,
            range=req.range,
        )
    )

    values = result.get("values", [])
    return {
        "success": True,
        "spreadsheet_id": req.spreadsheet_id,
        "range": result.get("range", req.range),
        "values": values,
        "rows": len(values),
        "columns": max((len(r) for r in values), default=0),
    }


# Write large payloads in 1 000-row chunks to stay inside the 2 MB API limit.
_WRITE_CHUNK = 1_000


@router.post("/write_sheet_data")
async def write_sheet_data(req: WriteSheetRequest):
    service, _ = await GoogleAuthManager.get_service_async("sheets", "v4", req.user_email)

    # Parse once - O(1) for all subsequent chunk offsets
    sheet_prefix, col_letters, start_row = _extract_start_cell(req.range)

    total_cells = 0
    ranges_written: List[str] = []

    for offset in range(0, len(req.values), _WRITE_CHUNK):
        chunk = req.values[offset: offset + _WRITE_CHUNK]
        # Advance only the row number; column anchor stays fixed
        target = f"{sheet_prefix}{col_letters}{start_row + offset}"

        r = await execute_with_retry_async(
            service.spreadsheets().values().update(
                spreadsheetId=req.spreadsheet_id,
                range=target,
                valueInputOption="USER_ENTERED",
                body={"values": chunk},
            )
        )
        total_cells += r.get("updatedCells", 0)
        ranges_written.append(r.get("updatedRange", ""))

    return {
        "success": True,
        "spreadsheet_id": req.spreadsheet_id,
        "updated_cells": total_cells,
        "updated_ranges": ranges_written,
    }


@router.post("/append_rows")
async def append_rows(req: AppendRowsRequest):
    service, _ = await GoogleAuthManager.get_service_async("sheets", "v4", req.user_email)

    result = await execute_with_retry_async(
        service.spreadsheets().values().append(
            spreadsheetId=req.spreadsheet_id,
            range=req.range,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": req.values},
        )
    )

    updates = result.get("updates", {})
    return {
        "success": True,
        "spreadsheet_id": req.spreadsheet_id,
        "updated_range": updates.get("updatedRange", ""),
        "updated_rows": updates.get("updatedRows", 0),
        "updated_cells": updates.get("updatedCells", 0),
    }
