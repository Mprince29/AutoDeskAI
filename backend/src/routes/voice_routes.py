"""
Voice routes - Sarvam AI STT WebSocket bridge + TTS REST endpoint.

WebSocket flow:
  1. Client opens  ws://host/api/voice/ws?email=...
  2. Server opens outbound WS to Sarvam Saaras v3 STT
  3. Client streams Int16 PCM audio (16 kHz mono) as binary frames
  4. Sarvam returns transcript events; VAD auto-detects speech_end
  5. Backend runs Three-Tier Intent Router (Tier 1 = nav, 2/3 = agent)
  6. For risky actions (email/meeting), Ghost Draft is shown first
  7. On user confirm → executes via AgentExecutor stream
  8. Agent events streamed back to frontend in real-time

TTS endpoint:
  POST /api/voice/tts?email=...  { "text": "..." }
  → Calls Sarvam Bulbul v3 → returns { "audio_b64": "<wav_base64>" }
"""

import asyncio
import base64
import json
import os
import re
import time
from typing import Optional

import httpx
import websockets
import websockets.exceptions
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel

from services.intent_parser import build_ghost_preview, parse_intent
from services.rate_limiter import sarvam_limiter
from services.security import GLOBAL_SIGNER
from auth.database import SessionLocal
from auth.routes import decode_access_token, get_current_user
from auth.models import User
from utils.activity_logger import record_activity

router = APIRouter()

# ── Pending result store (HTTP fallback when WS closes during execution) ──────
# Keyed by user email. Frontend polls /api/voice/pending-result to consume.
_pending_voice_results: dict[str, dict] = {}
_PENDING_TTL = 90  # seconds before a pending result expires

def _save_pending_result(user_email: str, result: str, tools_used: list) -> None:
    _pending_voice_results[user_email] = {
        "result": result,
        "tools_used": tools_used,
        "expires_at": time.time() + _PENDING_TTL,
    }
    logger.info(f"Voice: pending result saved for {user_email} (HTTP polling fallback)")

# ── Sarvam auth error dedup ──────────────────���────────────────────────────────
# Tracks whether we've already emitted a WARNING for a Sarvam 403/401 so we
# don't flood the logs on every mic click when the key is invalid.
_sarvam_auth_error_logged = False

# ── End-of-command phrase detection ──────────────────────────────────────────
# Ordered longest-first so the regex alternation prefers more specific matches.
_END_PHRASES = (
    "that's all for now", "that will be all",
    "that's it for now",  "that's it",  "thats it", "that is it",
    "execute this now",   "execute this", "execute now", "execute it", "execute",
    "go ahead now",       "go ahead",
    "proceed now",        "proceed",
    "i'm done",           "im done",    "all done",  "okay done",
    "confirm it",         "alright go", "okay go",   "ok go",
    # NOTE: "send", "send it", "do it", "finish", "submit" removed -
    # they are too common in real commands (e.g. "send email to John")
    # and caused the transcript to be cut short mid-command.
)

# ── Exit-continuous phrases (recognized in transcript_pump) ───────────────────
# When the user says one of these, the backend sends {type: "exit_continuous"}
# to the frontend so the auto-restart loop terminates cleanly.
_EXIT_CONTINUOUS_PHRASES = (
    "stop listening", "stop voice", "exit voice", "exit voice mode",
    "goodbye", "good bye", "bye bye", "that's enough", "thats enough",
    "end conversation", "stop conversation", "close voice",
)
_EXIT_CONTINUOUS_RE = re.compile(
    r'^(' + '|'.join(re.escape(p) for p in _EXIT_CONTINUOUS_PHRASES) + r')[.!?]?\s*$',
    re.IGNORECASE,
)

_END_PHRASE_RE = re.compile(
    r'(?:[,\s.!?]+)\b(' + '|'.join(re.escape(p) for p in _END_PHRASES) + r')\b[.!?]?\s*$',
    re.IGNORECASE,
)
# For the case where the ENTIRE segment is just an end phrase
_END_PHRASE_EXACT_RE = re.compile(
    r'^(' + '|'.join(re.escape(p) for p in _END_PHRASES) + r')[.!?]?\s*$',
    re.IGNORECASE,
)


def _strip_end_phrase(text: str) -> tuple[str, bool]:
    """Return (cleaned_text, found).

    - Entire segment is end phrase → ('', True)
    - Segment ends with end phrase → (text_without_phrase, True)
    - No end phrase → (text, False)
    """
    stripped = text.strip()
    if _END_PHRASE_EXACT_RE.match(stripped):
        return "", True
    m = _END_PHRASE_RE.search(stripped)
    if m:
        return stripped[:m.start()].strip().rstrip(",. "), True
    return stripped, False

