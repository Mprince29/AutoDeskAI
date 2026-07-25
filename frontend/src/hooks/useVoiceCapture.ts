'use client';

/**
 * useVoiceCapture - manages the full voice pipeline:
 *
 *  1. Mic access + AudioWorklet (raw Int16 PCM at 16 kHz)
 *  2. WebSocket to backend /api/voice/ws
 *  3. State machine: idle → listening → speaking → processing → ghost_draft → executing → done
 *  4. Navigation callback (Tier 1 intents)
 *  5. TTS playback after action completion
 *
 * Click-to-speak UX:
 *  • Single click starts capture
 *  • Sarvam VAD (built-in) detects silence → triggers speech_end automatically
 *  • 30-second hard timeout as a safety net
 *  • No hold-to-speak required
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// Module-level cache so repeated hook mounts (React StrictMode double-invoke,
// multiple components) never fire more than one health request per 5 minutes.
let _voiceHealthCache: { value: boolean; ts: number } | null = null;
let _voiceHealthInflight: Promise<boolean> | null = null;
const VOICE_HEALTH_TTL_MS = 5 * 60 * 1000;

async function fetchVoiceHealth(): Promise<boolean> {
  const now = Date.now();
  if (_voiceHealthCache && (now - _voiceHealthCache.ts) < VOICE_HEALTH_TTL_MS) {
    return _voiceHealthCache.value;
  }
  if (_voiceHealthInflight) return _voiceHealthInflight;
  _voiceHealthInflight = fetch(`${API_BASE}/api/voice/health`)
    .then((r) => r.json())
    .then((d) => {
      const val = Boolean(d.sarvam_available);
      _voiceHealthCache = { value: val, ts: Date.now() };
      return val;
    })
    .catch(() => {
      _voiceHealthCache = { value: false, ts: Date.now() };
      return false;
    })
    .finally(() => { _voiceHealthInflight = null; });
  return _voiceHealthInflight;
}

const WS_BASE = API_BASE.replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws'));

// ── Types ─────────────────────────────────────────────────────────────────────

export type VoiceStatus =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'processing'
  | 'ghost_draft'
  | 'executing'
  | 'done'
  | 'error';

export interface GhostDraft {
  intent_type: string;
  transcript: string;
  preview: Record<string, string>;
}

export interface AgentEvent {
  type: string;
  tool?: string;
  message?: string;
}

export interface VoiceCaptureState {
  status: VoiceStatus;
  transcript: string;
  ghostDraft: GhostDraft | null;
  result: string;
  toolsUsed: string[];
  agentEvents: AgentEvent[];
  error: string | null;
  sarvamAvailable: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceCapture(
  userEmail: string,
  onNavigate?: (page: string) => void
) {
  const [state, setState] = useState<VoiceCaptureState>({
    status: 'idle',
    transcript: '',
    ghostDraft: null,
    result: '',
    toolsUsed: [],
    agentEvents: [],
    error: null,
    sarvamAvailable: true, // optimistic; corrected by health check on mount
  });

  // Internal refs - stable across re-renders
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const workletLoadedRef = useRef(false);           // track addModule() across sessions
  const streamRef = useRef<MediaStream | null>(null);
  const hardTimeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<VoiceStatus>('idle');
  // Stable ref for the WS message handler - avoids stale-closure bug
  const handleWsMessageRef = useRef<(raw: string) => void>(() => { });

  // ── Continuous mode ───────────────────────────────────────────────────────
  const [continuousMode, setContinuousModeState] = useState(true);
  const continuousModeRef = useRef(true);
  const consecutiveTurnsRef = useRef(0);
  const MAX_CONTINUOUS_TURNS = 10;

  const setContinuousMode = (value: boolean | ((prev: boolean) => boolean)) => {
    setContinuousModeState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      continuousModeRef.current = next;
      if (!next) consecutiveTurnsRef.current = 0; // reset counter on disable
      return next;
    });
  };

  // ── Audio queue (for streaming TTS chunks from backend) ───────────────────
  const audioQueueRef = useRef<string[]>([]);        // ordered base64 WAV chunks
  const isPlayingAudioRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // drainAudioQueue plays chunks in order; calls onAllDone when the queue empties.
  const drainAudioQueue = useCallback((onAllDone?: () => void) => {
    if (isPlayingAudioRef.current || audioQueueRef.current.length === 0) {
      if (audioQueueRef.current.length === 0) onAllDone?.();
      return;
    }
    const b64 = audioQueueRef.current.shift()!;
    const audio = new Audio(`data:audio/wav;base64,${b64}`);
    currentAudioRef.current = audio;
    isPlayingAudioRef.current = true;
    audio.onended = () => {
      isPlayingAudioRef.current = false;
      currentAudioRef.current = null;
      if (audioQueueRef.current.length > 0) {
        drainAudioQueue(onAllDone);
      } else {
        onAllDone?.();
      }
    };
    audio.onerror = () => {
      isPlayingAudioRef.current = false;
      currentAudioRef.current = null;
      if (audioQueueRef.current.length > 0) {
        drainAudioQueue(onAllDone);
      } else {
        onAllDone?.();
      }
    };
    audio.play().catch(() => {
      isPlayingAudioRef.current = false;
      currentAudioRef.current = null;
      onAllDone?.();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interrupt: stop current audio playback and discard queued chunks.
  const interruptAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;
  }, []);

  const set = useCallback((patch: Partial<VoiceCaptureState>) => {
    setState((prev) => ({ ...prev, ...patch }));
    if (patch.status !== undefined) statusRef.current = patch.status;
  }, []);

  // ── Health check + unmount cleanup ────────────────────────────────────────

  useEffect(() => {
    fetchVoiceHealth().then((available) => set({ sarvamAvailable: available }));

    return () => {
      // Close WS and release audio resources when component unmounts
      wsRef.current?.close();
      workletRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => { });
      if (hardTimeRef.current) clearTimeout(hardTimeRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once on mount, cleanup on unmount

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const stopCapture = useCallback(() => {
    console.log(`[Voice] stopCapture called, current status: ${statusRef.current}`);

    if (hardTimeRef.current) {
      clearTimeout(hardTimeRef.current);
      hardTimeRef.current = null;
    }

    // Stop AudioWorklet and mic stream
    if (workletRef.current) {
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Close AudioContext (but reuse is fine - suspend instead of close)
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.suspend().catch(() => { });
    }

    console.log(`[Voice] stopCapture completed`);
  }, []);

  // ── TTS playback ───────────────────────────────────────────────────────────

  const playTTS = useCallback(async (text: string, awaitCompletion = false) => {
    if (!text) return;
    try {
      const resp = await fetch(
        `${API_BASE}/api/voice/tts?email=${encodeURIComponent(userEmail)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 300) }),
        }
      );
      if (!resp.ok) return;
      const { audio_b64 } = await resp.json();
      if (!audio_b64) return;
      const audio = new Audio(`data:audio/wav;base64,${audio_b64}`);
      if (awaitCompletion) {
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
      } else {
        await audio.play();
      }
    } catch {
      // TTS is best-effort - never crash on failure
    }
  }, [userEmail]);

  // ── WebSocket event handler ────────────────────────────────────────────────

  const handleWsMessage = useCallback(
    (raw: string) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw);
      } catch {
        console.warn(`[Voice] Failed to parse WS message as JSON: ${raw.substring(0, 100)}`);
        return;
      }

      const type = event.type as string;
      console.log(`[Voice] handleWsMessage: type="${type}", status=${statusRef.current}`);

      try {
        switch (type) {
          case 'ready':
            // Backend is connected to Sarvam - audio already streaming
            console.log('[Voice] Received ready message');
            set({ status: 'listening' });
            break;

          case 'speech_start':
            console.log('[Voice] Received speech_start');
            // If TTS is currently playing, user interrupted → stop audio and notify backend
            if (isPlayingAudioRef.current) {
              console.log('[Voice] speech_start while TTS playing → interrupt');
              interruptAudio();
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
              }
            }
            set({ status: 'speaking' });
            break;

          case 'transcript':
            console.log(`[Voice] Received transcript: ${event.text}`);
            set({ transcript: event.text as string });
            break;

          case 'speech_end':
            // VAD pause - keep mic running so user can say the end phrase
            // Just show the hint in the UI; don't stop capture or transition to processing
            console.log('[Voice] Received speech_end');
            set({ status: 'listening' });
            break;

          case 'processing':
            console.log(`[Voice] Received processing, stopping capture`);
            // End phrase detected (or fallback gap) - NOW stop the mic and process
            stopCapture();
            set({ status: 'processing', transcript: event.transcript as string });
            break;

          case 'navigate':
            console.log(`[Voice] Received navigate to ${event.page}`);
            stopCapture();
            set({ status: 'idle', transcript: '', ghostDraft: null, error: null });
            onNavigate?.(event.page as string);
            break;

          case 'audio_chunk': {
            const chunkB64 = event.data as string;
            if (chunkB64) {
              audioQueueRef.current.push(chunkB64);
              // Start draining; when all chunks are played, trigger auto-restart if continuous
              drainAudioQueue(() => {
                if (continuousModeRef.current && statusRef.current === 'done') {
                  consecutiveTurnsRef.current += 1;
                  if (consecutiveTurnsRef.current >= MAX_CONTINUOUS_TURNS) {
                    console.log('[Voice] Max continuous turns reached, disabling continuous mode');
                    setContinuousMode(false);
                    return;
                  }
                  console.log(`[Voice] Continuous mode: auto-restart (turn ${consecutiveTurnsRef.current})`);
                  setTimeout(() => {
                    if (continuousModeRef.current) {
                      startListening();
                    }
                  }, 350);
                }
              });
            }
            break;
          }

          case 'exit_continuous':
            console.log('[Voice] Received exit_continuous');
            setContinuousMode(false);
            interruptAudio();
            set({ status: 'idle', transcript: '', ghostDraft: null, error: null });
            break;

          case 'ghost_draft':
            console.log(`[Voice] Received ghost_draft for ${event.intent_type}`);
            set({
              status: 'ghost_draft',
              ghostDraft: {
                intent_type: event.intent_type as string,
                transcript: event.transcript as string,
                preview: event.preview as Record<string, string>,
              },
            });
            break;

          case 'executing': {
            const execTranscript = event.transcript as string || '';
            console.log(`[Voice] Received executing message`);
            set({ status: 'executing', agentEvents: [] });
            window.dispatchEvent(new CustomEvent('voice:executing', { detail: { transcript: execTranscript } }));
            break;
          }

          case 'agent_event': {
            const agentEvt = {
              type: event.sub_type as string,
              tool: event.tool as string | undefined,
              message: event.label as string | undefined,
            };
            console.log(`[Voice] Received agent_event: type=${agentEvt.type}, tool=${agentEvt.tool}`);
            setState((prev) => {
              console.log(`[Voice] Adding agent event to state (now ${prev.agentEvents.length + 1} events)`);
              return {
                ...prev,
                agentEvents: [...prev.agentEvents, agentEvt],
              };
            });
            window.dispatchEvent(new CustomEvent('voice:step', { detail: agentEvt }));
            break;
          }

          case 'done': {
            const resultText = event.result as string;
            const tools = (event.tools_used as string[]) || [];
            console.log(`[Voice] Received done message with result length=${resultText.length}`);
            set({ status: 'done', result: resultText, toolsUsed: tools });
            window.dispatchEvent(new CustomEvent('voice:done', { detail: { result: resultText, toolsUsed: tools } }));
            // If no audio chunks were streamed (e.g. short result or TTS unavailable),
            // fall back to REST TTS for the first sentence only.
            if (audioQueueRef.current.length === 0 && !isPlayingAudioRef.current && resultText) {
              const clean = resultText
                .replace(/https?:\/\/\S+/g, 'here is your link')
                .replace(/\*\*/g, '')
                .split('\n')[0];
              const firstSentence = clean.match(/^.{10,}?[.!?]/)?.[0] ?? clean.slice(0, 120);
              playTTS(firstSentence.trim()).then(() => {
                // After fallback TTS, trigger continuous restart
                if (continuousModeRef.current && statusRef.current === 'done') {
                  consecutiveTurnsRef.current += 1;
                  if (consecutiveTurnsRef.current < MAX_CONTINUOUS_TURNS) {
                    setTimeout(() => {
                      if (continuousModeRef.current) startListening();
                    }, 350);
                  } else {
                    setContinuousMode(false);
                  }
                }
              });
            }
            // Auto-reset after 8 seconds
            setTimeout(() => {
              if (statusRef.current === 'done') {
                set({ status: 'idle', transcript: '', result: '', toolsUsed: [], ghostDraft: null });
              }
            }, 8000);
            break;
          }

          case 'cancelled':
            set({ status: 'idle', ghostDraft: null });
            break;

          case 'error':
            stopCapture();
            set({ status: 'error', error: event.message as string });
            window.dispatchEvent(new CustomEvent('voice:error', { detail: { message: event.message as string } }));
            setTimeout(() => {
              if (statusRef.current === 'error') {
                set({ status: 'idle', error: null });
              }
            }, 5000);
            break;

          default:
            console.warn(`[Voice] Unknown message type: ${type}`);
            break;
        }
      } catch (err) {
        console.error(`[Voice] Error handling message type="${type}":`, err);
        console.error(`[Voice] Error stack:`, err instanceof Error ? err.stack : 'N/A');
      }
    },
    [set, stopCapture, onNavigate, playTTS]
  );

  // Keep ref always pointing at the latest handler (avoids stale-closure in ws.onmessage)
  handleWsMessageRef.current = handleWsMessage;

  // ── HTTP result polling (fallback when WS closes during execution) ──────────

  const pollForResult = useCallback(async () => {
    let attempts = 0;
    const MAX_ATTEMPTS = 45; // 90 s at 2 s intervals - covers slow multi-step agents

    const check = async (): Promise<void> => {
      if (statusRef.current !== 'executing') return; // result arrived via WS or user cancelled

      if (attempts >= MAX_ATTEMPTS) {
        console.error('[Voice] Poll timeout - no pending result found');
        stopCapture();
        set({ status: 'error', error: 'Connection lost. Please try again.' });
        setTimeout(() => { if (statusRef.current === 'error') set({ status: 'idle', error: null }); }, 4000);
        return;
      }

      attempts++;
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
        const resp = await fetch(
          `${API_BASE}/api/voice/pending-result?email=${encodeURIComponent(userEmail)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.result !== null) {
            const resultText = data.result as string;
            const tools = (data.tools_used as string[]) || [];
            console.log(`[Voice] Polled result (len=${resultText.length})`);
            set({ status: 'done', result: resultText, toolsUsed: tools });
            window.dispatchEvent(new CustomEvent('voice:done', { detail: { result: resultText, toolsUsed: tools } }));
            if (resultText) {
              const clean = resultText
                .replace(/https?:\/\/\S+/g, 'here is your link')
                .replace(/\*\*/g, '')
                .split('\n')[0];
              const firstSentence = clean.match(/^.{10,}?[.!?]/)?.[0] ?? clean.slice(0, 120);
              playTTS(firstSentence.trim());
            }
            setTimeout(() => {
              if (statusRef.current === 'done') {
                set({ status: 'idle', transcript: '', result: '', toolsUsed: [], ghostDraft: null });
              }
            }, 8000);
            return;
          }
        }
      } catch { /* network blip - keep polling */ }

      setTimeout(check, 2000);
    };

    setTimeout(check, 2000); // first check after 2 s
  }, [userEmail, set, stopCapture, playTTS]);

  // ── Start listening ────────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'done') return;

    set({ status: 'listening', transcript: '', ghostDraft: null, result: '', error: null, agentEvents: [], toolsUsed: [] });
    console.log('[Voice] Starting listening session, status: idle → listening');

    // ── 0. Daily greeting (once per calendar day) ────────────────────────────
    const greetingKey = `voice_greeted_${new Date().toDateString()}`;
    if (!localStorage.getItem(greetingKey)) {
      const hour = new Date().getHours();
      const greeting =
        hour >= 5 && hour < 12 ? "Good morning! How may I help you today?" :
          hour >= 12 && hour < 17 ? "Good afternoon! How may I help you today?" :
            hour >= 17 && hour < 21 ? "Good evening! How may I help you today?" :
              "Hello! How may I help you today?";
      localStorage.setItem(greetingKey, '1');
      await playTTS(greeting, true); // await completion before opening mic
    }

    // ── 1. Request mic access ────────────────────────────────────────────────
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      console.log('[Voice] Microphone access granted');
    } catch {
      set({ status: 'error', error: 'Microphone access denied.' });
      console.error('[Voice] Microphone access denied');
      setTimeout(() => set({ status: 'idle', error: null }), 4000);
      return;
    }

    // ── 2. Open WebSocket to backend ─────────────────────────────────────────
    const ws = new WebSocket(
      `${WS_BASE}/api/voice/ws?email=${encodeURIComponent(userEmail)}`
    );
    wsRef.current = ws;
    console.log(`[Voice] Opening WebSocket: ${WS_BASE}/api/voice/ws?email=...`);

    ws.binaryType = 'arraybuffer';

    // Always delegate to the ref so future re-renders of the handler are reflected
    ws.onmessage = (ev) => {
      const msgType = typeof ev.data === 'string'
        ? (ev.data.length > 200 ? ev.data.substring(0, 100) + '...' : ev.data)
        : '(binary)';
      console.log(`[Voice] WS.onmessage: received data=${msgType}`);
      handleWsMessageRef.current(ev.data as string);
    };

    ws.onerror = () => {
      console.error('[Voice] WebSocket error occurred');
      stopCapture();
      set({ status: 'error', error: 'Connection to voice server failed.' });
      setTimeout(() => set({ status: 'idle', error: null }), 4000);
    };

    // Keep-alive ping every 10 s so the browser/proxy doesn't kill an idle WS
    // during long agent executions (e.g. reading emails takes 2-5 s with no traffic).
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
        console.log('[Voice] Sent keep-alive ping');
      } else {
        console.log(`[Voice] Cannot send ping: WS readyState=${ws.readyState}`);
      }
    }, 10_000);

    ws.onclose = (ev) => {
      clearInterval(pingInterval);
      const cur = statusRef.current;
      console.log(`[Voice] ws.onclose triggered: code=${ev.code}, wasClean=${ev.wasClean}, status=${cur}`);

      if (cur !== 'executing') {
        stopCapture();
      }

      // ghost_draft: WS closed while waiting for confirmation → reset so modal doesn't hang
      if (cur === 'ghost_draft') {
        set({ status: 'idle', ghostDraft: null, error: null });
        console.log('[Voice] Closed during ghost_draft, resetting to idle');
        return;
      }

      // executing: two sub-cases:
      // a) Backend sent "done" then immediately closed - browser may deliver the
      //    close frame before the buffered onmessage fires.  Give 400 ms to drain.
      // b) WS closed mid-execution (proxy kill, browser drop, etc.) - the agent
      //    keeps running server-side and saves the result for HTTP polling.
      if (cur === 'executing') {
        setTimeout(() => {
          if (statusRef.current === 'executing') {
            console.warn('[Voice] WS closed during executing - switching to HTTP result polling');
            pollForResult();
          }
          // If status is 'done', the done message arrived in the grace window - nothing to do
        }, 400);
        return;
      }

      if (cur === 'processing' || cur === 'listening' || cur === 'speaking') {
        console.error(`[Voice] Unexpected WS close during ${cur} state (code=${ev.code})`);
        set({ status: 'error', error: 'Connection lost. Please try again.' });
        setTimeout(() => { if (statusRef.current === 'error') set({ status: 'idle', error: null }); }, 4000);
        return;
      }

      // 'error' is already handled by the onmessage('error') handler - don't reset it here
      if (cur !== 'idle' && cur !== 'done' && cur !== 'error') {
        console.log(`[Voice] WS closed during ${cur}, resetting to idle`);
        set({ status: 'idle' });
      }
    };

    // Wait for WebSocket to open before starting AudioWorklet
    let connectFailed = false;
    await new Promise<void>((resolve, reject) => {
      const id = setTimeout(() => {
        console.error('[Voice] WebSocket open timeout (8s)');
        reject(new Error('WS open timeout'));
      }, 8000);
      ws.onopen = () => {
        console.log('[Voice] WebSocket opened successfully');
        clearTimeout(id);
        resolve();
      };
    }).catch(() => {
      connectFailed = true;
      stopCapture();
      set({ status: 'error', error: 'Could not connect to voice server.' });
      console.error('[Voice] WebSocket connection failed');
      setTimeout(() => set({ status: 'idle', error: null }), 4000);
    });

    if (connectFailed) return;

    // ── 3. Set up AudioContext + AudioWorklet ────────────────────────────────
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
        workletLoadedRef.current = false; // new context needs addModule again
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      // Load worklet module once per AudioContext lifetime
      if (!workletLoadedRef.current) {
        await ctx.audioWorklet.addModule('/audio-processor.worklet.js');
        workletLoadedRef.current = true;
      }

      const worklet = new AudioWorkletNode(ctx, 'pcm-processor');
      workletRef.current = worklet;

      // Each message from worklet = Int16 PCM ArrayBuffer → send as binary WS frame
      worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(ev.data);
        }
      };

      // Connect mic → worklet (output not needed - we only read input)
      const source = ctx.createMediaStreamSource(stream);
      source.connect(worklet);
      // Do NOT connect worklet to destination (would create feedback)

    } catch (audioErr) {
      stopCapture();
      const msg = audioErr instanceof Error && audioErr.name === 'NotAllowedError'
        ? 'Microphone permission denied. Please allow mic access and try again.'
        : 'Audio setup failed. Please refresh and try again.';
      set({ status: 'error', error: msg });
      setTimeout(() => set({ status: 'idle', error: null }), 5000);
      return;
    }

    // ── 4. Hard timeout: 60 seconds max session length ───────────────────────
    hardTimeRef.current = setTimeout(() => {
      const s = statusRef.current;
      if (s === 'listening' || s === 'speaking') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'force_end' }));
        }
        stopCapture();
        set({ status: 'idle' });
      }
    }, 60000);


    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, set, stopCapture, handleWsMessage, pollForResult]);

  // ── Cancel / stop ──────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    console.log(`[Voice] stopListening called, current status: ${statusRef.current}`);
    // Always disable continuous mode when user manually stops
    setContinuousMode(false);
    interruptAudio();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log(`[Voice] Sending force_end to backend`);
      wsRef.current.send(JSON.stringify({ type: 'force_end' }));
      wsRef.current.close();
    }
    stopCapture();
    set({ status: 'idle', ghostDraft: null, error: null });
    console.log(`[Voice] stopListening completed`);
  }, [stopCapture, set, interruptAudio]);

  // ── Ghost Draft: confirm ───────────────────────────────────────────────────

  const confirm = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'confirm', approved: true }));
    }
  }, []);

  // ── Ghost Draft: cancel ────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }));
    }
    set({ status: 'idle', ghostDraft: null });
  }, [set]);

  return {
    ...state,
    continuousMode,
    setContinuousMode,
    startListening,
    stopListening,
    confirm,
    cancel,
  };
}
