"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Plus,
  Paperclip,
  Link2,
  Telescope,
  Mic,
  ArrowRight,
  Loader2,
  FileText,
  X,
  Square,
  Languages
} from "lucide-react";
import { PERSONAS, BRAND_VOICES, LANGUAGES } from "@/constants/journalist";
import { GroundingSource } from "@/types/journalist.types";
import { uploadFile } from "@/services/journalist.service";

interface ISpeechRecognitionEvent {
  results: { length: number;[i: number]: { isFinal: boolean;[j: number]: { transcript: string } } };
}
interface ISpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => ISpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => ISpeechRecognitionInstance;
};

interface ChatInputProps {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  onSend: () => void;
  onStop?: () => void;
  isLoading: boolean;
  email: string;

  sources: string[];
  setSources: React.Dispatch<React.SetStateAction<string[]>>;
  groundingSources: GroundingSource[];
  setGroundingSources: React.Dispatch<React.SetStateAction<GroundingSource[]>>;

  persona: string;
  setPersona: React.Dispatch<React.SetStateAction<string>>;
  brandVoice: string;
  setBrandVoice: React.Dispatch<React.SetStateAction<string>>;
  language: string;
  setLanguage: React.Dispatch<React.SetStateAction<string>>;
  enableWebSearch: boolean;
  setEnableWebSearch: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ChatInput({
  input,
  setInput,
  onSend,
  onStop,
  isLoading,
  email,
  sources,
  setSources,
  groundingSources,
  setGroundingSources,
  persona,
  setPersona,
  brandVoice,
  setBrandVoice,
  language,
  setLanguage,
  enableWebSearch,
  setEnableWebSearch,
}: ChatInputProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isListening, setIsListening] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<ISpeechRecognitionInstance | null>(null);

