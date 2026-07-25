/**
 * Friendly error messaging - maps raw API/network errors to simple human language.
 * Import `toastError` and use it everywhere instead of toast.error() directly.
 */

import { toast } from "sonner";

interface FriendlyError {
  title: string;
  description?: string;
  action?: string;
}

function normalizeRawMessage(raw: string): string {
  return raw.replace(/^error:\s*/i, "").trim();
}

const PATTERNS: Array<[RegExp | string, FriendlyError]> = [
  // API key / auth issues
  [/api.?key|authentication|invalid.?key|no.?key|key.?not.?found/i, {
    title: "API key not set up",
    description: "Head to Settings → AI Provider to add your key.",
    action: "/settings",
  }],
  [/401|unauthorized|session.?expir|not.?authenticated/i, {
    title: "Session expired",
    description: "Please sign in again to continue.",
  }],
  [/403|forbidden|not.?authorized|permission/i, {
    title: "Access denied",
    description: "You don't have permission to do that.",
  }],

  // Rate limits
  [/429|rate.?limit|too.?many.?request/i, {
    title: "Slow down a bit",
    description: "You've hit the rate limit. Wait a moment and try again.",
  }],

  // Network / connectivity
  [/network|failed.?to.?fetch|econnrefused|timeout|ERR_CONNECTION/i, {
    title: "Can't reach the server",
    description: "Check your internet connection and try again.",
  }],

  // Server errors
  [/500|server.?error|internal.?error/i, {
    title: "Something went wrong on our end",
    description: "Our server had a hiccup. Try again in a moment.",
  }],

  // Not found
  [/404|not.?found/i, {
    title: "Not found",
    description: "That item may have been deleted or moved.",
  }],

  // Validation
  [/422|unprocessable|validation|invalid.?input|required.?field/i, {
    title: "Check your input",
    description: "Something looks off. Please review and try again.",
  }],

  // AI / pipeline
  [/pipeline.?fail|model.?fail|openai|gemini|litellm/i, {
    title: "AI ran into a problem",
    description: "The AI pipeline hit an issue. Try again or check your API key in Settings.",
  }],

  // File / upload
  [/file.?too.?large|unsupported.?file|file.?type/i, {
    title: "File problem",
    description: "Make sure your file is a supported type and under the size limit.",
  }],

  // Email / calendar tool errors
  [/gmail|calendar|google|microsoft|oauth|token.?expir/i, {
    title: "Account connection issue",
    description: "Your Google or Microsoft connection may need a refresh. Go to Settings → Integrations.",
  }],

  // DB / save errors
  [/database|db.?error|failed.?to.?save|commit/i, {
    title: "Couldn't save",
    description: "There was a problem saving your data. Try again.",
  }],
];

const CONTEXT_PREFIXES: Record<string, string> = {
  send_email: "Couldn't send your email.",
  load_emails: "Couldn't load emails.",
  agent_chat: "The assistant ran into a problem.",
  load_agents: "Couldn't load agents.",
  delete_agent: "Couldn't delete the agent.",
  create_agent: "Couldn't create the agent.",
  load_contacts: "Couldn't load contacts.",
  create_event: "Couldn't create the calendar event.",
  load_events: "Couldn't load calendar events.",
  generate_content: "The content writer ran into a problem.",
  generate_image: "Couldn't generate the cover image.",
  generate_social: "Couldn't generate the social kit.",
  upload_file: "File upload failed.",
  delete_report: "Couldn't delete the report.",
  save: "Couldn't save your changes.",
  load: "Couldn't load the data.",
};

export function getFriendlyError(err: unknown, context?: string): FriendlyError {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unexpected error";
  const normalizedRaw = normalizeRawMessage(raw);

  for (const [pattern, friendly] of PATTERNS) {
    if (typeof pattern === "string" ? normalizedRaw.includes(pattern) : pattern.test(normalizedRaw)) {
      if (context && CONTEXT_PREFIXES[context]) {
        return { ...friendly, title: CONTEXT_PREFIXES[context], description: friendly.title + (friendly.description ? `. ${friendly.description}` : "") };
      }
      return friendly;
    }
  }

  // Context-only match (no pattern match)
  if (context && CONTEXT_PREFIXES[context]) {
    return {
      title: CONTEXT_PREFIXES[context],
      description:
        normalizedRaw && normalizedRaw !== "Unexpected error"
          ? normalizedRaw
          : "Please try again. If the problem continues, check Settings.",
    };
  }

  return {
    title: "Something went wrong",
    description: "Please try again. If it keeps happening, contact support.",
  };
}

export function getFriendlyErrorText(err: unknown, context?: string): string {
  const { title, description } = getFriendlyError(err, context);
  return description ? `⚠️ ${title}. ${description}` : `⚠️ ${title}`;
}

/**
 * Show a friendly error toast.
 * @param err   - The raw error (Error, string, or unknown)
 * @param context - Optional key from CONTEXT_PREFIXES for extra context
 */
export function toastError(err: unknown, context?: string): void {
  const { title, description } = getFriendlyError(err, context);
  toast.error(title, {
    description,
    duration: 5000,
  });
}

/**
 * Show a friendly success toast (consistent style companion).
 */
export function toastSuccess(title: string, description?: string): void {
  toast.success(title, { description, duration: 3000 });
}

/**
 * Show a friendly info / warning toast.
 */
export function toastInfo(title: string, description?: string): void {
  toast.info(title, { description, duration: 4000 });
}
