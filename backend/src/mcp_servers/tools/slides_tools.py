import asyncio
import os
import uuid
from enum import Enum
from typing import List, Optional, Tuple

from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel, Field

from mcp_servers.core.google_auth import GoogleAuthManager
from mcp_servers.tools.imagen_utils import call_imagen, upload_to_drive
from utils.google_api_utils import execute_with_retry, execute_with_retry_async

router = APIRouter()

# Placeholder type sets used to find title/body slots in a slide layout
_TITLE_PLACEHOLDERS = frozenset({"TITLE", "CENTERED_TITLE"})
_BODY_PLACEHOLDERS  = frozenset({"BODY", "SUBTITLE"})

# Standard Google Slides canvas dimensions in EMU (English Metric Units)
_SLIDE_W = 9_144_000   # 25.4 cm wide
_SLIDE_H = 5_143_500   # 19.05 cm tall


# ── Enums & models ────────────────────────────────────────────────────────────

class SlideLayout(str, Enum):
    TITLE_AND_BODY                = "TITLE_AND_BODY"
    BLANK                         = "BLANK"
    TITLE_ONLY                    = "TITLE_ONLY"
    TITLE                         = "TITLE"
    SECTION_HEADER                = "SECTION_HEADER"
    SECTION_TITLE_AND_DESCRIPTION = "SECTION_TITLE_AND_DESCRIPTION"


class SlideContent(BaseModel):
    layout:        SlideLayout   = SlideLayout.TITLE_AND_BODY
    title_text:    Optional[str] = Field(None, max_length=1_000)
    body_text:     Optional[str] = Field(None, max_length=10_000,
                                         description="Newline-separated bullet points (no '•' prefix needed)")
    image_query:   Optional[str] = Field(None, max_length=500,
                                         description="Imagen prompt describing the ideal image for this slide")
    speaker_notes: Optional[str] = Field(None, max_length=5_000,
                                         description="Talking points shown in the speaker notes panel")


class CreatePresentationRequest(BaseModel):
    user_email: str
    title:  str                          = Field(..., min_length=1, max_length=200)
    slides: Optional[List[SlideContent]] = None


class PresentationRequest(BaseModel):
    user_email:      str
    presentation_id: str = Field(..., min_length=1)


# ── Image pipeline ────────────────────────────────────────────────────────────
# Priority: Gemini Imagen 3 (AI-generated, hosted on Drive)
#         → SerpAPI Google Images (stock photo, topic-specific)
#         → Unsplash Source redirect (free, topic-specific)
#         → None (slide created without image)

async def _fetch_image_url(prompt: str, user_email: str) -> Optional[str]:
    """Return a publicly-accessible image URL for *prompt*.

    Tries Gemini Imagen 3 first (AI-generated, uploaded to user's Drive),
    then falls back to stock-photo sources.
    """
    # ── 1. Gemini Imagen 3 ────────────────────────────────────────────────
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        url = await _imagen_to_drive(prompt, gemini_key, user_email)
        if url:
            logger.info(f"Image: Imagen 3 ✓ for '{prompt[:40]}'")
            return url

    # ── 2. SerpAPI Google Images ──────────────────────────────────────────
    serpapi_key = os.getenv("SERPAPI_API_KEY")
    if serpapi_key:
        url = await _serpapi_image(prompt, serpapi_key)
        if url:
            logger.info(f"Image: SerpAPI ✓ for '{prompt[:40]}'")
            return url

    # ── 3. Unsplash Source (no API key needed) ────────────────────────────
    url = await _unsplash_image(prompt)
    if url:
        logger.info(f"Image: Unsplash ✓ for '{prompt[:40]}'")
        return url

    logger.warning(f"Image: all sources failed for '{prompt[:40]}'")
    return None


# ── Imagen 3 via imagen_utils ─────────────────────────────────────────────────

