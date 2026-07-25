"""
imagen_utils.py - Shared Gemini Imagen 4 generation + Google Drive upload helpers.

Provides:
  generate_and_save_image(prompt, user_email, filename, aspect_ratio)
    → Complete workflow: enhance prompt → generate → upload → return result dict

  call_imagen(prompt, api_key, aspect_ratio)     → bytes | None
  upload_to_drive(bytes, user_email, filename)   → dict | None
"""

import asyncio
import os
import uuid
from typing import Optional

from loguru import logger

from mcp_servers.core.google_auth import GoogleAuthManager


# ── Prompt quality enhancement ────────────────────────────────────────────────

# Quality suffix keywords that already indicate a rich prompt - skip enhancement
_QUALITY_KEYWORDS = frozenset([
    "photorealistic", "ultra-detailed", "ultra detailed", "8k", "4k",
    "masterpiece", "cinematic", "hyperrealistic", "professional photography",
    "sharp focus", "high resolution", "studio lighting",
])

# Style categories that need their own quality suffix (not generic photo quality)
_VECTOR_KEYWORDS = frozenset(["vector", "flat design", "minimalist logo", "icon set", "svg style"])


def _enhance_imagen_prompt(prompt: str) -> str:
    """Append Imagen 4 quality modifiers to improve output fidelity.

    - Skips enhancement if the prompt already contains quality keywords.
    - Adds vector/design quality for logo/icon prompts.
    - Adds photorealistic quality for all other prompts.
    """
    lower = prompt.lower()

    if any(kw in lower for kw in _QUALITY_KEYWORDS):
        return prompt  # already a rich prompt - don't pad it

    if any(kw in lower for kw in _VECTOR_KEYWORDS):
        return (
            prompt
            + ", clean crisp vector edges, perfect geometry, professional graphic design, "
            "print-ready quality, scalable illustration"
        )

    # General photorealistic / illustrative enhancement
    return (
        prompt
        + ", ultra-high quality, photorealistic, sharp focus, rich detail, "
        "professional lighting, vibrant color depth, 8K resolution"
    )


# ── Imagen 4 generation ───────────────────────────────────────────────────────

def _call_imagen_sync(prompt: str, api_key: str, aspect_ratio: str = "1:1") -> Optional[bytes]:
    """Synchronous Imagen 4 call - runs inside asyncio.to_thread. Returns None on any failure."""
    try:
        from google import genai  # noqa: PLC0415

        client = genai.Client(api_key=api_key)
        response = client.models.generate_images(
            model="imagen-4.0-generate-001",
            prompt=_enhance_imagen_prompt(prompt),
            config={
                "number_of_images": 1,
                "aspect_ratio": aspect_ratio,
                "safety_filter_level": "BLOCK_LOW_AND_ABOVE",
                "person_generation": "ALLOW_ADULT",
            },
        )
        if response.generated_images:
            return response.generated_images[0].image.image_bytes
    except ImportError:
        logger.debug("google-genai not installed - Imagen unavailable")
    except Exception as e:
        logger.warning(f"Imagen generation failed for '{prompt[:50]}': {e}")
    return None


def _call_imagen_sync_raising(prompt: str, api_key: str, aspect_ratio: str = "1:1") -> bytes:
    """Like _call_imagen_sync but raises on failure so callers can capture the real error."""
    from google import genai  # noqa: PLC0415

    enhanced = _enhance_imagen_prompt(prompt)
    client = genai.Client(api_key=api_key)
    response = client.models.generate_images(
        model="imagen-4.0-generate-001",
        prompt=enhanced,
        config={
            "number_of_images": 1,
            "aspect_ratio": aspect_ratio,
            "safety_filter_level": "BLOCK_LOW_AND_ABOVE",
            "person_generation": "ALLOW_ADULT",
        },
    )
    if response.generated_images:
        return response.generated_images[0].image.image_bytes
    raise RuntimeError("Imagen returned no images - prompt may have been blocked by safety filters")


