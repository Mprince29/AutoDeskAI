'use client';

/**
 * VoiceMic - Voice control button + Ghost Draft confirmation UI.
 *
 * Visual states:
 *  idle        → mic icon, subtle hover ring
 *  listening   → pulsing red ring, "Listening..." label below
 *  speaking    → animated waveform bars
 *  processing  → spinner + transcript text
 *  ghost_draft → centered confirmation modal with preview
 *  executing   → tool event stream (live agent events)
 *  done        → sky blue check + result text
 *  error       → red icon + error message
 *
 * Click UX:
 *  • Idle: click → start listening
 *  • Any active state: click → cancel/stop
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AudioLines, CheckCircle, Loader2, Repeat, X, Zap } from 'lucide-react';
import { useVoiceCapture, type GhostDraft, type VoiceStatus } from '@/hooks/useVoiceCapture';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface VoiceMicProps {
  userEmail: string;
}

// ── Waveform animation ────────────────────────────────────────────────────────

function WaveformBars() {
  return (
    <div className="flex items-center gap-[3px]">
      {[0.6, 1.0, 0.7, 0.9, 0.5].map((h, i) => (
        <div
          key={i}
          className="w-[3px] bg-red-500 rounded-full animate-pulse"
          style={{
            height: `${10 + h * 12}px`,
            animationDelay: `${i * 120}ms`,
            animationDuration: '600ms',
          }}
        />
      ))}
    </div>
  );
}

// ── Web Speech vocal confirmation ──────────────────────────────────────────────

// Minimal inline types for the Web Speech API (not in default TS lib)
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const YES_WORDS = new Set(['yes', 'yeah', 'yep', 'confirm', 'send', 'send it', 'do it', 'ok', 'okay', 'go', 'proceed']);
const NO_WORDS = new Set(['no', 'nope', 'cancel', 'stop', 'abort', 'nevermind', 'never mind', "don't"]);

function useVocalConfirm(onConfirm: () => void, onCancel: () => void) {
  const srRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;

    const sr = new Ctor();
    sr.continuous = false;
    sr.interimResults = false;
    sr.lang = 'en-US';
    srRef.current = sr;

    sr.onresult = (ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => {
      const said = ev.results[0]?.[0]?.transcript?.toLowerCase().trim() ?? '';
      if (YES_WORDS.has(said)) onConfirm();
      else if (NO_WORDS.has(said)) onCancel();
      // unrecognised → ignore; user can still tap buttons
    };

    sr.onerror = () => { /* non-fatal */ };

    try { sr.start(); } catch { /* browser may deny */ }

    return () => {
      try { sr.abort(); } catch { /* ignore */ }
    };
  }, [onConfirm, onCancel]);
}

// ── Ghost Draft modal ─────────────────────────────────────────────────────────