  // Speech recognition init
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as WindowWithSpeech).SpeechRecognition || (window as WindowWithSpeech).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event: ISpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      const base = (textareaRef.current?.dataset.baseText) || "";
      const isFinal = event.results[event.results.length - 1].isFinal;
      const newText = base.trim() ? `${base.trim()} ${transcript}` : transcript;
      setInput(newText + (isFinal ? "" : " (listening...)"));
    };
    rec.onend = () => {
      setIsListening(false);
      setInput(p => p.replace(/\s*\(listening\.\.\.\)$/i, ""));
    };
    recognitionRef.current = rec;
  }, [setInput]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      if (textareaRef.current) textareaRef.current.dataset.baseText = input.replace(/\s*\(listening\.\.\.\)$/i, "");
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch { /* ignore */ }
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Close plus menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowPlusMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File too large (max 10MB)."); return; }
    setIsUploading(true);
    try {
      const src = await uploadFile(file, email);
      setGroundingSources(prev => [...prev, src]);
    } catch {
      alert("Upload failed. Ensure the backend is running.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submitUrl = () => {
    if (!urlInput.trim()) { setShowUrlInput(false); return; }
    try {
      new URL(urlInput.trim());
      if (!sources.includes(urlInput.trim())) setSources(prev => [...prev, urlInput.trim()]);
      setShowUrlInput(false);
      setUrlInput("");
    } catch {
      alert("Enter a valid URL (e.g. https://example.com)");
    }
  };

  return (
    <div className="shrink-0 p-4 relative z-50">
      <div className="flex flex-col gap-1 border border-border/40 rounded-2xl bg-surface/40 backdrop-blur-3xl focus-within:border-primary/40 transition-all focus-within:bg-surface/60 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)]">
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".pdf,.txt" />

        {/* URL input row */}
        {showUrlInput && (
          <div className="flex items-center gap-2 px-4 pt-3">
            <div className="flex-1 flex items-center bg-background/30 border border-border/40 rounded-xl px-3 py-2.5 focus-within:border-primary transition-all backdrop-blur-md">
              <Link2 size={14} className="text-primary opacity-60 mr-2" />
              <input
                autoFocus type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitUrl(); } if (e.key === "Escape") setShowUrlInput(false); }}
                placeholder="Paste research URL..."
                className="flex-1 bg-transparent border-0 outline-none text-[12px] text-foreground placeholder-muted font-semibold"
              />
            </div>
            <button type="button" onClick={submitUrl} className="px-5 py-2.5 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-[0.15em] hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 active:scale-95">Add Source</button>
          </div>
        )}

        {/* Attached sources */}
        {(sources.length > 0 || groundingSources.length > 0 || isUploading) && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {isUploading && (
              <div className="flex items-center gap-2 bg-surface/80 border border-border/40 rounded-lg px-3 py-1.5 animate-pulse">
                <Loader2 size={12} className="text-primary animate-spin" />
                <span className="text-[9px] font-black uppercase tracking-widest text-muted">Indexing Document...</span>
              </div>
            )}
            {groundingSources.map((src, i) => (
              <div key={i} className="flex items-center gap-2 bg-success/10 border border-success/20 rounded-xl px-3 py-1.5 shadow-sm group hover:border-success/40 transition-all">
                <FileText size={12} className="text-success" />
                <span className="text-[10px] font-bold text-success truncate max-w-[140px]">{src.name}</span>
                <button onClick={() => setGroundingSources(p => p.filter((_, j) => j !== i))} className="text-success/40 hover:text-success transition-colors"><X size={12} /></button>
              </div>
            ))}
            {sources.map((src, i) => (
              <div key={i} className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-xl px-3 py-1.5 max-w-[90%] shadow-sm group hover:border-primary/40 transition-all">
                <Link2 size={12} className="text-primary" />
                <span className="text-[10px] font-bold text-primary truncate max-w-[140px]">{src.replace(/^https?:\/\//, "")}</span>
                <button onClick={() => setSources(p => p.filter((_, j) => j !== i))} className="text-primary/40 hover:text-primary transition-colors"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="What are we investigating today?"
          className="w-full text-[13px] bg-transparent border-0 resize-none outline-none px-5 pt-5 pb-2 text-foreground placeholder-muted/50 leading-relaxed min-h-[56px] max-h-[160px] overflow-y-auto font-medium"
          rows={1} disabled={isLoading || isUploading}
        />

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-4 pb-4 mt-1">
          <div className="flex items-center gap-2">
            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setShowPlusMenu(p => !p)}
                className={`w-7 h-7 flex items-center justify-center rounded-xl transition-all border ${showPlusMenu ? "bg-foreground border-foreground text-background rotate-45" : "bg-surface/60 text-muted border-border/40 hover:border-primary/40 hover:text-primary shadow-sm active:scale-90"}`}
              >
                <Plus size={18} strokeWidth={2.5} />
              </button>
              {showPlusMenu && (
                <div className="absolute bottom-full left-0 mb-4 w-[315px] bg-background/95 backdrop-blur-2xl border border-border/40 rounded-[24px] shadow-[0_20px_60px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col z-100">
                  <div className="max-h-[70vh] overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1">
                    <div className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-primary/60 flex items-center justify-between">
                      <span>Intelligence Settings</span>
                      <div className="h-px flex-1 bg-primary/10 ml-4" />
                    </div>

                    <div className="grid grid-cols-2 gap-2 p-1.5">
                      <button type="button" onClick={() => { fileInputRef.current?.click(); setShowPlusMenu(false); }}
                        className="flex items-center gap-3 p-3 rounded-2xl hover:bg-surface/80 transition-all group bg-surface/30 border border-border/10 hover:border-border/40">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform shrink-0"><Paperclip size={18} strokeWidth={2.5} /></div>
                        <div className="text-left min-w-0"><div className="text-[11px] font-bold text-foreground truncate">Documents</div><div className="text-[9px] text-muted font-medium truncate">PDF/TXT grounding</div></div>
                      </button>
                      <button type="button" onClick={() => { setShowUrlInput(p => !p); setShowPlusMenu(false); }}
                        className="flex items-center gap-3 p-3 rounded-2xl hover:bg-surface/80 transition-all group bg-surface/30 border border-border/10 hover:border-border/40">
                        <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center text-success group-hover:scale-110 transition-transform shrink-0"><Link2 size={18} strokeWidth={2.5} /></div>
                        <div className="text-left min-w-0"><div className="text-[11px] font-bold text-foreground truncate">Live URL</div><div className="text-[9px] text-muted font-medium truncate">Instant research</div></div>
                      </button>
                    </div>

                    <div className="px-1.5">
                      <button type="button" onClick={() => { setEnableWebSearch(!enableWebSearch); setShowPlusMenu(false); }}
                        className={`flex items-center justify-between w-full p-3 rounded-2xl transition-all border ${enableWebSearch ? "bg-primary/5 border-primary/20 shadow-sm" : "bg-surface/30 border-border/10 hover:bg-surface/80"}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${enableWebSearch ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-muted/10 text-muted"}`}><Telescope size={18} strokeWidth={2.5} /></div>
                          <div className="text-left"><div className="text-[11px] font-bold text-foreground">Web Discovery</div><div className="text-[9px] text-muted font-medium">{enableWebSearch ? "Live Search Active" : "Internal Knowledge Only"}</div></div>
                        </div>
                        <div className={`w-9 h-5 rounded-full relative transition-colors ${enableWebSearch ? "bg-primary" : "bg-muted/30"}`}>
                          <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all shadow-sm ${enableWebSearch ? "right-1" : "left-1"}`} />
                        </div>
                      </button>
                    </div>

                    <div className="h-px bg-border/10 my-2 mx-4" />
                    <div className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-primary/60 flex items-center justify-between">
                      <span>Newsroom Persona</span>
                      <div className="h-px flex-1 bg-primary/10 ml-4" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-2 gap-2 p-1.5">
                      {PERSONAS.map(p => (
                        <button key={p.id} type="button" onClick={() => { setPersona(p.id); setShowPlusMenu(false); }}
                          className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all border ${persona === p.id ? "bg-primary/10 border-primary/40 text-primary shadow-sm" : "bg-surface/30 border-transparent text-muted hover:bg-surface/60 hover:text-foreground"}`}
                        >
                          <span className="text-xl group-hover:scale-110 transition-transform">{p.icon}</span>
                          <span className="text-[9px] font-black uppercase tracking-tighter">{p.id}</span>
                        </button>
                      ))}
                    </div>

                    <div className="h-px bg-border/10 my-2 mx-4" />
                    <div className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-primary/60 flex items-center justify-between">
                      <span>Brand Voice</span>
                      <div className="h-px flex-1 bg-primary/10 ml-4" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-1.5">
                      {BRAND_VOICES.map(bv => (
                        <button key={bv.id} type="button" onClick={() => { setBrandVoice(bv.id); setShowPlusMenu(false); }}
                          className={`flex flex-col items-start gap-1 p-3 rounded-2xl text-left transition-all border min-h-[64px] ${brandVoice === bv.id ? "bg-primary/10 border-primary/40 text-primary shadow-sm" : "bg-surface/30 border-transparent text-muted hover:bg-surface/60 hover:text-foreground"}`}
                        >
                          <div className="text-[11px] font-black uppercase truncate w-full tracking-tight">{bv.name}</div>
                          <div className="text-[9px] opacity-70 line-clamp-2 w-full font-medium leading-tight">{bv.description}</div>
                        </button>
                      ))}
                    </div>

                    <div className="h-px bg-border/10 my-2 mx-4" />
                    <div className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-primary/60 flex items-center justify-between">
                      <span>Output Language</span>
                      <div className="h-px flex-1 bg-primary/10 ml-4" />
                    </div>
                    <div className="px-1.5 pb-4">
                      <div className="grid grid-cols-3 gap-2">
                        {LANGUAGES.map(lang => (
                          <button key={lang.id} type="button" onClick={() => { setLanguage(lang.id); setShowPlusMenu(false); }}
                            className={`flex flex-col items-center p-2 rounded-2xl text-[10px] font-bold transition-all border ${language === lang.id ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" : "bg-surface/30 border-transparent text-muted hover:bg-surface/60 hover:text-foreground"}`}
                          >
                            <span className="text-lg shrink-0">{lang.flag}</span>
                            <span className="truncate">{lang.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[200px] xs:max-w-[280px] p-0.5">
              {enableWebSearch && <span className="shrink-0 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-bold text-primary">Deep Research</span>}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-bold text-primary whitespace-nowrap">
                <span className="opacity-60">{PERSONAS.find(p => p.id === persona)?.icon}</span>
                {persona}
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-500 whitespace-nowrap">
                <Languages size={10} className="opacity-60" />
                {LANGUAGES.find(l => l.id === language)?.name || language}
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 border border-success/20 text-[10px] font-bold text-success whitespace-nowrap">
                <FileText size={10} className="opacity-60" />
                {BRAND_VOICES.find(v => v.id === brandVoice)?.name || brandVoice}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleListening}
              className={`w-8 h-8 flex items-center justify-center border transition-all rounded-xl ${isListening ? "bg-red-500 border-red-500 text-white animate-pulse shadow-lg shadow-red-500/20" : "bg-surface/60 text-muted border-border/40 hover:text-foreground hover:border-border active:scale-90"}`}>
              <Mic size={16} strokeWidth={2.5} />
            </button>
            {isLoading ? (
              <button type="button" onClick={onStop}
                className="w-8 h-8 rounded-xl flex items-center justify-center bg-foreground text-background transition-all hover:scale-105 active:scale-90 shadow-lg shadow-black/10"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button type="button" onClick={onSend}
                disabled={(!input.trim() && sources.length === 0 && groundingSources.length === 0) || isLoading || isUploading}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${(input.trim() || sources.length > 0 || groundingSources.length > 0) && !isLoading && !isUploading ? "bg-primary text-white shadow-xl shadow-primary/30 scale-110 hover:scale-115 active:scale-95" : "bg-surface/40 text-muted opacity-30 cursor-not-allowed"}`}
              >
                <ArrowRight size={20} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
