"use client";

import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Volume2, VolumeX, ImageIcon, Share2, RotateCcw, Check, ArrowRight } from "lucide-react";
import { Message } from "@/types/journalist.types";
import { StatusLoader } from "./StatusLoader";
import { motion } from "framer-motion";

interface MessageBubbleProps {
  msg: Message;
  isSelected?: boolean;
  onSelect?: () => void;
  onRewrite: () => void;
  onGenerateImage: () => void;
  onGenerateSocialKit: () => void;
}

export function MessageBubble({
  msg,
  isSelected,
  onSelect,
  onRewrite,
  onGenerateImage,
  onGenerateSocialKit,
}: MessageBubbleProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGenImage, setIsGenImage] = useState(false);
  const [isGenKit, setIsGenKit] = useState(false);

  useEffect(() => {
    if (msg.imageUrl) setIsGenImage(false);
    if (msg.socialKit) setIsGenKit(false);
  }, [msg.imageUrl, msg.socialKit]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
    };
  }, []);

  const handleSpeech = () => {
    if (typeof window === "undefined") return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const text = (msg.articleData?.markdown_content || msg.content)
      .replace(/#+\s/g, "")
      .replace(/[*_~`]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();
    const utt = new SpeechSynthesisUtterance(text);
    utt.onstart = () => setIsSpeaking(true);
    utt.onend = () => setIsSpeaking(false);
    utt.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utt);
  };

  if (msg.role === "user") {
    return (
      <div className="w-full flex justify-end px-4 py-3">
        <div className="bg-primary text-white rounded-[20px_20px_4px_20px] py-3 px-5 text-[13px] leading-relaxed max-w-[85%] shadow-xl shadow-primary/10 font-medium">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`w-full flex justify-start px-4 py-3 transition-all duration-300 ${msg.articleData ? "cursor-pointer group/msg relative" : ""}`}
      onClick={() => msg.articleData && onSelect?.()}
    >
      <div className={`flex flex-col gap-2 max-w-[100%] w-full p-4 rounded-[20px_20px_20px_4px] border transition-all duration-300 backdrop-blur-xl ${isSelected ? "bg-surface/80 border-border shadow-2xl shadow-primary/5" : "bg-surface/40 border-border/40 hover:border-border/60"}`}>
        <div className="text-[var(--text-primary)]">
          {msg.pending ? (
            <div className="space-y-6">
              <StatusLoader statuses={msg.pendingStatuses || []} />
              {msg.progress !== undefined && (
                <div className="space-y-2 px-1">
                  <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-primary/70">
                    <span className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-primary animate-pulse" />
                      Research Progress
                    </span>
                    <span>{msg.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-primary/5 rounded-full overflow-hidden border border-primary/10">
                    <motion.div 
                      className="h-full bg-gradient-to-r from-primary/60 to-primary shadow-[0_0_15px_rgba(var(--primary-rgb),0.3)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${msg.progress}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary flex items-center gap-2 opacity-80">
                  <div className="w-1 h-1 rounded-full bg-primary" />
                  Generated Article
                </div>
                {msg.updatedAt && (
                  <span className="text-[9px] text-muted">
                    {new Date(msg.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              <div className="relative group/content mb-4 bg-background/40 p-4 rounded-2xl border border-border/20 hover:bg-background/60 transition-colors">
                <div className={`prose prose-sm dark:prose-invert max-w-none text-[12.5px] leading-[1.7] text-muted font-medium ${msg.articleData ? "line-clamp-[8] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent_100%)]" : ""}`}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({node, ...props}) => <h1 className="text-[13px] font-bold text-foreground mb-3 mt-0 tracking-tight" {...props} />,
                      h2: ({node, ...props}) => <h2 className="text-[12px] font-bold text-foreground mb-2 mt-4 tracking-tight" {...props} />,
                      p: ({node, ...props}) => <p className="mb-3 last:mb-0" {...props} />,
                      ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 space-y-1.5" {...props} />,
                      li: ({node, ...props}) => <li className="marker:text-primary/60" {...props} />,
                      a: ({node, ...props}) => <a className="text-primary hover:underline font-bold uppercase tracking-widest text-[9px]" target="_blank" {...props} />
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
                
                 {/* {msg.articleData && msg.content.length > 150 && (
                  <div className="absolute inset-x-0 bottom-0 py-4 flex items-center justify-center pointer-events-none opacity-0 group-hover/content:opacity-100 transition-all duration-300 translate-y-2 group-hover/content:translate-y-0">
                    <div className="px-3 py-1 rounded-xl bg-primary text-white text-[9px] font-bold uppercase tracking-widest shadow-2xl shadow-primary/30 flex items-center gap-2 backdrop-blur-xl border border-white/10">
                      <span>View Report</span>
                      <ArrowRight size={10} strokeWidth={3} />
                    </div>
                  </div>
                )} */}
              </div>

              {msg.articleData && !msg.pending && (
                <div className="flex w-full items-center gap-2 overflow-x-auto flex-nowrap no-scrollbar mt-4 pb-1">
                  <button
                    onClick={handleSpeech}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground/10 border border-border/40 text-[10px] font-bold text-muted hover:text-foreground hover:border-primary/50 transition-all active:scale-95"
                  >
                    {isSpeaking ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    {isSpeaking ? "Stop" : "Listen"}
                  </button>
                  <button
                    onClick={onRewrite}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground/10 border border-border/40 text-[10px] font-bold text-muted hover:text-foreground hover:border-primary/50 transition-all active:scale-95"
                  >
                    <RotateCcw size={12} />
                    Rewrite
                  </button>
                  <button
                    onClick={() => { if (!msg.imageUrl) { setIsGenImage(true); onGenerateImage(); } }}
                    disabled={isGenImage || !!msg.imageUrl}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-bold transition-all active:scale-95 ${
                      msg.imageUrl 
                        ? "bg-success/5 border-success/20 text-success pointer-events-none" 
                        : "bg-foreground/10 border-border/40 text-muted hover:text-foreground hover:border-primary/50"
                    }`}
                  >
                    {msg.imageUrl ? <Check size={12} /> : <ImageIcon size={12} className={isGenImage ? "animate-pulse" : ""} />}
                    {isGenImage ? "Generating..." : (msg.imageUrl ? "Cover Created" : "AI Cover")}
                  </button>
                  <button
                    onClick={() => { if (!msg.socialKit) { setIsGenKit(true); onGenerateSocialKit(); } }}
                    disabled={isGenKit || !!msg.socialKit}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-bold transition-all active:scale-95 ${
                      msg.socialKit 
                        ? "bg-success/5 border-success/20 text-success pointer-events-none" 
                        : "bg-foreground/10 border-border/40 text-muted hover:text-foreground hover:border-primary/50"
                    }`}
                  >
                    {msg.socialKit ? <Check size={12} /> : <Share2 size={12} className={isGenKit ? "animate-pulse" : ""} />}
                    {isGenKit ? "Generating..." : (msg.socialKit ? "Social Created" : "Social Kit")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
