'use client';

/**
 * PersonalitySetup - shown once after first login.
 *
 * Asks 5 quick questions about how the user wants the AI to respond.
 * Answers are stored in localStorage under "mc_personality_v1" and injected
 * into every chat request via a system context prefix.
 *
 * The modal is skipped if the key already exists.
 * Export `getPersonalityContext()` to read the saved profile anywhere.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

import { X, ChevronRight, CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mc_personality_v1';

export interface PersonalityProfile {
  tone: string;
  length: string;
  focus: string;
  formality: string;
  emoji: string;
}

/** Returns the saved personality as a short system prompt prefix, or '' if not set. */
export function getPersonalityContext(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    const p: PersonalityProfile = JSON.parse(raw);
    return (
      `[User preferences] Tone: ${p.tone}. Response length: ${p.length}. ` +
      `Focus: ${p.focus}. Formality: ${p.formality}. ` +
      `Use emoji: ${p.emoji === 'yes' ? 'yes, sparingly' : 'no'}. ` +
      `Always match these preferences in every reply.`
    );
  } catch {
    return '';
  }
}

// ── Question definitions ──────────────────────────────────────────────────────

interface Option { value: string; label: string; desc: string; }
interface Question { id: keyof PersonalityProfile; title: string; subtitle: string; options: Option[] }

const QUESTIONS: Question[] = [
  {
    id: 'tone',
    title: 'What communication voice do you prefer?',
    subtitle: 'How your AI speaks and frames ideas',
    options: [
      { value: 'analytical', label: 'Analytical', desc: 'Objective, evidence-based, breaks down complexity' },
      { value: 'executive', label: 'Executive', desc: 'High-level, strategic, bottom-line focused' },
      { value: 'consultative', label: 'Consultative', desc: 'Advises with context, surfaces trade-offs' },
      { value: 'direct', label: 'Direct', desc: 'No filler. Clear, confident, action-oriented' },
    ],
  },
  {
    id: 'length',
    title: 'How should responses be structured?',
    subtitle: 'How answers are organised and delivered',
    options: [
      { value: 'concise', label: 'Bullet-First', desc: 'Key points up front, scannable lists' },
      { value: 'balanced', label: 'Structured Hybrid', desc: 'Short intro → bullets → brief context' },
      { value: 'detailed', label: 'Narrative Prose', desc: 'Flowing paragraphs with full reasoning' },
      { value: 'structured', label: 'Executive Summary', desc: 'Conclusion first, supporting detail below' },
    ],
  },
  {
    id: 'focus',
    title: 'What\'s your domain expertise?',
    subtitle: 'The professional lens your AI applies',
    options: [
      { value: 'sales & business development', label: 'Sales & Growth', desc: 'Pipeline thinking, deal framing, and revenue outcomes' },
      { value: 'operations & management', label: 'Operations & Leadership', desc: 'Process clarity, team dynamics, and execution' },
      { value: 'content & marketing', label: 'Content & Brand', desc: 'Messaging, storytelling, and creative strategy' },
      { value: 'research & analysis', label: 'Research & Insight', desc: 'Data interpretation and pattern recognition' },
      { value: 'product & technology', label: 'Product & Tech', desc: 'Systems thinking and engineering trade-offs' },
      { value: 'finance & strategy', label: 'Finance & Strategy', desc: 'Financial modelling and risk assessment' },
    ],
  },
  {
    id: 'formality',
    title: 'What language register do you prefer?',
    subtitle: 'Vocabulary and formality level in responses',
    options: [
      { value: 'very formal', label: 'Corporate Formal', desc: 'Polished, precise, board-level' },
      { value: 'semi-formal', label: 'Professional', desc: 'Standard business English' },
      { value: 'casual', label: 'Conversational', desc: 'Relaxed, plain language' },
      { value: 'mixed', label: 'Adaptive', desc: 'Reads the context and shifts register' },
    ],
  },
  {
    id: 'emoji',
    title: 'What\'s your writing signature style?',
    subtitle: 'The distinctive quality that marks every response',
    options: [
      { value: 'data-driven', label: 'Data-Driven', desc: 'Anchors every point in facts and evidence' },
      { value: 'framework-focused', label: 'Framework-Focused', desc: 'Uses mental models and structured thinking' },
      { value: 'example-rich', label: 'Example-Rich', desc: 'Illustrates with concrete, real-world scenarios' },
      { value: 'no', label: 'First-Principles', desc: 'Builds reasoning from the ground up' },
    ],
  },
];

// ── Option card ───────────────────────────────────────────────────────────────

