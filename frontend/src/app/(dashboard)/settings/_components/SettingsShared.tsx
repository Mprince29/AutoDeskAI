"use client";

import React, { useState } from "react";
import { 
  CheckCircle, XCircle, Info, Zap, Plus, Edit2, Trash2, CheckCircle2, Bot 
} from "lucide-react";
import { 
  SiOpenai, SiAnthropic, SiGoogle, SiMistralai, SiOllama,
  SiSlack, SiNotion, SiTrello, SiDiscord, SiTelegram, SiGithub
} from "react-icons/si";
import { Contact, ContactCreate } from "@/services/api";

// --- Types ---
export type TabType = "profile" | "integrations" | "ai";
export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  message: string;
  type: NotificationType;
}

// --- Constants ---
export const AUTOPILOT_TOGGLES: Array<{
  id: "auto_classify_emails" | "auto_schedule_meetings";
  label: string;
  desc: string;
}> = [
  { id: "auto_classify_emails", label: "Sort My Emails", desc: "Automatically organize incoming emails by priority" },
  { id: "auto_schedule_meetings", label: "Schedule Meetings", desc: "Automatically fix scheduling conflicts in my calendar" },
];

export const PROVIDERS = [
  { value: "openai", label: "OpenAI", sub: "Best overall", icon: <SiOpenai className="w-3.5 h-3.5" style={{ color: '#10A37F' }} />, desc: "Smart and reliable", color: '#10A37F' },
  { value: "anthropic", label: "Claude", sub: "Great for writing", icon: <SiAnthropic className="w-3.5 h-3.5" style={{ color: '#D4702A' }} />, desc: "Better for long responses", color: '#D4702A' },
  { value: "gemini", label: "Google AI", sub: "Handles big data", icon: <SiGoogle className="w-3.5 h-3.5" style={{ color: '#4285F4' }} />, desc: "Good with large inputs", color: '#4285F4' },
  { value: "mistral", label: "Mistral", sub: "Lightweight", icon: <SiMistralai className="w-3.5 h-3.5" style={{ color: '#FF7000' }} />, desc: "Efficient and fast", color: '#FF7000' },
  { value: "deepseek", label: "DeepSeek", sub: "Logical", icon: <Bot className="w-3.5 h-3.5" style={{ color: '#1B6EF3' }} />, desc: "Strong reasoning", color: '#1B6EF3' },
  { value: "ollama", label: "Local AI", sub: "Runs on your device", icon: <SiOllama className="w-3.5 h-3.5" style={{ color: '#919191' }} />, desc: "Private & offline", color: '#919191' },
];

export const getPlatformIcon = (platform: string, size: string = "w-4 h-4") => {
  const p = platform.toLowerCase();
  if (p === "openai") return <SiOpenai className={size} style={{ color: '#10A37F' }} />;
  if (p === "anthropic") return <SiAnthropic className={size} style={{ color: '#D4702A' }} />;
  if (p === "gemini" || p === "google") return <SiGoogle className={size} style={{ color: '#4285F4' }} />;
  if (p === "mistral") return <SiMistralai className={size} style={{ color: '#FF7000' }} />;
  if (p === "deepseek") return <Bot className={size} style={{ color: '#1B6EF3' }} />;
  if (p === "ollama" || p === "local_llm") return <SiOllama className={size} style={{ color: '#919191' }} />;
  if (p === "slack") return <SiSlack className={size} style={{ color: '#4A154B' }} />;
  if (p === "notion") return <SiNotion className={size} />;
  if (p === "trello") return <SiTrello className={size} style={{ color: '#0052CC' }} />;
  if (p === "discord") return <SiDiscord className={size} style={{ color: '#5865F2' }} />;
  if (p === "telegram") return <SiTelegram className={size} style={{ color: '#229ED9' }} />;
  if (p === "github") return <SiGithub className={size} />;
  return <Bot className={size} />;
};

// --- Styles ---
export const CARD: React.CSSProperties = {
  borderRadius: 10, border: '0.5px solid var(--border-light)',
  background: 'var(--surface)', padding: 16,
};

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '0.5px solid var(--border-light)', background: 'var(--background)',
  fontSize: 12, color: 'var(--foreground)', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
};

export const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8, border: 'none',
  background: 'var(--primary)', color: 'white',
  fontSize: 12, fontWeight: 500, cursor: 'pointer',
};

export const btnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8,
  border: '0.5px solid var(--border-light)', background: 'transparent',
  color: 'var(--foreground)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};

export const sectionLabel = (text: string) => (
  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
    {text}
  </p>
);

// --- Shared Components ---

