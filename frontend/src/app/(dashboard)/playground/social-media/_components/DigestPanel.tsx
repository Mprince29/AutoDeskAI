"use client";

import React from "react";
import {
  ExternalLink,
  Globe,
  Loader2,
  Newspaper,
  RefreshCcw,
  Trash2,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { DigestGeo, NewsDigestDetail, NewsDigestListItem } from "@/types/social.types";
import {
  GEO_OPTIONS,
  formatTimestamp,
  formatRelative,
  statusPillClass,
} from "./social-helpers";

// ── Props 

interface DigestPanelProps {
  digests: NewsDigestListItem[];
  digestsLoading: boolean;
  selectedDigestId: number | null;
  selectedDigest: NewsDigestDetail | null;
  selectedDigestLoading: boolean;
  digestGeo: DigestGeo;
  activeDigestId: number | null;
  creatingDigest: boolean;
  deletingDigestId: number | null;
  onSelectDigest: (id: number) => void;
  onSetGeo: (geo: DigestGeo) => void;
  onGenerate: () => void;
  onDelete: (id: number) => void;
  onRetry: (geo: DigestGeo) => void;
}

// ── Component ─────────────────────

export function DigestPanel({
  digests,
  digestsLoading,
  selectedDigestId,
  selectedDigest,
  selectedDigestLoading,
  digestGeo,
  activeDigestId,
  creatingDigest,
  deletingDigestId,
  onSelectDigest,
  onSetGeo,
  onGenerate,
  onDelete,
  onRetry,
}: DigestPanelProps) {
  const [activeIframeUrl, setActiveIframeUrl] = React.useState<string | null>(null);
  const [selectedStoryId, setSelectedStoryId] = React.useState<number | null>(null);

  // Auto-select first story when digest loads or changes
  React.useEffect(() => {
    if (selectedDigest?.status === 'done' && selectedDigest.stories.length > 0) {
      // Check if the current selection is valid for this digest
      const isValidSelection = selectedDigest.stories.some(s => s.id === selectedStoryId);
      if (!isValidSelection) {
        setSelectedStoryId(selectedDigest.stories[0].id);
        setActiveIframeUrl(selectedDigest.stories[0].url || null);
      }
    } else if (!selectedDigest || selectedDigest.status !== 'done') {
      // Clear selection if no digest or it's not done
      setSelectedStoryId(null);
      setActiveIframeUrl(null);
    }
  }, [selectedDigest, selectedStoryId]);
  return (
    <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">
      {/* Left sidebar — digest controls + history */}
      <div className="w-full lg:w-[320px] shrink-0 border-b lg:border-b-0 lg:border-r border-border/20 flex flex-col lg:overflow-y-auto">
        <div className="px-4 py-4 border-b border-border/10">
          <div className="flex items-center justify-between">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40 block mb-1">News Brief Details</span>
                <p className="text-[11px] text-foreground font-medium">AI-generated summary of industry news</p>
              </div>
            {activeDigestId ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                <Loader2 className="h-3 w-3 animate-spin" />
                Running
              </span>
            ) : null}
          </div>

          <div className="mt-3">
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Region</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {GEO_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSetGeo(option.value)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all",
                    digestGeo === option.value
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/40 bg-surface/50 text-muted-foreground hover:border-primary/20"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onGenerate}
            disabled={creatingDigest}
            className="mt-4 w-full flex items-center justify-center gap-2 text-white text-[11px] font-bold uppercase tracking-widest px-4 py-3 rounded-xl bg-primary hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
          >
            {creatingDigest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Newspaper className="h-4 w-4" />}
            {creatingDigest ? "Generating..." : "Generate News Brief"}
          </button>
          
          {/* Informational Callout */}
          <div className="bg-primary/5 border border-primary/10 rounded-xl p-3.5 mt-4">
            <div className="flex gap-2.5">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">How it works</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Our AI agents will scour the web for the latest industry news in your selected region. For each article, they will extract key insights to generate a concise summary and determine the relevance to your company.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30">History</span>
            {digestsLoading ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40" /> : null}
          </div>

          {!digestsLoading && digests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/40 bg-surface/30 px-3 py-6 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">No news briefs yet</p>
              <p className="mt-1 text-[10px] text-muted-foreground/40">Generate your first news brief above.</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            {digests.map((digest) => (
              <div
                key={digest.id}
                onClick={() => onSelectDigest(digest.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectDigest(digest.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition cursor-pointer",
                  selectedDigestId === digest.id
                    ? "border-primary/30 bg-primary/5"
                    : "border-border/20 hover:border-primary/15 hover:bg-surface/60"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 shrink-0">{digest.geo.toUpperCase()}</span>
                    <span className={cn("rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest capitalize", statusPillClass(digest.status))}>{digest.status}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onDelete(digest.id); }}
                    disabled={deletingDigestId === digest.id}
                    className="p-1 rounded text-muted-foreground/30 hover:text-rose-500 hover:bg-rose-500/5 transition disabled:opacity-50 shrink-0"
                    aria-label="Delete digest"
                  >
                    {deletingDigestId === digest.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-foreground">{digest.story_count} {digest.story_count === 1 ? "story" : "stories"}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground/50 tracking-wide">{formatRelative(digest.created_at) || formatTimestamp(digest.created_at)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Middle & Right Panes */}
      {selectedDigestLoading ? (
        <>
          {/* Middle Pane Skeleton */}
          <div className="w-full lg:w-[380px] shrink-0 border-b lg:border-b-0 lg:border-r border-border/20 flex flex-col lg:overflow-y-auto bg-surface/5">
            <div className="p-4 border-b border-border/10 bg-background/80 flex flex-col gap-3">
               <div className="flex items-center gap-2">
                 <Skeleton className="h-5 w-16" />
                 <Skeleton className="h-3 w-12" />
               </div>
               <div className="flex items-center gap-2 mt-1">
                 <Skeleton className="h-2 w-12" />
                 <Skeleton className="h-2 w-16" />
               </div>
            </div>
            <div className="flex flex-col">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="p-4 border-b border-border/10 flex flex-col gap-2.5">
                   <div className="flex gap-2">
                     <Skeleton className="h-3 w-16" />
                     <Skeleton className="h-3 w-12" />
                   </div>
                   <Skeleton className="h-4 w-full mt-1" />
                   <Skeleton className="h-4 w-2/3" />
                   <div className="flex gap-2 mt-1.5">
                     <Skeleton className="h-2 w-14" />
                     <Skeleton className="h-2 w-10" />
                   </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Pane Skeleton */}
          <div className="flex-1 flex flex-col lg:overflow-hidden bg-background relative">
             <div className="flex-1 bg-surface/10 flex items-center justify-center">
                 <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/20" />
             </div>
          </div>
        </>
      ) : !selectedDigest ? (
        <div className="flex-1 flex h-full min-h-[400px] flex-col items-center justify-center px-6 text-center">
          <Globe className="h-8 w-8 text-muted-foreground/30" />
          <h3 className="mt-3 text-sm font-bold text-foreground uppercase tracking-tight">Pick a news brief</h3>
          <p className="mt-1 text-[10px] text-muted-foreground/60 tracking-wide max-w-xs">Select one from the sidebar to view headlines, summaries, and company context.</p>
        </div>
      ) : selectedDigest.status === "pending" ? (
        <div className="flex-1 flex h-full min-h-[400px] flex-col items-center justify-center px-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
          <h3 className="mt-3 text-sm font-bold text-foreground uppercase tracking-tight">News brief in progress</h3>
          <p className="mt-1 text-[10px] text-muted-foreground/60 tracking-wide">Polling every 5 seconds. This view updates automatically.</p>
        </div>
      ) : selectedDigest.status === "failed" ? (
        <div className="flex-1 flex h-full min-h-[400px] flex-col items-center justify-center px-6 text-center">
          <RefreshCcw className="h-8 w-8 text-rose-500" />
          <h3 className="mt-3 text-sm font-bold text-foreground uppercase tracking-tight">News brief failed</h3>
          <p className="mt-1 text-[10px] text-muted-foreground/60 tracking-wide">Try generating another news brief with the same region.</p>
          <button
            type="button"
            onClick={() => onRetry(selectedDigest.geo)}
            className="mt-3 flex items-center gap-1.5 text-white text-[9px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg bg-primary hover:opacity-90 transition-all"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Middle Pane: Story List */}
          <div className="w-full lg:w-[380px] shrink-0 border-b lg:border-b-0 lg:border-r border-border/20 flex flex-col lg:overflow-y-auto bg-surface/5">
            <div className="p-4 border-b border-border/10 bg-background/80 backdrop-blur-sm sticky top-0 z-10 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded">{selectedDigest.geo.toUpperCase()}</span>
                <span className="text-[10px] font-semibold text-foreground">News #{selectedDigest.id}</span>
              </div>
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground/50 uppercase tracking-widest">
                <span>{selectedDigest.story_count} stories</span>
                <span>{formatTimestamp(selectedDigest.created_at)}</span>
              </div>
            </div>

            {selectedDigest.stories.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">No stories returned</p>
                <p className="mt-1 text-[10px] text-muted-foreground/40">Try another region or run the digest again.</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {selectedDigest.stories.map(story => {
                  const isSelected = selectedStoryId === story.id;
                  return (
                    <div key={story.id} className="flex flex-col border-b border-border/10">
                      <button
                        onClick={() => {
                          setSelectedStoryId(story.id);
                          setActiveIframeUrl(story.url || null);
                        }}
                        className={cn(
                          "p-4 text-left hover:bg-surface transition-all flex flex-col gap-1.5 relative",
                          isSelected ? "bg-primary/5" : "bg-transparent"
                        )}
                      >
                        {isSelected && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r" />
                        )}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {story.relevance_tag ? (
                            <span className="text-[8px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-1.5 py-0.5 rounded">{story.relevance_tag}</span>
                          ) : null}
                          {story.geo_tag ? (
                            <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 bg-surface px-1.5 py-0.5 rounded">{story.geo_tag}</span>
                          ) : null}
                        </div>
                        <h4 className="text-[13px] font-bold text-foreground line-clamp-2 leading-snug">{story.headline}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          {story.source && <span className="text-[9px] text-muted-foreground/60 uppercase tracking-widest truncate">{story.source}</span>}
                          {story.published_at && <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest shrink-0">{story.published_at}</span>}
                        </div>
                      </button>
                      
                      {/* Expanded Content */}
                      {isSelected && (
                        <div className="px-4 pb-4 pt-1 bg-primary/5">
                          <div className="grid gap-3">
                            <div className="bg-background rounded-lg p-3 border border-border/10 shadow-sm">
                              <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1.5">Summary</p>
                              <p className="text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">{story.plain_summary || "No summary generated."}</p>
                            </div>
                            <div className="bg-background rounded-lg p-3 border border-border/10 shadow-sm">
                              <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1.5">Company Context</p>
                              <p className="text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">{story.company_info || "No context available."}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Pane: Story Details & Iframe */}
          <div className="flex-1 flex flex-col lg:overflow-hidden bg-background relative">
            {selectedStoryId ? (
              (() => {
                const story = selectedDigest.stories.find(s => s.id === selectedStoryId);
                if (!story) return null;
                return (
                  <>
                    {/* Iframe only */}
                    <div className="flex-1 relative bg-surface/10">
                      {activeIframeUrl ? (
                        <>
                          <div className="absolute top-0 inset-x-0 h-10 bg-background/80 backdrop-blur border-b border-border/10 flex items-center justify-between px-4 z-20">
                            <div className="flex items-center gap-2 min-w-0">
                              <Globe size={12} className="text-primary shrink-0" />
                              <span className="text-[9px] font-semibold text-foreground truncate">{new URL(activeIframeUrl).hostname}</span>
                            </div>
                            <a
                              href={activeIframeUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 px-2 py-1 bg-surface hover:bg-surface-hover rounded text-[9px] font-bold uppercase tracking-widest text-muted-foreground transition-colors border border-border/10"
                              title="Open in new tab"
                            >
                              <ExternalLink size={10} />
                              Pop Out
                            </a>
                          </div>
                          <iframe 
                            src={`/api/iframe-proxy?url=${encodeURIComponent(activeIframeUrl)}`} 
                            className="absolute inset-0 w-full h-full border-0 pt-10 bg-white" 
                            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                            title="Source Article"
                          />
                        </>
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground/40 text-[10px] uppercase tracking-widest font-bold">
                          No source link available
                        </div>
                      )}
                    </div>
                  </>
                );
              })()
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground/40">
                <Newspaper className="h-10 w-10 mb-3 opacity-30" />
                <h3 className="text-sm font-bold uppercase tracking-tight text-foreground/60">Select a story</h3>
                <p className="text-[10px] tracking-wide max-w-xs mt-1">Click a headline from the list to view its summary and full article.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
