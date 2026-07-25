"use client";

/**
 * Token usage widget for the AI Settings tab.
 * - Shows today's cost in USD, EUR, GBP, INR.
 * - User can set a daily limit in tokens OR money (USD).
 * - When limit is exceeded a popup alert fires (once per day).
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Edit2, Settings2, X, Zap } from "lucide-react";

// FX rates vs USD (live rates, April 2026)
const FX: Record<string, number> = {
  EUR: 0.88, GBP: 0.76, INR: 94.2, AED: 3.67, SGD: 1.35,
  CAD: 1.38, AUD: 1.56, JPY: 142.0, CNY: 7.26, BRL: 5.72, MXN: 19.8,
};

// Blended input+output cost per 1M tokens (USD, ~60% input / 40% output).
// Sources: official pricing pages, April 2026.
const MODEL_PRICE_PER_1M: Array<[string, number]> = [
  ["gpt-4o", 5.50],        // $2.50 in + $10 out
  ["gpt-4o-mini", 0.22],   // $0.15 in + $0.60 out
  ["gpt-4.1", 4.40],       // $2 in + $8 out
  ["gpt-4.1-mini", 0.28],  // $0.40 in + $1.60 out
  ["gpt-4.1-nano", 0.08],  // $0.10 in + $0.40 out
  ["o3", 30.00],
  ["o4-mini", 3.00],
  ["o3-mini", 2.75],
  ["o1", 37.50],
  ["claude-opus-4", 13.00],  // $5 in + $25 out (claude-opus-4 / opus-4.7)
  ["claude-sonnet-4", 7.80], // $3 in + $15 out
  ["claude-haiku-4", 2.60],  // $1 in + $5 out
  ["claude-3-7-sonnet", 7.50],
  ["claude-3-5-sonnet", 7.50],
  ["claude-3-5-haiku", 1.80],
  ["claude-3-opus", 45.00],
  ["gemini-2.5-pro", 8.50],   // $1.25 in + $10 out (>200k ctx)
  ["gemini-2.5-flash", 1.18], // $0.30 in + $2.50 out
  ["gemini-2.0-flash", 0.28], // $0.10 in + $0.40 out
  ["gemini-1.5-pro", 2.50],
  ["gemini-1.5-flash", 0.15],
  ["mistral-large", 4.00],
  ["mistral-medium", 1.50],
  ["mistral-small", 0.30],
  ["mistral-nemo", 0.15],
  ["deepseek-reasoner", 2.00],
  ["deepseek-chat", 0.28],
  ["llama-3.3-70b", 0.59],
  ["llama-3.1-8b", 0.08],
];

const DEFAULT_PRICE_PER_1M = 1.18; // matches gemini-2.5-flash (primary model)

function normalizeModelName(model: string): string {
  return model
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/^(openai|anthropic|google|gemini|mistral|groq|deepseek|meta|cohere|openrouter\/[^/]+)\//, "");
}

function getPricePer1M(model: string): number {
  const key = normalizeModelName(model);
  for (const [name, price] of MODEL_PRICE_PER_1M) {
    if (key.includes(name.toLowerCase())) return price;
  }
  return DEFAULT_PRICE_PER_1M;
}

interface TokenLog { ts: number; tokens: number; model: string; }
interface BudgetConfig { type: "money" | "tokens"; value: number; }

const BUDGET_KEY = "mc_budget_config";
const ALERT_KEY = "mc_budget_alert_date";
const DEFAULT_BUDGET: BudgetConfig = { type: "money", value: 1.00 };

function readLog(): TokenLog[] {
  try { return JSON.parse(localStorage.getItem("mc_token_log") || "[]"); } catch { return []; }
}
function readBudget(): BudgetConfig {
  try {
    const b = JSON.parse(localStorage.getItem(BUDGET_KEY) || "null");
    if (!b || typeof b.value !== "number" || isNaN(b.value)) return DEFAULT_BUDGET;
    return b;
  } catch { return DEFAULT_BUDGET; }
}
function saveBudget(b: BudgetConfig) {
  try { localStorage.setItem(BUDGET_KEY, JSON.stringify(b)); } catch { /* ignore */ }
}