export function NotificationToast({ n, onClose }: { n: Notification; onClose: () => void }) {
  const borderColor = n.type === 'success' ? 'rgba(16,185,129,0.3)' : n.type === 'error' ? 'rgba(248,113,113,0.3)' : n.type === 'warning' ? 'rgba(245,158,11,0.3)' : 'color-mix(in srgb, var(--primary) 30%, transparent)';
  const bgColor = n.type === 'success' ? 'rgba(16,185,129,0.07)' : n.type === 'error' ? 'rgba(248,113,113,0.07)' : n.type === 'warning' ? 'rgba(245,158,11,0.07)' : 'rgba(83,74,183,0.07)';
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 100, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, minWidth: 260, border: `0.5px solid ${borderColor}`, background: bgColor, backdropFilter: 'blur(12px)' }}>
      {n.type === 'success' && <CheckCircle style={{ width: 14, height: 14, color: '#10B981', flexShrink: 0 }} />}
      {n.type === 'error' && <XCircle style={{ width: 14, height: 14, color: '#F87171', flexShrink: 0 }} />}
      {n.type === 'warning' && <Zap style={{ width: 14, height: 14, color: '#F59E0B', flexShrink: 0 }} />}
      {n.type === 'info' && <Info style={{ width: 14, height: 14, color: 'var(--primary)', flexShrink: 0 }} />}
      <span style={{ fontSize: 12, color: 'var(--foreground)', fontWeight: 500 }}>{n.message}</span>
      <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
        <Plus style={{ width: 13, height: 13, transform: 'rotate(45deg)', opacity: 0.5 }} />
      </button>
    </div>
  );
}

export function ContactRow({
  contact, onDelete, onEdit,
  isEditing, editDraft, isSaving, onDraftChange, onSave, onCancel,
}: {
  contact: Contact;
  onDelete: () => void;
  onEdit: () => void;
  isEditing: boolean;
  editDraft: ContactCreate;
  isSaving: boolean;
  onDraftChange: (d: ContactCreate) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  if (isEditing) {
    return (
      <div style={{ padding: '10px 12px', borderRadius: 8, border: '1.5px solid color-mix(in srgb, var(--primary) 35%, transparent)', background: 'color-mix(in srgb, var(--primary) 3%, transparent)' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Edit Contact</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Full Name', key: 'name', type: 'text', placeholder: 'Jane Doe' },
            { label: 'Email', key: 'email', type: 'email', placeholder: 'jane@example.com' },
            { label: 'Nickname', key: 'nickname', type: 'text', placeholder: 'Optional' },
          ].map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500, width: 64, flexShrink: 0 }}>{f.label}</label>
              <input
                type={f.type}
                placeholder={f.placeholder}
                style={{ ...inputStyle, padding: '6px 8px', fontSize: 11 }}
                value={editDraft[f.key as keyof ContactCreate]}
                onChange={e => onDraftChange({ ...editDraft, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={onSave} disabled={isSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: 'none', background: 'var(--primary)', color: 'white', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
            {isSaving ? <span className="animate-spin">◌</span> : <CheckCircle2 style={{ width: 11, height: 11 }} />} Save
          </button>
          <button onClick={onCancel} style={{ padding: '6px 12px', borderRadius: 7, border: '0.5px solid var(--border-light)', background: 'transparent', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', borderRadius: 8,
        border: `0.5px solid ${hovered ? 'color-mix(in srgb, var(--primary) 20%, transparent)' : 'var(--border-light)'}`,
        background: hovered ? 'rgba(83,74,183,0.03)' : 'var(--surface)',
        transition: 'all 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-glow)', border: '0.5px solid color-mix(in srgb, var(--primary) 20%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--primary)', flexShrink: 0 }}>
          {contact.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)' }}>{contact.name}</span>
            {contact.nickname && <span style={{ fontSize: 10, color: 'var(--primary)', background: 'rgba(83,74,183,0.07)', padding: '1px 6px', borderRadius: 99, border: '0.5px solid var(--accent-glow)' }}>@{contact.nickname}</span>}
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{contact.email}</span>
        </div>
      </div>
      {hovered && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={onEdit} style={{ width: 26, height: 26, borderRadius: 6, border: '0.5px solid var(--border-light)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
            <Edit2 style={{ width: 11, height: 11 }} />
          </button>
          <button onClick={onDelete} style={{ width: 26, height: 26, borderRadius: 6, border: '0.5px solid rgba(248,113,113,0.2)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F87171' }}>
            <Trash2 style={{ width: 11, height: 11 }} />
          </button>
        </div>
      )}
    </div>
  );
}