# ── Sarvam constants ──────────────────────────────────────────────────────────

_SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
# API key is embedded in the URL path; VAD flags are query params
_SARVAM_STT_URL_TEMPLATE = (
    "wss://api.sarvam.ai/speech-to-text-translate/ws/{key}"
    "?vad_signals=true"
    # high_vad_sensitivity omitted - default ~1.5s silence threshold is safer
)

# Intent → AgentType string (covers all 11 agents)
_INTENT_AGENT: dict[str, str] = {
    "send_email":              "email_manager",
    "create_draft":            "email_manager",
    "read_emails":             "email_manager",
    "simulate_communication":  "communication_simulator",
    "schedule_meeting":        "calendar_assistant",
    "generate_image":          "document_creator",
    "create_document":         "document_creator",
    "search_web":              "document_creator",
    "create_spreadsheet":      "data_analyst",
    "analyze_data":            "data_analyst",
    "create_presentation":     "presentation_builder",
    "manage_files":            "file_manager",
    "create_form":             "form_builder",
    "manage_tasks":            "task_manager",
    "translate_text":          "translator",
    "negotiate":               "negotiation_advisor",
    "general_task":            "email_manager",
}


# ── Helper: collect transcript from Sarvam ────────────────────────────────────

async def _collect_transcript(
    client_ws: WebSocket,
    sarvam_ws,
    hard_timeout: float = 30.0,
) -> tuple[str, bool, bool]:
    """
    Concurrently forward audio from client → Sarvam and receive Sarvam events.
    Returns (transcript, sarvam_ok, client_disconnected) where:
      sarvam_ok=False means the Sarvam connection dropped before any transcript.
      client_disconnected=True means the browser closed the WS during collection.
    """
    transcript = ""
    sarvam_disconnected = False
    client_disconnected = False
    done = asyncio.Event()
    logger.info(f"_collect_transcript: starting (timeout={hard_timeout}s)")

    async def audio_pump():
        """Forward raw PCM bytes from the browser to Sarvam STT."""
        nonlocal client_disconnected
        audio_chunks_received = 0
        try:
            while not done.is_set():
                try:
                    raw = await asyncio.wait_for(client_ws.receive(), timeout=0.1)
                except asyncio.TimeoutError:
                    continue
                except WebSocketDisconnect as e:
                    logger.info(f"audio_pump: client disconnected: {type(e).__name__}")
                    client_disconnected = True
                    done.set()
                    break
                except Exception as e:
                    logger.info(f"audio_pump: receive error: {type(e).__name__}")
                    done.set()
                    break

                if raw.get("type") == "websocket.disconnect":
                    logger.info("audio_pump: received disconnect message")
                    client_disconnected = True
                    done.set()
                    break

                b = raw.get("bytes")
                if b:
                    audio_chunks_received += 1
                    try:
                        encoded = base64.b64encode(b).decode("utf-8")
                        await sarvam_ws.send(json.dumps({
                            "audio": {
                                "data": encoded,
                                "sample_rate": 16000,
                                "encoding": "audio/wav",
                            }
                        }))
                        logger.debug(f"audio_pump: sent chunk {audio_chunks_received} ({len(b)}B)")
                    except Exception as e:
                        logger.warning(f"Failed to send audio to Sarvam: {e}")
                        done.set()
                        break

                # Control messages during audio phase (e.g. force_end from hard timeout)
                t = raw.get("text")
                if t:
                    try:
                        ctrl = json.loads(t)
                        if ctrl.get("type") == "force_end":
                            logger.info("audio_pump: received force_end")
                            done.set()
                            break
                        # "ping" is a keep-alive - ignore silently
                    except Exception:
                        pass
        except Exception as e:
            logger.debug(f"audio_pump exception: {e}")
        finally:
            logger.info(f"audio_pump: ending (received {audio_chunks_received} chunks)")
            done.set()

    async def transcript_pump():
        """
        Receive Sarvam events and build up the full transcript.

        Sarvam STTT event format:
          {"type":"events","data":{"signal_type":"START_SPEECH","occured_at":...}}
          {"type":"events","data":{"signal_type":"END_SPEECH","occured_at":...}}
          {"type":"data","data":{"transcript":"...","language_code":"...","metrics":{...}}}

        Each START→END cycle produces one "data" segment.  We accumulate all
        segments and stop 2.5 s after the last END_SPEECH with no new START_SPEECH.
        """
        nonlocal transcript, sarvam_disconnected
        segments: list[str] = []
        # Fallback: if user forgets to say an end phrase, auto-submit after
        # 12 s of silence following the last END_SPEECH signal.
        _last_end_at: float = 0.0
        _INTER_SEGMENT_GAP = 12.0
        events_received = 0
        try:
            deadline = asyncio.get_running_loop().time() + hard_timeout
            while not done.is_set():
                loop_now = asyncio.get_running_loop().time()

                # If we got at least one segment and silence gap has passed → done
                if segments and _last_end_at and (loop_now - _last_end_at) >= _INTER_SEGMENT_GAP:
                    logger.info(f"transcript_pump: silence gap detected ({_INTER_SEGMENT_GAP}s), ending collection")
                    done.set()
                    break

                remaining = deadline - loop_now
                if remaining <= 0:
                    logger.info(f"transcript_pump: hard timeout reached")
                    done.set()
                    break

                try:
                    msg = await asyncio.wait_for(
                        sarvam_ws.recv(), timeout=min(0.5, remaining)
                    )
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed as e:
                    logger.warning(f"transcript_pump: Sarvam WS closed unexpectedly: {e}")
                    sarvam_disconnected = True
                    done.set()
                    break
                except Exception as e:
                    logger.warning(f"transcript_pump recv error: {type(e).__name__}: {e}")
                    sarvam_disconnected = True
                    done.set()
                    break

                if not isinstance(msg, str):
                    logger.debug(f"transcript_pump: non-string message type: {type(msg)}")
                    continue

                events_received += 1
                try:
                    event = json.loads(msg)
                except Exception:
                    logger.debug(f"transcript_pump: non-JSON message: {msg[:100]}")
                    continue

                logger.debug(f"transcript_pump: event {events_received}: {msg[:300]}")
                evt_type = event.get("type", "")
                evt_data = event.get("data", {})

                if evt_type == "error":
                    logger.warning(f"Sarvam pipeline error: {evt_data}")
                    continue

                if evt_type == "events":
                    signal = evt_data.get("signal_type", "")
                    if signal == "START_SPEECH":
                        _last_end_at = 0.0  # reset gap timer - user is speaking again
                        try:
                            await client_ws.send_json({"type": "speech_start"})
                        except Exception:
                            pass
                    elif signal == "END_SPEECH":
                        _last_end_at = asyncio.get_running_loop().time()
                        try:
                            await client_ws.send_json({"type": "speech_end"})
                        except Exception:
                            pass

                elif evt_type == "data":
                    seg = evt_data.get("transcript", "").strip()
                    if seg:
                        # Check for exit-continuous phrases first (highest priority)
                        if _EXIT_CONTINUOUS_RE.match(seg):
                            logger.info(f"transcript_pump: exit_continuous phrase detected: '{seg}'")
                            try:
                                await client_ws.send_json({"type": "exit_continuous"})
                            except Exception:
                                pass
                            done.set()
                            break

                        clean_seg, found_end = _strip_end_phrase(seg)
                        if clean_seg:
                            segments.append(clean_seg)
                        transcript = " ".join(segments)
                        if transcript:
                            try:
                                await client_ws.send_json(
                                    {"type": "transcript", "text": transcript, "final": found_end}
                                )
                            except Exception as e:
                                logger.warning(f"transcript_pump: failed to send transcript to client: {e}")
                                done.set()
                                break
                        if found_end:
                            # User said the end phrase - terminate immediately
                            logger.info(f"transcript_pump: end phrase detected, terminating")
                            done.set()
                            break

        except Exception as e:
            logger.debug(f"transcript_pump exception: {e}")
            sarvam_disconnected = True
        finally:
            logger.info(f"transcript_pump: ending (received {events_received} events, collected {len(segments)} segments)")
            done.set()

    await asyncio.gather(audio_pump(), transcript_pump())
    # sarvam_ok = False if we exited due to a connection error with no transcript
    sarvam_ok = not (sarvam_disconnected and not transcript.strip())
    logger.info(f"_collect_transcript: completed (transcript_len={len(transcript)}, sarvam_ok={sarvam_ok}, client_disconnected={client_disconnected})")
    return transcript.strip(), sarvam_ok, client_disconnected