function todayEntries(log: TokenLog[]): TokenLog[] {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  return log.filter(e => e.ts >= midnight.getTime());
}
function calcCostUsd(entries: TokenLog[]): number {
  return entries.reduce((sum, e) => sum + (e.tokens / 1_000_000) * getPricePer1M(e.model), 0);
}
function topModels(entries: TokenLog[]): { model: string; usd: number }[] {
  const map: Record<string, number> = {};
  entries.forEach(e => { map[e.model] = (map[e.model] || 0) + (e.tokens / 1_000_000) * getPricePer1M(e.model); });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([model, usd]) => ({ model, usd }));
}
function fmtCost(usd: number, rate: number, symbol: string): string {
  const v = usd * rate;
  if (v < 0.001) return `${symbol}0.00`;
  if (v < 0.01) return `${symbol}${v.toFixed(4)}`;
  if (v < 1) return `${symbol}${v.toFixed(3)}`;
  return `${symbol}${v.toFixed(2)}`;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

export function appendTokenLog(tokens: number, model: string) {
  try {
    const log: TokenLog[] = JSON.parse(localStorage.getItem("mc_token_log") || "[]");
    log.push({ ts: Date.now(), tokens, model });
    localStorage.setItem("mc_token_log", JSON.stringify(log.slice(-500)));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mc_usage_updated"));
    }
  } catch { /* ignore */ }
}

const PREFERRED_CURRENCY_KEY = "mc_preferred_currency";

