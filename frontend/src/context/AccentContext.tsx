"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type AccentKey = "violet" | "ocean" | "emerald" | "rose" | "amber" | "cyan" | "slate" | "indigo" | "teal" | "midnight" | "forest" | "burgundy" | "olive" | "gold" | "navy" | "charcoal";

export const ACCENT_PALETTES: Array<{
  key: AccentKey;
  label: string;
  light: string;   // preview swatch colour
  dark: string;
  description: string;
}> = [
    { key: "violet", label: "Violet", light: "#534AB7", dark: "#7c5ddb", description: "Default - calm and focused" },
    { key: "ocean", label: "Ocean", light: "#2563eb", dark: "#3b82f6", description: "Confident and trustworthy" },
    { key: "teal", label: "Teal", light: "#0f766e", dark: "#2dd4bf", description: "Modern and balanced" },
    { key: "emerald", label: "Emerald", light: "#059669", dark: "#10b981", description: "Fresh and growth-oriented" },
    { key: "forest", label: "Forest", light: "#166534", dark: "#4ade80", description: "Strong and natural" },
    { key: "amber", label: "Amber", light: "#d97706", dark: "#f59e0b", description: "Warm and creative" },
    { key: "rose", label: "Rose", light: "#e11d48", dark: "#f43f5e", description: "Bold and energetic" },
    { key: "cyan", label: "Cyan", light: "#0891b2", dark: "#06b6d4", description: "Clear and modern" },
    { key: "slate", label: "Slate", light: "#475569", dark: "#94a3b8", description: "Neutral and minimal" },
    { key: "burgundy", label: "Burgundy", light: "#7f1d1d", dark: "#dc2626", description: "Classic and prestigious" },
    { key: "olive", label: "Olive", light: "#3f6212", dark: "#84cc16", description: "Earthy and organic" },
    { key: "navy", label: "Navy", light: "#172554", dark: "#3b82f6", description: "Authoritative and solid" },
    { key: "charcoal", label: "Charcoal", light: "#171717", dark: "#525252", description: "Sharp and executive" },
  ];

const LS_KEY = "mc_accent";

interface AccentContextValue {
  accent: AccentKey;
  setAccent: (key: AccentKey) => void;
}

const AccentContext = createContext<AccentContextValue>({
  accent: "violet",
  setAccent: () => { },
});

export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<AccentKey>("violet");

  useEffect(() => {
    const saved = (localStorage.getItem(LS_KEY) as AccentKey) || "violet";
    applyAccent(saved);
    setAccentState(saved);
  }, []);

  const setAccent = (key: AccentKey) => {
    applyAccent(key);
    setAccentState(key);
    localStorage.setItem(LS_KEY, key);
  };

  return (
    <AccentContext.Provider value={{ accent, setAccent }}>
      {children}
    </AccentContext.Provider>
  );
}

function applyAccent(key: AccentKey) {
  const el = document.documentElement;
  if (key === "violet") {
    el.removeAttribute("data-accent");
  } else {
    el.setAttribute("data-accent", key);
  }
}

export function useAccent() {
  return useContext(AccentContext);
}