_IMAGEN_TIMEOUT = 60.0   # seconds - Imagen 3 can be slow for complex prompts


async def call_imagen(prompt: str, api_key: str, aspect_ratio: str = "1:1") -> Optional[bytes]:
    """Async wrapper: run Imagen 3 in a thread with a hard timeout."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_call_imagen_sync, prompt, api_key, aspect_ratio),
            timeout=_IMAGEN_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning(f"Imagen 3 timed out after {_IMAGEN_TIMEOUT}s for '{prompt[:50]}'")
        return None


# ── Google Drive upload ───────────────────────────────────────────────────────

def _upload_to_drive_sync(image_bytes: bytes, drive_service, filename: str) -> Optional[dict]:
    """Upload PNG bytes to Drive as a publicly-readable file.

    Returns a dict with file_id, drive_url (view link), download_url.
    """
    try:
        from googleapiclient.http import MediaInMemoryUpload  # noqa: PLC0415

        media = MediaInMemoryUpload(image_bytes, mimetype="image/png", resumable=False)
        file = drive_service.files().create(
            body={"name": filename, "mimeType": "image/png"},
            media_body=media,
            fields="id,name",
        ).execute()
        file_id = file["id"]

        # Allow anyone with the link to view (required for Slides API and easy sharing)
        drive_service.permissions().create(
            fileId=file_id,
            body={"type": "anyone", "role": "reader"},
            fields="id",
        ).execute()

        return {
            "file_id": file_id,
            "filename": file.get("name", filename),
            "drive_url": f"https://drive.google.com/file/d/{file_id}/view",
            "download_url": f"https://drive.google.com/uc?export=download&id={file_id}",
        }
    except Exception as e:
        logger.warning(f"Drive upload failed: {e}")
        return None


_DRIVE_UPLOAD_TIMEOUT = 30.0  # seconds


async def upload_to_drive(image_bytes: bytes, user_email: str, filename: str) -> Optional[dict]:
    """Async wrapper: get Drive service then upload with hard timeout."""
    try:
        drive_svc, _ = await GoogleAuthManager.get_service_async("drive", "v3", user_email)
        return await asyncio.wait_for(
            asyncio.to_thread(_upload_to_drive_sync, image_bytes, drive_svc, filename),
            timeout=_DRIVE_UPLOAD_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning(f"Drive upload timed out after {_DRIVE_UPLOAD_TIMEOUT}s for '{filename}'")
        return None
    except Exception as e:
        logger.warning(f"Could not get Drive service for upload: {e}")
        return None


# ── Brand-aware prompt synthesis ─────────────────────────────────────────────

_BRAND_SYNTHESIS_SYSTEM = """\
You are a senior brand designer and AI image-prompt specialist.

Given raw text scraped from a brand's website and a user image request, extract:
  1. PRIMARY COLOR - the dominant brand color (be specific: hex if visible, or name like "deep navy", "forest green")
  2. SECONDARY COLOR - accent/highlight color
  3. VISUAL STYLE - one of: minimalist, bold/expressive, luxury, corporate, playful, sci-fi/tech, organic/natural, retro
  4. INDUSTRY - e.g. fintech, healthcare, SaaS, fashion, food, education
  5. BRAND PERSONALITY - 2-3 adjectives (e.g. "trustworthy, modern, approachable")
  6. KEY VISUAL SYMBOLS - any icons, shapes, or imagery strongly associated with the brand

Then write a SINGLE vivid Imagen 4 prompt that:
  - Fulfils the user's image request
  - Incorporates the exact brand colors as named gradients or solid fills
  - Reflects the visual style and personality
  - Is specific about composition, lighting, background, and intended use