export default function CostWidget() {
  const [log, setLog] = useState<TokenLog[]>([]);
  const [budget, setBudget] = useState<BudgetConfig>(DEFAULT_BUDGET);
  const [editing, setEditing] = useState(false);
  const [limitAlert, setLimitAlert] = useState(false);
  const [preferredCurrency, setPreferredCurrency] = useState<string>("USD");
  const alertFiredRef = useRef(false);

  useEffect(() => {
    const loadData = () => {
      setLog(readLog());
      setBudget(readBudget());
      try {
        const saved = localStorage.getItem(PREFERRED_CURRENCY_KEY);
        if (saved && (saved === "USD" || FX[saved] !== undefined)) {
          setPreferredCurrency(saved);
        }
      } catch { /* ignore */ }
    };
    loadData();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "mc_token_log" || e.key === BUDGET_KEY || e.key === PREFERRED_CURRENCY_KEY) loadData();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("mc_usage_updated", loadData);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("mc_usage_updated", loadData);
    };
  }, []);

  const entries = todayEntries(log);
  const totalTokens = entries.reduce((s, e) => s + e.tokens, 0);
  const costUsd = calcCostUsd(entries);
  const models = topModels(entries);

  // Compute effective price/1M based on what models were actually used today
  const effectivePricePer1M = entries.length > 0
    ? costUsd / (totalTokens / 1_000_000 || 1)
    : DEFAULT_PRICE_PER_1M;

  // Compute % against user's chosen limit
  const usedValue = budget.type === "money" ? costUsd : totalTokens;
  const pct = budget.value > 0 ? Math.min((usedValue / budget.value) * 100, 100) : 0;
  const barColor = pct >= 100 ? "#F87171" : pct > 75 ? "#FBBF24" : "#10B981";

  // Fire limit-reached popup once per calendar day
  useEffect(() => {
    if (alertFiredRef.current) return;
    if (pct >= 100) {
      const today = todayStr();
      const lastFired = localStorage.getItem(ALERT_KEY);
      if (lastFired !== today) {
        alertFiredRef.current = true;
        setLimitAlert(true);
        localStorage.setItem(ALERT_KEY, today);
      }
    }
  }, [pct]);

  // draftDisplay holds the value in preferred currency (for the input field).
  // On save we convert back to USD before storing.
  const [draftDisplay, setDraftDisplay] = useState<number>(1);

  const openEdit = () => {
    const rate = currencies.find(c => c.label === preferredCurrency)?.rate ?? 1;
    setDraftDisplay(parseFloat((budget.value * rate).toFixed(4)));

    setEditing(true);
  };
  const saveEdit = () => {
    const rate = currencies.find(c => c.label === preferredCurrency)?.rate ?? 1;
    const usdValue = Math.max(0.001, (Number(draftDisplay) || 0.001) / rate);
    const b: BudgetConfig = { type: "money", value: usdValue };
    setBudget(b);
    saveBudget(b);
    setEditing(false);
    alertFiredRef.current = false;
  };
  
  const saveCurrencyPreference = (currency: string) => {
    setPreferredCurrency(currency);
    try { localStorage.setItem(PREFERRED_CURRENCY_KEY, currency); } catch { /* ignore */ }
  };

  const currencies = [
    { label: "USD", symbol: "$",  rate: 1 },
    { label: "EUR", symbol: "€",  rate: FX.EUR },
    { label: "GBP", symbol: "£",  rate: FX.GBP },
    { label: "INR", symbol: "₹",  rate: FX.INR },
    { label: "AED", symbol: "د.إ",rate: FX.AED },
    { label: "SGD", symbol: "S$", rate: FX.SGD },
    { label: "CAD", symbol: "C$", rate: FX.CAD },
    { label: "AUD", symbol: "A$", rate: FX.AUD },
    { label: "JPY", symbol: "¥",  rate: FX.JPY },
    { label: "CNY", symbol: "¥",  rate: FX.CNY },
    { label: "BRL", symbol: "R$", rate: FX.BRL },
    { label: "MXN", symbol: "MX$",rate: FX.MXN },
  ];

  // Resolve preferred currency info for display
  const currInfo = currencies.find(c => c.label === preferredCurrency) ?? currencies[0];

  // Budget is always stored in USD internally. Convert to preferred currency for display.
  const limitLabel = budget.type === "money"
    ? fmtCost(budget.value, currInfo.rate, currInfo.symbol)
    : `${budget.value.toLocaleString()} tokens`;

  const usedLabel = budget.type === "money"
    ? fmtCost(costUsd, currInfo.rate, currInfo.symbol)
    : totalTokens.toLocaleString();

  return (
    <>
      {/* ── Limit-reached popup ─────────────────────────────────────────────── */}
      {limitAlert && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
        }}>
          <div style={{
            background: "var(--background)", borderRadius: 14,
            border: "0.5px solid rgba(248,113,113,0.35)",
            padding: "28px 28px 24px",
            maxWidth: 360, width: "90%",
            boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "0.5px solid rgba(248,113,113,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <AlertTriangle size={18} style={{ color: "#F87171" }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>Daily limit reached</p>
                  <p style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 0" }}>Your usage cap for today has been hit</p>
                </div>
              </div>
              <button onClick={() => setLimitAlert(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2, flexShrink: 0 }}>
                <X size={15} />
              </button>
            </div>

            <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(248,113,113,0.05)", border: "0.5px solid rgba(248,113,113,0.2)" }}>
              <p style={{ fontSize: 12, color: "var(--foreground)", margin: 0, lineHeight: 1.6 }}>
                You&apos;ve used <strong>{usedLabel}</strong> out of your <strong>{limitLabel}</strong> daily limit.
                New AI tasks may cost extra beyond your cap.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setLimitAlert(false); openEdit(); }}
                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: "var(--primary)", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Raise my limit
              </button>
              <button
                onClick={() => setLimitAlert(false)}
                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "0.5px solid var(--border-light)", background: "transparent", color: "var(--foreground)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main widget ─────────────────────────────────────────────────────── */}
      <div style={{ 
        display: "flex", flexDirection: "column", gap: 20, padding: "24px", 
        borderRadius: 20, border: "1px solid var(--border-light)", 
        background: "var(--surface)", boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
        position: "relative", overflow: "hidden"
      }}>
        {/* Decorative background element */}
        <div style={{
          position: "absolute", top: -50, left: -50, width: 200, height: 200,
          background: `radial-gradient(circle, ${barColor}10 0%, transparent 70%)`,
          opacity: 0.5, pointerEvents: "none"
        }} />

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ 
              width: 32, height: 32, borderRadius: 10, background: `${barColor}15`, 
              display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${barColor}30` 
            }}>
              <Zap size={16} style={{ color: barColor }} />
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Usage Overview</span>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>Daily resource tracking</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ background: "var(--background)", padding: "4px 10px", borderRadius: 8, border: "0.5px solid var(--border-light)" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>{totalTokens.toLocaleString()} tokens</span>
            </div>
            <button onClick={openEdit} title="Set daily limit" style={{ background: "var(--surface)", border: "0.5px solid var(--border-light)", borderRadius: 8, cursor: "pointer", color: "var(--muted)", display: "flex", alignItems: "center", padding: 6, transition: "all 0.2s" }}>
              <Settings2 size={14} />
            </button>
          </div>
        </div>

        {/* Big Spend Tile */}
        <div style={{ 
          display: "flex", alignItems: "center", justifyContent: "space-between", 
          padding: "20px", borderRadius: 16, 
          background: "linear-gradient(135deg, var(--background) 0%, color-mix(in srgb, var(--primary) 5%, var(--background)) 100%)", 
          border: "1px solid var(--border-light)",
          position: "relative"
        }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Total Spent Today</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: "var(--foreground)", letterSpacing: "-0.02em" }}>
                {fmtCost(costUsd, currInfo.rate, currInfo.symbol)}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>{currInfo.label}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
             <div style={{ fontSize: 11, fontWeight: 600, color: barColor, background: `${barColor}15`, padding: "4px 12px", borderRadius: 20, border: `1px solid ${barColor}25` }}>
                {pct.toFixed(0)}% used
             </div>
          </div>
        </div>

        {/* Progress bar vs user limit */}
        <div style={{ background: "var(--background)", padding: "16px", borderRadius: 14, border: "0.5px solid var(--border-light)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Daily Budget</span>
              <span style={{ fontSize: 11, color: "var(--foreground)", fontWeight: 600 }}>
                 {limitLabel} <span style={{ opacity: 0.5, fontWeight: 400 }}>≈ {Math.floor((budget.value / effectivePricePer1M) * 1_000_000).toLocaleString()} tokens</span>
              </span>
            </div>
            <span style={{ fontSize: 11, color: pct >= 100 ? "#F87171" : "var(--muted)", fontWeight: 700 }}>
              {usedLabel} Used
            </span>
          </div>
          
          <div style={{ height: 8, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border-light)", overflow: "hidden", position: "relative" }}>
            <div style={{ 
              height: "100%", width: `${pct}%`, borderRadius: 10, 
              background: `linear-gradient(90deg, ${barColor} 0%, color-mix(in srgb, ${barColor} 80%, white) 100%)`, 
              transition: "width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
              boxShadow: `0 0 10px ${barColor}40`
            }} />
          </div>
          
          {pct >= 100 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <AlertTriangle size={12} style={{ color: "#F87171" }} />
              <p style={{ fontSize: 10, color: "#F87171", margin: 0, fontWeight: 600 }}>Usage cap reached for today</p>
            </div>
          )}
        </div>

        {/* Per-model cost breakdown */}
        {models.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Model Breakdown</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {models.map(m => (
                <div key={m.model} style={{ 
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 10, fontWeight: 600, color: "var(--foreground)", 
                  background: "var(--background)", padding: "6px 12px", 
                  borderRadius: 10, border: "0.5px solid var(--border-light)" 
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--primary)" }} />
                  <span>{m.model.split("/").pop()}</span>
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>·</span>
                  <span style={{ color: "var(--primary)" }}>{fmtCost(m.usd, currInfo.rate, currInfo.symbol)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "10px 0", borderTop: "0.5px solid var(--border-light)" }}>
             <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>No usage yet today - start a task to see your spend.</p>
          </div>
        )}
      </div>

      {/* ── Edit limit drawer ───────────────────────────────────────────────── */}
      {editing && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
        }}>
          <div style={{
            background: "var(--background)", borderRadius: 14,
            border: "0.5px solid var(--border-light)",
            padding: "24px", maxWidth: 340, width: "90%",
            boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
            display: "flex", flexDirection: "column", gap: 18,
          }}>
            {/* Title */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Edit2 size={14} style={{ color: "var(--primary)" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>Set Daily Limit</span>
              </div>
              <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>
                <X size={14} />
              </button>
            </div>

            {/* Limit type toggle */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Preferred Currency</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {currencies.map(c => (
                  <button
                    key={c.label}
                    onClick={() => {
                      // Reconvert draftDisplay through USD into the new currency
                      const usd = draftDisplay / currInfo.rate;
                      const converted = usd * c.rate;
                      setDraftDisplay(parseFloat(converted.toFixed(c.rate >= 10 ? 0 : 2)));
                      saveCurrencyPreference(c.label);
                    }}
                    style={{
                      padding: "5px 10px", borderRadius: 6, border: preferredCurrency === c.label ? "1px solid var(--primary)" : "0.5px solid var(--border-light)", cursor: "pointer",
                      fontSize: 11, fontWeight: preferredCurrency === c.label ? 700 : 400,
                      background: preferredCurrency === c.label ? "var(--primary-glow)" : "var(--surface)",
                      color: preferredCurrency === c.label ? "var(--primary)" : "var(--muted)",
                      transition: "all 0.12s",
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Value input */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Amount in {preferredCurrency} ({currInfo.symbol})
              </p>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--muted)", fontWeight: 600, pointerEvents: "none" }}>
                  {currInfo.symbol}
                </span>
                <input
                  type="number"
                  min={0.01}
                  step={currInfo.rate >= 10 ? 10 : 0.5}
                  value={draftDisplay}
                  onChange={e => setDraftDisplay(parseFloat(e.target.value) || 0)}
                  style={{
                    width: "100%", padding: "9px 10px 9px 26px",
                    borderRadius: 8, border: "0.5px solid var(--border-light)",
                    background: "var(--background)", fontSize: 14, fontWeight: 600,
                    color: "var(--foreground)", outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
              <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>
                ≈ {Math.floor(((draftDisplay / currInfo.rate) / DEFAULT_PRICE_PER_1M) * 1_000_000).toLocaleString()} tokens at avg pricing
              </p>
              {/* Quick preset chips — values in preferred currency */}
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {([0.50, 1, 2, 5, 10].map(usd => parseFloat((usd * currInfo.rate).toFixed(usd * currInfo.rate >= 10 ? 0 : 2)))).map(v => (
                  <button
                    key={v}
                    onClick={() => setDraftDisplay(v)}
                    style={{
                      padding: "3px 10px", borderRadius: 99, fontSize: 11, cursor: "pointer",
                      border: draftDisplay === v ? "1px solid var(--primary)" : "0.5px solid var(--border-light)",
                      background: draftDisplay === v ? "var(--primary-glow)" : "var(--surface)",
                      color: draftDisplay === v ? "var(--primary)" : "var(--muted)",
                      fontWeight: draftDisplay === v ? 600 : 400,
                    }}
                  >
                    {currInfo.symbol}{v}
                  </button>
                ))}
              </div>
            </div>

            {/* Save */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveEdit} style={{ flex: 2, padding: "9px 0", borderRadius: 8, border: "none", background: "var(--primary)", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Save limit
              </button>
              <button onClick={() => setEditing(false)} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "0.5px solid var(--border-light)", background: "transparent", color: "var(--foreground)", fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