function GhostDraftModal({
  draft,
  onConfirm,
  onCancel,
}: {
  draft: GhostDraft;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useVocalConfirm(onConfirm, onCancel);

  const preview = draft.preview;
  // Separate body from metadata
  const hasBody = !!preview.body;
  const previewEntries = Object.entries(preview).filter(
    ([k]) => !['action', 'description', 'body'].includes(k)
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl max-w-2xl w-full shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] animate-scale-in flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-foreground text-base">Confirm Action</h2>
              <p className="text-[11px] text-muted">Say &ldquo;confirm&rdquo; or &ldquo;cancel&rdquo; &mdash; or tap below</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-background text-muted hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Transcript Section */}
          <div className="bg-background/40 rounded-xl border border-border/40 p-4">
            <p className="text-[10px] text-muted uppercase tracking-wider font-bold mb-1.5 opacity-60">You said</p>
            <p className="text-sm text-foreground/90 italic leading-relaxed">&ldquo;{draft.transcript}&rdquo;</p>
          </div>

          {/* Action Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded-full uppercase tracking-tight italic">
                {preview.action}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {previewEntries.map(([k, v]) => (
                <div key={k} className="p-3 bg-background/30 rounded-lg border border-border/30">
                  <span className="block text-[10px] font-bold text-muted uppercase tracking-widest mb-1 opacity-50">{k}</span>
                  <span className="text-sm text-foreground/80 font-medium break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Email Body / Main Content */}
          {hasBody && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted uppercase tracking-wider font-bold opacity-60">Draft Content</p>
              <div className="p-5 bg-background rounded-xl border border-border/60 shadow-inner font-serif text-[15px] leading-relaxed text-foreground/90 whitespace-pre-wrap min-h-[100px] border-l-4 border-l-primary/30">
                {preview.body}
              </div>
            </div>
          )}

          {preview.description && (
            <div className="bg-muted/10 p-4 rounded-xl border border-border/40">
              <p className="text-xs text-muted/80 leading-relaxed italic text-center">
                {preview.description}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-border/50 bg-background/20 shrink-0 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-bold transition-all shadow-[0_8px_24px_-8px_rgba(var(--primary),0.6)] hover:-translate-y-0.5"
          >
            <CheckCircle className="w-5 h-5" />
            Confirm Execution
          </button>
          <button
            onClick={onCancel}
            className="sm:w-1/3 py-3.5 bg-background border border-border hover:bg-surface text-foreground rounded-xl text-sm font-semibold transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Status label helper ────────────────────────────────────────────────────────

function getStatusLabel(status: VoiceStatus, transcript: string): string {
  switch (status) {
    case 'listening':
      return transcript
        ? `"${transcript.slice(0, 55)}${transcript.length > 55 ? '…' : ''}" - say "that's it" to send`
        : 'Listening... say your command, then "that\'s it"';
    case 'speaking': return 'Hearing you...';
    case 'processing': return transcript ? `"${transcript}"` : 'Processing...';
    case 'executing': return 'Agent working...';
    case 'done': return 'Done!';
    case 'error': return '';
    default: return '';
  }
}

// ── Active session pill (shown near the mic button) ───────────────────────────

function SessionPill({
  status,
  transcript,
  result,
  agentEvents,
  error,
  onStop,
  continuousMode,
  turnCount,
  maxTurns,
}: {
  status: VoiceStatus;
  transcript: string;
  result: string;
  agentEvents: { type: string; tool?: string; message?: string }[];
  error: string | null;
  onStop: () => void;
  continuousMode: boolean;
  turnCount: number;
  maxTurns: number;
}) {
  if (status === 'idle' || status === 'ghost_draft') return null;

  const isError = status === 'error';
  const isDone = status === 'done';
  // type on AgentEvent holds the sub_type value (e.g. 'tool_call')
  const lastTool = agentEvents.filter((e) => e.type === 'tool_call').slice(-1)[0]?.tool;

  return (
    <div
      className={`fixed top-[72px] left-1/2 -translate-x-1/2 z-40 max-w-[90vw] w-80
        bg-surface border rounded-xl shadow-xl px-4 py-3 flex flex-col gap-2
        ${isError ? 'border-red-500/40' : isDone ? 'border-sky-400/40' : 'border-primary/30'}
        transition-all duration-300`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {status === 'listening' && (
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          )}
          {status === 'speaking' && <WaveformBars />}
          {(status === 'processing' || status === 'executing') && (
            <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
          )}
          {isDone && <CheckCircle className="w-4 h-4 text-sky-400 shrink-0" />}
          {isError && <AudioLines className="w-4 h-4 text-red-500 shrink-0" />}

          <span
            className={`text-xs font-medium truncate ${isError ? 'text-red-400' : isDone ? 'text-sky-400' : 'text-foreground'
              }`}
          >
            {isError
              ? (error || 'Something went wrong')
              : isDone
                ? (result?.slice(0, 120) || 'Done!')
                : getStatusLabel(status, transcript)}
          </span>
        </div>

        {!isDone && !isError && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onStop}
                className="shrink-0 p-1 rounded-md text-muted hover:text-foreground hover:bg-background transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Continuous mode indicator */}
      {continuousMode && !isError && !isDone && (
        <p className="text-[10px] text-emerald-400/70 border-t border-border/40 pt-1.5 flex items-center gap-1">
          <Repeat className="w-2.5 h-2.5" />
          Continuous · Turn {turnCount}/{maxTurns} · say &ldquo;stop listening&rdquo; to exit
        </p>
      )}

      {/* Live tool events during execution */}
      {status === 'executing' && lastTool && (
        <p className="text-[10px] text-muted border-t border-border/40 pt-1.5">
          Using: {lastTool.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VoiceMic({ userEmail }: VoiceMicProps) {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const {
    status,
    transcript,
    ghostDraft,
    result,
    toolsUsed: _toolsUsed,
    agentEvents,
    error,
    sarvamAvailable,
    continuousMode,
    setContinuousMode,
    startListening,
    stopListening,
    confirm,
    cancel,
  } = useVoiceCapture(userEmail, (page) => router.push(page));

  // Track turn count for the session pill display
  const [turnCount, setTurnCount] = useState(0);
  const MAX_TURNS = 10;

  const isActive = status !== 'idle';

  const handleClick = () => {
    if (!sarvamAvailable) return;
    if (status === 'idle') {
      if (continuousMode) setTurnCount(0); // reset counter on new session
      startListening();
    } else if (status !== 'ghost_draft') {
      setContinuousMode(false); // manual stop always exits continuous mode
      stopListening();
    }
  };

  return (
    <TooltipProvider>
      <>
        {/* ── Mic button (in header) ────────────────────────────────────────── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleClick}
              disabled={!sarvamAvailable}
              className={`
                relative p-2 rounded-md transition-all flex items-center gap-1.5 duration-200
                ${!sarvamAvailable
                  ? 'text-muted/40 cursor-not-allowed'
                  : status === 'error'
                    ? 'text-red-500 bg-red-500/10'
                    : status === 'done'
                      ? 'text-sky-400 bg-sky-400/10'
                      : isActive
                        ? 'text-red-500 bg-red-500/10'
                        : 'text-muted hover:text-foreground hover:bg-surface'
                }`}
            >
              {/* Animated ring when listening/speaking */}
              {(status === 'listening' || status === 'speaking') && (
                <span className="absolute inset-0 rounded-md border-2 border-red-500/60 animate-ping" />
              )}

              <AudioLines className="w-4 h-4" />
              {status === 'listening' || status === 'speaking' ? <span className='text-red-500'>Stop</span> : null}
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-white">
            {!sarvamAvailable
              ? 'Voice commands unavailable - SARVAM_API_KEY not configured'
              : isActive
                ? 'Stop voice command'
                : 'Start voice command (click & speak)'}
          </TooltipContent>
        </Tooltip>

        {/* ── Session status pill (Portaled to Body) ────────────────────────── */}
        {isMounted &&
          createPortal(
            <SessionPill
              status={status}
              transcript={transcript}
              result={result}
              agentEvents={agentEvents}
              error={error}
              onStop={stopListening}
              continuousMode={continuousMode}
              turnCount={turnCount}
              maxTurns={MAX_TURNS}
            />,
            document.body
          )
        }

        {/* ── Ghost Draft confirmation modal (Portaled to Body) ───────────────── */}
        {isMounted && status === 'ghost_draft' && ghostDraft &&
          createPortal(
            <GhostDraftModal draft={ghostDraft} onConfirm={confirm} onCancel={cancel} />,
            document.body
          )
        }
      </>
    </TooltipProvider>
  );
}
