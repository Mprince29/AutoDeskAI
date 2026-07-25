"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;
const MAX_LABEL = 80;
const MAX_VALUE = 120;
const FLUSH_INTERVAL_MS = 30_000; // send batched logs every 30 s — reduce HTTP noise
const MAX_QUEUE = 20;             // never buffer more than 20 events

type Details = Record<string, string | number | boolean | null | undefined | string[]>;

// ── Module-level batch queue (shared across all hook instances) ───────────────
interface LogEntry {
  level: string;
  action: string;
  message: string;
  url: string;
  email?: string;
  details: Record<string, unknown>;
}
let _queue: LogEntry[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionStartFired = false; // deduplicate session_start across StrictMode double-invoke

function _scheduleFlush() {
  if (_flushTimer !== null) return;
  _flushTimer = setTimeout(_flush, FLUSH_INTERVAL_MS);
}

function _flush(useBeacon = false) {
  if (_flushTimer !== null) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_queue.length === 0) return;
  const batch = _queue.splice(0, _queue.length);
  const body = JSON.stringify({ events: batch });
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(`${API_BASE_URL}/api/logs/client`, new Blob([body], { type: "application/json" }));
    return;
  }
  fetch(`${API_BASE_URL}/api/logs/client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSessionId(): string {
  let id = sessionStorage.getItem("mc_activity_session");
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("mc_activity_session", id);
  }
  return id;
}

function compactText(value: string | null | undefined, max = MAX_LABEL): string | undefined {
  const cleaned = (value || "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function elementLabel(el: Element): string | undefined {
  const aria = compactText(el.getAttribute("aria-label"));
  if (aria) return aria;
  const title = compactText(el.getAttribute("title"));
  if (title) return title;
  const text = compactText(el.textContent);
  if (text) return text;
  if (el instanceof HTMLInputElement) {
    return compactText(el.value || el.placeholder || el.name);
  }
  return undefined;
}

function safePath(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, window.location.origin);
    return `${url.pathname}${url.search ? "?..." : ""}`;
  } catch {
    return href.slice(0, MAX_VALUE);
  }
}

function getCurrentEmail(fallback?: string): string | undefined {
  if (fallback) return fallback;
  try {
    const raw = localStorage.getItem("user_info");
    return raw ? JSON.parse(raw)?.email : undefined;
  } catch {
    return undefined;
  }
}

// ── Public API (unchanged signature for callers) ──────────────────────────────
export function logClientActivity(
  action: string,
  details: Details = {},
  email?: string,
  message = action,
  useBeacon = false
) {
  if (typeof window === "undefined") return;

  const entry: LogEntry = {
    level: "INFO",
    action,
    message,
    url: window.location.pathname,
    email: getCurrentEmail(email),
    details: { sid: getSessionId(), ts: Date.now(), ...details },
  };

  // Beacon events (page_hidden / session_end) flush immediately — they can't wait.
  if (useBeacon) {
    _queue.push(entry);
    _flush(true);
    return;
  }

  if (_queue.length < MAX_QUEUE) _queue.push(entry);
  _scheduleFlush();
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ActivityTelemetry() {
  const pathname = usePathname();
  const { user } = useAuth();
  const lastEventRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const lastPathRef = useRef<string>("");

  const log = (action: string, details: Details = {}, message = action, beacon = false) => {
    logClientActivity(action, details, user?.email, message, beacon);
  };

  useEffect(() => {
    if (!pathname || lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    log("page_view", { path: pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, user?.email]);

  useEffect(() => {
    if (!_sessionStartFired) {
      _sessionStartFired = true;
      log("session_start", { path: window.location.pathname });
    }

    const shouldSkip = (key: string) => {
      const now = Date.now();
      const last = lastEventRef.current;
      if (last.key === key && now - last.at < 700) return true;
      lastEventRef.current = { key, at: now };
      return false;
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const el = target?.closest("button,a,[role='button'],input[type='button'],input[type='submit'],[data-activity]");
      if (!el) return;
      const label = elementLabel(el);
      const key = `click:${window.location.pathname}:${label || el.tagName}`;
      if (shouldSkip(key)) return;
      log("ui_click", {
        tag: el.tagName.toLowerCase(),
        label,
        target: safePath(el.getAttribute("href")),
        id: compactText(el.id, 40),
      });
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      log("form_submit", {
        form: compactText(form?.getAttribute("name") || form?.id, 60),
        action_path: safePath(form?.getAttribute("action") || null),
        method: (form?.method || "get").toLowerCase(),
      });
    };

    const onChange = (event: Event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input || input.type !== "file" || !input.files) return;
      const files = Array.from(input.files);
      log("file_selected", {
        count: files.length,
        names: files.map((f) => f.name.slice(0, 60)).slice(0, 5),
        bytes: files.reduce((sum, f) => sum + f.size, 0),
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const el = event.target;
      if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return;
      if (el instanceof HTMLInputElement && !["text", "search"].includes(el.type)) return;
      const value = el.value || "";
      if (!value.trim()) return;
      const label = compactText(el.getAttribute("aria-label") || el.name || el.placeholder, 60);
      log("prompt_enter", {
        field: label,
        chars: value.length,
        words: value.trim().split(/\s+/).filter(Boolean).length,
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        log("page_hidden", { path: window.location.pathname }, "page_hidden", true);
      }
    };

    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);
    window.addEventListener("change", onChange, true);
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("change", onChange, true);
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      log("session_end", { path: window.location.pathname }, "session_end", true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  return null;
}
