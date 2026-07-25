"use client";

import { useEffect, useState, useCallback } from "react";
import { Sliders, CheckCircle2 } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LLMControls {
  creativity: number;   // 1–5  → temperature 0.0–1.0
  length: number;       // 1–5  → max_tokens 512–8192
  focus: number;        // 1–5  → top_p 0.7–1.0
}

const DEFAULT: LLMControls = { creativity: 3, length: 3, focus: 3 };
const LS_KEY = "mc_llm_controls";

// ── Mapping helpers ────────────────────────────────────────────────────────────

export function llmControlsToParams(c: LLMControls) {
  const tempMap = [0.0, 0.25, 0.5, 0.75, 1.0];
  const tokenMap = [512, 1024, 2048, 4096, 8192];
  const topPMap = [0.7, 0.8, 0.9, 0.95, 1.0];
  return {
    temperature: tempMap[c.creativity - 1],
    max_tokens: tokenMap[c.length - 1],
    top_p: topPMap[c.focus - 1],
  };
}

export function loadLLMControls(): LLMControls {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT;
}

// ── Slider config ──────────────────────────────────────────────────────────────

const PRESETS = [
  { id: "factual", label: "🎯 Factual", creativity: 1, length: 2, focus: 1, desc: "Direct, precise, and concise." },
  { id: "balanced", label: "⚖️ Balanced", creativity: 3, length: 3, focus: 3, desc: "Natural flow with helpful context." },
  { id: "creative", label: "✨ Creative", creativity: 5, length: 4, focus: 5, desc: "Expressive, detailed, and exploratory." },
];

const SLIDERS = [
  {
    key: "creativity" as keyof LLMControls,
    title: "Answer Style",
    titleIcon: "✨",
    subtitle: "Precise ↔ Creative",
    steps: [
      { label: "Precise", hint: "Exact same answer every time." },
      { label: "Mostly Precise", hint: "Reliable with small variation." },
      { label: "Natural", hint: "Natural flow with fresh phrasing." },
      { label: "Expressive", hint: "More variety in expression." },
      { label: "Creative", hint: "Freely explores creative ideas." },
    ],
  },
  {
    key: "length" as keyof LLMControls,
    title: "Response Length",
    titleIcon: "📏",
    subtitle: "Short ↔ Detailed",
    steps: [
      { label: "Quick", hint: "One or two sentences." },
      { label: "Brief", hint: "Short, clear paragraph." },
      { label: "Medium", hint: "Good detail, balanced length." },
      { label: "Detailed", hint: "Thorough response." },
      { label: "Comprehensive", hint: "Full deep-dive response." },
    ],
  },
  {
    key: "focus" as keyof LLMControls,
    title: "Topic Focus",
    titleIcon: "🎯",
    subtitle: "Narrow ↔ Broad",
    steps: [
      { label: "Laser Focus", hint: "Strictly stays on question." },
      { label: "Mostly Focused", hint: "Adds a bit of context." },
      { label: "Balanced", hint: "Brings in related context." },
      { label: "Exploratory", hint: "Explores related ideas." },
      { label: "Wide Broad", hint: "Broad, wide-ranging context." },
    ],
  },
];

// ── Preview sentence generator ─────────────────────────────────────────────────

function getPreviewSentence(c: LLMControls): string {
  const styles = ["precise and consistent", "mostly precise", "balanced", "varied and expressive", "creative and exploratory"];
  const lengths = ["very short", "brief", "medium-length", "detailed", "comprehensive"];
  const focuses = ["strictly on-topic", "mostly on-topic", "with helpful context", "exploratory", "broadly connected"];
  return `Your AI will give ${styles[c.creativity - 1]}, ${lengths[c.length - 1]} answers that stay ${focuses[c.focus - 1]}.`;
}

// ── Cost impact label ──────────────────────────────────────────────────────────

function getCostLabel(c: LLMControls): { label: string; color: string } {
  const score = c.length + (c.creativity > 3 ? 1 : 0);
  if (score <= 3) return { label: "Low credit usage", color: "#10B981" };
  if (score <= 5) return { label: "Moderate credit usage", color: "#F59E0B" };
  return { label: "Higher credit usage", color: "#F87171" };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  userEmail: string;
}