async def _imagen_to_drive(prompt: str, api_key: str, user_email: str) -> Optional[str]:
    """Generate a 16:9 slide image with Imagen 3, upload to Drive, return download URL."""
    image_bytes = await call_imagen(prompt, api_key, aspect_ratio="16:9")
    if not image_bytes:
        return None
    filename = f"slide_{uuid.uuid4().hex[:8]}.png"
    result = await upload_to_drive(image_bytes, user_email, filename)
    return result["download_url"] if result else None


# ── SerpAPI stock photos ──────────────────────────────────────────────────────

def _looks_like_image(url: str) -> bool:
    path = url.lower().split("?")[0]
    return any(path.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp"))


async def _serpapi_image(query: str, api_key: str) -> Optional[str]:
    def _search():
        from serpapi import GoogleSearch
        return GoogleSearch({
            "engine": "google_images",
            "q": query,
            "api_key": api_key,
            "num": 10,
            "safe": "active",
        }).get_dict()

    try:
        result = await asyncio.wait_for(asyncio.to_thread(_search), timeout=12.0)
        images = result.get("images_results", [])
        for img in images[:8]:
            url = img.get("original", "")
            if url and url.startswith("https://") and _looks_like_image(url):
                return url
        for img in images[:4]:
            url = img.get("original", "")
            if url and url.startswith("https://"):
                return url
    except asyncio.TimeoutError:
        logger.warning(f"SerpAPI image search timed out for '{query[:40]}'")
    except Exception as e:
        logger.warning(f"SerpAPI image search failed: {e}")
    return None


# ── Unsplash fallback ─────────────────────────────────────────────────────────

async def _unsplash_image(query: str) -> Optional[str]:
    import urllib.request

    safe_q = query.replace(" ", "+")[:120]

    def _resolve() -> Optional[str]:
        try:
            req = urllib.request.Request(
                f"https://source.unsplash.com/1200x800/?{safe_q}",
                headers={"User-Agent": "Mozilla/5.0 (compatible; SlideBot/1.0)"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                final = resp.url
                if "images.unsplash.com" in final:
                    return final
        except Exception as e:
            logger.warning(f"Unsplash fallback failed: {e}")
        return None

    try:
        return await asyncio.wait_for(asyncio.to_thread(_resolve), timeout=12.0)
    except asyncio.TimeoutError:
        logger.warning(f"Unsplash timed out for '{query[:40]}'")
        return None


# ── Style helpers ─────────────────────────────────────────────────────────────

def _style_title(obj_id: str) -> dict:
    """Navy blue bold title for content/body slides."""
    return {
        "updateTextStyle": {
            "objectId": obj_id,
            "textRange": {"type": "ALL"},
            "style": {
                "bold": True,
                "fontSize": {"magnitude": 30, "unit": "PT"},
                "foregroundColor": {
                    "opaqueColor": {"rgbColor": {"red": 0.07, "green": 0.20, "blue": 0.46}}
                },
            },
            "fields": "bold,fontSize,foregroundColor",
        }
    }


def _style_title_white(obj_id: str) -> dict:
    """White bold title for dark-background slides (cover, section header)."""
    return {
        "updateTextStyle": {
            "objectId": obj_id,
            "textRange": {"type": "ALL"},
            "style": {
                "bold": True,
                "fontSize": {"magnitude": 42, "unit": "PT"},
                "foregroundColor": {
                    "opaqueColor": {"rgbColor": {"red": 1.0, "green": 1.0, "blue": 1.0}}
                },
            },
            "fields": "bold,fontSize,foregroundColor",
        }
    }


def _style_body(obj_id: str) -> dict:
    """Dark slate body text for light-background content slides."""
    return {
        "updateTextStyle": {
            "objectId": obj_id,
            "textRange": {"type": "ALL"},
            "style": {
                "fontSize": {"magnitude": 15, "unit": "PT"},
                "foregroundColor": {
                    "opaqueColor": {"rgbColor": {"red": 0.12, "green": 0.12, "blue": 0.18}}
                },
            },
            "fields": "fontSize,foregroundColor",
        }
    }


def _style_body_light(obj_id: str) -> dict:
    """Soft light body text for dark-background slides (cover, section header)."""
    return {
        "updateTextStyle": {
            "objectId": obj_id,
            "textRange": {"type": "ALL"},
            "style": {
                "fontSize": {"magnitude": 22, "unit": "PT"},
                "foregroundColor": {
                    "opaqueColor": {"rgbColor": {"red": 0.80, "green": 0.88, "blue": 0.98}}
                },
            },
            "fields": "fontSize,foregroundColor",
        }
    }


def _set_slide_background(slide_id: str, r: float, g: float, b: float) -> dict:
    """Set a solid background colour on a slide."""
    return {
        "updatePageProperties": {
            "objectId": slide_id,
            "pageProperties": {
                "pageBackgroundFill": {
                    "solidFill": {
                        "color": {"rgbColor": {"red": r, "green": g, "blue": b}}
                    }
                }
            },
            "fields": "pageBackgroundFill",
        }
    }


def _apply_bullets(obj_id: str) -> dict:
    return {
        "createParagraphBullets": {
            "objectId": obj_id,
            "textRange": {"type": "ALL"},
            "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
        }
    }


def _resize_body(obj_id: str, el: dict, _unused: float = 0.57) -> dict:
    """Resize body text box so it never overlaps the right image column.

    Computes the target width from the slide canvas dimensions so the text
    always ends before the image starts, regardless of the placeholder's
    original size.
    """
    transform = el.get("transform", {})
    size = el.get("size", {})

    tx = transform.get("translateX", 457_200)   # default ½-inch left margin
    ty = transform.get("translateY", 0)
    scaleY = transform.get("scaleY", 1.0)

    # Native (un-scaled) element width from the layout description
    native_w = size.get("width", {}).get("magnitude", _SLIDE_W - 2 * 457_200)

    # Target right edge: image starts at 59 % → leave a 5 % gap → end at 54 %
    right_edge = int(_SLIDE_W * 0.54)
    target_w = max(right_edge - int(tx), 914_400)   # never narrower than 1 inch

    new_sx = target_w / native_w if native_w > 0 else 0.50

    return {
        "updatePageElementTransform": {
            "objectId": obj_id,
            "transform": {
                "scaleX": new_sx,
                "scaleY": scaleY,
                "shearX": 0,
                "shearY": 0,
                "translateX": int(tx),
                "translateY": int(ty),
                "unit": "EMU",
            },
            "applyMode": "ABSOLUTE",
        }
    }


def _insert_image(slide_id: str, url: str) -> dict:
    """Place image in the right ~38% of the slide, below the title row."""
    img_x = int(_SLIDE_W * 0.59)
    img_y = int(_SLIDE_H * 0.24)   # start below title (was 0.17 — caused title overlap)
    img_w = int(_SLIDE_W * 0.38)
    img_h = int(_SLIDE_H * 0.66)   # reduced proportionally
    return {
        "createImage": {
            "url": url,
            "elementProperties": {
                "pageObjectId": slide_id,
                "size": {
                    "height": {"magnitude": img_h, "unit": "EMU"},
                    "width":  {"magnitude": img_w, "unit": "EMU"},
                },
                "transform": {
                    "scaleX": 1,
                    "scaleY": 1,
                    "shearX": 0,
                    "shearY": 0,
                    "translateX": img_x,
                    "translateY": img_y,
                    "unit": "EMU",
                },
            },
        }
    }


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.post("/create_presentation")
async def create_presentation(req: CreatePresentationRequest):
    service, _ = await GoogleAuthManager.get_service_async("slides", "v1", req.user_email)

    # 1. Create empty presentation (Google adds one default blank slide)
    presentation = await execute_with_retry_async(
        service.presentations().create(body={"title": req.title})
    )
    pid = presentation["presentationId"]
    url = f"https://docs.google.com/presentation/d/{pid}/edit"

    if not req.slides:
        return {"success": True, "presentation_id": pid, "url": url, "slide_count": 1}

    default_slide_id: str = presentation["slides"][0]["objectId"]

    # 2. Delete default slide + create all requested slides in one batch
    batch: List[dict] = [{"deleteObject": {"objectId": default_slide_id}}]
    for i, slide in enumerate(req.slides):
        batch.append({
            "createSlide": {
                "objectId": f"slide_{i}",
                "insertionIndex": i,
                "slideLayoutReference": {"predefinedLayout": slide.layout.value},
            }
        })

    batch_result = await execute_with_retry_async(
        service.presentations().batchUpdate(
            presentationId=pid, body={"requests": batch}
        )
    )

    created_ids: List[str] = [
        r["createSlide"]["objectId"]
        for r in batch_result.get("replies", [])
        if "createSlide" in r
    ]

    # 3. Fetch page elements for every slide (sequential - thread-safe)
    def _fetch_elements():
        out = []
        for sid in created_ids:
            page = execute_with_retry(service.presentations().pages().get(
                presentationId=pid, pageObjectId=sid
            ))
            out.append(page.get("pageElements", []))
        return out

    all_elements = await asyncio.to_thread(_fetch_elements)

    # 4. Fetch/generate images in parallel - non-blocking, hard 70s per image
    async def _safe_image(prompt: Optional[str]) -> Optional[str]:
        if not prompt:
            return None
        try:
            return await asyncio.wait_for(_fetch_image_url(prompt, req.user_email), timeout=70.0)
        except asyncio.TimeoutError:
            logger.warning(f"Image fetch timed out for '{prompt[:40]}'")
            return None
        except Exception:
            return None

    fetched_images: List[Optional[str]] = list(
        await asyncio.gather(*[_safe_image(s.image_query) for s in req.slides])
    )

    # 5. Build text-insertion + styling + background requests
    # Dark-background layouts: TITLE (cover) and SECTION_HEADER
    _DARK_BG_LAYOUTS = frozenset({SlideLayout.TITLE, SlideLayout.SECTION_HEADER})
    # Dark navy for cover/section headers, light blue-gray for content slides
    _DARK_BG  = (0.07, 0.18, 0.40)   # #122E66
    _LIGHT_BG = (0.95, 0.97, 0.99)   # #F2F7FE

    text_style_requests: List[dict] = []
    body_resize_info: List[Tuple[Optional[str], Optional[dict]]] = []

    for slide_id, elements, slide_content in zip(created_ids, all_elements, req.slides):
        title_id = body_id = None
        body_el  = None
        is_dark  = slide_content.layout in _DARK_BG_LAYOUTS

        # Set slide background colour
        bg = _DARK_BG if is_dark else _LIGHT_BG
        text_style_requests.append(_set_slide_background(slide_id, *bg))

        for el in elements:
            p_type = el.get("shape", {}).get("placeholder", {}).get("type", "")
            if p_type in _TITLE_PLACEHOLDERS:
                title_id = el["objectId"]
            elif p_type in _BODY_PLACEHOLDERS:
                body_id = el["objectId"]
                body_el = el

        if title_id and slide_content.title_text:
            text_style_requests.append(
                {"insertText": {"objectId": title_id, "text": slide_content.title_text}}
            )
            text_style_requests.append(
                _style_title_white(title_id) if is_dark else _style_title(title_id)
            )

        if body_id and slide_content.body_text:
            text_style_requests.append(
                {"insertText": {"objectId": body_id, "text": slide_content.body_text}}
            )
            text_style_requests.append(
                _style_body_light(body_id) if is_dark else _style_body(body_id)
            )
            if slide_content.layout == SlideLayout.TITLE_AND_BODY:
                text_style_requests.append(_apply_bullets(body_id))

        body_resize_info.append((body_id, body_el) if body_el and body_id else (None, None))

    if text_style_requests:
        try:
            await execute_with_retry_async(
                service.presentations().batchUpdate(
                    presentationId=pid, body={"requests": text_style_requests}
                )
            )
        except Exception as e:
            logger.error(f"Text/style batchUpdate failed: {e}")

    # 6. Insert images + resize body placeholders (separate batch - graceful fallback)
    image_requests: List[dict] = []
    for slide_id, slide_content, img_url, (body_id, body_el) in zip(
        created_ids, req.slides, fetched_images, body_resize_info
    ):
        if not img_url or slide_content.layout != SlideLayout.TITLE_AND_BODY:
            continue
        if body_id and body_el:
            image_requests.append(_resize_body(body_id, body_el, 0.57))
        image_requests.append(_insert_image(slide_id, img_url))

    if image_requests:
        # Try all at once; on failure retry one-by-one skipping bad URLs
        try:
            await asyncio.wait_for(
                execute_with_retry_async(
                    service.presentations().batchUpdate(
                        presentationId=pid, body={"requests": image_requests}
                    )
                ),
                timeout=30.0,
            )
        except (asyncio.TimeoutError, Exception) as batch_err:
            logger.warning(f"Image batch failed ({batch_err}), retrying individually…")
            for req_item in image_requests:
                try:
                    await asyncio.wait_for(
                        execute_with_retry_async(
                            service.presentations().batchUpdate(
                                presentationId=pid, body={"requests": [req_item]}
                            )
                        ),
                        timeout=15.0,
                    )
                except (asyncio.TimeoutError, Exception):
                    pass

    # 7. Add speaker notes
    notes_map = {
        sid: sc.speaker_notes
        for sid, sc in zip(created_ids, req.slides)
        if sc.speaker_notes
    }
    if notes_map:
        await _insert_speaker_notes(service, pid, notes_map)

    return {
        "success": True,
        "presentation_id": pid,
        "url": url,
        "slide_count": len(req.slides),
    }


async def _insert_speaker_notes(service, pid: str, notes_map: dict) -> None:
    """Insert speaker notes text into each slide's notes panel."""
    def _get_pres():
        return execute_with_retry(service.presentations().get(presentationId=pid))

    try:
        pres_data = await asyncio.to_thread(_get_pres)
    except Exception as e:
        logger.warning(f"Could not fetch presentation for speaker notes: {e}")
        return

    note_requests: List[dict] = []
    for slide_data in pres_data.get("slides", []):
        slide_id  = slide_data["objectId"]
        notes_text = notes_map.get(slide_id)
        if not notes_text:
            continue
        notes_page = slide_data.get("slideProperties", {}).get("notesPage", {})
        for el in notes_page.get("pageElements", []):
            if el.get("shape", {}).get("placeholder", {}).get("type") == "BODY":
                note_requests.append(
                    {"insertText": {"objectId": el["objectId"], "text": notes_text}}
                )
                break

    if note_requests:
        try:
            await execute_with_retry_async(
                service.presentations().batchUpdate(
                    presentationId=pid, body={"requests": note_requests}
                )
            )
        except Exception as e:
            logger.warning(f"Speaker notes insertion failed: {e}")


# ── Read presentation ─────────────────────────────────────────────────────────

@router.post("/get_presentation")
async def get_presentation(req: PresentationRequest):
    service, _ = await GoogleAuthManager.get_service_async("slides", "v1", req.user_email)

    presentation = await execute_with_retry_async(
        service.presentations().get(presentationId=req.presentation_id)
    )

    slides: List[dict] = []
    for slide in presentation.get("slides", []):
        texts: List[str] = []
        for el in slide.get("pageElements", []):
            for te in el.get("shape", {}).get("text", {}).get("textElements", []):
                content = te.get("textRun", {}).get("content", "").strip()
                if content:
                    texts.append(content)
        slides.append({"id": slide["objectId"], "texts": texts})

    return {
        "success": True,
        "presentation_id": req.presentation_id,
        "title": presentation.get("title", ""),
        "slide_count": len(slides),
        "slides": slides,
    }
