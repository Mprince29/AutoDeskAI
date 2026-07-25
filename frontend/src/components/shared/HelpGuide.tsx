'use client';
import { useEffect, useRef, useState } from 'react';
import {
  X, HelpCircle, MessageSquare, Bot, Mic, Mail, Calendar,
  FileText, Zap, ChevronRight, ChevronLeft, Play,
  Users, Globe, BookOpen, Shield, Wrench,
} from 'lucide-react';

// ── Chapter definitions ─────────────────────────────────────────────────────

interface Chapter {
  id: string;
  icon: React.ElementType;
  title: string;
  tagline: string;
  color: string;        // Tailwind text colour class
  bg: string;           // Tailwind bg for the avatar
  description: string;
  bullets: string[];
  videoSrc?: string;    // URL to embed (YouTube embed / mp4) - optional
  videoThumb?: string;  // Poster image URL
}

const CHAPTERS: Chapter[] = [
  {
    id: 'chat',
    icon: MessageSquare,
    title: 'Central Command',
    tagline: 'Your AI-powered inbox for everything',
    color: 'text-primary',
    bg: 'bg-primary/10 border-primary/20',
    description:
      'The dashboard chat is where you talk to your AI assistants. Just type in plain English - no commands to memorise. Ask it to read your emails, schedule a meeting, write a document, or answer any question.',
    bullets: [
      'Type naturally - the AI understands everyday language',
      'Attach a file to ask questions about its content',
      'Press the mic icon to speak instead of type',
      'Watch the live status bar to see what the AI is doing',
    ],
  },
  {
    id: 'agents',
    icon: Bot,
    title: 'AI Assistants',
    tagline: 'Specialists built just for your work',
    color: 'text-accent',
    bg: 'bg-accent/10 border-accent/20',
    description:
      'Assistants are like trained employees. Each one is built for a specific job - sales emails, data analysis, customer support, and more. You can create your own in minutes by describing the role.',
    bullets: [
      'Click the plus icon in the sidebar to add a new assistant',
      'The AI researches your industry automatically',
      'Upload documents to give it your company\'s specific knowledge',
      'Select an assistant from the sidebar to chat with it directly',
    ],
  },
  {
    id: 'tools',
    icon: Wrench,
    title: 'Playground Tools',
    tagline: 'Powerful standalone utilities',
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10 border-indigo-500/20',
    description:
      'The Playground contains standalone tools for specific workflows like cleaning CSV files.',
    bullets: [
      'Navigate to Tools in the top menu to open the Playground',
      'Use the CSV Cleaner to instantly fix messy spreadsheets',
      'Select Tools from the left sidebar to quickly access them',
    ],
  },
  {
    id: 'voice',
    icon: Mic,
    title: 'Voice Commands',
    tagline: 'Talk to your AI like a colleague',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    description:
      'Click the audio waveform icon, say your command out loud, then say "that\'s it" when finished. The AI understands natural speech - you can say "send John an email about the meeting tomorrow" and it handles everything.',
    bullets: [
      'Click the waveform icon once to start - no hold required',
      'Speak naturally, pause when thinking, end with "that\'s it"',
      'A preview appears before any email is sent - you confirm it',
      'The AI reads the result back to you automatically',
    ],
  },
  {
    id: 'email',
    icon: Mail,
    title: 'Smart Inbox',
    tagline: 'Email that organises itself',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
    description:
      'The Smart Inbox connects to your Gmail or Outlook and shows every email sorted by importance. You can read, reply, draft, and archive emails just by asking the AI in the chat.',
    bullets: [
      'Navigate to Workspaces → Smart Inbox to see your emails',
      'Ask the assistant "show me unread from last week"',
      'Draft replies by typing "reply to [name] and say…"',
      'Emails are auto-classified into priority, newsletters, alerts',
    ],
  },
  {
    id: 'calendar',
    icon: Calendar,
    title: 'Calendar & Meetings',
    tagline: 'Scheduling without the back-and-forth',
    color: 'text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
    description:
      'Connect your Google or Microsoft calendar. The AI can check your availability, create meetings, send invites, and remind you before events. Just ask it in the chat.',
    bullets: [
      'Say "schedule a 30-min call with Sarah next Tuesday"',
      'The AI checks for conflicts automatically',
      'View upcoming meetings in the top bar of the dashboard',
      'Click any meeting pill to join directly',
    ],
  },
  {
    id: 'documents',
    icon: FileText,
    title: 'Documents & Files',
    tagline: 'Generate and understand any document',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    description:
      'Attach any PDF, Word doc, spreadsheet, or text file to a chat message. The AI reads it and answers your questions. You can also ask it to generate new documents, presentations, or spreadsheets.',
    bullets: [
      'Click the plus icon to attach a file to your question',
      'Ask "summarise this contract" or "what are the key figures?"',
      'Say "create a report on our Q3 sales" for generated docs',
      'Download results as PDF, Word, Excel, or plain text',
    ],
  },
  {
    id: 'contacts',
    icon: Users,
    title: 'Contacts',
    tagline: 'Smart contact management',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
    description:
      'The Contacts panel (toggle with the people icon in the chat header) shows everyone you\'ve communicated with. The AI can look up people and pull their details into emails automatically.',
    bullets: [
      'Click the people icon in the chat header to open the panel',
      'Search by name, company, or topic',
      'Ask "email all contacts from Acme Corp"',
      'Contacts sync automatically from your email',
    ],
  },
  {
    id: 'hitl',
    icon: Shield,
    title: 'Human Approval',
    tagline: 'You\'re always in control',
    color: 'text-success',
    bg: 'bg-success/10 border-success/20',
    description:
      'Before any important action (sending email, creating meetings, sharing files), the AI pauses and shows you a preview. You approve or cancel. Nothing is done without your permission.',
    bullets: [
      'A confirmation card appears before risky actions',
      'Review the full email or event details before confirming',
      'Say "confirm" or "cancel" out loud when using voice',
      'All actions are logged in the audit trail',
    ],
  },
  {
    id: 'security',
    icon: Shield,
    title: 'Security & Privacy',
    tagline: 'How your data is protected',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
    description:
      'Your credentials and data are protected at every layer - from storage to transit. You remain in full control of what is stored and can revoke access to any integration at any time.',
    bullets: [
      'API keys & OAuth tokens encrypted with AES-256 (Fernet) - no plain-text secrets stored',
      'All browser-to-server traffic uses HTTPS/TLS; integrations use OAuth 2.0 with PKCE',
      'Chat history is private to your account and used only to improve your agent responses',
      'A full audit log of agent actions is kept - disconnect or delete data at any time',
    ],
  },
];

