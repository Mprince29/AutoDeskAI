import React, { useState, useEffect, useRef } from 'react';
import { apiService, AgentStatus } from '@/services/api';
import {
  MessageSquare,
  Send,
  Bot,
  X,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  Paperclip,
  FileText
} from 'lucide-react';
import { getToolIcon } from '@/utils/toolIcons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AdvisorToast, { AdvisorAdvice } from './AdvisorToast';
import { appendTokenLog } from './CostWidget';

interface AIAgentChatProps {
  userEmail: string;
  onProcessEmails?: () => void;
}

interface ChatMessage {
  id: string;
  type: 'user' | 'agent';
  content: string;
  timestamp: Date;
  toolsUsed?: string[];
}

const TOOL_LABELS: Record<string, string> = {
  thinking: 'Thinking...',
  create_document: 'Creating Document',
  create_folder: 'Creating Folder',
  share_file: 'Sharing File',
  get_file_info: 'Reading File Info',
  send_email: 'Sending Email',
  list_emails: 'Fetching Emails',
  get_email: 'Reading Email',
  delete_email: 'Deleting Email',
  modify_labels: 'Modifying Labels',
  create_draft: 'Creating Draft',
  get_drafts: 'Fetching Drafts',
  send_draft: 'Sending Draft',
  delete_draft: 'Deleting Draft',
  create_calendar_event: 'Scheduling Event',
  list_events: 'Fetching Events',
  check_availability: 'Checking Calendar',
  delete_event: 'Deleting Event',
  suggest_times: 'Suggesting Times',
  create_spreadsheet: 'Creating Spreadsheet',
  get_sheet_data: 'Reading Spreadsheet',
  write_sheet_data: 'Writing to Spreadsheet',
  append_rows: 'Appending Rows',
  create_form: 'Creating Form',
  get_form_responses: 'Reading Form Responses',
  create_presentation: 'Creating Presentation',
  get_presentation: 'Reading Presentation',
  web_search: 'Searching Web'
};