function OptionCard({
  opt, selected, onClick,
}: { opt: Option; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all duration-200
        ${selected
          ? 'border-primary bg-primary/10 shadow-[0_0_0_2px_rgba(var(--primary-rgb),0.2)]'
          : 'border-border/50 bg-background hover:border-primary/30 hover:bg-surface'}`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>{opt.label}</p>
        <p className="text-[11px] text-muted truncate">{opt.desc}</p>
      </div>
      {selected && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface PersonalitySetupProps {
  onComplete?: (profile: PersonalityProfile) => void;
}

export default function PersonalitySetup({ onComplete }: PersonalitySetupProps) {
  const router = useRouter();
  const { user, updatePreferences } = useAuth();
  const [show, setShow] = useState(false);

  const [step, setStep] = useState(0);       // 0 = intro, 1-5 = questions, 6 = done
  const [answers, setAnswers] = useState<Partial<PersonalityProfile>>({});
  const [animDir, setAnimDir] = useState<'forward' | 'back'>('forward');

  // Only show once per browser profile
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      // Small delay so the dashboard finishes loading first
      const t = setTimeout(() => setShow(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  if (!show) return null;

  const q = QUESTIONS[step - 1];   // undefined on intro (step=0) and done (step=6)
  const totalSteps = QUESTIONS.length;
  const isDone = step > totalSteps;
  const isIntro = step === 0;
  const progress = Math.round((step / totalSteps) * 100);

  const handleSelect = (val: string) => {
    setAnswers(prev => ({ ...prev, [q.id]: val }));
  };

  const canAdvance = isIntro || isDone || !!answers[q?.id];

  const advance = async () => {
    if (!canAdvance) return;
    setAnimDir('forward');
    if (step === totalSteps) {
      // Save profile
      const profile = answers as PersonalityProfile;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      onComplete?.(profile);
      
      // Save to database if user is authenticated
      if (user) {
        try {
          await updatePreferences({ communication_profile: JSON.stringify(profile) } as any);
        } catch (error) {
          console.error('Failed to save communication profile to database:', error);
        }
      }
      
      setStep(s => s + 1); // show done screen
    } else {
      setStep(s => s + 1);
    }
  };

  const back = () => {
    if (step <= 1) return;
    setAnimDir('back');
    setStep(s => s - 1);
  };

  const skip = async () => {
    const defaultProfile = { tone: 'professional', length: 'balanced', focus: 'operations & management', formality: 'semi-formal', emoji: 'data-driven' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultProfile));
    
    // Save to database if user is authenticated
    if (user) {
      try {
        await updatePreferences({ communication_profile: JSON.stringify(defaultProfile) } as any);
      } catch (error) {
        console.error('Failed to save communication profile to database:', error);
      }
    }
    
    setShow(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-lg bg-background border border-border/40 rounded-2xl shadow-2xl overflow-hidden
        animate-in fade-in zoom-in-95 duration-300">

        {/* ── Progress bar ── */}
        {!isIntro && !isDone && (
          <div className="h-1 bg-border/30">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* ── Intro screen ── */}
        {isIntro && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/80 to-accent/60 flex items-center justify-center mx-auto mb-5 shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-2">Personalise your AI</h1>
            <p className="text-sm text-muted leading-relaxed max-w-sm mx-auto">
              Answer 5 quick questions and your assistant will always respond exactly the way you like - tone, length, style, everything.
            </p>
            <p className="text-[11px] text-muted/60 mt-2">Takes about 30 seconds · You can change it later</p>

            <div className="mt-8 flex flex-col gap-2">
              <button onClick={advance}
                className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4" /> Let&apos;s personalise it
              </button>
              <button onClick={skip}
                className="text-[11px] text-muted hover:text-foreground transition-colors py-1">
                Skip for now (use defaults)
              </button>
            </div>
          </div>
        )}

        {/* ── Question screen ── */}
        {!isIntro && !isDone && q && (
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex-1">
                <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">
                  Question {step} of {totalSteps}
                </p>
                <h2 className="text-base font-bold text-foreground">{q.title}</h2>
                <p className="text-[12px] text-muted mt-0.5">{q.subtitle}</p>
              </div>
              <button onClick={skip} className="p-1.5 rounded-lg text-muted hover:text-foreground transition-colors shrink-0 ml-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Options */}
            <div className="space-y-2 mb-6">
              {q.options.map(opt => (
                <OptionCard
                  key={opt.value}
                  opt={opt}
                  selected={answers[q.id] === opt.value}
                  onClick={() => handleSelect(opt.value)}
                />
              ))}
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-3">
              {step > 1 && (
                <button onClick={back}
                  className="px-4 py-2.5 rounded-xl border border-border text-muted hover:text-foreground text-sm font-medium transition-colors">
                  Back
                </button>
              )}
              <button onClick={advance} disabled={!canAdvance}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all
                  bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90">
                {step === totalSteps ? 'Save my preferences' : 'Next'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Step dots */}
            <div className="flex items-center justify-center gap-1.5 mt-4">
              {QUESTIONS.map((_, i) => (
                <div key={i} className={`rounded-full transition-all duration-300
                  ${i + 1 === step ? 'w-4 h-1.5 bg-primary' : i + 1 < step ? 'w-1.5 h-1.5 bg-primary/50' : 'w-1.5 h-1.5 bg-border'}`} />
              ))}
            </div>
          </div>
        )}

        {/* ── Done screen ── */}
        {isDone && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-2">All set!</h1>
            <p className="text-sm text-muted max-w-xs mx-auto leading-relaxed">
              Your AI will now match your preferred tone, style, and focus in every response. You can update this anytime in Settings.
            </p>

            {/* Profile summary pills */}
            <div className="flex flex-wrap gap-2 justify-center mt-5">
              {Object.entries(answers).map(([k, v]) => (
                <span key={k} className="text-[11px] px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary font-medium capitalize">
                  {v as string}
                </span>
              ))}
            </div>

            <button onClick={() => { setShow(false); router.push('/settings'); }}
              className="btn-primary w-full mt-7 py-3 text-sm flex items-center justify-center gap-2">
              Start using AutoDeskAI <ArrowRight className="w-4 h-4" />
            </button>

          </div>
        )}
      </div>
    </div>
  );
}
