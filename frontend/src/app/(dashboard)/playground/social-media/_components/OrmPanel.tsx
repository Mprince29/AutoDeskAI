"use client";

import React, { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  History,
  Loader2,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DigestGeo,
  OrmPlatform,
  OrmPlatformFilter,
  OrmPostDetail,
  OrmPostListItem,
  OrmPostStatusFilter,
  OrmScanLog,
} from "@/types/social.types";
import {
  GEO_OPTIONS,
  ORM_PLATFORMS,
  ORM_STATUS_OPTIONS,
  formatTimestamp,
  formatRelative,
  platformIcon,
  platformPillClass,
  statusPillClass,
} from "./social-helpers";

// ── Props ──────────────────────────────────────────────────────────────────────

interface OrmPanelProps {
  // Scan config
  keywordsInput: string;
  onKeywordsChange: (v: string) => void;
  selectedPlatforms: OrmPlatform[];
  onTogglePlatform: (p: OrmPlatform) => void;
  scanGeo: DigestGeo;
  onScanGeoChange: (g: DigestGeo) => void;
  brandName: string;
  onBrandNameChange: (v: string) => void;
  brandContext: string;
  onBrandContextChange: (v: string) => void;
  brandVoice: string;
  onBrandVoiceChange: (v: string) => void;
  creatingScan: boolean;
  onRunScan: () => void;

  // Scan history
  scanHistory: OrmScanLog[];
  scanHistoryLoading: boolean;
  activeScanId: number | null;
  historyScanIdFilter: number | null;
  onHistoryScanIdFilter: (id: number | null) => void;

  // Post queue
  posts: OrmPostListItem[];
  postTotal: number;
  postsLoading: boolean;
  selectedPostId: number | null;
  onSelectPost: (id: number) => void;
  statusFilter: OrmPostStatusFilter;
  onStatusFilter: (v: OrmPostStatusFilter) => void;
  platformFilter: OrmPlatformFilter;
  onPlatformFilter: (v: OrmPlatformFilter) => void;

  // Post detail
  selectedPost: OrmPostDetail | null;
  selectedPostLoading: boolean;
  regeneratingSuggestions: boolean;
  onRegenerateSuggestions: () => void;
  approvingSuggestionId: number | null;
  onApproveSuggestion: (id: number) => void;
  rejectingPostId: number | null;
  onRejectPost: () => void;
  onCopyApprovedComment: () => void;
  copiedApprovedComment: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OrmPanel({
  keywordsInput,
  onKeywordsChange,
  selectedPlatforms,
  onTogglePlatform,
  scanGeo,
  onScanGeoChange,
  brandName,
  onBrandNameChange,
  brandContext,
  onBrandContextChange,
  brandVoice,
  onBrandVoiceChange,
  creatingScan,
  onRunScan,
  scanHistory,
  scanHistoryLoading,
  activeScanId,
  historyScanIdFilter,
  onHistoryScanIdFilter,
  posts,
  postTotal,
  postsLoading,
  selectedPostId,
  onSelectPost,
  statusFilter,
  onStatusFilter,
  platformFilter,
  onPlatformFilter,
  selectedPost,
  selectedPostLoading,
  regeneratingSuggestions,
  onRegenerateSuggestions,
  approvingSuggestionId,
  onApproveSuggestion,
  rejectingPostId,
  onRejectPost,
  onCopyApprovedComment,
  copiedApprovedComment,
}: OrmPanelProps) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden">
      {/* Left — scan config */}
      <div className="w-full lg:w-[320px] shrink-0 border-b lg:border-b-0 lg:border-r border-border/20 flex flex-col lg:overflow-hidden">
        <div className="px-4 py-4 space-y-3 shrink-0 overflow-y-auto h-full custom-scrollbar">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30">{showHistory ? "History" : "Scan"}</span>
              <h2 className="text-sm font-bold text-foreground uppercase tracking-tight mt-0.5">{showHistory ? "Previous Scans" : "Brand Mentions Scanner"}</h2>
              <p className="mt-1 text-[10px] text-muted-foreground/50 tracking-wide mb-3">{showHistory ? "View your past scan logs and details." : "Find what people are saying about your brand and reply."}</p>
            </div>
            
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
              title={showHistory ? "Back to Config" : "View Scan History"}
            >
              {showHistory ? <X className="h-4 w-4" /> : <History className="h-4 w-4" />}
            </button>
          </div>