function formatToolName(tool: string) {
  return TOOL_LABELS[tool] || tool.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

const AIAgentChat: React.FC<AIAgentChatProps> = ({ userEmail, onProcessEmails }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<string>('');
  const [streamTools, setStreamTools] = useState<string[]>([]);
  const [advice, setAdvice] = useState<AdvisorAdvice | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkAgentStatus(); loadChatHistory(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const checkAgentStatus = async () => {
    try {
      const status = await apiService.getLegacyAgentStatus(userEmail);
      setAgentStatus(status);
    } catch (error) {
      console.error('Error checking agent status:', error);
    }
  };

  const loadChatHistory = async () => {
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL;
      const res = await fetch(
        `${API_BASE}/api/agents/chat/history?email=${encodeURIComponent(userEmail)}&limit=20`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!data.messages?.length) return;
      const hydrated: ChatMessage[] = data.messages.map(
        (m: { role: string; content: string }, i: number) => ({
          id: `history-${i}`,
          type: m.role === 'assistant' ? 'agent' : 'user',
          content: m.content,
          timestamp: new Date(),
        })
      );
      setMessages(hydrated);
    } catch {
      // history is non-critical - silently ignore
    }
  };

  const initializeAgent = async () => {
    setIsInitializing(true);
    try {
      await apiService.initializeAgent(userEmail);
      await checkAgentStatus();
      setMessages([{
        id: Date.now().toString(),
        type: 'agent',
        content: "Hello! I'm Sync. I can help you with emails, scheduling, forms, and presentations. How can I assist you today?",
        timestamp: new Date()
      }]);
    } catch {
      setMessages([{
        id: Date.now().toString(),
        type: 'agent',
        content: "Sorry, I couldn't initialize. Please try again later.",
        timestamp: new Date()
      }]);
    } finally {
      setIsInitializing(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const baseMessage = inputMessage;
    const finalPrompt = uploadedDocId
      ? `[Context: I have attached a document with doc_id="${uploadedDocId}" for your reference. Use the 'read_uploaded_document' tool with this ID if you need to read it.]\\n\\n${baseMessage}`
      : baseMessage;

    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      type: 'user',
      content: baseMessage + (uploadedFilename ? `\\n\\n**(Attached: ${uploadedFilename})**` : ''),
      timestamp: new Date()
    }]);
    setInputMessage('');
    setIsLoading(true);
    setStreamStatus('AI is orchestrating tools...');
    setStreamTools([]);

    try {
      await apiService.chatWithAgentStream(userEmail, { message: finalPrompt }, (event) => {
        if (event.type === 'status') {
          setStreamStatus(event.message ?? '');
          if (event.message?.includes('Thinking')) {
            setStreamTools(prev => prev.includes('thinking') ? prev : [...prev, 'thinking']);
          }
        } else if (event.type === 'tool_call') {
          setStreamStatus(`Using ${(event.tool ?? '').replace(/_/g, ' ')}...`);
          setStreamTools(prev => [...prev.filter(t => t !== 'thinking'), ...(event.tool ? [event.tool] : [])]);
        } else if (event.type === 'result') {
          setUploadedDocId(null);
          setUploadedFilename(null);
          const finalTools = event.tools_used && event.tools_used.length > 0
            ? ['thinking', ...event.tools_used]
            : event.tools_used;
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            type: 'agent',
            content: event.text || 'I processed your request.',
            timestamp: new Date(),
            toolsUsed: finalTools
          }]);
          if (event.advice) setAdvice(event.advice);
          if (event.token_count) appendTokenLog(event.token_count, event.model_used || 'unknown');
        } else if (event.error) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            type: 'agent',
            content: `Error: ${event.error}`,
            timestamp: new Date()
          }]);
        }
      });
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        type: 'agent',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
      setStreamStatus('');
      setStreamTools([]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const processEmailsWithAgent = async () => {
    setIsLoading(true);
    try {
      const result = await apiService.processEmailsWithAgent(userEmail);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        type: 'agent',
        content: `I've analyzed your emails and found some insights:\n\n${result.insights?.join('\n') || 'No specific insights available.'}\n\n${result.suggestions?.join('\n') || ''}`,
        timestamp: new Date()
      }]);
      if (onProcessEmails) onProcessEmails();
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        type: 'agent',
        content: "Sorry, I couldn't process your emails right now. Please try again later.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickActions = [
    { label: 'Smart Summary', action: processEmailsWithAgent, icon: Sparkles },
    {
      label: 'Auto-Schedule',
      action: () => { setInputMessage('Can you help me auto-schedule a meeting?'); setTimeout(sendMessage, 100); },
      icon: MessageSquare
    }
  ];

  /* ── FAB ── */
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 p-4 text-foreground rounded-2xl shadow-2xl transition-all duration-200 hover:scale-110 z-50"
        style={{
          background: 'var(--primary-gradient)',
          boxShadow: '0 4px 24px var(--primary-glow)',
        }}
        title="Chat with AI Agent"
      >
        <Bot className="w-6 h-6" />
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed bottom-6 right-6 w-96 h-[520px] border border-[var(--glass-border)] rounded-2xl shadow-2xl z-50 flex flex-col animate-scale-in overflow-hidden"
        style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)' }}
      >
        {/* Top gradient line */}
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: 'var(--primary-gradient)' }} />

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)]"
          style={{ background: 'color-mix(in srgb, var(--surface) 60%, transparent)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="p-1.5 rounded-xl"
              style={{ background: 'var(--primary-gradient)', boxShadow: '0 0 12px var(--primary-glow)' }}
            >
              <Bot className="w-4 h-4 text-foreground" />
            </div>
            <span className="font-semibold text-foreground text-sm">Sync</span>
            {agentStatus?.enabled && (
              <span className="px-2 py-0.5 bg-success/10 text-success text-[10px] font-semibold rounded-full border border-success/25">
                Active
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 hover:bg-surface rounded-lg text-muted hover:text-foreground transition-colors"
            >
              {isMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 hover:bg-surface rounded-lg text-muted hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background/40">
              {!agentStatus?.enabled && messages.length === 0 && (
                <div className="text-center py-10">
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                    style={{ background: 'var(--primary-gradient)', boxShadow: '0 4px 20px var(--primary-glow)' }}
                  >
                    <Bot className="w-7 h-7 text-foreground" />
                  </div>
                  {agentStatus?.status === 'disabled' && (
                    <div className="mb-4">
                      <p className="text-muted mb-1 text-sm">Sync is currently offline</p>
                      <p className="text-[10px] text-muted-dark">{agentStatus.message}</p>
                    </div>
                  )}
                  {agentStatus?.status === 'no_api_key' && (
                    <div className="mb-4">
                      <p className="text-muted mb-1 text-sm">AI API key not configured</p>
                      <p className="text-[10px] text-muted-dark">{agentStatus.message}</p>
                    </div>
                  )}
                  {!agentStatus?.status && (
                    <p className="text-muted mb-5 text-sm">Sync is ready to deploy!</p>
                  )}
                  <button
                    onClick={initializeAgent}
                    disabled={isInitializing || agentStatus?.status === 'disabled' || agentStatus?.status === 'no_api_key'}
                    className="btn-primary mx-auto"
                  >
                    {isInitializing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isInitializing ? 'Initializing...' : 'Start Chat'}
                  </button>
                </div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[82%] p-3 rounded-2xl text-sm shadow-sm ${message.type === 'user'
                      ? 'text-foreground rounded-tr-sm'
                      : 'bg-surface border border-border text-foreground rounded-tl-sm'
                      }`}
                    style={message.type === 'user' ? {
                      background: 'var(--primary-gradient)',
                      boxShadow: '0 2px 12px var(--primary-glow)',
                    } : {}}
                  >
                    <div className="prose dark:prose-invert max-w-none text-sm break-words whitespace-pre-wrap leading-relaxed chat-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node: _node, ...props }) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline decoration-primary/30 font-semibold"
                            />
                          )
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>

                    {message.toolsUsed && message.toolsUsed.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3.5 pt-3 border-t border-border/40">
                        {message.toolsUsed.map((tool, idx) => {
                          const Icon = getToolIcon(tool);
                          return (
                            <div
                              key={idx}
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-background/50 border border-border/30 shadow-sm text-xs text-muted transition-colors hover:bg-background/70"
                              title={tool}
                            >
                              <div className="shrink-0 bg-white dark:bg-zinc-800 flex items-center justify-center p-1 rounded-lg border border-border/40 shadow-sm">
                                <Icon />
                              </div>
                              <span className="font-medium text-foreground/85">{formatToolName(tool)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <p className="text-[10px] opacity-45 mt-2">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-surface border border-border rounded-2xl rounded-tl-sm p-3 min-w-[210px] shadow-sm">
                    <div className="flex items-center gap-2 mb-2.5 px-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      <span className="text-xs font-medium text-muted">{streamStatus || 'AI is orchestrating tools...'}</span>
                    </div>

                    {streamTools.length > 0 ? (
                      <div className="flex flex-col gap-2.5 border-t border-border/40 pt-3">
                        {streamTools.map((tool, idx) => {
                          const Icon = getToolIcon(tool);
                          const isLast = idx === streamTools.length - 1;
                          return (
                            <div
                              key={idx}
                              className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border shadow-sm transition-all duration-500 ${isLast
                                ? 'border-primary/35 ring-1 ring-primary/15 bg-primary/5 translate-x-0.5'
                                : 'border-border/30 bg-background/30'
                                }`}
                            >
                              <span className={`text-[10px] font-mono mt-1.5 font-bold ${isLast ? 'text-primary' : 'text-muted-dark'}`}>{idx + 1}.</span>
                              <div className="shrink-0 bg-white dark:bg-zinc-800 flex items-center justify-center p-1.5 rounded-lg border border-border/40 shadow-sm">
                                <Icon />
                              </div>
                              <div className="flex flex-col gap-0.5 mt-0.5">
                                <span className={`font-semibold text-xs tracking-tight ${isLast ? 'text-foreground' : 'text-muted'}`}>{formatToolName(tool)}</span>
                                <span className={`text-[10px] font-medium ${isLast ? 'text-primary animate-pulse' : 'text-success'}`}>
                                  {isLast ? 'Processing...' : 'Done'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex gap-1.5 border-t border-border/40 pt-2.5 px-1">
                        {[0, 1, 2].map(i => (
                          <div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Actions */}
            {agentStatus?.enabled && messages.length > 0 && (
              <div className="px-4 py-3 border-t border-[var(--glass-border)] bg-surface/40">
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Quick Actions</p>
                <div className="flex gap-2">
                  {quickActions.map((action, index) => (
                    <button
                      key={index}
                      onClick={action.action}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-background/60 hover:bg-background border border-border hover:border-primary/30 text-foreground text-[10px] font-semibold rounded-lg transition-all duration-200"
                    >
                      <action.icon className="w-3 h-3 text-primary" />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="p-3 border-t border-[var(--glass-border)] bg-surface/60 rounded-b-2xl">
              {uploadedFilename && (
                <div className="flex items-center justify-between bg-primary/8 border border-primary/20 rounded-lg p-2 mb-2.5">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-xs text-primary font-medium truncate">{uploadedFilename}</span>
                  </div>
                  <button
                    onClick={() => { setUploadedDocId(null); setUploadedFilename(null); }}
                    className="p-0.5 text-muted hover:text-foreground transition-colors shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              <div className="flex gap-2 items-center">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf,.txt,.csv,.docx,.xlsx"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setIsUploading(true);
                    try {
                      const res = await apiService.uploadDocument(userEmail, file);
                      if (res && res.id) {
                        setUploadedDocId(res.id);
                        setUploadedFilename(res.filename);
                      }
                    } catch {
                      setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        type: 'agent',
                        content: 'Sorry, the document upload failed. Try again.',
                        timestamp: new Date()
                      }]);
                    } finally {
                      setIsUploading(false);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!agentStatus?.enabled || isLoading || isUploading}
                  className="p-2 rounded-lg border border-border text-muted bg-background/60 hover:bg-background hover:text-foreground transition-all disabled:opacity-50"
                  title="Attach Document"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Paperclip className="w-4 h-4" />}
                </button>

                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={agentStatus?.enabled ? 'Type your message...' : 'Initialize agent to start chatting...'}
                  disabled={!agentStatus?.enabled || isLoading}
                  className="input-field flex-1 text-sm bg-background/50"
                />
                <button
                  onClick={sendMessage}
                  disabled={!agentStatus?.enabled || !inputMessage.trim() || isLoading}
                  className="btn-primary px-3 py-2"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <AdvisorToast advice={advice} onDismiss={() => setAdvice(null)} />
    </>
  );
};

export default AIAgentChat;
