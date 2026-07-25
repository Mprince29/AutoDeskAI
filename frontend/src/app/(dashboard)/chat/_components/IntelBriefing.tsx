import React, { useEffect, useRef, useState } from "react";
import { 
  Calendar, 
  UserSearch, 
  RefreshCw, 
  Sparkles, 
  Brain, 
  Mail, 
  TrendingUp,
  Clock,
  AlertTriangle,
  User
} from "lucide-react";
import { proactiveService } from "@/services/proactive.service";
import { contactService } from "@/services/contact.service";
import { BriefingResult, RelationshipCard } from "@/types/proactive.types";

export function IntelBriefing({ 
  userEmail,
  initialBriefingData,
  initialRelCard
}: { 
  userEmail: string;
  initialBriefingData?: BriefingResult | null;
  initialRelCard?: RelationshipCard | null;
}) {
  const [intelTab, setIntelTab] = useState<'briefing' | 'relationship'>('briefing');
  const [briefingData, setBriefingData] = useState<BriefingResult | null>(initialBriefingData || null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const fetchedRef = useRef(false);

  const [contactInput, setContactInput] = useState('');
  const [relCard, setRelCard] = useState<RelationshipCard | null>(initialRelCard || null);
  const [relLoading, setRelLoading] = useState(false);


  useEffect(() => {
    if (userEmail && !briefingData && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchBriefing();
    }
  }, [userEmail]);

  const fetchBriefing = async () => {
    setBriefingLoading(true);
    try {
      const res = await proactiveService.getBriefing(userEmail);
      setBriefingData(res);
    } catch (err) {
      console.error("Briefing failed", err);
    } finally {
      setBriefingLoading(false);
    }
  };

  const fetchRelationship = async () => {
    if (!contactInput.trim()) return;
    setRelLoading(true);
    try {
      const res = await proactiveService.getRelationshipIntel(userEmail, contactInput);
      setRelCard(res);
    } catch (err) {
      console.error("Relationship intel failed", err);
    } finally {
      setRelLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Today Focus Strip */}
      <div className="px-4 h-[46px] border-b border-[var(--glass-border)] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Clock className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Today</span>
        </div>
        <span className="text-[9px] font-bold text-muted/60">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>

      {/* Intel sub-tabs */}
      <div className="px-3 py-2 flex gap-1 border-b border-[var(--glass-border)]">
        {([
          { id: 'briefing', icon: Calendar, label: 'Briefing' },
          { id: 'relationship', icon: UserSearch, label: 'Contacts' },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setIntelTab(id)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold tracking-[0.1em] uppercase transition-all flex-1 justify-center"
            style={intelTab === id
              ? { background: 'var(--primary-light)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }
              : { color: 'var(--muted)', border: '1px solid transparent' }}
          >
            <Icon className="w-2.5 h-2.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {intelTab === 'briefing' && (
          <div className="flex-1 flex flex-col min-h-0 animate-fade-in px-1">
            {/* Status Bar */}
            <div className="flex items-center justify-between mb-4 bg-surface/50 border border-border dark:bg-white/[0.03] dark:border-white/[0.05] p-3 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-foreground">My Briefing</p>
                  <p className="text-[8px] text-muted-dark dark:text-muted font-bold tracking-widest">
                    {new Date().toLocaleDateString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={fetchBriefing}
                  disabled={briefingLoading}
                  className="p-2 rounded-lg bg-surface border border-border hover:bg-surface-hover dark:bg-white/5 dark:border-white/10 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-primary ${briefingLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {briefingLoading && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12 opacity-50">
                <div className="relative">
                  <div className="w-12 h-12 border-2 border-orange-500/20 rounded-full animate-ping" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Brain className="w-6 h-6 text-orange-400 animate-pulse" />
                  </div>
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-400">Preparing Summary...</span>
              </div>
            )}

            {!briefingLoading && !briefingData && (
              <div className="flex-1 flex flex-col items-center justify-center py-12 gap-6">
                <Calendar className="w-8 h-8 text-orange-500/40" />
                <button
                  onClick={fetchBriefing}
                  className="px-6 py-2 rounded-xl bg-orange-500 text-black text-[10px] font-black uppercase tracking-widest"
                >
                  Refresh Summary
                </button>
              </div>
            )}

            {briefingData && (
              <div className="space-y-4 pb-4 pr-1">
                {/* Inbox Section */}
                <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10">
                  <div className="flex items-center gap-3 mb-4">
                    <Mail className="w-4 h-4 text-emerald-400" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400">Tactical Communications</span>
                  </div>
                  <p className="text-[12px] text-muted leading-relaxed font-medium mb-4">{briefingData.email?.summary}</p>
                </div>

                {/* Calendar Section */}
                <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10">
                  <div className="flex items-center gap-3 mb-4">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-primary">Agenda Focus</span>
                  </div>
                  <p className="text-[12px] text-muted leading-relaxed font-medium">{briefingData.calendar?.summary}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {intelTab === 'relationship' && (
          <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted">Relationship Intel</p>
            </div>

            <div className="relative mb-4 group">
              <input
                type="text"
                placeholder="Enter name or email..."
                className="w-full bg-surface/50 border border-border dark:bg-white/[0.03] dark:border-white/[0.05] rounded-xl px-4 py-3 text-[11px] font-bold text-foreground focus:border-primary/60 outline-none transition-all pr-10"
                value={contactInput}
                onChange={e => setContactInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchRelationship()}
              />
              <button
                onClick={fetchRelationship}
                disabled={relLoading}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors disabled:opacity-40"
              >
                {relLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserSearch className="w-3.5 h-3.5" />}
              </button>
            </div>

            {relCard && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="p-4 rounded-2xl bg-orange-500/5 border border-orange-500/10 space-y-4">
                  <div className="flex items-center gap-3">
                    <User className="w-4 h-4 text-orange-400" />
                    <span className="text-[13px] font-black text-foreground">{relCard.name}</span>
                  </div>
                    <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-orange-400" />
                    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-orange-400">{relCard.tone_trend} Sentiment</span>
                  </div>
                  <p className="text-[11px] text-foreground/80 leading-relaxed font-medium italic">&ldquo;{relCard.suggested_action}&rdquo;</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
