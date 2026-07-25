"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";

// ── Copy button for code blocks ────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all hover:bg-white/10 active:scale-95"
      style={{ color: copied ? "#34D399" : "rgba(255,255,255,0.35)" }}
      title="Copy code"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ── Streaming cursor ───────────────────────────────────────────────────────────
export function StreamingCursor() {
  return (
    <span
      className="inline-block w-[3px] h-[1em] rounded-full align-middle ml-0.5 animate-pulse"
      style={{ background: "var(--primary, #8B5CF6)", verticalAlign: "text-bottom" }}
    />
  );
}

// ── Main Renderer ──────────────────────────────────────────────────────────────
export default function MarkdownRenderer({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── Headings ──────────────────────────────────────────────────────────
          h1: ({ children }) => (
            <h1 className="text-[17px] font-bold mt-5 mb-3 tracking-tight leading-tight"
              style={{ color: "var(--foreground)" }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[15px] font-semibold mt-4 mb-2 pb-1.5 tracking-tight leading-tight border-b border-border/50"
              style={{ color: "var(--foreground)" }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[13px] font-semibold mt-3 mb-1.5 leading-tight"
              style={{ color: "var(--accent)" }}>
              {children}
            </h3>
          ),

          // ── Paragraph ─────────────────────────────────────────────────────────
          p: ({ children }) => (
            <p className="text-[13px] leading-[1.75] mb-3 last:mb-0"
              style={{ color: "var(--foreground)", opacity: 0.9 }}>
              {children}
            </p>
          ),

          // ── Lists ─────────────────────────────────────────────────────────────
          ul: ({ children }) => (
            <ul className="my-3 space-y-1.5 pl-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 space-y-1.5 pl-1 list-none counter-reset-list">
              {children}
            </ol>
          ),
          li: ({ children, ordered }: { children?: React.ReactNode; ordered?: boolean }) => {
            // Check if this is inside an ordered list
            const isOrdered = Boolean(ordered);
            return (
              <li className="flex gap-2.5 text-[13px] leading-[1.7] items-start"
                style={{ color: "var(--foreground)", opacity: 0.88 }}>
                {isOrdered ? null : (
                  <span className="shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--primary, #8B5CF6)" }} />
                )}
                <span className="flex-1">{children}</span>
              </li>
            );
          },

          // ── Inline formatting ─────────────────────────────────────────────────
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: "#2DD4BF" }}>
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic" style={{ color: "rgba(var(--foreground-rgb), 0.75)" }}>
              {children}
            </em>
          ),

          // ── Inline code ───────────────────────────────────────────────────────
          code: ({ children, className }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) return <code className={className}>{children}</code>;
            return (
              <code
                className="px-1.5 py-0.5 rounded-md text-[11.5px] font-mono"
                style={{
                  background: "var(--surface)",
                  color: "var(--accent)",
                  border: "1px solid var(--border)",
                }}
              >
                {children}
              </code>
            );
          },

          // ── Code blocks ───────────────────────────────────────────────────────
          pre: ({ children }) => {
            const codeEl = React.Children.toArray(children).find(
              (c) => React.isValidElement(c) && c.type === "code"
            ) as React.ReactElement<{ children?: React.ReactNode; className?: string }> | undefined;
            const rawText = codeEl?.props?.children ?? "";
            const lang = (codeEl?.props?.className ?? "").replace("language-", "") || "code";
            return (
              <div className="my-4 rounded-xl overflow-hidden border border-border dark:border-white/10 bg-surface/50 dark:bg-black/40">
                {/* header bar */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-border dark:border-white/10 bg-surface/80 dark:bg-white/5">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-dark dark:text-white/30">
                    {lang}
                  </span>
                  <CopyButton text={String(rawText)} />
                </div>
                <pre className="overflow-x-auto p-4 text-[12px] leading-relaxed font-mono m-0 text-foreground/80 dark:text-[#e2e8f0]">
                  {children}
                </pre>
              </div>
            );
          },

          // ── Blockquote ────────────────────────────────────────────────────────
          blockquote: ({ children }) => (
            <blockquote
              className="my-4 pl-4 pr-3 py-2.5 rounded-r-xl text-[13px] italic leading-relaxed border-l-[3px] border-primary/50 bg-primary/5 dark:bg-primary/10 text-muted-dark dark:text-white/70"
            >
              {children}
            </blockquote>
          ),

          // ── Tables ────────────────────────────────────────────────────────────
          table: ({ children }) => (
            <div className="my-5 overflow-x-auto rounded-xl border border-border dark:border-white/10">
              <table className="w-full text-[12px] text-left border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface/80 dark:bg-white/10">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody>{children}</tbody>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-accent border-b border-border/80 dark:border-white/10">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 text-foreground/80 dark:text-white/70 border-b border-border/40 dark:border-white/5">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="transition-colors hover:bg-white/[0.02]">
              {children}
            </tr>
          ),

          // ── Links ─────────────────────────────────────────────────────────────
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4 transition-colors"
              style={{ color: "#22D3EE", textDecorationColor: "rgba(34,211,238,0.35)" }}
            >
              {children}
            </a>
          ),

          // ── HR ────────────────────────────────────────────────────────────────
          hr: () => (
            <hr className="my-4 border-border/50 dark:border-white/10" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {isStreaming && <StreamingCursor />}
    </div>
  );
}
