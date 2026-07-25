import React from "react";
import { BarChart2, Search, BookOpen, Zap } from "lucide-react";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL;

export const PERSONAS = [
  { id: "Analytical", icon: <BarChart2 size={13} />, color: "var(--primary)" },
  { id: "Investigative", icon: <Search size={13} />, color: "#2b8a3e" },
  { id: "Narrative", icon: <BookOpen size={13} />, color: "#e67700" },
  { id: "Tabloid", icon: <Zap size={13} />, color: "#d9480f" },
];

export const BRAND_VOICES = [
  { id: "Default", name: "Default AI", description: "Balanced and helpful" },
  { id: "Economist", name: "The Economist", description: "Dry, data-driven, global" },
  { id: "Wired", name: "Wired", description: "Futuristic, fast-paced, high-tech" },
  { id: "TechCrunch", name: "TechCrunch", description: "Snappy, VC-focused, direct" },
  { id: "Professional", name: "Professional", description: "Formal, authoritative, clear" },
  { id: "Minimalist", name: "Minimalist", description: "Brief, concise, essential" },
];

export const LANGUAGES = [
  { id: "English", name: "English", flag: "🇺🇸" },
  { id: "Hindi", name: "Hindi", flag: "🇮🇳" },
  { id: "Marathi", name: "Marathi", flag: "🇮🇳" },
  { id: "Bengali", name: "Bengali", flag: "🇮🇳" },
  { id: "Telugu", name: "Telugu", flag: "🇮🇳" },
  { id: "Tamil", name: "Tamil", flag: "🇮🇳" },
  { id: "Gujarati", name: "Gujarati", flag: "🇮🇳" },
  { id: "Kannada", name: "Kannada", flag: "🇮🇳" },
  { id: "Malayalam", name: "Malayalam", flag: "🇮🇳" },
  { id: "Punjabi", name: "Punjabi", flag: "🇮🇳" },
  { id: "Spanish", name: "Spanish", flag: "🇪🇸" },
  { id: "French", name: "French", flag: "🇫🇷" },
  { id: "German", name: "German", flag: "🇩🇪" },
  { id: "Chinese", name: "Chinese", flag: "🇨🇳" },
  { id: "Japanese", name: "Japanese", flag: "🇯🇵" },
];