// ── Animated video placeholder ───────────────────────────────────────────────

function VideoPlaceholder({ icon: Icon, color, bg }: { icon: React.ElementType; color: string; bg: string }) {
  return (
    <div className={`relative w-full aspect-video rounded-2xl border-2 ${bg} flex flex-col items-center justify-center gap-3 overflow-hidden`}>
      {/* Background pulse rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[0, 1, 2].map(i => (
          <div key={i} className={`absolute rounded-full border ${bg} animate-ping`}
            style={{
              width: `${120 + i * 60}px`, height: `${120 + i * 60}px`,
              animationDelay: `${i * 0.4}s`, animationDuration: '2.4s', opacity: 0.3 - i * 0.08,
            }} />
        ))}
      </div>

      {/* Centre icon */}
      <div className={`relative z-10 p-5 rounded-2xl border ${bg} backdrop-blur-sm`}>
        <Icon className={`w-10 h-10 ${color}`} />
      </div>

      {/* Play button overlay */}
      <div className="relative z-10 flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm">
        <Play className="w-4 h-4 text-white fill-white" />
        <span className="text-xs text-white/80 font-medium">Video coming soon</span>
      </div>

      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <div key={i} className={`absolute w-1.5 h-1.5 rounded-full ${color.replace('text-', 'bg-')} opacity-40 animate-bounce`}
          style={{
            left: `${15 + i * 15}%`, top: `${20 + (i % 3) * 25}%`,
            animationDelay: `${i * 0.3}s`, animationDuration: `${1.2 + i * 0.2}s`,
          }} />
      ))}
    </div>
  );
}

// ── Video embed (YouTube or mp4) ─────────────────────────────────────────────

