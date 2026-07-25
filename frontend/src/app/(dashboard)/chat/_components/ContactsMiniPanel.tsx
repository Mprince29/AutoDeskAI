"use client";

import React, { useState } from "react";
import { Search, User, Clock, TrendingUp, MessageSquare, Loader2, Mail, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { proactiveService } from "@/services/proactive.service";
import { RelationshipCard } from "@/types/proactive.types";

const HEALTH_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  green:   { bg: "rgba(16,185,129,0.1)",  text: "#10B981", label: "Healthy" },
  yellow:  { bg: "rgba(245,158,11,0.1)",  text: "#F59E0B", label: "Needs attention" },
  red:     { bg: "rgba(239,68,68,0.1)",   text: "#EF4444", label: "At risk" },
  unknown: { bg: "rgba(148,163,184,0.1)", text: "#94A3B8", label: "No data" },
};

const TONE_LABEL: Record<string, string> = {
  warm:    "Warm",
  neutral: "Neutral",
  cooling: "Cooling off",
  cold:    "Cold",
  unknown: "Unknown",
};

const TONE_COLORS: Record<string, string> = {
  warm:    "#10B981",
  neutral: "#94A3B8",
  cooling: "#F59E0B",
  cold:    "#EF4444",
  unknown: "#94A3B8",
};

export function ContactsMiniPanel({ userEmail }: { userEmail: string }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState<RelationshipCard | null>(null);
  const [error, setError] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(false);
    setCard(null);
    try {
      const res = await proactiveService.getRelationshipIntel(userEmail, query.trim());
      setCard(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const health = HEALTH_COLORS[card?.health ?? "unknown"];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>

      {/* Search */}
      <div style={{ padding: "10px 10px 8px", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 10px", borderRadius: 8,
          border: "0.5px solid var(--border-light)", background: "var(--surface)",
        }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()}
            placeholder="Type a name or email…"
            style={{
              flex: 1, border: "none", background: "transparent", outline: "none",
              fontSize: 12, color: "var(--foreground)", fontFamily: "inherit",
            }}
          />
          <button
            onClick={search}
            disabled={loading || !query.trim()}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
              color: "var(--muted)", display: "flex", opacity: !query.trim() ? 0.4 : 1,
            }}
          >
            {loading
              ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
              : <Search style={{ width: 13, height: 13 }} />}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 5, opacity: 0.6 }}>
          Press Enter to look up relationship history
        </p>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "0 10px 12px" }}>

        {/* Empty / idle state */}
        {!loading && !card && !error && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 48, gap: 8, opacity: 0.45 }}>
            <User style={{ width: 28, height: 28, color: "var(--muted)" }} />
            <span style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", lineHeight: 1.5 }}>
              Search a contact to see your<br />relationship history with them
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.07)", border: "0.5px solid rgba(239,68,68,0.2)", fontSize: 12, color: "#EF4444" }}>
            Could not find relationship data for this contact.
          </div>
        )}

        {/* Relationship card */}
        {card && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>

            {/* Header: name + health */}
            <div style={{
              padding: "10px 12px", borderRadius: 10,
              background: health.bg, border: `0.5px solid ${health.text}30`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{card.name}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>{card.contact_email}</p>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 99,
                background: health.bg, color: health.text,
                border: `0.5px solid ${health.text}40`,
              }}>
                {health.label}
              </span>
            </div>

            {/* Last contact */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "var(--surface)", border: "0.5px solid var(--border-light)" }}>
              <Clock style={{ width: 13, height: 13, color: "var(--muted)", flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 500, color: "var(--foreground)" }}>
                  {card.days_since_contact != null
                    ? card.days_since_contact === 0 ? "Last contact: today"
                    : card.days_since_contact === 1 ? "Last contact: yesterday"
                    : `Last contact: ${card.days_since_contact} days ago`
                    : "No contact on record"}
                </p>
                {card.last_contact_date && (
                  <p style={{ margin: "1px 0 0", fontSize: 10, color: "var(--muted)" }}>
                    {new Date(card.last_contact_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>

            {/* Tone */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "var(--surface)", border: "0.5px solid var(--border-light)" }}>
              <TrendingUp style={{ width: 13, height: 13, color: TONE_COLORS[card.tone_trend] ?? "var(--muted)", flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Relationship tone</p>
                <p style={{ margin: "1px 0 0", fontSize: 12, fontWeight: 600, color: TONE_COLORS[card.tone_trend] ?? "var(--foreground)" }}>
                  {TONE_LABEL[card.tone_trend] ?? card.tone_trend}
                </p>
              </div>
            </div>

            {/* Last email */}
            {card.last_subject && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--surface)", border: "0.5px solid var(--border-light)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                  <Mail style={{ width: 11, height: 11, color: "var(--muted)", flexShrink: 0 }} />
                  <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Last email</p>
                  {card.last_direction === "sent"
                    ? <ArrowUpRight style={{ width: 10, height: 10, color: "#10B981", marginLeft: "auto" }} />
                    : <ArrowDownLeft style={{ width: 10, height: 10, color: "#3B82F6", marginLeft: "auto" }} />
                  }
                  <span style={{ fontSize: 10, color: card.last_direction === "sent" ? "#10B981" : "#3B82F6", fontWeight: 500 }}>
                    {card.last_direction === "sent" ? "You sent" : "They sent"}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "var(--foreground)", lineHeight: 1.4 }}>
                  {card.last_subject}
                </p>
                {card.last_snippet && (
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--muted)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {card.last_snippet}
                  </p>
                )}
              </div>
            )}

            {/* Topics */}
            {card.topics?.length > 0 && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--surface)", border: "0.5px solid var(--border-light)" }}>
                <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--muted)" }}>Recent topics</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {card.topics.slice(0, 5).map(t => (
                    <span key={t} style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 99,
                      background: "var(--background)", border: "0.5px solid var(--border-light)",
                      color: "var(--foreground)",
                    }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested action */}
            {card.suggested_action && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--primary) 5%, transparent)", border: "0.5px solid var(--accent-glow)" }}>
                <p style={{ margin: "0 0 3px", fontSize: 11, color: "var(--primary)", fontWeight: 500 }}>Suggested next step</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--foreground)", lineHeight: 1.5 }}>{card.suggested_action}</p>
              </div>
            )}

            {/* Stats row */}
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { label: "Emails sent", value: card.sent_count },
                { label: "Received", value: card.received_count },
                { label: "Interactions", value: card.total_interactions },
              ].map(s => (
                <div key={s.label} style={{
                  flex: 1, padding: "8px 6px", borderRadius: 8, textAlign: "center",
                  background: "var(--surface)", border: "0.5px solid var(--border-light)",
                }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>{s.value}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--muted)" }}>{s.label}</p>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
