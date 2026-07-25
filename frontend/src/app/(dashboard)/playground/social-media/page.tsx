"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  MessagesSquare,
  Newspaper,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { socialService } from "@/services/social.service";
import type {
  ApproveSuggestionResponse,
  CreateScanRequest,
  DigestGeo,
  NewsDigestDetail,
  NewsDigestListItem,
  OrmPlatform,
  OrmPlatformFilter,
  OrmPostDetail,
  OrmPostListItem,
  OrmPostStatus,
  OrmPostStatusFilter,
  OrmScanLog,
} from "@/types/social.types";

import { DigestPanel } from "./_components/DigestPanel";
import { OrmPanel } from "./_components/OrmPanel";
import {
  LOCAL_STORAGE_KEYS,
  upsertDigestSummary,
  upsertScan,
  moveSelection,
} from "./_components/social-helpers";

// ── Page 

export default function SocialMediaPage() {
  const { user, loading } = useAuth();

  const [activeTab, setActiveTab] = useState("digest");

  // ── Digest state 
  const [digests, setDigests] = useState<NewsDigestListItem[]>([]);
  const [digestsLoading, setDigestsLoading] = useState(false);
  const [selectedDigestId, setSelectedDigestId] = useState<number | null>(null);
  const [selectedDigest, setSelectedDigest] = useState<NewsDigestDetail | null>(null);
  const [selectedDigestLoading, setSelectedDigestLoading] = useState(false);
  const [digestGeo, setDigestGeo] = useState<DigestGeo>("us");
  const [activeDigestId, setActiveDigestId] = useState<number | null>(null);
  const [creatingDigest, setCreatingDigest] = useState(false);
  const [deletingDigestId, setDeletingDigestId] = useState<number | null>(null);

  // ── ORM state ───
  const [posts, setPosts] = useState<OrmPostListItem[]>([]);
  const [postTotal, setPostTotal] = useState(0);
  const [postsLoading, setPostsLoading] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [selectedPost, setSelectedPost] = useState<OrmPostDetail | null>(null);
  const [selectedPostLoading, setSelectedPostLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrmPostStatusFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<OrmPlatformFilter>("all");
  const [historyScanIdFilter, setHistoryScanIdFilter] = useState<number | null>(null);
  const [scanHistory, setScanHistory] = useState<OrmScanLog[]>([]);
  const [scanHistoryLoading, setScanHistoryLoading] = useState(false);
  const [activeScanId, setActiveScanId] = useState<number | null>(null);
  const [creatingScan, setCreatingScan] = useState(false);
  const [regeneratingSuggestions, setRegeneratingSuggestions] = useState(false);
  const [approvingSuggestionId, setApprovingSuggestionId] = useState<number | null>(null);
  const [rejectingPostId, setRejectingPostId] = useState<number | null>(null);
  const [copiedApprovedComment, setCopiedApprovedComment] = useState(false);

  // ── Scan form state 
  const [keywordsInput, setKeywordsInput] = useState("");
  const [scanGeo, setScanGeo] = useState<DigestGeo>("us");
  const [selectedPlatforms, setSelectedPlatforms] = useState<OrmPlatform[]>(["linkedin", "twitter"]);
  const [brandName, setBrandName] = useState("M37 Labs");
  const [brandContext, setBrandContext] = useState("An AI-focused company building tools for business teams");
  const [brandVoice, setBrandVoice] = useState("Conversational, knowledgeable, not salesy. Peer-to-peer tone.");

  const digestPollRef = useRef<number | null>(null);
  const scanPollRef = useRef<number | null>(null);

  // ── Data loaders 

  async function loadDigests(options?: { preserveSelection?: boolean; autoSelectLatest?: boolean }) {
    if (!user?.email) return;

    setDigestsLoading(true);
    try {
      const list = await socialService.listDigests(user.email);
      setDigests(list);

      const shouldAutoSelect = options?.autoSelectLatest ?? true;
      const preserveSelection = options?.preserveSelection ?? true;

      if (!list.length) {
        setSelectedDigestId(null);
        setSelectedDigest(null);
      } else if (shouldAutoSelect) {
        const nextId = preserveSelection && selectedDigestId && list.some((item) => item.id === selectedDigestId)
          ? selectedDigestId
          : list[0].id;
        setSelectedDigestId(nextId);
      }
    } catch {
      toast.error("Failed to load digests");
    } finally {
      setDigestsLoading(false);
    }
  }

  async function loadDigestDetail(digestId: number, options?: { silent?: boolean }) {
    if (!user?.email) return;

    if (!options?.silent) {
      setSelectedDigestLoading(true);
    }

    try {
      const detail = await socialService.getDigest(digestId, user.email);
      setSelectedDigest(detail);
      setDigests((current) => upsertDigestSummary(current, detail));
    } catch {
      toast.error("Failed to load digest details");
    } finally {
      if (!options?.silent) {
        setSelectedDigestLoading(false);
      }
    }
  }

  async function loadPosts(options?: { keepSelection?: boolean }) {
    if (!user?.email) return;

    setPostsLoading(true);
    try {
      const response = await socialService.listPosts(user.email, {
        status: statusFilter === "all" ? undefined : statusFilter,
        platform: platformFilter === "all" ? undefined : platformFilter,
        scan_id: historyScanIdFilter ?? undefined,
        limit: 50,
        offset: 0,
      });

      setPosts(response.posts);
      setPostTotal(response.total);

      const keepSelection = options?.keepSelection ?? true;
      if (!response.posts.length) {
        setSelectedPostId(null);
        setSelectedPost(null);
      } else {
        const nextId = keepSelection && selectedPostId && response.posts.some((item) => item.id === selectedPostId)
          ? selectedPostId
          : response.posts[0].id;
        setSelectedPostId(nextId);
      }
    } catch {
      toast.error("Failed to load ORM posts");
    } finally {
      setPostsLoading(false);
    }
  }

  async function loadPostDetail(postId: number, options?: { silent?: boolean }) {
    if (!user?.email) return;

    if (!options?.silent) {
      setSelectedPostLoading(true);
    }

    try {
      const detail = await socialService.getPost(postId, user.email);
      setSelectedPost(detail);
      setPosts((current) => current.map((item) => (item.id === detail.id ? detail : item)));
    } catch {
      toast.error("Failed to load post details");
    } finally {
      if (!options?.silent) {
        setSelectedPostLoading(false);
      }
    }
  }

  async function loadScanHistory() {
    if (!user?.email) return;

    setScanHistoryLoading(true);
    try {
      const scans = await socialService.listScans(user.email);
      setScanHistory(scans);
    } catch {
      toast.error("Failed to load scan history");
    } finally {
      setScanHistoryLoading(false);
    }
  }

  // ── Effects ─────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedBrandName = window.localStorage.getItem(LOCAL_STORAGE_KEYS.brandName);
    const savedBrandContext = window.localStorage.getItem(LOCAL_STORAGE_KEYS.brandContext);
    const savedBrandVoice = window.localStorage.getItem(LOCAL_STORAGE_KEYS.brandVoice);

    if (savedBrandName) setBrandName(savedBrandName);
    if (savedBrandContext) setBrandContext(savedBrandContext);
    if (savedBrandVoice) setBrandVoice(savedBrandVoice);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.brandName, brandName);
  }, [brandName]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.brandContext, brandContext);
  }, [brandContext]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.brandVoice, brandVoice);
  }, [brandVoice]);

  useEffect(() => {
    if (!user?.email) return;

    loadDigests({ preserveSelection: false, autoSelectLatest: true });
    loadPosts({ keepSelection: false });
    loadScanHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  useEffect(() => {
    if (selectedDigestId === null) {
      setSelectedDigest(null);
      return;
    }

    loadDigestDetail(selectedDigestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDigestId]);

  useEffect(() => {
    if (selectedPostId === null) {
      setSelectedPost(null);
      return;
    }

    loadPostDetail(selectedPostId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPostId]);

  useEffect(() => {
    if (!user?.email) return;
    loadPosts({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, platformFilter, historyScanIdFilter, user?.email]);

  // Digest polling
  useEffect(() => {
    if (digestPollRef.current) {
      window.clearInterval(digestPollRef.current);
      digestPollRef.current = null;
    }

    if (!activeDigestId || !user?.email) return;

    digestPollRef.current = window.setInterval(async () => {
      try {
        const detail = await socialService.getDigest(activeDigestId, user.email);
        setDigests((current) => upsertDigestSummary(current, detail));
        if (selectedDigestId === detail.id) {
          setSelectedDigest(detail);
        }

        if (detail.status === "done") {
          setActiveDigestId(null);
          toast.success(`Digest ready with ${detail.story_count} stories`);
        } else if (detail.status === "failed") {
          setActiveDigestId(null);
          toast.error("Digest generation failed");
        }
      } catch {
        setActiveDigestId(null);
        toast.error("Digest polling failed");
      }
    }, 5000);

    return () => {
      if (digestPollRef.current) {
        window.clearInterval(digestPollRef.current);
        digestPollRef.current = null;
      }
    };
  }, [activeDigestId, selectedDigestId, user?.email]);

  // Scan polling
  useEffect(() => {
    if (scanPollRef.current) {
      window.clearInterval(scanPollRef.current);
      scanPollRef.current = null;
    }

    if (!activeScanId || !user?.email) return;

    scanPollRef.current = window.setInterval(async () => {
      try {
        const scan = await socialService.getScan(activeScanId, user.email);
        setScanHistory((current) => upsertScan(current, scan));

        if (scan.status === "done") {
          setActiveScanId(null);
          toast.success(`Scan complete: ${scan.posts_found} posts found`);
          loadPosts({ keepSelection: false });
          loadScanHistory();
        } else if (scan.status === "failed") {
          setActiveScanId(null);
          toast.error(scan.error || "ORM scan failed");
        }
      } catch {
        setActiveScanId(null);
        toast.error("Scan polling failed");
      }
    }, 8000);

    return () => {
      if (scanPollRef.current) {
        window.clearInterval(scanPollRef.current);
        scanPollRef.current = null;
      }
    };
  }, [activeScanId, user?.email]);

  // ── Handlers ────

  async function handleGenerateDigest() {
    if (!user?.email) return;

    setCreatingDigest(true);
    try {
      const response = await socialService.createDigest({
        email: user.email,
        geo: digestGeo,
      });

      const optimisticDigest: NewsDigestDetail = {
        id: response.digest_id,
        user_email: user.email,
        geo: digestGeo,
        status: response.status,
        story_count: 0,
        created_at: new Date().toISOString(),
        stories: [],
      };

      setDigests((current) => upsertDigestSummary(current, optimisticDigest));
      setSelectedDigestId(response.digest_id);
      setSelectedDigest(optimisticDigest);
      setActiveDigestId(response.digest_id);
      toast.success("Digest generation started");
    } catch {
      toast.error("Failed to start digest");
    } finally {
      setCreatingDigest(false);
    }
  }

  async function handleDeleteDigest(digestId: number) {
    if (!user?.email) return;

    setDeletingDigestId(digestId);
    try {
      await socialService.deleteDigest(digestId, user.email);

      setDigests((current) => {
        const next = current.filter((item) => item.id !== digestId);
        if (selectedDigestId === digestId) {
          const nextSelectedId = moveSelection(next, digestId);
          setSelectedDigestId(nextSelectedId);
          if (nextSelectedId === null) {
            setSelectedDigest(null);
          }
        }
        return next;
      });

      if (activeDigestId === digestId) {
        setActiveDigestId(null);
      }

      toast.success("Digest deleted");
    } catch {
      toast.error("Failed to delete digest");
    } finally {
      setDeletingDigestId(null);
    }
  }

  function handleRetryDigest(geo: DigestGeo) {
    setDigestGeo(geo);
    handleGenerateDigest();
  }

  function togglePlatformSelection(platform: OrmPlatform) {
    setSelectedPlatforms((current) => {
      if (current.includes(platform)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== platform);
      }
      return [...current, platform];
    });
  }

  async function handleRunScan() {
    if (!user?.email) return;

    const keywords = keywordsInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!keywords.length) {
      toast.error("Add at least one keyword");
      return;
    }

    if (!selectedPlatforms.length) {
      toast.error("Choose at least one platform");
      return;
    }

    const payload: CreateScanRequest = {
      email: user.email,
      keywords,
      platforms: selectedPlatforms,
      geo: scanGeo,
      brand_name: brandName.trim(),
      brand_context: brandContext.trim(),
      brand_voice: brandVoice.trim(),
    };

    setCreatingScan(true);
    try {
      const response = await socialService.createScan(payload);
      const optimisticScan: OrmScanLog = {
        id: response.scan_id,
        status: response.status,
        keywords,
        platforms: selectedPlatforms,
        geo: scanGeo,
        posts_found: 0,
        error: null,
        started_at: new Date().toISOString(),
        finished_at: null,
      };

      setScanHistory((current) => upsertScan(current, optimisticScan));
      setActiveScanId(response.scan_id);
      setActiveTab("orm");
      toast.success("ORM scan started");
    } catch {
      toast.error("Failed to start scan");
    } finally {
      setCreatingScan(false);
    }
  }

  async function handleRegenerateSuggestions() {
    if (!user?.email || !selectedPostId) return;

    setRegeneratingSuggestions(true);
    try {
      const response = await socialService.regenerateSuggestions(selectedPostId, {
        email: user.email,
        brand_name: brandName.trim(),
        brand_voice: brandVoice.trim(),
      });

      setSelectedPost((current) => (
        current
          ? { ...current, suggestions: response.suggestions }
          : current
      ));
      toast.success("Suggestions regenerated");
    } catch {
      toast.error("Failed to regenerate suggestions");
    } finally {
      setRegeneratingSuggestions(false);
    }
  }

  async function handleApproveSuggestion(suggestionId: number) {
    if (!user?.email || !selectedPostId || !selectedPost) return;

    setApprovingSuggestionId(suggestionId);
    try {
      const response = await socialService.approveSuggestion(selectedPostId, {
        email: user.email,
        suggestion_id: suggestionId,
      });

      syncApprovedPost(response);
      toast.success("Comment approved");
    } catch {
      toast.error("Failed to approve suggestion");
    } finally {
      setApprovingSuggestionId(null);
    }
  }

  function syncApprovedPost(response: ApproveSuggestionResponse) {
    if (!selectedPostId) return;

    setSelectedPost((current) => (
      current
        ? {
            ...current,
            status: "approved",
            approved_comment: response.approved_comment,
            platform: response.platform,
            post_url: response.post_url,
            actioned_at: new Date().toISOString(),
          }
        : current
    ));

    setPosts((current) => {
      const updated = current.map((item) => (
        item.id === selectedPostId
          ? {
              ...item,
              status: "approved" as OrmPostStatus,
              approved_comment: response.approved_comment,
              actioned_at: new Date().toISOString(),
            }
          : item
      ));

      if (statusFilter === "pending") {
        const filtered = updated.filter((item) => item.id !== selectedPostId);
        const nextId = moveSelection(filtered, selectedPostId);
        setSelectedPostId(nextId);
        setSelectedPost(null);
        setPostTotal((count) => Math.max(0, count - 1));
        return filtered;
      }

      return updated;
    });
  }

  async function handleRejectPost() {
    if (!user?.email || !selectedPostId) return;

    setRejectingPostId(selectedPostId);
    try {
      await socialService.rejectPost(selectedPostId, { email: user.email });

      setSelectedPost((current) => (
        current
          ? { ...current, status: "rejected", actioned_at: new Date().toISOString() }
          : current
      ));

      setPosts((current) => {
        const updated = current.map((item) => (
          item.id === selectedPostId
            ? { ...item, status: "rejected" as OrmPostStatus, actioned_at: new Date().toISOString() }
            : item
        ));

        if (statusFilter === "pending") {
          const filtered = updated.filter((item) => item.id !== selectedPostId);
          const nextId = moveSelection(filtered, selectedPostId);
          setSelectedPostId(nextId);
          setSelectedPost(null);
          setPostTotal((count) => Math.max(0, count - 1));
          return filtered;
        }

        return updated;
      });

      toast.success("Post rejected");
    } catch {
      toast.error("Failed to reject post");
    } finally {
      setRejectingPostId(null);
    }
  }

  async function handleCopyApprovedComment() {
    if (!selectedPost?.approved_comment) return;

    try {
      await navigator.clipboard.writeText(selectedPost.approved_comment);
      setCopiedApprovedComment(true);
      window.setTimeout(() => setCopiedApprovedComment(false), 2000);
      toast.success("Approved comment copied");
    } catch {
      toast.error("Failed to copy comment");
    }
  }

  // ── Render ──────

  if (loading) {
    return (
      <div className="h-full bg-background flex flex-col">
        {/* Top bar skeleton */}
        <div className="border-b border-border/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 bg-background/80">
          <div className="flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-lg" />
            <Skeleton className="w-9 h-9 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48 hidden sm:block" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-32 rounded-lg" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex-1 p-4 sm:p-6 grid gap-6 grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left panel skeleton */}
          <div className="lg:col-span-4 xl:col-span-3 flex flex-col gap-4 border-r border-border/10 pr-4">
            <Skeleton className="h-10 w-full" />
            <div className="flex flex-col gap-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          </div>
          {/* Right panel skeleton */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-6">
            <Skeleton className="h-[200px] w-full rounded-xl" />
            <div className="flex flex-col gap-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user?.email) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-base font-bold text-foreground uppercase tracking-tight">Sign in to continue</h1>
          <p className="mt-1 text-[10px] text-muted-foreground uppercase tracking-widest">Authentication required for Social Media Intelligence</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-background overflow-y-auto flex flex-col">

      {/* ── Top bar ── */}
      <div className="border-b border-border/30 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Link href="/playground" className="p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:border hover:border-border/20 bg-surface transition-all shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600 shadow-sm border border-sky-500/20 shrink-0">
            <MessagesSquare size={16} className="opacity-80" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-foreground uppercase tracking-tight">Social Media Intelligence</h1>
            <p className="hidden sm:block text-[10px] text-muted-foreground font-normal tracking-widest uppercase opacity-60">Track industry news and mentions</p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          <div className="flex items-center bg-surface/50 border border-border/40 rounded-lg overflow-hidden shrink-0">
            <button
              onClick={() => setActiveTab("digest")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-all",
                activeTab === "digest"
                  ? "bg-primary text-white"
                  : "text-muted-foreground/80 hover:bg-surface"
              )}
            >
              <Newspaper size={13} />
              <span>Industry News</span>
            </button>
            <button
              onClick={() => setActiveTab("orm")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-all",
                activeTab === "orm"
                  ? "bg-primary text-white"
                  : "text-muted-foreground/80 hover:bg-surface"
              )}
            >
              <Search size={13} />
              <span>Brand Mentions</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}
      {activeTab === "digest" ? (
        <DigestPanel
          digests={digests}
          digestsLoading={digestsLoading}
          selectedDigestId={selectedDigestId}
          selectedDigest={selectedDigest}
          selectedDigestLoading={selectedDigestLoading}
          digestGeo={digestGeo}
          activeDigestId={activeDigestId}
          creatingDigest={creatingDigest}
          deletingDigestId={deletingDigestId}
          onSelectDigest={setSelectedDigestId}
          onSetGeo={setDigestGeo}
          onGenerate={handleGenerateDigest}
          onDelete={handleDeleteDigest}
          onRetry={handleRetryDigest}
        />
      ) : (
        <OrmPanel
          keywordsInput={keywordsInput}
          onKeywordsChange={setKeywordsInput}
          selectedPlatforms={selectedPlatforms}
          onTogglePlatform={togglePlatformSelection}
          scanGeo={scanGeo}
          onScanGeoChange={setScanGeo}
          brandName={brandName}
          onBrandNameChange={setBrandName}
          brandContext={brandContext}
          onBrandContextChange={setBrandContext}
          brandVoice={brandVoice}
          onBrandVoiceChange={setBrandVoice}
          creatingScan={creatingScan}
          onRunScan={handleRunScan}
          scanHistory={scanHistory}
          scanHistoryLoading={scanHistoryLoading}
          activeScanId={activeScanId}
          historyScanIdFilter={historyScanIdFilter}
          onHistoryScanIdFilter={setHistoryScanIdFilter}
          posts={posts}
          postTotal={postTotal}
          postsLoading={postsLoading}
          selectedPostId={selectedPostId}
          onSelectPost={setSelectedPostId}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          platformFilter={platformFilter}
          onPlatformFilter={setPlatformFilter}
          selectedPost={selectedPost}
          selectedPostLoading={selectedPostLoading}
          regeneratingSuggestions={regeneratingSuggestions}
          onRegenerateSuggestions={handleRegenerateSuggestions}
          approvingSuggestionId={approvingSuggestionId}
          onApproveSuggestion={handleApproveSuggestion}
          rejectingPostId={rejectingPostId}
          onRejectPost={handleRejectPost}
          onCopyApprovedComment={handleCopyApprovedComment}
          copiedApprovedComment={copiedApprovedComment}
        />
      )}
    </div>
  );
}