          {showHistory ? (
            <div className="pt-2">
              {scanHistoryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
                </div>
              ) : scanHistory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/40 bg-surface/30 px-3 py-6 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">No scans yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {scanHistory.map((scan) => (
                    <div 
                      key={scan.id} 
                      onClick={() => onHistoryScanIdFilter(historyScanIdFilter === scan.id ? null : scan.id)}
                      className={cn(
                        "border rounded-lg p-3 transition-all cursor-pointer",
                        historyScanIdFilter === scan.id 
                          ? "border-primary ring-1 ring-primary bg-primary/5" 
                          : "border-border/20 bg-background hover:border-primary/20"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-foreground">Scan #{scan.id}</span>
                        <span className={cn("rounded border px-1.5 py-0.5 text-[8px] font-bold tracking-widest capitalize", statusPillClass(scan.status))}>{scan.status}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(scan.platforms || []).map((platform) => (
                          <span key={`${scan.id}-${platform}`} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest", platformPillClass(platform))}>
                            {platformIcon(platform)}
                            {platform}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-[9px] text-muted-foreground/50 tracking-wide line-clamp-2">{(scan.keywords || []).join(", ")}</p>
                      <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground/40 uppercase tracking-widest">
                        <span>{scan.geo ? scan.geo.toUpperCase() : "—"}</span>
                        <span>{scan.posts_found} posts</span>
                      </div>
                      {scan.error ? (
                        <p className="mt-2 rounded bg-rose-500/5 px-2 py-1 text-[9px] text-rose-600">{scan.error}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Keywords</label>
                <input
                  value={keywordsInput}
                  onChange={(e) => onKeywordsChange(e.target.value)}
                  placeholder="AI automation, AI agents"
                  className="mt-1.5 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-[12px] outline-none transition focus:border-primary/30 focus:ring-1 focus:ring-primary/10"
                />
                <p className="mt-0.5 text-[9px] text-muted-foreground/40 tracking-wide">Comma-separated topics</p>
              </div>

              <div>
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Platforms</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ORM_PLATFORMS.map((platform) => {
                    const active = selectedPlatforms.includes(platform.value);
                    return (
                      <button
                        key={platform.value}
                        type="button"
                        onClick={() => onTogglePlatform(platform.value)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest transition",
                          active
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border/40 bg-surface/50 text-muted-foreground hover:border-primary/20"
                        )}
                      >
                        {platformIcon(platform.value)}
                        {platform.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Geo</label>
                <select
                  value={scanGeo}
                  onChange={(e) => onScanGeoChange(e.target.value as DigestGeo)}
                  className="mt-1.5 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-[12px] outline-none transition focus:border-primary/30 focus:ring-1 focus:ring-primary/10"
                >
                  {GEO_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Brand name</label>
                <input
                  value={brandName}
                  onChange={(e) => onBrandNameChange(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-[12px] outline-none transition focus:border-primary/30 focus:ring-1 focus:ring-primary/10"
                />
              </div>

              <div>
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Brand context</label>
                <textarea
                  value={brandContext}
                  onChange={(e) => onBrandContextChange(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-[12px] outline-none transition focus:border-primary/30 focus:ring-1 focus:ring-primary/10 resize-none"
                />
              </div>

              <div>
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Brand voice</label>
                <textarea
                  value={brandVoice}
                  onChange={(e) => onBrandVoiceChange(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-[12px] outline-none transition focus:border-primary/30 focus:ring-1 focus:ring-primary/10 resize-none"
                />
              </div>

              <button
                type="button"
                onClick={onRunScan}
                disabled={creatingScan}
                className="flex w-full items-center justify-center gap-1.5 text-white text-[9px] sm:text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg bg-primary cursor-pointer hover:opacity-90 transition-all mt-auto disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingScan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Scan
              </button>
            </>
          )}
        </div>
      </div>

      {/* Center — post queue */}
      <div className="flex-1 flex flex-col lg:overflow-hidden border-b lg:border-b-0 lg:border-r border-border/20">
        {/* Filters bar */}
        <div className="px-4 py-2.5 border-b border-border/10 flex flex-wrap items-center gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30 shrink-0">Status</span>
            <Select value={statusFilter} onValueChange={(v) => onStatusFilter(v as OrmPostStatusFilter)}>
              <SelectTrigger className="h-7 px-2.5 text-[10px] font-bold uppercase tracking-widest bg-background border-border/30 w-auto gap-2 rounded-lg">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-background border border-border/30 shadow-xl rounded-lg">
                {ORM_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-[10px] font-bold uppercase tracking-widest focus:bg-surface hover:bg-surface cursor-pointer rounded-md">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30 shrink-0">Platform</span>
            <Select value={platformFilter} onValueChange={(v) => onPlatformFilter(v as OrmPlatformFilter)}>
              <SelectTrigger className="h-7 px-2.5 text-[10px] font-bold uppercase tracking-widest bg-background border-border/30 w-auto gap-2 rounded-lg">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent className="bg-background border border-border/30 shadow-xl rounded-lg">
                <SelectItem value="all" className="text-[10px] font-bold uppercase tracking-widest focus:bg-surface hover:bg-surface cursor-pointer rounded-md">
                  All
                </SelectItem>
                {ORM_PLATFORMS.map((platform) => (
                  <SelectItem key={platform.value} value={platform.value} className="text-[10px] font-bold uppercase tracking-widest focus:bg-surface hover:bg-surface cursor-pointer rounded-md">
                    <div className="flex items-center gap-1.5">
                      {platformIcon(platform.value)}
                      <span>{platform.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span className="ml-auto text-[9px] text-muted-foreground/40 uppercase tracking-widest shrink-0">{postTotal} posts</span>
        </div>

        {/* Post list */}
        <div className="flex-1 overflow-y-auto">
          {postsLoading ? (
            <div className="divide-y divide-border/10">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-4 py-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-5 w-20 rounded" />
                    <Skeleton className="h-5 w-16 rounded" />
                  </div>
                  <Skeleton className="h-10 w-full" />
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-6 text-center">
              <Search className="h-7 w-7 text-muted-foreground/30" />
              <h3 className="mt-3 text-sm font-bold text-foreground uppercase tracking-tight">No posts found</h3>
              <p className="mt-1 text-[10px] text-muted-foreground/60 tracking-wide">Run a scan or change filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/10">
              {posts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => onSelectPost(post.id)}
                  className={cn(
                    "w-full px-4 py-3 text-left transition hover:bg-surface/50",
                    selectedPostId === post.id && "bg-primary/5"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest", platformPillClass(post.platform))}>
                      {platformIcon(post.platform)}
                      {post.platform}
                    </span>
                    <span className={cn("rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest", statusPillClass(post.status))}>{post.status}</span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-[12px] leading-5 text-foreground/80 break-words overflow-hidden text-ellipsis prose dark:prose-invert max-w-none prose-p:text-[12px] prose-p:leading-5 prose-p:my-0 prose-a:text-inherit prose-a:no-underline">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                    >
                      {post.post_content || "No content."}
                    </ReactMarkdown>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground/40 uppercase tracking-widest">
                    <span>Score {(post.relevance_score * 100).toFixed(0)}%</span>
                    <span>{formatRelative(post.discovered_at) || formatTimestamp(post.discovered_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right — post detail */}
      <div className="flex-1 lg:max-w-[420px] overflow-hidden lg:overflow-y-auto flex flex-col">
        {selectedPostLoading ? (
          <div className="p-4 space-y-4 w-full">
            <div className="border border-border/20 rounded-lg p-4 space-y-3">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20 rounded" />
                <Skeleton className="h-5 w-16 rounded" />
              </div>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <div className="border border-border/20 rounded-lg p-4 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        ) : !selectedPost ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-6 text-center">
            <Search className="h-7 w-7 text-muted-foreground/30" />
            <h3 className="mt-3 text-sm font-bold text-foreground uppercase tracking-tight">Select a post</h3>
            <p className="mt-1 text-[10px] text-muted-foreground/60 tracking-wide">Post details, suggestions, and actions appear here.</p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Post info */}
            <div className="border border-border/20 rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest", platformPillClass(selectedPost.platform))}>
                  {platformIcon(selectedPost.platform)}
                  {selectedPost.platform}
                </span>
                <span className={cn("rounded border px-1.5 py-0.5 text-[8px] font-bold tracking-widest capitalize", statusPillClass(selectedPost.status))}>{selectedPost.status}</span>
                {selectedPost.scan_keyword ? (
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">{selectedPost.scan_keyword}</span>
                ) : null}
              </div>

              <div className="mt-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar prose dark:prose-invert max-w-none text-foreground/80 break-words prose-p:text-[12px] prose-p:leading-5 prose-p:mt-0 prose-p:mb-3 prose-a:text-primary prose-img:rounded-md">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                >
                  {selectedPost.post_content || "No content."}
                </ReactMarkdown>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-[9px] text-muted-foreground/40 uppercase tracking-widest">
                <span>Relevance {(selectedPost.relevance_score * 100).toFixed(0)}%</span>
                {selectedPost.post_author ? <span>{selectedPost.post_author}</span> : null}
                <span>{formatRelative(selectedPost.discovered_at) || formatTimestamp(selectedPost.discovered_at)}</span>
              </div>

              {selectedPost.relevance_reason ? (
                <div className="mt-3 bg-surface/40 rounded-lg p-3">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1">Why it matters</p>
                  <p className="text-[12px] leading-5 text-foreground/80 break-words">{selectedPost.relevance_reason}</p>
                </div>
              ) : null}

              {selectedPost.post_url ? (
                <a
                  href={selectedPost.post_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 border border-border/20 text-muted-foreground/80 text-[9px] font-bold uppercase tracking-widest px-2.5 py-2 rounded-lg hover:bg-surface transition-all"
                >
                  <ExternalLink size={12} />
                  <span>Open Post</span>
                </a>
              ) : null}
            </div>

            {/* Approved comment */}
            {selectedPost.status === "approved" && selectedPost.approved_comment ? (
              <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-700">Approved Comment</span>
                  <button
                    type="button"
                    onClick={onCopyApprovedComment}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white hover:opacity-90 transition"
                  >
                    {copiedApprovedComment ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedApprovedComment ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-foreground/80 bg-white/60 rounded-lg p-2.5 border border-emerald-500/10 break-words">{selectedPost.approved_comment}</p>
              </div>
            ) : null}

            {/* Suggestions */}
            <div className="border border-border/20 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Suggestions</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={onRegenerateSuggestions}
                    disabled={regeneratingSuggestions}
                    className="inline-flex items-center gap-1 border border-border/20 text-muted-foreground/80 text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg hover:bg-surface transition-all disabled:opacity-50"
                  >
                    {regeneratingSuggestions ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                    Regen
                  </button>
                  <button
                    type="button"
                    onClick={onRejectPost}
                    disabled={rejectingPostId === selectedPost.id}
                    className="inline-flex items-center gap-1 border border-rose-500/20 text-rose-600 text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg hover:bg-rose-500/5 transition-all disabled:opacity-50"
                  >
                    {rejectingPostId === selectedPost.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Reject
                  </button>
                </div>
              </div>

              {selectedPost.suggestions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/40 bg-surface/20 px-3 py-6 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">No suggestions</p>
                  <p className="mt-1 text-[9px] text-muted-foreground/40">Try regenerating.</p>
                </div>
              ) : null}

              <div className="space-y-2">
                {selectedPost.suggestions.map((suggestion) => (
                  <div key={suggestion.id} className="border border-border/20 rounded-lg p-3 bg-surface/20">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {suggestion.tone ? (
                          <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50 bg-background px-1.5 py-0.5 rounded border border-border/20">{suggestion.tone}</span>
                        ) : null}
                        <span className="text-[8px] text-muted-foreground/40 tracking-wide">{formatRelative(suggestion.generated_at) || formatTimestamp(suggestion.generated_at)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onApproveSuggestion(suggestion.id)}
                        disabled={approvingSuggestionId === suggestion.id}
                        className="flex items-center gap-1 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 rounded-lg bg-primary hover:opacity-90 transition-all disabled:opacity-50"
                      >
                        {approvingSuggestionId === suggestion.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Approve
                      </button>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-foreground/80 break-words">{suggestion.comment_text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
