import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { ExternalLink, Globe, Copy, Check, Terminal } from "lucide-react";
import { useState } from "react";

import { DraftPreviewCard } from "./DraftPreviewCard";
import { BriefingCard, BriefingData } from "./BriefingCard";

const DRAFT_MARKER_RE = /\[DRAFT:([^:\]]+):([^:\]]+):([^\]]+)\]/g;

// Attempt to fix common LLM JSON mistakes before parsing
function tryParseJson(raw: string): any | null {
  // First try as-is
  try { return JSON.parse(raw); } catch {}
  // Remove trailing commas before } or ]
  const sanitized = raw
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{[,])\s*,/g, '$1');
  try { return JSON.parse(sanitized); } catch {}
  return null;
}

function CodeBlock({ children, language }: { children: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-6 rounded-xl border border-white/10 bg-[#0d0d0d] overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted/60" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted/60">
            {language || "code"}
          </span>
        </div>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/10 transition-colors text-muted/60 hover:text-white"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          <span className="text-[10px] font-bold uppercase tracking-wider">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="p-4 overflow-x-auto custom-scrollbar-thin">
        <code className="text-[13px] font-mono leading-relaxed text-blue-100/90 whitespace-pre">
          {children}
        </code>
      </pre>
    </div>
  );
}

function MarkdownBlock({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  if (!content.trim()) return null;

  return (
    <div className={`prose dark:prose-invert prose-sm md:prose-base max-w-none 
      prose-p:leading-relaxed prose-p:mb-4 last:prose-p:mb-0
      prose-headings:font-bold prose-headings:tracking-tight prose-headings:mt-8 prose-headings:mb-4
      prose-strong:font-bold prose-strong:text-foreground
      prose-ul:my-4 prose-ol:my-4 prose-li:my-1
      prose-blockquote:border-l-4 prose-blockquote:border-primary/30 prose-blockquote:bg-primary/5 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:italic
      ${isStreaming ? "streaming-text" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children, ...props }) => {
            const isGoogleDoc = href?.includes("docs.google.com") || href?.includes("drive.google.com");
            const isExternal = href?.startsWith("http");

            if (isGoogleDoc) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="no-underline block my-4 group"
                >
                  <span className="flex items-center gap-4 p-4 rounded-2xl border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-all active:scale-[0.98]">
                    <span className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <Globe className="w-6 h-6 text-primary" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[10px] font-black uppercase tracking-widest text-primary/60 mb-0.5">Primary Action</span>
                      <span className="block text-sm font-bold truncate text-foreground group-hover:text-primary transition-colors">
                        {children || "Open Document"}
                      </span>
                    </span>
                    <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors mr-2" />
                  </span>
                </a>
              );
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 underline decoration-primary/30 underline-offset-4 inline-flex items-center gap-1 font-bold group"
                {...props}
              >
                {children}
                {isExternal ? <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" /> : null}
              </a>
            );
          },
          table: ({ ...props }) => (
            <div className="overflow-x-auto my-4 rounded-xl border border-white/5 bg-white/[0.02]">
              <table className="min-w-full divide-y divide-white/5" {...props} />
            </div>
          ),
          th: ({ ...props }) => <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-widest text-muted bg-white/5" {...props} />,
          td: ({ ...props }) => <td className="px-4 py-2 text-[11px] border-t border-white/5" {...props} />,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const isCodeBlock = !!match;
            const content = String(children).replace(/\n$/, "");

            return !isCodeBlock ? (
              <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-md text-[13px] font-mono font-semibold" {...props}>
                {children}
              </code>
            ) : (
              <CodeBlock language={match[1]}>{content}</CodeBlock>
            );
          },
        }}
      >
        {content
          .replace(/\\n/g, "\n")
          .replace(/^(Subject|From|To|Date|Snippet):/gm, "\n\n**$1:**")
          .trim()}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownRenderer({
  content,
  isStreaming,
  userEmail,
}: {
  content: string;
  isStreaming?: boolean;
  userEmail: string;
}) {
  const parts: Array<
    | { type: "markdown"; content: string } 
    | { type: "draft"; id: string }
    | { type: "briefing"; data: BriefingData }
  > = [];
  
  let lastIndex = 0;
  
  // Combine all markers and sort by index
  const allMatches: Array<{ index: number; length: number; type: "draft" | "briefing"; value: any }> = [];
  
  let draftMatch;
  while ((draftMatch = DRAFT_MARKER_RE.exec(content)) !== null) {
    allMatches.push({ index: draftMatch.index, length: draftMatch[0].length, type: "draft", value: draftMatch[1] });
  }
  
  let briefingMatch;
  // Use a more inclusive regex for the content, we'll validate JSON in the loop
  const BRIEFING_MARKER_RE_LOCAL = /\[BRIEFING_DATA:([\s\S]*?)\]/g;
  
  while ((briefingMatch = BRIEFING_MARKER_RE_LOCAL.exec(content)) !== null) {
    let rawJson = briefingMatch[1];
    let data = tryParseJson(rawJson);
    let lastMatchIndex = BRIEFING_MARKER_RE_LOCAL.lastIndex;

    // If parsing fails, it might be because of nested brackets/braces (e.g., agenda: [])
    // We try to find the next closing bracket and see if it makes the JSON valid
    while (!data && lastMatchIndex < content.length) {
      const nextBracket = content.indexOf(']', lastMatchIndex);
      if (nextBracket === -1) break;
      
      const extendedRaw = content.slice(briefingMatch.index + "[BRIEFING_DATA:".length, nextBracket);
      const extendedData = tryParseJson(extendedRaw);
      
      if (extendedData) {
        data = extendedData;
        lastMatchIndex = nextBracket + 1;
        BRIEFING_MARKER_RE_LOCAL.lastIndex = lastMatchIndex; // Sync regex pointer
        break;
      }
      lastMatchIndex = nextBracket + 1;
    }

    if (data) {
      allMatches.push({ 
        index: briefingMatch.index, 
        length: lastMatchIndex - briefingMatch.index, 
        type: "briefing", 
        value: data 
      });
    }
  }
  
  allMatches.sort((a, b) => a.index - b.index);
  
  allMatches.forEach((match) => {
    if (match.index > lastIndex) {
      parts.push({ type: "markdown", content: content.slice(lastIndex, match.index) });
    }
    if (match.type === "draft") {
      parts.push({ type: "draft", id: match.value });
    } else if (match.type === "briefing") {
      parts.push({ type: "briefing", data: match.value });
    }
    lastIndex = match.index + match.length;
  });

  if (lastIndex < content.length) {
    parts.push({ type: "markdown", content: content.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ type: "markdown", content });
  }

  return (
    <div>
        {parts.map((part, index) => {
          if (part.type === "draft") {
            return (
              <DraftPreviewCard
                key={`${part.id}-${index}`}
                draftId={part.id}
                userEmail={userEmail}
                refreshToken={part.id}
              />
            );
          }

          if (part.type === "briefing") {
            return <BriefingCard key={`briefing-${index}`} data={part.data} />;
          }

          return <MarkdownBlock key={`md-${index}`} content={part.content} isStreaming={isStreaming} />;
        })}
    </div>
  );
}