Output ONLY the Imagen 4 prompt text. No JSON, no explanation, no intro. Max 180 words.\
"""


async def _synthesize_brand_prompt(
    user_prompt: str,
    brand_context: str,
    api_key: str,
) -> str:
    """Use Gemini Flash to synthesize a brand-accurate Imagen 4 prompt from webpage context.

    Returns the synthesized prompt, or falls back to `user_prompt` on any failure.
    """
    try:
        from litellm import acompletion  # noqa: PLC0415

        messages = [
            {"role": "system", "content": _BRAND_SYNTHESIS_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Brand webpage text (first 4000 chars):\n{brand_context[:4000]}\n\n"
                    f"User image request: {user_prompt}"
                ),
            },
        ]
        response = await acompletion(
            model="gemini/gemini-2.0-flash",
            messages=messages,
            max_tokens=350,
            temperature=0.5,
            api_key=api_key,
        )
        synthesized = (response.choices[0].message.content or "").strip()
        if synthesized and len(synthesized) > 30:
            logger.info(f"Brand-synthesized prompt ({len(synthesized)} chars): '{synthesized[:80]}…'")
            return synthesized
    except Exception as e:
        logger.warning(f"Brand prompt synthesis failed - falling back to user prompt: {e}")

    return user_prompt  # safe fallback


# ── Top-level workflow ────────────────────────────────────────────────────────

async def generate_and_save_image(
    prompt: str,
    user_email: str,
    filename: str = None,
    aspect_ratio: str = "1:1",
    brand_context: str = None,
) -> dict:
    """Generate an image with Gemini Imagen 4 and upload to user's Google Drive.

    Args:
        prompt:        Detailed Imagen 4 visual description.
        user_email:    User whose Drive will hold the file.
        filename:      Desired filename (without extension; .png appended automatically).
        aspect_ratio:  '1:1' for logos/icons, '16:9' for slides/banners, '4:3', '9:16'.
        brand_context: Raw text from a brand's website (from fetch_webpage). When provided,
                       a Gemini Flash call synthesises a brand-accurate Imagen prompt instead
                       of using the LLM-written prompt directly.

    Returns a dict:
        success=True  → drive_url, download_url, file_id, filename, prompt_used
        success=False → error (human-readable string)
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"success": False, "error": "GEMINI_API_KEY is not configured on the server."}

    # Brand-aware prompt synthesis - kicks in whenever webpage context is provided
    final_prompt = prompt
    if brand_context and brand_context.strip():
        logger.info("Brand context provided - synthesising brand-accurate Imagen prompt…")
        final_prompt = await _synthesize_brand_prompt(prompt, brand_context, api_key)

    # Build safe filename
    if not filename:
        filename = f"imagen_{uuid.uuid4().hex[:8]}.png"
    else:
        safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in filename).strip()
        filename = (safe or "imagen") + ".png"

    logger.info(f"Imagen 4: generating | ratio={aspect_ratio} | prompt='{final_prompt[:80]}'")
    try:
        image_bytes = await asyncio.wait_for(
            asyncio.to_thread(_call_imagen_sync_raising, final_prompt, api_key, aspect_ratio),
            timeout=_IMAGEN_TIMEOUT,
        )
    except asyncio.TimeoutError:
        return {"success": False, "error": "Imagen 4 timed out after 60 seconds. Try a shorter, simpler prompt."}
    except Exception as e:
        logger.error(f"Imagen 4 generation error: {e}")
        return {"success": False, "error": f"Imagen 4 error: {e}"}

    if not image_bytes:
        return {
            "success": False,
            "error": "Imagen 4 returned no image. Prompt may have been blocked by safety filters.",
        }

    result = await upload_to_drive(image_bytes, user_email, filename)
    if not result:
        return {
            "success": False,
            "error": "Image was generated but could not be saved to Google Drive.",
        }

    logger.info(f"Imagen 4: saved to Drive as {result['filename']} (id={result['file_id']})")
    return {
        "success": True,
        "drive_url": result["drive_url"],
        "download_url": result["download_url"],
        "file_id": result["file_id"],
        "filename": result["filename"],
        "prompt_used": final_prompt,
    }
