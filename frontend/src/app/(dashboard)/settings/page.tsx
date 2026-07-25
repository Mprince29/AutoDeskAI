"use client";

import { useAuth } from "@/context/AuthContext";
import { apiService, Contact, ContactCreate } from "@/services/api";
import { getRecommendedTimezone, SUPPORTED_TIMEZONES } from "@/utils/timezoneUtils";
import { Globe, Users, Plus, Edit2, Loader2, Sparkles, CheckCircle2, Bot } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import AccentPicker from "./_components/AccentPicker";
import { useOnboarding } from "@/hooks/useOnboarding";
import {
  CARD, sectionLabel, inputStyle, btnPrimary, btnSecondary,
  AUTOPILOT_TOGGLES, Notification, NotificationType, NotificationToast, ContactRow
} from "./_components/SettingsShared";
import { ProactiveSettings } from "./_components/ProactiveSettings";
import { ConfirmationModal } from "@/components/shared/ConfirmationModal";

const PERSONALITY_OPTIONS: Record<string, {
  label: string;
  subtitle: string;
  choices: { value: string; emoji: string; title: string; desc: string }[]
}> = {
  tone: {
    label: 'Communication Voice',
    subtitle: 'How your AI speaks and frames ideas',
    choices: [
      { value: 'analytical', emoji: '📊', title: 'Analytical', desc: 'Objective, evidence-based, breaks down complexity with precision' },
      { value: 'executive', emoji: '🏢', title: 'Executive', desc: 'High-level, strategic, bottom-line focused - built for decision-makers' },
      { value: 'consultative', emoji: '🤝', title: 'Consultative', desc: 'Advises with context, surfaces trade-offs, guides toward decisions' },
      { value: 'direct', emoji: '⚡', title: 'Direct', desc: 'No filler. Clear, confident statements and action-oriented language' },
    ],
  },
  length: {
    label: 'Response Structure',
    subtitle: 'How answers are organised and delivered',
    choices: [
      { value: 'concise', emoji: '✦', title: 'Bullet-First', desc: 'Key points up front, scannable lists, minimal prose' },
      { value: 'balanced', emoji: '▤', title: 'Structured Hybrid', desc: 'Short intro → bullets → brief context. Best for most tasks' },
      { value: 'detailed', emoji: '◈', title: 'Narrative Prose', desc: 'Flowing paragraphs with full reasoning and context' },
      { value: 'structured', emoji: '◉', title: 'Executive Summary', desc: 'BLUF format - conclusion first, supporting detail below' },
    ],
  },
  focus: {
    label: 'Domain Expertise',
    subtitle: 'The professional lens your AI applies',
    choices: [
      { value: 'sales & business development', emoji: '📈', title: 'Sales & Growth', desc: 'Pipeline thinking, deal framing, persuasion, and revenue outcomes' },
      { value: 'operations & management', emoji: '⚙️', title: 'Operations & Leadership', desc: 'Process clarity, team dynamics, execution, and decision frameworks' },
      { value: 'content & marketing', emoji: '🎯', title: 'Content & Brand', desc: 'Messaging, storytelling, audience targeting, and creative strategy' },
      { value: 'research & analysis', emoji: '🔬', title: 'Research & Insight', desc: 'Data interpretation, pattern recognition, academic rigour' },
      { value: 'product & technology', emoji: '🛠️', title: 'Product & Tech', desc: 'Systems thinking, user-centric design, engineering trade-offs' },
      { value: 'finance & strategy', emoji: '💹', title: 'Finance & Strategy', desc: 'Financial modelling, risk assessment, long-term planning' },
    ],
  },
  formality: {
    label: 'Language Register',
    subtitle: 'Vocabulary and formality level in responses',
    choices: [
      { value: 'very formal', emoji: '🏛️', title: 'Corporate Formal', desc: 'Polished, precise language suitable for board-level or legal contexts' },
      { value: 'semi-formal', emoji: '👔', title: 'Professional', desc: 'Standard business English - clear, confident, no jargon' },
      { value: 'casual', emoji: '🧩', title: 'Conversational', desc: 'Relaxed, plain language - startup, creative, or internal team tone' },
      { value: 'mixed', emoji: '🔀', title: 'Adaptive', desc: 'Reads the context and shifts register accordingly' },
    ],
  },
  emoji: {
    label: 'Writing Signature',
    subtitle: 'The distinctive quality that marks every response',
    choices: [
      { value: 'data-driven', emoji: '📐', title: 'Data-Driven', desc: 'Anchors every point in facts, numbers, and cited evidence' },
      { value: 'framework-focused', emoji: '🗂️', title: 'Framework-Focused', desc: 'Uses mental models and structured thinking patterns' },
      { value: 'example-rich', emoji: '💡', title: 'Example-Rich', desc: 'Illustrates abstract ideas with concrete, real-world scenarios' },
      { value: 'no', emoji: '🔑', title: 'First-Principles', desc: 'Builds reasoning from the ground up, avoids assumptions' },
    ],
  },
};

