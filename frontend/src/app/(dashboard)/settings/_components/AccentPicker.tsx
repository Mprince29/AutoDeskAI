"use client";

import { useAccent, ACCENT_PALETTES } from "@/context/AccentContext";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function AccentPicker() {
  const { accent, setAccent } = useAccent();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <div id="accent-picker-section" style={{
      borderRadius: 16,
      border: "0.5px solid var(--border-light)",
      background: "var(--surface)",
      padding: "18px 20px",
    }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 3px" }}>
          Accent Colour
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          Choose the colour that runs through your workspace
        </p>
      </div>

      {/* Palette grid */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
        {ACCENT_PALETTES.map(p => {
          const active = accent === p.key;
          const swatch = isDark ? p.dark : p.light;
          return (
            <button
              key={p.key}
              onClick={() => setAccent(p.key)}
              className="transition-all duration-150"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 8px", borderRadius: 8, cursor: "pointer",
                textAlign: "left", flexShrink: 0,
                border: active ? `1.5px solid ${swatch}` : "0.5px solid var(--border-light)",
                background: active ? `${swatch}10` : "var(--background)",
                boxShadow: active ? `0 2px 10px ${swatch}20` : "none",
              }}
            >
              {/* Swatch dot */}
              <div style={{
                width: 25, height: 25, borderRadius: "50%", flexShrink: 0,
                background: swatch,
                boxShadow: active ? `0 0 0 2px ${swatch}30` : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {active && <CheckCircle2 style={{ width: 8, height: 8, color: "#fff" }} />}
              </div>

              {/* Label */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: active ? swatch : "var(--foreground)", margin: "0 0 1px", whiteSpace: "nowrap" }}>
                  {p.label}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Live preview strip */}
      <div style={{
        marginTop: 14, padding: "10px 14px", borderRadius: 9,
        background: "var(--background)", border: "0.5px solid var(--border-light)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ display: "flex", gap: 5 }}>
          {["var(--primary)", `${isDark ? ACCENT_PALETTES.find(p=>p.key===accent)?.dark : ACCENT_PALETTES.find(p=>p.key===accent)?.light}30`, "var(--border-light)"].map((bg, i) => (
            <div key={i} style={{ width: i === 0 ? 28 : 18, height: 8, borderRadius: 99, background: bg, transition: "background 0.2s" }} />
          ))}
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
          Colour applied across buttons, highlights, and active states
        </p>
      </div>
    </div>
  );
}
