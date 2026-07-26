"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare, Bot, Mic, Mail, Calendar, FileText, UserCheck, Shield,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { AppLogo } from "@/components/shared/AppLogo";

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Central Command Chat",
    desc: "Talk to your AI in plain English - no commands to memorise. Ask it to read your email, schedule a meeting, or answer a question.",
  },
  {
    icon: Bot,
    title: "Custom AI Assistants",
    desc: "Build specialist assistants for any role in minutes. Each one learns your business from the documents you give it.",
  },
  {
    icon: Mail,
    title: "Smart Inbox",
    desc: "Connects to Gmail so every email is sorted by importance, drafted, and replied to right from the chat.",
  },
  {
    icon: Calendar,
    title: "Calendar & Meetings",
    desc: "Schedule, reschedule, and check availability just by asking. Conflicts are caught automatically.",
  },
  {
    icon: Mic,
    title: "Voice Commands",
    desc: "Speak your request naturally and get a spoken response back - no hold-to-talk button required.",
  },
  {
    icon: FileText,
    title: "Document Intelligence",
    desc: "Attach any file to ask questions about it, or ask your assistant to generate reports, decks, and sheets.",
  },
  {
    icon: UserCheck,
    title: "Relationship Intelligence",
    desc: "Every contact's history, tone, and follow-up status is tracked automatically across your inbox.",
  },
  {
    icon: Shield,
    title: "Human-in-the-Loop Safety",
    desc: "Nothing important is sent or scheduled without your review. You approve every action first.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Sign up & connect",
    desc: "Create your account and connect Gmail, Calendar, and the workspace tools you already use.",
  },
  {
    n: "02",
    title: "Chat naturally",
    desc: "Ask your assistant to handle email, research, scheduling, or documents - in plain English or by voice.",
  },
  {
    n: "03",
    title: "Review & approve",
    desc: "Every important action shows a preview first. Confirm it, edit it, or cancel - you're always in control.",
  },
  {
    n: "04",
    title: "Let it run",
    desc: "Assistants work in the background, follow up automatically, and brief you each morning.",
  },
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Already signed in - skip the pitch, go straight to the app.
  useEffect(() => {
    if (!loading && user) router.replace("/chat");
  }, [user, loading, router]);

  if (loading || user) return null;

  return (
    <main className="relative min-h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/30">
      <div className="noise-texture" />

      {/* Ambient background - same tech-icon wallpaper used inside the app chat */}
      <div
        className="absolute inset-0 pointer-events-none bg-repeat bg-local bg-[length:280px_280px] bg-[url('/chat-bg-light.svg')] dark:bg-[url('/chat-bg-dark.svg')]"
        style={{ maskImage: "linear-gradient(to bottom, black, transparent 70%)", WebkitMaskImage: "linear-gradient(to bottom, black, transparent 70%)" }}
      />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-[10%] top-[5%] h-[600px] w-[600px] rounded-full bg-primary/[0.05] blur-[150px]" />
        <div className="absolute right-[10%] top-[20%] h-[500px] w-[500px] rounded-full bg-primary/[0.03] blur-[120px]" />
      </div>

      {/* ── Nav ── */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 h-[64px] border-b border-border/40">
        <div className="flex items-center gap-2">
          <AppLogo width={32} height={32} className="h-6 w-auto" />
          <span className="text-[13px] font-black tracking-wide">AutoDeskAI</span>
        </div>
        <Link
          href="/auth"
          className="text-[12px] font-bold uppercase tracking-[0.15em] text-muted hover:text-foreground transition-colors"
        >
          Sign In
        </Link>
      </header>

      {/* ── Hero ── */}
      <section className="relative z-10 px-6 sm:px-10 pt-20 pb-24 sm:pt-28 sm:pb-32 max-w-[1100px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/60 bg-surface/60 text-[11px] font-bold uppercase tracking-[0.15em] text-muted mb-8">
            Multi-Agent Workflow Automation
          </div>
          <h1 className="text-[42px] sm:text-[64px] leading-[0.95] font-black tracking-tighter mb-6">
            Your inbox, calendar,<br />
            and workflows.<br />
            <span className="text-foreground/20">Run by AI.</span>
          </h1>
          <p className="text-[15px] sm:text-[17px] font-medium text-muted-dark/60 max-w-[520px] mx-auto leading-relaxed mb-10">
            AutoDeskAI orchestrates a fleet of AI assistants that read your email, manage your calendar,
            draft documents, and get real work done - all from one chat, with you approving every important step.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              href="/auth"
              className="group relative flex h-[56px] items-center justify-center gap-2 px-8 rounded-full bg-foreground text-background text-[13px] font-black uppercase tracking-[0.2em] transition-all hover:bg-primary active:scale-[0.98] overflow-hidden"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ── Features ── */}
      <section className="relative z-10 px-6 sm:px-10 py-20 max-w-[1100px] mx-auto">
        <div className="text-center mb-14">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary mb-3">Features</p>
          <h2 className="text-[28px] sm:text-[36px] font-black tracking-tighter">
            Everything your team does by hand - automated.
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: (i % 4) * 0.06 }}
              className="p-5 rounded-2xl border border-border/50 bg-surface/40 hover:bg-surface/70 hover:border-primary/30 transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <f.icon className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-[14px] font-bold tracking-tight mb-1.5">{f.title}</h3>
              <p className="text-[12.5px] text-muted leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="relative z-10 px-6 sm:px-10 py-20 max-w-[1100px] mx-auto">
        <div className="text-center mb-14">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary mb-3">Usage</p>
          <h2 className="text-[28px] sm:text-[36px] font-black tracking-tighter">
            From sign-up to done, in four steps.
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="relative"
            >
              <span className="text-[40px] font-black tracking-tighter text-foreground/10 block mb-2">
                {s.n}
              </span>
              <h3 className="text-[14px] font-bold tracking-tight mb-2">{s.title}</h3>
              <p className="text-[12.5px] text-muted leading-relaxed">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 px-6 sm:px-10 py-24">
        <div className="max-w-[720px] mx-auto text-center border-t border-border/40 pt-20">
          <h2 className="text-[28px] sm:text-[40px] font-black tracking-tighter mb-4">
            Put your workflows on autopilot.
          </h2>
          <p className="text-[14px] sm:text-[15px] text-muted-dark/60 mb-10 max-w-[440px] mx-auto leading-relaxed">
            Create your account in under a minute. No credit card required to get started.
          </p>
          <Link
            href="/auth"
            className="group relative inline-flex h-[56px] items-center justify-center gap-2 px-8 rounded-full bg-foreground text-background text-[13px] font-black uppercase tracking-[0.2em] transition-all hover:bg-primary active:scale-[0.98]"
          >
            Get Started Free
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 px-6 sm:px-10 py-8 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <AppLogo width={24} height={24} className="h-5 w-auto" />
          <span className="text-[12px] font-bold text-muted">AutoDeskAI</span>
        </div>
        <p className="text-[11px] text-muted/60">
          © {new Date().getFullYear()} AutoDeskAI. All rights reserved.
        </p>
      </footer>
    </main>
  );
}