# ── Helper: wait for user confirm/cancel ──────────────────────────────────────

async def _wait_for_confirm(
    client_ws: WebSocket,
    timeout: float = 30.0,
) -> bool:
    """
    Wait for {"type":"confirm","approved":true/false} or {"type":"cancel"}.
    Returns True if confirmed, False if cancelled or timed-out (30s = auto-cancel).
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        remaining = deadline - loop.time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(client_ws.receive(), timeout=min(0.5, remaining))
            if raw.get("type") == "websocket.disconnect":
                return False
            t = raw.get("text")
            if t:
                ctrl = json.loads(t)
                if ctrl.get("type") == "confirm":
                    return bool(ctrl.get("approved", True))
                if ctrl.get("type") == "cancel":
                    return False
        except asyncio.TimeoutError:
            continue
        except Exception:
            return False

    return False  # timeout → auto-cancel


# ── Helper: execute intent via AgentExecutor stream ──────────────────────────

async def _ws_send(ws: WebSocket, payload: dict, retry_count: int = 1) -> bool:
    """Send JSON to client WebSocket. Returns False if the connection is closed.
    
    Args:
        ws: WebSocket connection
        payload: JSON payload to send
        retry_count: Number of times to retry on transient failures (max 2)
    """
    payload_type = payload.get("type", "unknown")
    max_retries = min(retry_count, 2)
    
    for attempt in range(max_retries):
        try:
            await ws.send_json(payload)
            if attempt == 0:
                logger.info(f"Voice: {payload_type} message sent successfully")
            else:
                logger.debug(f"Voice: {payload_type} msg sent on retry {attempt}")
            return True
        except WebSocketDisconnect:
            logger.warning(f"Voice: WebSocket disconnected during {payload_type} send")
            return False
        except Exception as e:
            if attempt < max_retries - 1:
                logger.debug(f"Voice: {payload_type} send attempt {attempt + 1} failed ({type(e).__name__}), retrying...")
                await asyncio.sleep(0.1)  # brief delay before retry
            else:
                logger.warning(f"Voice: {payload_type} send failed after {max_retries} attempts: {type(e).__name__}")
                return False
    
    return False


async def _execute_and_stream(
    intent: dict,
    user_email: str,
    client_ws: WebSocket,
    security_token: Optional[str] = None,
    skip_done: bool = False,
    sarvam_key: str = "",
) -> str:
    """Run intent through AgentExecutor and stream events back to client.

    When sarvam_key is provided, the result text is split into sentences and
    TTS audio chunks are streamed back to the frontend before the done message,
    so playback begins before the full response is read.
    """
    text = intent.get("passthrough_text") or intent.get("original_text", "")
    if not text:
        await _ws_send(client_ws, {"type": "error", "message": "Empty command"})
        return ""

    logger.info(f"Voice: _execute_and_stream: about to send executing message (text_len={len(text)})")
    if not await _ws_send(client_ws, {"type": "executing", "transcript": text}):
        logger.error(f"Voice: _execute_and_stream: client disconnected before executing message sent")
        return ""  # Client already disconnected before execution started

    logger.info(f"Voice: _execute_and_stream: executing message sent, starting agent stream")
    raw_intent = intent.get("intent", "")
    if raw_intent in ("general_task", ""):
        # Tier 3 fallback: detect task type from text so we don't blindly
        # route every ambiguous command to email_manager.
        text_lower = text.lower()
        _DOC_KW   = ("create a doc", "write a report", "make a document", "document about",
                     "write about", "draft a", "prepare a report", "save a document",
                     "security", "vulnerability", "cve", "insecure", "unsafe to install",
                     "research", "not safe")
        _SHEET_KW = ("spreadsheet", "create a table", "make a table", "data on", "csv")
        _PRES_KW  = ("slides", "ppt", "deck", "presentation")
        _CAL_KW   = ("schedule", "book a meeting", "set up a meeting", "create event")
        if any(kw in text_lower for kw in _DOC_KW):
            agent_type = "document_creator"
        elif any(kw in text_lower for kw in _SHEET_KW):
            agent_type = "data_analyst"
        elif any(kw in text_lower for kw in _PRES_KW):
            agent_type = "presentation_builder"
        elif any(kw in text_lower for kw in _CAL_KW):
            agent_type = "calendar_assistant"
        else:
            agent_type = "email_manager"
    else:
        agent_type = _INTENT_AGENT.get(raw_intent, "email_manager")

    result_text = "Task completed."
    tools_used: list[str] = []

    try:
        from services.agent_executor import agent_executor  # noqa: PLC0415

        logger.info(f"Voice: starting agent stream (agent={agent_type}, user={user_email})")
        iteration_count = 0
        async for chunk_str in agent_executor.execute_agent_stream_task(
            agent_type, text, user_email, security_token=security_token
        ):
            iteration_count += 1
            try:
                event = json.loads(chunk_str.strip())
            except json.JSONDecodeError:
                logger.debug(f"Voice stream: skipped non-JSON chunk: {chunk_str!r:.120}")
                continue

            etype = event.get("type", "")

            if etype in ("status", "tool_call", "agent"):
                # Send agent events, but don't stop streaming if this fails
                # The done message will be sent regardless
                sent = await _ws_send(client_ws, {
                    "type": "agent_event",
                    "sub_type": etype,
                    "tool": event.get("tool"),
                    "label": event.get("message") or event.get("text", ""),
                })
                if not sent:
                    logger.debug(f"Voice: agent_event send failed at iteration {iteration_count}; connection may be closed but continuing...")
            elif etype == "result":
                result_text = event.get("text", "Task completed.")
                tools_used = event.get("tools_used", [])
                logger.info(f"Voice: result received (length={len(result_text)}, tools={len(tools_used)})")
            elif etype == "error":
                err_msg = event.get("message", "Execution failed")
                logger.error(f"Voice: agent error: {err_msg}")
                await _ws_send(client_ws, {"type": "error", "message": err_msg})
                return ""

        logger.info(f"Voice: agent stream completed ({iteration_count} iterations)")

        # ── Streaming TTS: split result into sentences and fire TTS per-sentence ──
        # Only when sarvam_key is available and result is non-empty.
        # TTS tasks are fired concurrently; the done message is sent after all are
        # launched (non-blocking) so the WebSocket stays open for audio_chunk frames.
        tts_tasks: list[asyncio.Task] = []
        if sarvam_key and result_text and not skip_done:
            # Simple sentence splitter on . ! ? — keeps punctuation with each sentence
            _SENT_RE = re.compile(r'(?<=[.!?])\s+')
            raw_sentences = _SENT_RE.split(result_text.strip())
            # Strip markdown, URLs, empty strings; cap each sentence at 400 chars
            _CLEAN = re.compile(r'https?://\S+|\*{1,2}|#{1,6}\s?')
            sentences = [
                _CLEAN.sub('', s).strip()
                for s in raw_sentences
                if _CLEAN.sub('', s).strip()
            ]
            logger.info(f"Voice: streaming TTS for {len(sentences)} sentence(s)")
            for seq, sentence in enumerate(sentences):
                if not sentence:
                    continue
                task = asyncio.ensure_future(
                    _stream_tts_to_ws(client_ws, sentence, sarvam_key, seq)
                )
                tts_tasks.append(task)

        # ALWAYS try to send done message, even if earlier messages failed
        # This ensures the frontend receives the final result
        if not skip_done:
            logger.info(f"Voice: sending done message (critical)...")
            # Wait for all TTS tasks to finish before sending done so the frontend
            # audio queue has all chunks before the done event triggers auto-restart.
            if tts_tasks:
                await asyncio.gather(*tts_tasks, return_exceptions=True)
                logger.info(f"Voice: all {len(tts_tasks)} TTS chunk(s) dispatched")

            success = await _ws_send(
                client_ws,
                {"type": "done", "result": result_text, "tools_used": tools_used},
                retry_count=2
            )
            if success:
                logger.info(f"Voice: ✓ CRITICAL done message delivered (result: {result_text[:80]}...)")
                await asyncio.sleep(0.3)
            else:
                logger.error(f"Voice: ✗✗ WS closed before done message - saving for HTTP polling")
                _save_pending_result(user_email, result_text, tools_used)

        return result_text

    except asyncio.CancelledError:
        logger.warning("Voice: execution was cancelled")
        await _ws_send(client_ws, {"type": "error", "message": "Voice command was cancelled"})
        return ""
    
    except Exception as e:
        # Log all exceptions with full traceback
        import traceback
        log_msg = f"Voice execute error: {type(e).__name__}: {str(e)[:200]}"
        logger.error(f"{log_msg}\n{traceback.format_exc()}")
        await _ws_send(client_ws, {"type": "error", "message": "Task execution failed. Please try again."})
        return ""


# ── Helper: open Sarvam STT connection with one retry ────────────────────────

async def _open_sarvam(sarvam_key: str):
    """
    Connect to Sarvam STT-Translate WebSocket (saaras:v3).
    API key is embedded in the URL path; no auth header needed.
    Retries once (after 1 s) on transient network errors.
    Raises immediately on auth errors (HTTP 401/403).
    """
    url = _SARVAM_STT_URL_TEMPLATE.format(key=sarvam_key)
    last_exc: Exception = RuntimeError("unreachable")
    for attempt in range(2):
        try:
            logger.debug(f"_open_sarvam: attempt {attempt + 1} to connect")
            return await websockets.connect(
                url,
                ping_interval=None,   # Sarvam manages keep-alive
                open_timeout=10,
            )
        except websockets.exceptions.InvalidStatus as e:
            logger.error(f"_open_sarvam: HTTP {getattr(e.response, 'status_code', '?')} from Sarvam - not retrying")
            raise  # auth / bad-request - don't retry
        except Exception as e:
            last_exc = e
            if attempt == 0:
                logger.debug(f"_open_sarvam: attempt 1 failed ({type(e).__name__}: {e}), retrying in 1s…")
                await asyncio.sleep(1.0)
            else:
                logger.error(f"_open_sarvam: attempt 2 failed ({type(e).__name__}: {e})")
    raise last_exc


# ── Streaming TTS helper ──────────────────────────────────────────────────────

async def _stream_tts_to_ws(
    client_ws: WebSocket,
    sentence: str,
    sarvam_key: str,
    seq: int,
) -> bool:
    """
    Call Sarvam Bulbul v3 TTS for one sentence and send the audio chunk
    back to the frontend as:
        {"type": "audio_chunk", "data": "<base64_wav>", "seq": <int>}

    Returns True on success, False on any failure (best-effort).
    Called concurrently while the LLM is still generating subsequent sentences.
    """
    sentence = sentence.strip()
    if not sentence:
        return False
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(
                _SARVAM_TTS_URL,
                headers={
                    "api-subscription-key": sarvam_key,
                    "Content-Type": "application/json",
                },
                json={
                    "inputs": [sentence[:400]],
                    "target_language_code": "en-IN",
                    "speaker": "shubh",
                    "model": "bulbul:v3",
                    "enable_preprocessing": True,
                },
            )
            if not resp.is_success:
                logger.warning(f"TTS chunk failed (HTTP {resp.status_code}) for seq={seq}")
                return False
            audios = resp.json().get("audios", [])
            if not audios:
                return False
            return await _ws_send(client_ws, {
                "type": "audio_chunk",
                "data": audios[0],
                "seq": seq,
            })
    except Exception as e:
        logger.warning(f"_stream_tts_to_ws seq={seq} error: {type(e).__name__}: {e}")
        return False


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws")
async def voice_ws(websocket: WebSocket, token: str = Query(...)):
    """
    Main voice WebSocket.  Browser connects, streams PCM, receives JSON events.

    Event types sent to client:
      ready          - session open, start streaming audio
      speech_start   - Sarvam VAD detected voice
      transcript     - partial/final transcript text
      speech_end     - silence detected, processing intent
      processing     - intent parser running
      navigate       - Tier 1: page to navigate to
      ghost_draft    - Tier 2/3: show preview before executing
      executing      - agent started
      agent_event    - relay of agent stream (status/tool_call/result)
      done           - final result
      error          - something went wrong
      cancelled      - user cancelled ghost draft

    Control messages FROM client (JSON text):
      { "type": "confirm", "approved": true/false }
      { "type": "cancel" }
      { "type": "force_end" }   - hard timeout from browser
    """
    await websocket.accept()

    try:
        email = decode_access_token(token)
    except Exception:
        await websocket.close(code=1008)
        return

    sarvam_key = os.getenv("SARVAM_API_KEY", "").strip()
    if not sarvam_key:
        await websocket.send_json(
            {"type": "error", "message": "Voice commands unavailable - SARVAM_API_KEY not set."}
        )
        await websocket.close()
        return

    if not sarvam_limiter.can_call(email):
        usage = sarvam_limiter.usage(email)
        await websocket.send_json(
            {
                "type": "error",
                "message": (
                    f"Rate limit reached ({usage['used']}/{usage['limit']} calls/min). "
                    "Please wait a moment."
                ),
            }
        )
        await websocket.close()
        return

    sarvam_limiter.record(email)

    sarvam_ws = None
    try:
        logger.info(f"Voice WS: opening Sarvam connection for {email}")
        sarvam_ws = await _open_sarvam(sarvam_key)
        logger.info(f"Voice WS: Sarvam connection opened successfully")
        
        await websocket.send_json({"type": "ready"})
        logger.info(f"Voice WS: ready for email={email}")

        # ── Phase 1: Stream audio, collect transcript ─────────────────────
        logger.info(f"Voice WS: entering phase 1 (transcript collection)")
        transcript, sarvam_ok, client_disconnected = await _collect_transcript(websocket, sarvam_ws)
        logger.info(f"Voice WS: phase 1 complete (transcript_len={len(transcript)}, sarvam_ok={sarvam_ok}, client_disconnected={client_disconnected})")

        if not transcript:
            if client_disconnected:
                # Browser left - nothing to send back; just exit cleanly
                logger.info(f"Voice WS: client disconnected during speech collection for {email}")
                return
            if not sarvam_ok:
                logger.warning(f"Voice WS: Sarvam connection dropped for {email}")
                error_msg = "Voice service connection dropped. Please try again."
            else:
                logger.warning(f"Voice WS: no transcript detected for {email}")
                error_msg = "No speech detected. Please speak clearly and try again."
            try:
                await websocket.send_json({"type": "error", "message": error_msg})
            except Exception as e:
                logger.info(f"Voice WS: could not send error to client (already gone): {e}")
            return

        logger.info(f"Voice WS: transcript collected: {transcript[:100]}")

        # Close Sarvam connection early - we're done with STT
        if sarvam_ws is not None:
            try:
                await sarvam_ws.close()
                logger.info(f"Voice WS: closed Sarvam connection")
                sarvam_ws = None
            except Exception as e:
                logger.debug(f"Voice WS: error closing Sarvam WS: {e}")
                sarvam_ws = None

        # ── Phase 2: Parse intent ─────────────────────────────────────────
        try:
            await websocket.send_json({"type": "processing", "transcript": transcript})
            logger.info(f"Voice WS: sent processing message to client")
        except Exception as e:
            logger.error(f"Voice WS: failed to send processing message: {e}")
            return
            
        intent = await parse_intent(transcript, email)
        logger.info(f"Voice WS: intent parsed: {intent.get('intent')} (tier={intent.get('tier')})")

        # Log voice command to DB
        def _log_voice():
            db = SessionLocal()
            try:
                record_activity(
                    db, email, "voice_command",
                    entity_type="voice",
                    details={
                        "transcript": transcript[:300],
                        "intent": intent.get("intent"),
                        "tier": intent.get("tier"),
                    },
                    request=websocket
                )
            finally:
                db.close()
        asyncio.get_event_loop().run_in_executor(None, _log_voice)

        # ── Phase 3: Route ────────────────────────────────────────────────
        tier = intent.get("tier", 3)

        if tier == 1:
            page = intent.get("page", "/dashboard")
            # __exit_continuous__ is a sentinel — not a real page, signals loop exit
            if page == "__exit_continuous__":
                logger.info(f"Voice WS: Tier 1 exit_continuous command detected")
                try:
                    await websocket.send_json({"type": "exit_continuous"})
                except Exception:
                    pass
                return
            # Normal navigation
            logger.info(f"Voice WS: Tier 1 navigation to {page}")
            await websocket.send_json(
                {
                    "type": "navigate",
                    "page": page,
                    "transcript": transcript,
                }
            )
            return

        if intent.get("needs_ghost_draft"):
            # Show preview; wait for explicit user confirmation
            intent_type = intent.get("intent", "")
            logger.info(f"Voice WS: showing ghost_draft for {intent_type}")
            preview = build_ghost_preview(intent)

            # Phase A: Draft-only execution for emails
            draft_text = ""
            if intent_type == "send_email":
                draft_intent = dict(intent)
                draft_intent["passthrough_text"] = f"Draft ONLY (DO NOT SEND). Show the complete email with To, Subject, and Body. Task: {transcript}"
                
                logger.info(f"Voice WS: generating email draft")
                draft_text = await _execute_and_stream(
                    draft_intent, email, websocket, security_token=None, skip_done=True,
                    sarvam_key="",  # No TTS for draft-only pass
                )
                logger.info(f"Voice WS: draft generated, length={len(draft_text)}")
                preview["body"] = draft_text

            await websocket.send_json(
                {
                    "type": "ghost_draft",
                    "intent_type": intent_type,
                    "transcript": transcript,
                    "preview": preview,
                }
            )

            logger.info(f"Voice WS: waiting for user confirmation for {intent_type}")
            confirmed = await _wait_for_confirm(websocket, timeout=30.0)
            if not confirmed:
                logger.info(f"Voice WS: user cancelled {intent_type}")
                await websocket.send_json({"type": "cancelled"})
                return
            
            logger.info(f"Voice WS: user confirmed {intent_type}")
                            # Phase B: Send-only execution for emails
            if intent_type == "send_email" and draft_text:
                intent["passthrough_text"] = f"Send this email exactly as written:\n{draft_text}"
        else:
            logger.info(f"Voice WS: skipping ghost_draft, executing directly")


        # ── Phase 4: Execute ──────────────────────────────────────────────
        logger.info(f"Voice WS: phase 4 execute starting")
        security_token = None
        if intent.get("needs_ghost_draft"):
            action_name = intent.get("intent", "general_task")
            # params={} because tool-level args differ from intent-level params
            security_token = GLOBAL_SIGNER.generate_token(
                action=action_name,
                params={},
                user_email=email,
            )

        # Drain incoming client messages during execution so the receive
        # buffer stays empty. When the buffer fills (keep-alive pings,
        # residual audio frames), some browsers close the WebSocket.
        _drain_stop = asyncio.Event()

        _interrupt_requested = False

        async def _drain_client() -> None:
            nonlocal _interrupt_requested
            while not _drain_stop.is_set():
                try:
                    raw = await asyncio.wait_for(websocket.receive(), timeout=1.0)
                    if raw.get("type") == "websocket.disconnect":
                        _drain_stop.set()
                        break
                    # Handle interrupt signal from frontend (user spoke while TTS playing)
                    t = raw.get("text")
                    if t:
                        try:
                            ctrl = json.loads(t)
                            if ctrl.get("type") == "interrupt":
                                _interrupt_requested = True
                                logger.info("Voice WS: interrupt signal received from client")
                        except Exception:
                            pass
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break

        _drain_task = asyncio.ensure_future(_drain_client())
        try:
            logger.info(f"Voice WS: executing intent with agent")
            await _execute_and_stream(
                intent, email, websocket,
                security_token=security_token,
                sarvam_key=sarvam_key,
            )
            logger.info(f"Voice WS: execution complete")
        finally:
            _drain_stop.set()
            _drain_task.cancel()
            try:
                await asyncio.wait_for(_drain_task, timeout=0.5)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass

    except websockets.exceptions.InvalidStatus as e:
        global _sarvam_auth_error_logged
        status_code = getattr(e.response, "status_code", "?")
        msg = (
            "Invalid Sarvam API key - check SARVAM_API_KEY."
            if status_code == 401
            else f"Sarvam connection failed (HTTP {status_code})."
        )
        if not _sarvam_auth_error_logged:
            logger.warning(f"Sarvam WS connect failed (HTTP {status_code}) - suppressing further repeats.")
            _sarvam_auth_error_logged = True
        else:
            logger.debug(f"Sarvam WS connect failed: {e}")
        try:
            await websocket.send_json({"type": "error", "message": msg})
        except Exception as send_err:
            logger.error(f"Failed to send Sarvam error to client: {send_err}")

    except WebSocketDisconnect as e:
        logger.info(f"Voice WS: client disconnected for {email}: {e}")
        
    except Exception as e:
        import traceback
        logger.error(
            f"Voice WS unexpected error for {email}: {type(e).__name__}: {str(e)[:300]}\n"
            f"Traceback:\n{traceback.format_exc()}"
        )
        try:
            await websocket.send_json({"type": "error", "message": f"Unexpected error: {type(e).__name__}"})
        except Exception as send_err:
            logger.error(f"Failed to send error message to client: {send_err}")

    finally:
        if sarvam_ws is not None:
            try:
                await sarvam_ws.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


# ── Health check ─────────────────────────────────────────────────────────────

@router.get("/health")
async def voice_health():
    """Return whether Sarvam STT/TTS is configured and reachable."""
    available = bool(os.getenv("SARVAM_API_KEY", "").strip())
    return {"sarvam_available": available}


# ── Pending result polling ────────────────────────────────────────────────────

@router.get("/pending-result")
async def get_pending_result(user: User = Depends(get_current_user)):
    """
    HTTP fallback: return any result saved when the WebSocket closed during
    execution. Consumed once - subsequent calls return null until a new result
    is saved.  Frontend polls this when WS closes mid-execution.
    """
    email = user.email
    entry = _pending_voice_results.get(email)
    if entry and time.time() < entry["expires_at"]:
        del _pending_voice_results[email]
        return {"result": entry["result"], "tools_used": entry["tools_used"]}
    return {"result": None, "tools_used": []}


# ── TTS REST endpoint ─────────────────────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str


@router.post("/tts")
async def text_to_speech(request: TTSRequest, user: User = Depends(get_current_user)):
    """
    Convert text to speech using Sarvam Bulbul v3.
    Returns { "audio_b64": "<base64 WAV>" }.
    """
    email = user.email
    sarvam_key = os.getenv("SARVAM_API_KEY", "").strip()
    if not sarvam_key:
        raise HTTPException(status_code=400, detail="SARVAM_API_KEY not configured")

    if not sarvam_limiter.can_call(email):
        raise HTTPException(status_code=429, detail="Rate limit reached. Please wait.")

    text = request.text.strip()[:500]  # cap at 500 chars for TTS
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                _SARVAM_TTS_URL,
                headers={
                    "api-subscription-key": sarvam_key,
                    "Content-Type": "application/json",
                },
                json={
                    "inputs": [text],
                    "target_language_code": "en-IN",
                    "speaker": "shubh",           # professional male voice
                    "model": "bulbul:v3",
                    "enable_preprocessing": True,
                },
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.warning(f"Sarvam TTS error: {e.response.status_code}")
            raise HTTPException(status_code=502, detail="TTS service error")
        except Exception as e:
            logger.error(f"TTS request failed: {e}")
            raise HTTPException(status_code=502, detail="TTS unavailable")

    data = resp.json()
    audios = data.get("audios", [])
    if not audios:
        raise HTTPException(status_code=502, detail="TTS returned no audio")

    sarvam_limiter.record(email)
    return {"audio_b64": audios[0]}
