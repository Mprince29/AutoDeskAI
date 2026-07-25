"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Newspaper, ArrowRight, Plus, History, ChevronLeft, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { getFriendlyErrorText, toastError, toastSuccess, toastInfo } from "@/lib/friendly-errors";
import { useAuth } from "@/context/AuthContext";

// Types & Services
import { Message, GroundingSource, ArticleData } from "@/types/journalist.types";
import { 
  generateContent, 
  generateImage, 
  generateSocialKit, 
  getReports, 
  deleteReport,
  saveReport 
} from "@/services/journalist.service";
import { MobileViewToggle } from "./_components/MobileViewToggle";
import { MessageBubble } from "./_components/MessageBubble";
import { ChatInput } from "./_components/ChatInput";
import ArticleEditor from "./_components/ArticleEditor";
import HistoryPanel from "./_components/HistoryPanel";
import { useJournalistStore } from "@/store/journalistStore";

export default function AIJournalistPage() {
  const { user } = useAuth();

  // State
  const {
    messages,
    setMessages,
    dbReports,
    setDbReports,
    dbSessions,
    activeReportId,
    setActiveReportId,
    activeSessionId,
    setActiveSessionId,
    selectedAssistantMsgId,
    setSelectedAssistantMsgId,
    loadSessions,
  } = useJournalistStore();

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mobileView, setMobileView] = useState<"chat" | "editor">("chat");
  const [input, setInput] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [groundingSources, setGroundingSources] = useState<GroundingSource[]>([]);
  const [persona, setPersona] = useState("Analytical");
  const [brandVoice, setBrandVoice] = useState("Default");
  const [language, setLanguage] = useState("English");
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [isGeneratingSocialKit, setIsGeneratingSocialKit] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Tracks the latest saved report ID for the CURRENT chat session.
  // Used to send reportId on follow-up turns so the backend updates the same row.
  const currentSessionReportIdRef = useRef<number | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (user?.email) {
      loadSessions(user.email);
    }
  }, [user?.email, loadSessions]);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      toastInfo("Generation stopped by user.");
    }
  }, []);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && sources.length === 0 && groundingSources.length === 0) || isLoading) return;

    const userText = input.trim();
    setInput("");
    setSources([]);
    setGroundingSources([]);

    const userMsgId = Math.random().toString(36).slice(2);
    const pendingId = Math.random().toString(36).slice(2);

    const history = messages.map(m => ({ role: m.role, content: m.content }));

    // Always append new user and assistant messages for every query
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: "user", content: userText },
      {
        id: pendingId,
        role: "assistant",
        content: "Generation initializing...",
        pending: true,
        pendingStatuses: ["Contacting Newsroom..."]
      },
    ]);

    const currentSessionId = activeSessionId || crypto.randomUUID();
    if (!activeSessionId) setActiveSessionId(currentSessionId);

    setIsLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await generateContent(
        user?.email || "",
        {
          query: userText,
          category: "Technology",
          tone: "Journalistic",
          persona,
          enable_web_search: enableWebSearch,
          target_audience: "General Professionals",
          sources,
          grounding_sources: groundingSources,
          history,
          brand_voice: brandVoice !== "Default" ? brandVoice : undefined,
          language,
          report_id: currentSessionReportIdRef.current ?? undefined,
          session_id: currentSessionId
        },
        (statusMsg) => {
          setMessages(prev => prev.map(m =>
            m.id === pendingId
              ? { ...m, pendingStatuses: [...(m.pendingStatuses || []), statusMsg] }
              : m
          ));
        },
        (chunk) => {
          setMessages(prev => prev.map(m =>
            m.id === pendingId
              ? {
                ...m,
                content: m.content === "Generation initializing..." ? chunk : m.content + chunk
              }
              : m
          ));
        },
        controller.signal,
        (percentage) => {
          setMessages(prev => prev.map(m =>
            m.id === pendingId
              ? { ...m, progress: percentage }
              : m
          ));
        }
      );
      setMessages(prev => prev.map(m => {
        if (m.id === pendingId) {
          const newVersions = [result];
          return {
            ...m,
            pending: false,
            content: result.markdown_content,
            articleData: result,
            imageUrl: result.image_url || null,
            socialKit: result.social_kit || null,
            versions: newVersions,
            activeVersionIndex: 0,
            updatedAt: Date.now()
          };
        }
        return m;
      }));
      
      // UPSERT: If we just created the first report in a session, track its ID.
      // If result.id changed, we update the list.
      if (result.id) {
        setActiveReportId(result.id);
        currentSessionReportIdRef.current = result.id;
        setDbReports(prev => {
          const index = prev.findIndex(r => r.id === result.id);
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = result;
            return updated;
          }
          return [result, ...prev];
        });
      }

      setSelectedAssistantMsgId(pendingId);
      setMobileView("editor");

      // Refresh sessions in background so history panel shows updated version count
      if (user?.email) loadSessions(user.email, true);

    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages(prev => prev.map(m => m.id === pendingId ? { ...m, pending: false, content: "Generation cancelled by user." } : m));
        return;
      }
      const msg = getFriendlyErrorText(err, "generate_content");
      // Surface API key errors as a persistent banner so users can't miss them
      const errStr = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (errStr.includes("missing ai provider") || errStr.includes("api key") || errStr.includes("provider key")) {
        setApiKeyError(msg);
      }
      setMessages(prev => prev.map(m =>
        m.id === pendingId
          ? {
              ...m,
              pending: false,
              content: `### Editorial Update Required\n\n${msg}`
            }
          : m
      ));
      toastError(err, "generate_content");
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, sources, groundingSources, isLoading, messages, persona, enableWebSearch, user?.email]);

  const handleNewChat = () => {
    setMessages([]);
    setSelectedAssistantMsgId(null);
    setIsHistoryOpen(false);
    setActiveReportId(null);
    setActiveSessionId(null);
    currentSessionReportIdRef.current = null;
  };

  const handleImageGenerate = async (msgId: string, topic: string, category: string, articleContent?: string, reportId?: number) => {
    try {
      const url = await generateImage(topic, category, user?.email || "", articleContent, reportId);
      if (url) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, imageUrl: url } : m));
        // Update archive list
        if (reportId) {
          setDbReports(prev => prev.map(r => r.id === reportId ? { ...r, image_url: url } : r));
        }
        toastSuccess("AI Cover Image generated successfully! do check in editor section!");
      }
    } catch (err) {
      toastError(err, "generate_image");
    }
  };

  const handleSocialKitGenerate = async (msgId: string, content: string, reportId?: number, options?: { platforms: string[], moreHashtags: boolean, prompt?: string }) => {
    try {
      setIsGeneratingSocialKit(true);
      const kit = await generateSocialKit(content, user?.email || "", reportId, options);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, socialKit: kit } : m));
      // Update archive list
      if (reportId) {
        setDbReports(prev => prev.map(r => r.id === reportId ? { ...r, social_kit: kit } : r));
      }
      toastSuccess("Social Media Kit generated successfully! do check in editor section!");
    } catch { 
      toastError("Failed to generate social media kit.");
    } finally {
      setIsGeneratingSocialKit(false);
    }
  };
  
  const handleManualSave = async (content: string) => {
    if (!currentSessionReportIdRef.current || !user?.email || isSaving) return;
    
    try {
      setIsSaving(true);
      const res = await saveReport(
        currentSessionReportIdRef.current,
        user.email,
        content
      );
      
      if (res) {
        toastSuccess("Content saved successfully!");
        loadSessions(user.email, true);
      }
    } catch (err) {
      toastError(err, "save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteReport = async (reportId: number) => {
    try {
      if (!user?.email) return;
      await deleteReport(reportId, user.email);
      
      // Update local states
      setDbReports(prev => prev.filter(r => r.id !== reportId));
      setMessages(prev => prev.filter(m => {
        // Remove both the user query and assistant report associated with this ID
        const suffix = `-${reportId}`;
        return !m.id.endsWith(suffix);
      }));
      
      if (selectedAssistantMsgId === `report-${reportId}`) {
        setSelectedAssistantMsgId(null);
      }
      
      toastSuccess("Report deleted successfully.");
    } catch (err) {
      console.error("Failed to delete report:", err);
      toastError(err, "delete_report");
    }
  };

  const currentArticleMsg = messages.find(m => m.id === selectedAssistantMsgId) || [...messages].reverse().find(m => m.role === "assistant" && m.articleData);

  return (
    <div className="relative flex flex-col h-full bg-background overflow-hidden font-sans">
      {/* Ambient Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-5%] left-[-5%] w-[35%] h-[35%] bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[35%] h-[35%] bg-primary/5 rounded-full blur-[100px]" />
      </div>

      <MobileViewToggle 
        view={mobileView} 
        setView={setMobileView} 
        onNewChat={handleNewChat}
        onHistoryOpen={() => setIsHistoryOpen(true)}
      />

      <div className="relative z-10 flex flex-1 overflow-hidden">

        {/* LEFT: Chat Panel */}
        <div className={`w-full md:w-[380px] shrink-0 flex flex-col bg-[var(--bg-primary)] border-r border-border ${mobileView === "chat" ? "flex" : "hidden md:flex"}`}>

          {/* Chat Panel Header - Premium Controls (Hidden on mobile as it's now in the unified top header) */}
          <div className="sticky top-0 z-40 hidden md:flex items-center justify-between px-3 py-2.5 bg-background/60 backdrop-blur-xl border-b border-border/10">
            <Link
              href="/playground"
              className="flex items-center gap-2 text-[12px] font-bold text-muted hover:text-foreground transition-all"
            >
              <div className="w-8 h-8 rounded-lg bg-surface/50 border border-border flex items-center justify-center hover:bg-primary hover:text-white hover:border-primary transition-all active:scale-95">
                <ChevronLeft size={16} />
              </div>
            </Link>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handleNewChat}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest bg-primary text-white hover:bg-primary/90 transition-all active:scale-95"
              >
                <Plus size={14} strokeWidth={3} />
                <span className="hidden xs:inline">New Chat</span>
              </button>
              <button
                onClick={() => setIsHistoryOpen(true)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:bg-surface/80 hover:text-foreground border border-transparent hover:border-border/40 transition-all"
                title="View History"
              >
                <History size={16} />
              </button>
            </div>
          </div>

          {/* Persistent API key error banner */}
          {apiKeyError && (
            <div className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-400">
              <span className="mt-0.5 shrink-0 text-red-400">⚠</span>
              <div className="flex-1">
                <span className="font-semibold">API Key Required — </span>
                {apiKeyError}{" "}
                <Link href="/settings" className="underline underline-offset-2 hover:text-red-300 transition-colors">
                  Go to Settings →
                </Link>
              </div>
              <button onClick={() => setApiKeyError(null)} className="shrink-0 text-red-400/60 hover:text-red-300 transition-colors text-base leading-none">×</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
            {isHistoryOpen ? (
              <HistoryPanel 
                sessions={dbSessions}
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                onSelect={(reportIdStr) => {
                  const numericId = parseInt(reportIdStr.split("-")[1]);
                  const selectedReport = dbReports.find(r => r.id === numericId);
                  
                  if (selectedReport) {
                    // Find all physical database rows in the same session (legacy multi-row support)
                    const sessionRows = dbReports
                      .filter(r => 
                        selectedReport.session_id 
                          ? r.session_id === selectedReport.session_id
                          : r.topic === selectedReport.topic && !r.session_id
                      )
                      .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

                    // Flatten physical rows and their internal JSON versions into a single timeline
                    const allVersions: ArticleData[] = [];
                    sessionRows.forEach(row => {
                      if (row.versions && Array.isArray(row.versions)) {
                        allVersions.push(...(row.versions as ArticleData[]));
                      }
                      allVersions.push(row);
                    });

                    // Sort everything by creation time
                    allVersions.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

                    // Map all versions to separate message pairs
                    const newMessages: Message[] = [];
                    allVersions.forEach((v, idx) => {
                      // For the first version, use the actual topic
                      // For subsequent versions, use a "Refinement" placeholder
                      newMessages.push({
                        id: `user-v${idx}-${selectedReport.id}`,
                        role: "user",
                        content: idx === 0 ? v.topic : "Refine and improve article..."
                      });
                      
                      newMessages.push({
                        id: `assistant-v${idx}-${v.id || idx}`,
                        role: "assistant",
                        content: v.markdown_content,
                        articleData: v,
                        imageUrl: v.image_url || null,
                        socialKit: v.social_kit || null,
                        updatedAt: new Date(v.created_at || '').getTime()
                      });
                    });

                    setMessages(newMessages);
                    
                    // Select the latest one by default
                    const latestMsg = newMessages[newMessages.length - 1];
                    setSelectedAssistantMsgId(latestMsg.id);
                    
                    setActiveReportId(selectedReport.id || null);
                    setActiveSessionId(selectedReport.session_id || null);
                    currentSessionReportIdRef.current = selectedReport.id || null;
                    setIsHistoryOpen(false);
                    setMobileView("editor");
                  }
                }}
                onDelete={handleDeleteReport}
                inline
              />
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-b from-transparent to-surface/5">
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-16 h-16 p-4 rounded-3xl bg-gradient-to-tr from-primary to-primary/60 flex items-center justify-center mb-4 shadow-2xl shadow-primary/30 relative group"
                >
                  <Newspaper className="w-8 h-8 text-white relative z-10" />
                  <div className="absolute inset-0 rounded-3xl bg-primary animate-pulse blur-xl opacity-20" />
                </motion.div>
                <h2 className="text-[20px] font-bold text-foreground mb-2 tracking-tighter">AI Journalist</h2>
                <p className="text-[10px] font-semibold text-muted mb-8 max-w-[260px] leading-relaxed uppercase tracking-widest opacity-60">
                  Autonomous Editorial Engine
                </p>
                <div className="w-full flex flex-col gap-4 max-w-[320px]">
                  {[
                    "Investigate the impact of new semiconductor subsidies on India's hardware startups.",
                    "Analyze how the shift to EV is disrupting traditional auto-component hubs in Pune.",
                    "Draft an investigative report on the sustainability of green hydrogen in India's heavy industry.",
                  ].map((s, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 * i }}
                      onClick={() => setInput(s)}
                      className="w-full text-left p-5 rounded-2xl border border-border/30 bg-surface/30 hover:border-primary/40 hover:bg-surface/50 transition-all text-[12px] font-medium text-muted hover:text-foreground flex items-center justify-between group backdrop-blur-sm"
                    >
                      <span className="leading-snug pr-4">{s}</span>
                      <ArrowRight className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0 -translate-x-2 group-hover:translate-x-0" />
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-2">
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isSelected={selectedAssistantMsgId === msg.id}
                    onSelect={() => setSelectedAssistantMsgId(msg.id)}
                    onRewrite={() => {
                      if (msg.articleData) {
                        const cleanTopic = msg.articleData.topic.replace(/^Please rewrite the article about\s*["']?|["']?\s*$/gi, '').trim();
                        setInput(`Please rewrite the article about "${cleanTopic}"`);
                      }
                    }}
                    onGenerateImage={() => msg.articleData && handleImageGenerate(msg.id, msg.articleData.topic, msg.articleData.category, msg.articleData.markdown_content, msg.articleData.id)}
                    onGenerateSocialKit={() => msg.articleData && handleSocialKitGenerate(msg.id, msg.articleData.markdown_content, msg.articleData.id)}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <AnimatePresence>
            {isLoading && (
              <motion.div 
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: 10, height: 0 }}
                className="mx-3 mb-3 p-3 rounded-2xl bg-primary/5 border border-primary/10 flex items-start gap-3 backdrop-blur-md"
              >
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm">✨</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-foreground font-bold uppercase tracking-widest mb-1">Background Pipeline Active</p>
                  <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                    You can switch to other pages (Chat or Inbox) while your report generates. We'll keep working in the background!
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <ChatInput
            input={input}
            setInput={setInput}
            onSend={handleSend}
            onStop={handleStopGeneration}
            isLoading={isLoading}
            email={user?.email || ""}
            sources={sources}
            setSources={setSources}
            groundingSources={groundingSources}
            setGroundingSources={setGroundingSources}
            persona={persona}
            setPersona={setPersona}
            brandVoice={brandVoice}
            setBrandVoice={setBrandVoice}
            language={language}
            setLanguage={setLanguage}
            enableWebSearch={enableWebSearch}
            setEnableWebSearch={setEnableWebSearch}
          />
        </div>

        {/* RIGHT: Editor Panel */}
        <div className={`flex-1 flex flex-col min-w-0 bg-[var(--bg-primary)] ${mobileView === "editor" ? "flex" : "hidden md:flex"}`}>
          {currentArticleMsg ? (
            <ArticleEditor
              key={`${currentArticleMsg.id}-${currentArticleMsg.activeVersionIndex || 0}`}
              id={currentArticleMsg.id}
              content={currentArticleMsg.articleData?.markdown_content || currentArticleMsg.content}
              imageUrl={currentArticleMsg.imageUrl}
              socialKit={currentArticleMsg.socialKit}
              audit={currentArticleMsg.articleData?.audit}
              sources={currentArticleMsg.articleData?.sources}
              articleData={currentArticleMsg.articleData}
              onGenerateImage={(t, c, content, rId) => handleImageGenerate(currentArticleMsg.id, t, c, content, rId)}
              onGenerateSocialKit={(content, rId, options) => handleSocialKitGenerate(currentArticleMsg.id, content, rId, options)}
              isGeneratingSocialKit={isGeneratingSocialKit}
              onManualSave={handleManualSave}
              isSaving={isSaving}
              onSave={(newContent) => {
                setMessages(prev => prev.map(m =>
                  m.id === currentArticleMsg.id
                    ? { ...m, content: newContent, articleData: m.articleData ? { ...m.articleData, markdown_content: newContent } : undefined }
                    : m
                ));
              }}
              brandVoice={brandVoice}
              persona={persona}
              email={user?.email || ""}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center relative bg-background px-8 text-center overflow-hidden">
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)", backgroundSize: "32px 32px" }} />
              <div className="relative z-10 flex flex-col items-center max-w-[440px]">
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="w-24 h-24 mb-10 rounded-[2.5rem] bg-gradient-to-br from-surface to-transparent flex items-center justify-center border border-border/40 shadow-2xl relative"
                >
                  <Newspaper className="w-12 h-12 text-primary" />
                  <div className="absolute -top-2 -right-2 w-6 h-6 rounded-lg bg-success/20 border border-success/40 flex items-center justify-center">
                    <CheckCircle2 className="w-3 h-3 text-success" />
                  </div>
                </motion.div>
                <h2 className="text-[24px] font-bold text-foreground mb-3 tracking-tighter">Your Canvas Awaits</h2>
                <p className="text-[14px] text-muted leading-relaxed mb-10 text-pretty font-medium opacity-80">
                  Describe a topic in the chat panel to generate a deep-dive semantic article with visuals and social assets.
                </p>
                <div className="flex gap-3 flex-wrap justify-center">
                  {["SEO Optimization", "Research Grounding", "AI Visuals", "Social Kits"].map(tag => (
                    <div key={tag} className="px-4 py-2 rounded-2xl border border-border/40 bg-surface/50 text-[11px] font-bold uppercase tracking-widest text-muted flex items-center gap-2.5 hover:border-primary/30 transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                      {tag}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