const buildPersonaDescription = (p: Record<string, string>) => {
  const toneMap: Record<string, string> = { analytical: 'analytical thinker', executive: 'executive communicator', consultative: 'strategic advisor', direct: 'direct communicator' };
  const structMap: Record<string, string> = { concise: 'bullet-first responses', balanced: 'structured hybrid answers', detailed: 'narrative prose', structured: 'executive summaries' };
  const sigMap: Record<string, string> = { 'data-driven': 'data-backed evidence', 'framework-focused': 'structured frameworks', 'example-rich': 'real-world examples', no: 'first-principles reasoning' };
  const formalMap: Record<string, string> = { 'very formal': 'corporate formal', 'semi-formal': 'professional', casual: 'conversational', mixed: 'adaptive' };

  const t = p.tone ? (toneMap[p.tone] || p.tone) : '...';
  const s = p.length ? (structMap[p.length] || p.length) : '...';
  const sig = p.emoji ? (sigMap[p.emoji] || p.emoji) : '...';
  const f = p.formality ? (formalMap[p.formality] || p.formality) : '...';
  const domain = p.focus ? `with deep expertise in ${p.focus}` : '...';

  return `Your AI operates as a ${t} ${domain}, delivering ${s} in ${f} language, grounded in ${sig}.`;
};

