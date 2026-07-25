import React from "react";
import { Instagram, Linkedin, Twitter } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type {
  DigestGeo,
  OrmPlatform,
  OrmPostStatusFilter,
  NewsDigestListItem,
  NewsDigestDetail,
  OrmScanLog,
} from "@/types/social.types";

// ── Option arrays ────────

export const GEO_OPTIONS: Array<{ value: DigestGeo; label: string }> = [
  { value: "all", label: "All" },
  { value: "us", label: "US" },
  { value: "eu", label: "EU" },
  { value: "india", label: "India" },
];

export const ORM_PLATFORMS: Array<{ value: OrmPlatform; label: string }> = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "Twitter" },
  { value: "instagram", label: "Instagram" },
];

export const ORM_STATUS_OPTIONS: Array<{ value: OrmPostStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export const LOCAL_STORAGE_KEYS = {
  brandName: "social-orm-brand-name",
  brandContext: "social-orm-brand-context",
  brandVoice: "social-orm-brand-voice",
};

// ── Formatting helpers ───

export function formatTimestamp(value: string | null) {
  if (!value) return "Unknown";
  try {
    return format(new Date(value), "MMM d, yyyy • h:mm a");
  } catch {
    return value;
  }
}

export function formatRelative(value: string | null) {
  if (!value) return null;
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return null;
  }
}

// ── Platform / status pill helpers 

export function platformIcon(platform: OrmPlatform) {
  if (platform === "linkedin") return <Linkedin className="h-4 w-4" />;
  if (platform === "instagram") return <Instagram className="h-4 w-4" />;
  return <Twitter className="h-4 w-4" />;
}

export function platformPillClass(platform: OrmPlatform) {
  if (platform === "linkedin") return "bg-sky-500/10 text-sky-700 border-sky-500/20";
  if (platform === "instagram") return "bg-pink-500/10 text-pink-700 border-pink-500/20";
  return "bg-slate-500/10 text-slate-700 border-slate-500/20";
}

export function statusPillClass(status: string) {
  if (status === "done" || status === "approved") return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
  if (status === "failed" || status === "rejected") return "bg-rose-500/10 text-rose-700 border-rose-500/20";
  return "bg-amber-500/10 text-amber-700 border-amber-500/20";
}

// ── Data helpers ──────────

export function upsertDigestSummary(list: NewsDigestListItem[], detail: NewsDigestDetail): NewsDigestListItem[] {
  const summary: NewsDigestListItem = {
    id: detail.id,
    user_email: detail.user_email,
    geo: detail.geo,
    status: detail.status,
    story_count: detail.story_count,
    created_at: detail.created_at,
  };

  const existing = list.find((item) => item.id === detail.id);
  if (!existing) return [summary, ...list];
  return list.map((item) => (item.id === detail.id ? summary : item));
}

export function upsertScan(list: OrmScanLog[], scan: OrmScanLog): OrmScanLog[] {
  const existing = list.find((item) => item.id === scan.id);
  if (!existing) return [scan, ...list];
  return list.map((item) => (item.id === scan.id ? scan : item));
}

export function moveSelection<T extends { id: number }>(items: T[], removedId: number) {
  return items.find((item) => item.id !== removedId)?.id ?? null;
}