export default function AIResponseControls({ userEmail }: Props) {
  const [controls, setControls] = useState<LLMControls>(DEFAULT);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setControls(loadLLMControls());
  }, []);

  const persist = useCallback(async (next: LLMControls) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/llm-controls?email=${encodeURIComponent(userEmail)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ llm_controls: next }),
      });
    } catch { /* non-blocking - localStorage is the source of truth */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [userEmail]);

  const handleChange = (key: keyof LLMControls, value: number) => {
    const next = { ...controls, [key]: value };
    setControls(next);
    persist(next);
  };

  const cost = getCostLabel(controls);
  const preview = getPreviewSentence(controls);
  const params = llmControlsToParams(controls);

  const applyPreset = (p: typeof PRESETS[0]) => {
    const next = { creativity: p.creativity, length: p.length, focus: p.focus };
    setControls(next);
    persist(next);
  };

  const currentPresetId = PRESETS.find(p => p.creativity === controls.creativity && p.length === controls.length && p.focus === controls.focus)?.id;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Main Unified Card */}
      <div style={{
        borderRadius: 20,
        border: "1px solid var(--border-light)",
        background: "var(--surface)",
        padding: "24px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
        position: "relative",
        overflow: "hidden"
      }}>
        {/* Background glow effect */}
        <div style={{
          position: "absolute", top: -100, right: -100, width: 300, height: 300,
          background: "radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)",
          opacity: 0.4, pointerEvents: "none"
        }} />

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--primary-glow)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sliders style={{ width: 16, height: 16, color: "var(--primary)" }} />
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
                Model Personality
              </p>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>Tune how your AI generates responses</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saved && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "#10B981", display: "flex", alignItems: "center", gap: 4 }}>
                <CheckCircle2 style={{ width: 12, height: 12 }} /> Synced
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 700, color: cost.color,
              background: cost.color + "10", padding: "4px 10px", borderRadius: 99,
              border: `1px solid ${cost.color}20`
            }}>
              {cost.label}
            </span>
          </div>
        </div>

        {/* Presets Bar */}
        <div style={{ 
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, 
          marginBottom: 32, padding: 4, background: "var(--background)", 
          borderRadius: 14, border: "0.5px solid var(--border-light)" 
        }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              style={{
                padding: "10px 8px", borderRadius: 10, border: "none",
                background: currentPresetId === p.id ? "var(--primary)" : "transparent",
                color: currentPresetId === p.id ? "white" : "var(--muted)",
                cursor: "pointer", transition: "all 0.2s",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>{p.label}</span>
              <span style={{ fontSize: 9, opacity: 0.8, fontWeight: 500 }}>{p.desc}</span>
            </button>
          ))}
        </div>

        {/* Technical Preview */}
        <div style={{ 
          marginBottom: 32, padding: "16px", borderRadius: 12, 
          background: "color-mix(in srgb, var(--primary) 3%, transparent)", 
          border: "1px solid color-mix(in srgb, var(--primary) 10%, transparent)",
          position: "relative"
        }}>
          <div style={{ position: "absolute", top: -8, left: 16, background: "var(--surface)", padding: "0 8px", fontSize: 9, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase" }}>
            Live Status
          </div>
          <p style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500, margin: 0, lineHeight: 1.5 }}>
            {preview}
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 12, borderTop: "0.5px solid color-mix(in srgb, var(--primary) 10%, transparent)", paddingTop: 10 }}>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Temp: <strong style={{ color: "var(--primary)" }}>{params.temperature}</strong></span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Tokens: <strong style={{ color: "var(--primary)" }}>{params.max_tokens}</strong></span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Top-P: <strong style={{ color: "var(--primary)" }}>{params.top_p}</strong></span>
          </div>
        </div>

        {/* Sliders Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: 24 }}>
          {SLIDERS.map(slider => {
            const val = controls[slider.key];
            const step = slider.steps[val - 1];
            return (
              <div key={slider.key}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{slider.titleIcon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>{slider.title}</span>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--primary)", background: "var(--primary-glow)", padding: "2px 8px", borderRadius: 6 }}>
                    {step.label}
                  </span>
                </div>

                <div style={{ position: "relative", height: 24, display: "flex", alignItems: "center" }}>
                  {/* Modern Segmented Track */}
                  <div style={{ position: "absolute", left: 0, right: 0, height: 6, background: "var(--background)", borderRadius: 10, border: "0.5px solid var(--border-light)", display: "flex" }}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{ flex: 1, borderRight: "1px solid var(--border-light)", opacity: 0.3 }} />
                    ))}
                  </div>
                  {/* Active Fill */}
                  <div style={{ 
                    position: "absolute", left: 0, height: 6, 
                    width: `${((val - 1) / 4) * 100}%`, 
                    background: "var(--primary)", borderRadius: 10,
                    transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                  }} />
                  {/* Thumb */}
                  <div style={{ 
                    position: "absolute", 
                    left: `calc(${((val - 1) / 4) * 100}% - 9px)`, 
                    width: 18, height: 18, background: "white", 
                    border: "3px solid var(--primary)", borderRadius: "50%",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                    transition: "left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    zIndex: 2
                  }} />
                  <input
                    type="range" min={1} max={5} step={1}
                    value={val}
                    onChange={e => handleChange(slider.key, Number(e.target.value))}
                    style={{ position: "absolute", width: "100%", opacity: 0, cursor: "pointer", height: 24, zIndex: 3 }}
                  />
                </div>
                <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 8 }}>{step.hint}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