function VideoEmbed({ src, thumb, title }: { src: string; thumb?: string; title: string }) {
  const isYT = src.includes('youtube') || src.includes('youtu.be');
  if (isYT) {
    const id = src.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1] ?? '';
    return (
      <div className="w-full aspect-video rounded-2xl overflow-hidden border border-border/40">
        <iframe
          src={`https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`}
          title={title} allowFullScreen
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      </div>
    );
  }
  return (
    <div className="w-full aspect-video rounded-2xl overflow-hidden border border-border/40">
      <video src={src} poster={thumb} controls className="w-full h-full object-cover" title={title} />
    </div>
  );
}

// ── Key-point animated pill ──────────────────────────────────────────────────

function BulletPill({ text, index }: { text: string; index: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 120 + index * 90);
    return () => clearTimeout(t);
  }, [index]);
  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-xl border border-border/40 bg-surface/60
      transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
      <span className="text-[13px] text-foreground/80 leading-snug">{text}</span>
    </div>
  );
}

// ── Main HelpGuide component ──────────────────────────────────────────────────

export default function HelpGuide({ customTrigger }: { customTrigger?: (props: { onClick: () => void }) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(CHAPTERS[0].id);
  const [animKey, setAnimKey] = useState(0); // re-triggers bullet animations on chapter change
  const panelRef = useRef<HTMLDivElement>(null);

  const chapter = CHAPTERS.find(c => c.id === activeId) ?? CHAPTERS[0];
  const activeIdx = CHAPTERS.findIndex(c => c.id === activeId);

  const goTo = (id: string) => {
    setActiveId(id);
    setAnimKey(k => k + 1);
  };

  const prev = () => activeIdx > 0 && goTo(CHAPTERS[activeIdx - 1].id);
  const next = () => activeIdx < CHAPTERS.length - 1 && goTo(CHAPTERS[activeIdx + 1].id);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Scroll lock
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Open via custom event
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-help-guide', handler);
    return () => window.removeEventListener('open-help-guide', handler);
  }, []);

  const Icon = chapter.icon;

  return (
    <>
      {/* ── Trigger button ── */}
      {!open && (
        customTrigger ? (
          customTrigger({ onClick: () => setOpen(o => !o) })
        ) : (
          <button
            onClick={() => setOpen(o => !o)}
            className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full shadow-xl
              flex items-center justify-center transition-all duration-300 group
              ${open
                ? 'bg-primary text-white scale-110 shadow-[0_8px_24px_rgba(var(--primary-rgb),0.5)]'
                : 'bg-surface border border-border text-muted hover:text-primary hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(var(--primary-rgb),0.25)]'
              }`}
            title="Help guide"
          >
            {open ? <X className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
          </button>
        )
      )}

      {/* ── Full-screen overlay ── */}
      <div className={`fixed inset-0 z-[100] transition-all duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        <div
          ref={panelRef}
          className={`absolute max-w-6xl w-full h-full md:h-[600px] mx-auto inset-0 md:inset-24 rounded-none md:rounded-2xl overflow-hidden
            border-0 md:border md:border-border/40 shadow-none md:shadow-2xl flex flex-col md:flex-row transition-all duration-400
            ${open ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
          style={{ background: 'var(--background)' }}
        >
          {/* ── Left sidebar - hidden on mobile ── */}
          <div className="hidden md:flex w-56 shrink-0 border-r border-border/30 flex-col overflow-hidden"
            style={{ background: 'var(--surface)' }}>
            {/* Header */}
            <div className="p-4 border-b border-border/30">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold text-foreground uppercase tracking-widest">User Guide</span>
              </div>
              <p className="text-[10px] text-muted mt-1">{CHAPTERS.length} features explained</p>
            </div>

            {/* Chapter list */}
            <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
              {CHAPTERS.map((ch, i) => {
                const Ch = ch.icon;
                const isActive = ch.id === activeId;
                return (
                  <button
                    key={ch.id}
                    onClick={() => goTo(ch.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all
                      ${isActive
                        ? 'bg-primary/10 text-primary border-r-2 border-primary'
                        : 'text-muted hover:text-foreground hover:bg-surface/80'}`}
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center border shrink-0
                      ${isActive ? ch.bg : 'bg-background border-border/30'}`}>
                      <Ch className={`w-3.5 h-3.5 ${isActive ? ch.color : 'text-muted'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[11px] font-semibold truncate ${isActive ? 'text-primary' : ''}`}>{ch.title}</p>
                    </div>
                    <span className={`ml-auto text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0
                      ${isActive ? 'bg-primary text-white' : 'bg-border text-muted'}`}>
                      {i + 1}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="p-3 border-t border-border/30">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] text-muted font-semibold uppercase tracking-wider">Progress</span>
                <span className="text-[9px] text-muted">{activeIdx + 1} / {CHAPTERS.length}</span>
              </div>
              <div className="w-full h-1 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${((activeIdx + 1) / CHAPTERS.length) * 100}%` }} />
              </div>
            </div>
          </div>

          {/* ── Main content ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl border ${chapter.bg}`}>
                  <Icon className={`w-5 h-5 ${chapter.color}`} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">{chapter.title}</h2>
                  <p className="text-[11px] text-muted">{chapter.tagline}</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)}
                className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-surface transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: video */}
                <div className="space-y-4">
                  {chapter.videoSrc
                    ? <VideoEmbed key={`video-${activeId}`} src={chapter.videoSrc} thumb={chapter.videoThumb} title={chapter.title} />
                    : <VideoPlaceholder key={`placeholder-${activeId}`} icon={chapter.icon} color={chapter.color} bg={chapter.bg} />
                  }

                  {/* Description */}
                  <div className="p-4 rounded-xl border border-border/40 bg-surface/50">
                    <p className="text-sm text-foreground/80 leading-relaxed">{chapter.description}</p>
                  </div>
                </div>

                {/* Right: animated key points */}
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-4">Key Points</p>
                  {chapter.bullets.map((b, i) => (
                    <BulletPill key={`${animKey}-${i}`} text={b} index={i} />
                  ))}

                  {/* Quick-start tip box */}
                  <div className="mt-2 p-4 rounded-xl border border-primary/20 bg-primary/5 flex gap-3">
                    <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-bold text-primary mb-0.5">Quick Start</p>
                      <p className="text-[11px] text-foreground/70 leading-snug">
                        {activeIdx === 0 && 'Go to the Dashboard and type your first message - try "summarise my latest emails"'}
                        {activeIdx === 1 && 'Click the plus icon in the "My Assistants" sidebar and describe a role in 2-3 sentences'}
                        {activeIdx === 2 && 'Select Tools from the left sidebar dropdown or top menu to access the Playground'}
                        {activeIdx === 3 && 'Click the audio waveform icon in the chat input area and speak your command'}
                        {activeIdx === 4 && 'Navigate to Workspaces → Smart Inbox, then ask the AI "show my unread emails"'}
                        {activeIdx === 5 && 'Ask in chat: "what meetings do I have today?" - no setup required'}
                        {activeIdx === 6 && 'Click the plus icon in the chat input, attach a PDF, then ask a question about it'}
                        {activeIdx === 7 && 'Click the people icon in the chat header to open the contacts panel instantly'}
                        {activeIdx === 8 && 'Just use voice or chat normally - approval prompts appear automatically when needed'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom navigation */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border/30 shrink-0 bg-surface/40">
              <button onClick={prev} disabled={activeIdx === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border text-muted hover:text-foreground
                  hover:border-border/80 transition-all disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium">
                <ChevronLeft className="w-4 h-4" /> <span className='hidden md:block'>Previous</span>
              </button>

              {/* Dot indicators */}
              <div className="flex items-center gap-1.5">
                {CHAPTERS.map((ch, i) => (
                  <button key={ch.id} onClick={() => goTo(ch.id)}
                    className={`rounded-full transition-all duration-300
                      ${i === activeIdx ? 'w-5 h-2 bg-primary' : 'w-2 h-2 bg-border hover:bg-muted'}`} />
                ))}
              </div>

              <div className="flex items-center justify-end">
                {activeIdx < CHAPTERS.length - 1 ? (
                  <button 
                    key="next-btn"
                    onClick={next}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white
                      hover:bg-primary/90 transition-all text-sm font-medium shadow-sm"
                  >
                    <span className="hidden md:block">Next</span> <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button 
                    key="done-btn"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-success text-white
                      hover:bg-success/90 transition-all text-sm font-medium"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