export default function SettingsPage() {
  const { user, loading, preferences, updatePreferences } = useAuth();
  const [notification, setNotification] = useState<Notification | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isContactsLoading, setIsContactsLoading] = useState(true);
  const [newContact, setNewContact] = useState<ContactCreate>({ name: '', email: '', nickname: '' });
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [editingContactDraft, setEditingContactDraft] = useState<ContactCreate>({ name: '', email: '', nickname: '' });
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<number | null>(null);
  const [isDeletingContact, setIsDeletingContact] = useState(false);

  const [taskNotifEnabled, setTaskNotifEnabled] = useState<boolean>(true);
  const [personality, setPersonality] = useState<Record<string, string> | null>(null);
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [personalityDraft, setPersonalityDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem('mc_task_notif');
      setTaskNotifEnabled(stored !== 'false');

      // Prioritise preferences from AuthContext (DB), fallback to localStorage
      if (preferences?.communication_profile) {
        const parsed = JSON.parse(preferences.communication_profile);
        setPersonality(parsed);
        localStorage.setItem('mc_personality_v1', preferences.communication_profile);
      } else {
        const raw = localStorage.getItem('mc_personality_v1');
        if (raw) setPersonality(JSON.parse(raw));
      }
    } catch { /* ignore */ }
  }, [preferences?.communication_profile]);

  useEffect(() => {
    if (!user?.email) return;
    apiService.getContacts(user.email)
      .then(c => setContacts(c))
      .catch(() => { })
      .finally(() => setIsContactsLoading(false));
  }, [user?.email]);

  const showNotification = (message: string, type: NotificationType = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const handlePreferenceChange = async (key: string, value: boolean | string) => {
    if (!user) return;
    try {
      await updatePreferences({ [key]: value });
      showNotification("Saved", "success");
    } catch { showNotification("Something went wrong", "error"); }
  };

  const toggleTaskNotif = (val: boolean) => {
    setTaskNotifEnabled(val);
    try { localStorage.setItem('mc_task_notif', String(val)); } catch { /* ignore */ }
    showNotification(val ? 'Task notifications enabled' : 'Task notifications disabled', 'success');
  };

  const savePersonality = async () => {
    // Check if all fields are filled
    const missing = Object.keys(PERSONALITY_OPTIONS).filter(k => !personalityDraft[k as keyof typeof personalityDraft]);
    if (missing.length > 0) {
      showNotification(`Please select an option for all categories`, 'error');
      return;
    }

    localStorage.setItem('mc_personality_v1', JSON.stringify(personalityDraft));
    setPersonality(personalityDraft as any);
    setEditingPersonality(false);

    // Save to database
    try {
      await updatePreferences({ communication_profile: JSON.stringify(personalityDraft) } as any);
      showNotification('AI style preferences saved', 'success');
    } catch (error) {
      console.error('Failed to save communication profile:', error);
      showNotification('Failed to save preferences', 'error');
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name || !newContact.email || !user?.email) return;
    try {
      setIsAddingContact(true);
      const added = await apiService.addContact(user.email, newContact);
      setContacts(prev => [...prev, added]);
      setNewContact({ name: '', email: '', nickname: '' });
      showNotification("Contact added", "success");
    } catch {
      showNotification("Failed to add contact", "error");
    } finally { setIsAddingContact(false); }
  };

  const handleDeleteContact = async (id: number) => {
    if (!user?.email) return;
    setIsDeletingContact(true);
    try {
      setContacts(prev => prev.filter(c => c.id !== id));
      await apiService.deleteContact(user.email, id);
      showNotification("Contact removed", "success");
    } catch {
      showNotification("Failed to remove contact", "error");
      apiService.getContacts(user.email).then(setContacts);
    } finally {
      setIsDeletingContact(false);
      setContactToDelete(null);
    }
  };

  const startEditing = (contact: Contact) => {
    setEditingContactId(contact.id);
    setEditingContactDraft({ name: contact.name, email: contact.email, nickname: contact.nickname || '' });
  };

  const handleSaveContact = async (id: number) => {
    if (!user?.email) return;
    try {
      setIsSavingContact(true);
      const updated = await apiService.updateContact(user.email, id, editingContactDraft);
      setContacts(prev => prev.map(c => c.id === id ? updated : c));
      setEditingContactId(null);
      showNotification("Contact updated", "success");
    } catch {
      showNotification("Failed to update contact", "error");
    } finally { setIsSavingContact(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero identity card */}
      <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
          background: 'color-mix(in srgb, var(--primary) 15%, transparent)',
          border: '2px solid color-mix(in srgb, var(--primary) 30%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 700, color: 'var(--primary)',
        }}>
          {(user?.name || user?.email || '?')[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.name || 'Your Account'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AccentPicker />

        {/* Timezone */}
        <div id="timezone-section" style={CARD}>
          {sectionLabel("Timezone")}
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
            Your timezone is used for meeting scheduling and calendar events.
          </p>
          <Select value={preferences?.timezone || 'UTC'} onValueChange={v => handlePreferenceChange('timezone', v)}>
            <SelectTrigger className="w-full h-9 rounded-lg text-xs border-border/50 bg-background focus:ring-0">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent className="bg-background/95 backdrop-blur border border-border rounded-xl h-72">
              {SUPPORTED_TIMEZONES.map(tz => (
                <SelectItem key={tz.value} value={tz.value} className="rounded-lg text-xs py-2 focus:bg-primary/5">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3 h-3 text-muted" />
                    <span>{tz.label}</span>
                    <span className="text-muted text-[10px] ml-1">{tz.offset}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preferences?.timezone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Globe style={{ width: 11, height: 11, color: 'var(--primary)' }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Active:</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', background: 'rgba(83,74,183,0.07)', padding: '1px 8px', borderRadius: 99, border: '0.5px solid var(--accent-glow)' }}>
                {SUPPORTED_TIMEZONES.find(t => t.value === preferences.timezone)?.label || preferences.timezone}
              </span>
            </div>
          )}
          <button
            onClick={() => {
              const detected = getRecommendedTimezone();
              const info = SUPPORTED_TIMEZONES.find(t => t.value === detected);
              handlePreferenceChange('timezone', detected);
              showNotification(`Timezone set to ${info?.label || detected}`, 'success');
            }}
            style={{ ...btnPrimary, width: '100%', marginTop: 10, fontSize: 11, justifyContent: 'center' }}
          >
            <Globe style={{ width: 12, height: 12 }} /> Detect automatically
          </button>
        </div>
      </div>

      {/* Communication Profile */}
      <div id="communication-profile-section" style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles style={{ width: 14, height: 14, color: 'var(--primary)' }} />
            {sectionLabel("Communication Profile")}
          </div>
          {!editingPersonality ? (
            <button onClick={() => { setPersonalityDraft(personality ?? { tone: '', length: '', focus: '', formality: '', emoji: '' }); setEditingPersonality(true); }} style={{ ...btnSecondary, padding: '5px 10px', fontSize: 11, gap: 5 }}>
              <Edit2 style={{ width: 11, height: 11 }} /> Edit Profile
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={savePersonality} style={{ ...btnPrimary, padding: '5px 10px', fontSize: 11 }}>Save Profile</button>
              <button onClick={() => setEditingPersonality(false)} style={{ ...btnSecondary, padding: '5px 10px', fontSize: 11 }}>Cancel</button>
            </div>
          )}
        </div>

        {editingPersonality ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{
              padding: '16px', borderRadius: 16,
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 5%, var(--background)), color-mix(in srgb, var(--primary) 2%, var(--background)))',
              border: '1px dashed color-mix(in srgb, var(--primary) 20%, transparent)',
              position: 'relative', overflow: 'hidden'
            }}>
              <Sparkles style={{ position: 'absolute', top: -10, right: -10, width: 60, height: 60, color: 'var(--primary)', opacity: 0.05, transform: 'rotate(15deg)' }} />
              <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>Refined Persona Preview</p>
              <p style={{ fontSize: 13, color: 'var(--foreground)', margin: 0, lineHeight: 1.7, fontWeight: 500 }}>{buildPersonaDescription(personalityDraft)}</p>
            </div>
            <div className="h-[400px] overflow-y-scroll">
              {Object.entries(PERSONALITY_OPTIONS).map(([key, { label, subtitle, choices }]) => (
                <div key={key}>
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 700, margin: '0 0 2px' }}>{label}</p>
                    <p style={{ fontSize: 10, color: 'var(--muted)', margin: 0, fontWeight: 500 }}>{subtitle}</p>
                  </div>
                  <div className={`grid gap-2.5 ${choices.length > 4 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 lg:grid-cols-4'}`}>
                    {choices.map(c => {
                      const active = personalityDraft[key] === c.value;
                      return (
                        <button
                          key={c.value}
                          onClick={() => setPersonalityDraft(prev => ({ ...prev, [key]: c.value }))}
                          className="transition-all duration-200 group/opt"
                          style={{
                            padding: '12px',
                            borderRadius: 14,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            textAlign: 'left',
                            border: active ? '1.5px solid var(--primary)' : '1px solid var(--border-light)',
                            background: active ? 'color-mix(in srgb, var(--primary) 8%, var(--background))' : 'var(--background)',
                            boxShadow: active ? '0 4px 15px rgba(var(--primary-rgb), 0.1)' : 'none'
                          }}
                        >
                          <div style={{
                            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                            background: active ? 'var(--primary)' : 'var(--surface)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 14, transition: 'all 0.2s'
                          }}>
                            {c.emoji}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 12, color: active ? 'var(--primary)' : 'var(--foreground)', fontWeight: 700, margin: '0 0 3px' }}>{c.title}</p>
                            <p style={{ fontSize: 10, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>{c.desc}</p>
                          </div>
                          {active && <CheckCircle2 style={{ width: 14, height: 14, color: 'var(--primary)', flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : personality ? (
          <div>
            <div
              onClick={() => { setPersonalityDraft(personality); setEditingPersonality(true); }}
              className="group cursor-pointer hover:border-primary/40 transition-all"
              style={{ padding: '16px 20px', borderRadius: 16, border: '1px solid color-mix(in srgb, var(--primary) 15%, var(--border-light))', background: 'rgba(var(--primary-rgb), 0.02)', marginBottom: 16 }}
            >
              <p style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>Active AI Personality</p>
              <p style={{ fontSize: 14, color: 'var(--foreground)', margin: 0, lineHeight: 1.7, fontWeight: 500 }}>{buildPersonaDescription(personality)}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(PERSONALITY_OPTIONS).map(([key, { label, choices }]) => {
                const choice = choices.find(c => c.value === personality[key]);
                if (!choice) return null;
                return (
                  <div key={key} onClick={() => { setPersonalityDraft(personality); setEditingPersonality(true); }} className="flex-1 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 14, border: '1px solid var(--border-light)', background: 'var(--background)' }}>
                    <span style={{ fontSize: 24 }}>{choice.emoji}</span>
                    <div className="flex flex-col">
                      <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>{label}</span>
                      <span style={{ fontSize: 11, color: 'var(--foreground)', fontWeight: 600 }}>{choice.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{
            padding: '32px 20px', textAlign: 'center', borderRadius: 16,
            background: 'rgba(var(--primary-rgb), 0.02)', border: '1px dashed var(--border-light)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 16, background: 'var(--primary)/10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles className="text-primary" />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)', margin: '0 0 4px' }}>Setup Your AI Persona</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, maxWidth: 300 }}>Tell us how you want your AI agents to communicate. This will apply to all your chats.</p>
            </div>
            <button
              onClick={() => { setPersonalityDraft({ tone: '', length: '', focus: '', formality: '', emoji: '' }); setEditingPersonality(true); }}
              style={{ ...btnPrimary, marginTop: 8, padding: '8px 24px' }}
            >
              Get Started
            </button>
          </div>
        )}
      </div>

      {/* Core Background Intelligence Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Autopilot */}
        <div id="autopilot-section" style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
          <div className="p-5 border-b border-border/40 flex items-center justify-between bg-primary/5">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted">Background Autopilot</p>
            </div>
          </div>
          
          <div className="p-5 flex flex-col gap-3 bg-surface/30">
            {AUTOPILOT_TOGGLES.map(toggle => {
              const isChecked = toggle.id === "auto_classify_emails" ? preferences?.auto_classify_emails : preferences?.auto_schedule_meetings;
              return (
                <div key={toggle.id} className="flex items-center justify-between p-4 rounded-2xl border border-border/40 bg-background hover:border-primary/20 transition-all group">
                  <div>
                    <p className="text-[12px] font-bold text-foreground mb-0.5">{toggle.label}</p>
                    <p className="text-[10px] text-muted font-medium leading-tight">{toggle.desc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input type="checkbox" checked={Boolean(isChecked)} onChange={e => handlePreferenceChange(toggle.id, e.target.checked)} className="sr-only peer" />
                    <div className="w-10 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-muted-dark after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary peer-checked:after:bg-white border border-border" />
                  </label>
                </div>
              );
            })}
            
            <div className="flex items-center justify-between p-4 rounded-2xl border border-border/40 bg-background hover:border-primary/20 transition-all group">
              <div>
                <p className="text-[12px] font-bold text-foreground mb-0.5">Task Completion Alerts</p>
                <p className="text-[10px] text-muted font-medium leading-tight">Show a popup in Command Center when tasks finish while away</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input type="checkbox" checked={taskNotifEnabled} onChange={e => toggleTaskNotif(e.target.checked)} className="sr-only peer" />
                <div className="w-10 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-muted-dark after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary peer-checked:after:bg-white border border-border" />
              </label>
            </div>
          </div>
        </div>

        <ProactiveSettings userEmail={user?.email || ""} showNotification={showNotification} />
      </div>

      {/* Contacts */}
      
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <div id="add-contact-section" style={{ ...CARD, alignSelf: 'start' }}>
          {sectionLabel("Add Contact")}
          <form onSubmit={handleAddContact} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Full Name', key: 'name', type: 'text', placeholder: 'Jane Doe' },
              { label: 'Email', key: 'email', type: 'email', placeholder: 'jane@example.com' },
              { label: 'Nickname (optional)', key: 'nickname', type: 'text', placeholder: 'The Boss' },
            ].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4, fontWeight: 500 }}>{f.label}</label>
                <input type={f.type} placeholder={f.placeholder} style={inputStyle} value={newContact[f.key as keyof typeof newContact]} onChange={e => setNewContact(prev => ({ ...prev, [f.key]: e.target.value }))} required={f.key !== 'nickname'} />
              </div>
            ))}
            <button type="submit" disabled={isAddingContact} style={{ ...btnPrimary, marginTop: 4 }}>
              {isAddingContact ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Plus style={{ width: 12, height: 12 }} />} Add Contact
            </button>
          </form>
        </div>
        <div style={CARD} className="max-h-[300px] overflow-y-auto">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            {sectionLabel("Saved Contacts")}
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--primary)', background: 'rgba(83,74,183,0.07)', padding: '2px 8px', borderRadius: 99 }}>{contacts.length}</span>
          </div>
          {isContactsLoading ? (
            <div className="flex flex-col gap-1.5">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border-light)', background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Skeleton className="w-[30px] h-[30px] rounded-full shrink-0" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-2.5 w-32" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 opacity-40">
              <Users className="w-8 h-8 text-muted" />
              <span className="text-sm">No contacts yet</span>
              <p className="text-xs">Save people you email often to use their nicknames with AI agents</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {contacts.map(c => (
                <ContactRow key={c.id} contact={c} isEditing={editingContactId === c.id} editDraft={editingContactDraft} isSaving={isSavingContact} onDraftChange={setEditingContactDraft} onSave={() => handleSaveContact(c.id)} onCancel={() => setEditingContactId(null)} onDelete={() => setContactToDelete(c.id)} onEdit={() => startEditing(c)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {notification && <NotificationToast n={notification} onClose={() => setNotification(null)} />}

      <ConfirmationModal
        isOpen={contactToDelete !== null}
        onClose={() => setContactToDelete(null)}
        onConfirm={() => contactToDelete && handleDeleteContact(contactToDelete)}
        title="Remove Contact"
        description="Are you sure you want to remove this contact?"
        confirmText="Remove"
        variant="destructive"
        isLoading={isDeletingContact}
      />
    </div>
  );
}
