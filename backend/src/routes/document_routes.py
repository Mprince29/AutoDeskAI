"""
document_routes.py - zero-filesystem document storage.

All uploaded files are stored in the DB as zlib-compressed blobs
(content_zlib) alongside pre-extracted plain text (parsed_text).
No /uploads directory is created or used.

Space strategy
--------------
* zlib level-9 compression  → CSV 4-6×, TXT 3-5×, DOCX ~20 % smaller,
  PDF marginal (already compressed internally).
* parsed_text stores extracted text (≤ 60 k chars) so the AI layer
  never needs to decompress the blob on every query.
* Only one DB row per upload - no scattered UUID files on disk.
"""

import asyncio
import io
import re
import uuid
import zlib
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.database import get_db
from auth.models import User, Document
from utils.activity_logger import record_activity
from loguru import logger

router = APIRouter()

ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.csv', '.txt', '.xlsx'}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


# ── Text extractor (works on in-memory bytes) ─────────────────────────────────

def _parse_bytes(raw: bytes, ext: str) -> str:
    """Extract plain text from raw file bytes for any supported type."""
    ext = ext.lower()
    try:
        if ext == ".txt":
            return raw.decode("utf-8", errors="replace")[:60_000]

        elif ext == ".csv":
            import pandas as pd
            df = pd.read_csv(io.BytesIO(raw))
            return df.to_string(index=False)[:40_000]

        elif ext == ".xlsx":
            import pandas as pd
            dfs = pd.read_excel(io.BytesIO(raw), sheet_name=None)
            parts = [f"=== Sheet: {s} ===\n{df.to_string(index=False)}" for s, df in dfs.items()]
            return "\n\n".join(parts)[:40_000]

        elif ext == ".docx":
            from docx import Document as DocxDoc
            doc = DocxDoc(io.BytesIO(raw))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())[:60_000]

        elif ext == ".pdf":
            try:
                from pypdf import PdfReader
            except ImportError:
                import PyPDF2 as pypdf; PdfReader = pypdf.PdfReader  # noqa: E702
            reader = PdfReader(io.BytesIO(raw))
            return "\n".join(page.extract_text() or "" for page in reader.pages)[:60_000]

    except Exception as exc:
        logger.warning(f"_parse_bytes error for .{ext}: {exc}")
    return ""


def _find_doc(doc_id: str, user_id: int, db: Session) -> Optional[Document]:
    """Lookup a Document by its UUID (doc_uuid column) scoped to the user."""
    return (
        db.query(Document)
        .filter(Document.doc_uuid == doc_id, Document.user_id == user_id)
        .first()
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    email: str,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a document - content compressed and stored entirely in DB."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from pathlib import Path
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    raw: bytes = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {MAX_UPLOAD_BYTES // (1024*1024)} MB.",
        )

    # Compress (level 9 = max compression, trades a bit of CPU for storage savings)
    compressed = zlib.compress(raw, level=9)

    # Pre-extract text so AI queries are instant (no decompression needed per call)
    parsed = await asyncio.to_thread(_parse_bytes, raw, ext)

    doc_id = str(uuid.uuid4())

    db_doc = Document(
        user_id=user.id,
        doc_uuid=doc_id,
        filename=file.filename,
        file_path=None,                          # unused - DB-only storage
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(raw),                     # original size, not compressed
        content_zlib=compressed,
        parsed_text=parsed,
    )
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)

    record_activity(
        db, email, "upload_document",
        entity_type="document", entity_id=doc_id,
        details={"filename": db_doc.filename, "size": db_doc.size_bytes, "mime": db_doc.mime_type},
        request=request
    )

    ratio = len(raw) / len(compressed) if compressed else 1
    logger.info(
        f"Uploaded '{file.filename}' ({len(raw):,} B → {len(compressed):,} B compressed, "
        f"{ratio:.1f}× ratio) for {email}"
    )

    return {
        "id": doc_id,
        "db_id": db_doc.id,
        "filename": db_doc.filename,
        "size": db_doc.size_bytes,
        "uploaded_at": db_doc.created_at,
    }


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: str,
    request: Request,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Delete a document from the DB."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    doc = _find_doc(doc_id, user.id, db)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    db.delete(doc)
    db.commit()

    record_activity(
        db, email, "delete_document",
        entity_type="document", entity_id=doc_id,
        details={"filename": doc.filename},
        request=request
    )

    return {"success": True, "doc_id": doc_id}


@router.get("/parse/{doc_id}")
async def parse_document(
    doc_id: str,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Return pre-extracted text for an uploaded document (no filesystem access)."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    doc = _find_doc(doc_id, user.id, db)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    text = doc.parsed_text or ""

    # If parsed_text is empty (legacy row) and we have the blob, re-extract on demand
    if not text and doc.content_zlib:
        from pathlib import Path
        ext = Path(doc.filename).suffix.lower()
        raw = zlib.decompress(doc.content_zlib)
        text = await asyncio.to_thread(_parse_bytes, raw, ext)
        # Cache the result back
        doc.parsed_text = text
        db.commit()

    return {
        "success": True,
        "doc_id": doc_id,
        "filename": doc.filename,
        "text": text,
        "char_count": len(text),
    }


@router.get("/list")
async def list_documents(email: str, db: Session = Depends(get_db)):
    """List all documents uploaded by a user."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    docs = (
        db.query(Document)
        .filter(Document.user_id == user.id)
        .order_by(Document.created_at.desc())
        .all()
    )

    return {
        "success": True,
        "documents": [
            {
                "id": doc.doc_uuid or str(doc.id),
                "filename": doc.filename,
                "size": doc.size_bytes,
                "uploaded_at": doc.created_at,
            }
            for doc in docs
        ],
    }


# ── Document generation (downloadable output) ─────────────────────────────────

class GenerateDocRequest(BaseModel):
    email: str
    content: str          # Markdown / plain text content to convert
    format: str           # "pdf" | "docx" | "xlsx" | "txt"
    filename: str = "document"


@router.post("/generate")
async def generate_document(
    request: Request,
    req: GenerateDocRequest,
    db: Session = Depends(get_db)
):
    """Generate a downloadable file (PDF/DOCX/XLSX/TXT) from text content."""
    
    record_activity(
        db, req.email, "generate_document",
        details={"format": req.format, "filename": req.filename},
        request=request
    )
    fmt = req.format.lower().strip(".")
    if fmt not in ("pdf", "docx", "xlsx", "txt"):
        raise HTTPException(status_code=400, detail="format must be pdf, docx, xlsx, or txt")

    buf = io.BytesIO()

    try:
        if fmt == "txt":
            buf.write(req.content.encode("utf-8"))
            media_type = "text/plain"
            ext = "txt"

        elif fmt == "docx":
            from docx import Document as DocxDoc
            from docx.shared import Pt, RGBColor, Inches
            doc = DocxDoc()
            doc.core_properties.author = req.email
            for section in doc.sections:
                section.top_margin    = Inches(1.0)
                section.bottom_margin = Inches(1.0)
                section.left_margin   = Inches(1.1)
                section.right_margin  = Inches(1.1)

            for line in req.content.splitlines():
                stripped = line.strip()
                if stripped.startswith("### "):
                    h = doc.add_heading(stripped[4:], level=3)
                    h.runs[0].font.color.rgb = RGBColor(0x12, 0x2F, 0x5E)
                elif stripped.startswith("## "):
                    h = doc.add_heading(stripped[3:], level=2)
                    h.runs[0].font.color.rgb = RGBColor(0x12, 0x2F, 0x5E)
                elif stripped.startswith("# "):
                    h = doc.add_heading(stripped[2:], level=1)
                    h.runs[0].font.color.rgb = RGBColor(0x12, 0x2F, 0x5E)
                elif stripped.startswith("- ") or stripped.startswith("* "):
                    doc.add_paragraph(stripped[2:], style="List Bullet")
                elif stripped == "":
                    doc.add_paragraph("")
                else:
                    p = doc.add_paragraph()
                    p.paragraph_format.space_after = Pt(6)
                    parts = stripped.split("**")
                    for i, part in enumerate(parts):
                        run = p.add_run(part)
                        run.font.size = Pt(11)
                        if i % 2 == 1:
                            run.bold = True
            doc.save(buf)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ext = "docx"

        elif fmt == "xlsx":
            import pandas as pd
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter

            lines = [ln for ln in req.content.splitlines() if ln.strip()]
            rows = []
            for line in lines:
                if "\t" in line:
                    rows.append(line.split("\t"))
                elif "," in line:
                    rows.append([c.strip() for c in line.split(",", 20)])
                else:
                    rows.append([line])
            max_cols = max((len(r) for r in rows), default=1)
            padded = [r + [""] * (max_cols - len(r)) for r in rows]
            df = pd.DataFrame(padded[1:], columns=padded[0] if len(padded) > 1 else None)

            with pd.ExcelWriter(buf, engine="openpyxl") as writer:
                df.to_excel(writer, index=False, sheet_name="Sheet1")
                wb = writer.book
                ws = writer.sheets["Sheet1"]

                header_fill = PatternFill("solid", fgColor="122F5E")
                header_font = Font(bold=True, color="FFFFFF", size=11)
                header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
                thin_border = Border(
                    bottom=Side(style="thin", color="AAAAAA"),
                    right=Side(style="thin",  color="DDDDDD"),
                )
                for cell in ws[1]:
                    cell.fill = header_fill
                    cell.font = header_font
                    cell.alignment = header_align
                    cell.border = thin_border

                light_fill = PatternFill("solid", fgColor="F0F4FA")
                for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
                    fill = light_fill if row_idx % 2 == 0 else None
                    for cell in row:
                        if fill:
                            cell.fill = fill
                        cell.alignment = Alignment(vertical="center")

                for col_idx, col_cells in enumerate(ws.columns, start=1):
                    max_len = max((len(str(c.value or "")) for c in col_cells), default=8)
                    ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 3, 42)
                ws.row_dimensions[1].height = 22

            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ext = "xlsx"

        elif fmt == "pdf":
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import cm
            from reportlab.lib import colors
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
            from reportlab.lib.enums import TA_JUSTIFY

            NAVY  = colors.HexColor("#122F5E")
            SLATE = colors.HexColor("#1E1E2A")
            MID   = colors.HexColor("#3A3A55")
            styles = getSampleStyleSheet()

            heading1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18,
                textColor=NAVY, spaceBefore=14, spaceAfter=4, fontName="Helvetica-Bold")
            heading2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=14,
                textColor=NAVY, spaceBefore=10, spaceAfter=4, fontName="Helvetica-Bold")
            heading3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=12,
                textColor=MID,  spaceBefore=8,  spaceAfter=3, fontName="Helvetica-Bold")
            body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=11,
                textColor=SLATE, spaceAfter=6, leading=18, alignment=TA_JUSTIFY,
                fontName="Helvetica")
            bullet_style = ParagraphStyle("Bullet", parent=styles["Normal"], fontSize=11,
                textColor=SLATE, leftIndent=18, spaceAfter=4, leading=17,
                bulletIndent=6, fontName="Helvetica")

            doc_tmpl = SimpleDocTemplate(buf, pagesize=A4,
                rightMargin=2.2*cm, leftMargin=2.2*cm,
                topMargin=2.5*cm, bottomMargin=2.5*cm)
            hr_navy  = HRFlowable(width="100%", thickness=1.5, color=NAVY,
                                  spaceAfter=6, spaceBefore=2)
            hr_light = HRFlowable(width="100%", thickness=0.5,
                                  color=colors.HexColor("#CCCCDD"),
                                  spaceAfter=4, spaceBefore=2)

            story = []
            for line in req.content.splitlines():
                stripped = line.strip()
                if stripped.startswith("### "):
                    story.append(Paragraph(stripped[4:], heading3))
                elif stripped.startswith("## "):
                    story.append(Paragraph(stripped[3:], heading2))
                    story.append(hr_light)
                elif stripped.startswith("# "):
                    story.append(Paragraph(stripped[2:], heading1))
                    story.append(hr_navy)
                elif stripped.startswith("- ") or stripped.startswith("* "):
                    html = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', stripped[2:])
                    story.append(Paragraph(f"• {html}", bullet_style))
                elif stripped == "":
                    story.append(Spacer(1, 8))
                else:
                    html = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', stripped)
                    story.append(Paragraph(html, body))

            doc_tmpl.build(story)
            media_type = "application/pdf"
            ext = "pdf"

    except Exception as exc:
        logger.error(f"generate_document error: {exc}")
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}")

    buf.seek(0)
    safe_name = "".join(c for c in req.filename if c.isalnum() or c in "._- ")
    return StreamingResponse(
        buf,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.{ext}"'},
    )
