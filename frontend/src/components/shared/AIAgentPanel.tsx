"use client";
import { AgentStatus, apiService } from '@/services/api';
import {
  Bot,
  Brain,
  Calendar,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  Send,
  Zap
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

interface AIAgentPanelProps {
  userEmail: string;
  onProcessEmails?: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  theme?: 'default' | 'teal';
}

interface ChatMessage {
  id: string;
  type: 'user' | 'agent';
  content: string;
  timestamp: Date;
}

const AIAgentPanel: React.FC<AIAgentPanelProps> = ({
  userEmail,
  onProcessEmails,
  isExpanded,
  onToggleExpanded,
}) => {
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkAgentStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const checkAgentStatus = async () => {
    try {
      const status = await apiService.getLegacyAgentStatus(userEmail);
      setAgentStatus(status);
      setIsConnected(status.enabled);
    } catch (error) {
      console.error('Error checking agent status:', error);
    }
  };

  const initializeAgent = async () => {
    setIsInitializing(true);
    try {
      await apiService.initializeAgent(userEmail);
      await checkAgentStatus();

      const welcomeMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'agent',
        content: 'Hello! I\'m Sync. I can help you with emails, scheduling, presentations, and spreadsheets. How can I assist you today?',
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
    } catch (error) {
      console.error('Error initializing agent:', error);
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'agent',
        content: 'Sorry, I couldn\'t initialize. Please try again later.',
        timestamp: new Date()
      };
      setMessages([errorMessage]);
    } finally {
      setIsInitializing(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: inputMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const response = await apiService.chatWithAgent(userEmail, { message: inputMessage });

      const agentMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'agent',
        content: response.response || 'I received your message but couldn\'t process it properly.',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, agentMessage]);

      if (response.status === 'completed' && onProcessEmails) {
        onProcessEmails();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'agent',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const processEmailsWithAgent = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const response = await apiService.processEmails(userEmail, 20);
      if (onProcessEmails) {
        onProcessEmails();
      }

      const agentMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'agent',
        content: `I've processed ${response.emails?.length || 0} emails and classified them for you. Check your inbox for the updated classifications!`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, agentMessage]);
    } catch (error) {
      console.error('Error processing emails:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const _getStatusColor = () => {
    if (!agentStatus) return 'text-muted';
    if (agentStatus.enabled) return 'text-success';
    if (agentStatus.status === 'disabled') return 'text-warning';
    if (agentStatus.status === 'no_api_key') return 'text-error';
    return 'text-warning';
  };

  const _getStatusText = () => {
    if (!agentStatus) return 'Checking...';
    if (agentStatus.enabled) return 'Active';
    if (agentStatus.status === 'disabled') return 'Disabled';
    if (agentStatus.status === 'no_api_key') return 'No API Key';
    return 'Disabled';
  };

  const quickActions = [
    {
      icon: Mail,
      label: 'Smart Summary',
      action: processEmailsWithAgent,
      description: 'Analyze and classify your emails',
      color: 'var(--primary)'
    },
    {
      icon: Calendar,
      label: 'Auto-Schedule',
      action: () => {
        const message = "I'd like to schedule a meeting. Can you help me with that?";
        setInputMessage(message);
        setTimeout(() => sendMessage(), 100);
      },
      description: 'Schedule meetings with attendees',
      color: 'var(--success)'
    },
    {
      icon: MessageSquare,
      label: 'Auto-Draft',
      action: () => {
        const message = "I'd like to send an email. Can you help me compose one?";
        setInputMessage(message);
        setTimeout(() => sendMessage(), 100);
      },
      description: 'Compose and send emails',
      color: 'var(--warning)'
    }
  ];

  return (
    <div className={clsx(
      "flex flex-col transition-all duration-500 ease-in-out overflow-hidden",
      isExpanded ? "w-full h-full" : "glass-panel rounded-xl shadow-2xl w-14"
    )}>
      {/* Header - only shown in standalone (collapsed) mode */}
      <div className={clsx("border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl", isExpanded ? "hidden" : "p-4")}>
        <div className="flex items-center justify-between">
          {isExpanded ? null : (
            <button
              onClick={onToggleExpanded}
              className="p-1.5 hover:bg-background rounded transition-colors w-full flex justify-center"
            >
              <Bot className="w-4 h-4 text-foreground" />
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Quick Actions — big icon tiles */}
          <div className="p-3 border-b border-[var(--glass-border)] bg-background/30">
            <p className="text-[9px] font-bold text-muted uppercase tracking-[0.18em] mb-2 px-1">What can I do for you?</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { emoji: '📧', label: 'Read Emails', hint: 'Summarise my inbox', action: processEmailsWithAgent },
                { emoji: '📅', label: 'Schedule', hint: 'Book a meeting', action: () => { setInputMessage("Schedule a meeting for me"); setTimeout(() => sendMessage(), 80); } },
                { emoji: '✍️', label: 'Draft Email', hint: 'Write an email', action: () => { setInputMessage("Help me write an email"); setTimeout(() => sendMessage(), 80); } },
              ].map((tile, i) => (
                <button
                  key={i}
                  onClick={tile.action}
                  disabled={isLoading || !isConnected}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-[var(--glass-border)] bg-surface/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                >
                  <span className="text-xl leading-none">{tile.emoji}</span>
                  <span className="text-[10px] font-600 text-foreground leading-tight">{tile.label}</span>
                  <span className="text-[9px] text-muted leading-tight text-center px-1">{tile.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-1 flex flex-col min-h-0 md:min-h-[350px] md:max-h-[500px]">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background/30">
              {messages.length === 0 ? (
                <div className="text-center py-8 animate-fade-in">
                  <div className="text-4xl mb-3">🤖</div>
                  <h3 className="text-sm font-bold text-foreground mb-1">Hi! I&apos;m Sync</h3>
                  <p className="text-[11px] text-muted mb-5 leading-relaxed max-w-[180px] mx-auto">
                    Tap a button above, or just type what you need — I&apos;ll handle it.
                  </p>
                  {!isConnected ? (
                    <button
                      onClick={initializeAgent}
                      disabled={isInitializing}
                      className="btn-primary text-xs py-2 px-4"
                    >
                      {isInitializing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      {isInitializing ? 'Starting…' : 'Start Chat'}
                    </button>
                  ) : (
                    <div className="text-[10px] text-muted">
                      Ready — type below to begin
                    </div>
                  )}
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={clsx("flex", message.type === 'user' ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={clsx(
                        "max-w-[85%] p-3.5 rounded-xl text-xs shadow-md animate-scale-in",
                        message.type === 'user'
                          ? "bg-primary text-foreground border border-primary-hover shadow-[0_0_15px_rgba(37,99,235,0.2)] rounded-tr-sm"
                          : "bg-[var(--glass-bg)] border border-[var(--glass-border)] text-foreground backdrop-blur-md rounded-tl-sm"
                      )}
                    >
                      <p className="leading-relaxed whitespace-pre-wrap">
                        {message.content.split(/(https?:\/\/\S+)/g).map((part, idx) =>
                          /^https?:\/\//.test(part) ? (
                            <a key={idx} href={part} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{part}</a>
                          ) : (
                            <span key={idx}>{part}</span>
                          )
                        )}
                      </p>
                      <div className="text-[10px] opacity-50 mt-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-md text-foreground py-2.5 px-4 rounded-full shadow-lg glow-border glow-active">
                    <div className="flex items-center gap-2">
                      <div className="relative w-4 h-4">
                        <div className="absolute inset-0 border-[1.5px] border-primary border-t-transparent rounded-full animate-spin"></div>
                      </div>
                      <span className="text-[10px] font-bold tracking-widest uppercase text-primary">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your message..."
                  disabled={!isConnected || isLoading}
                  className="input-field flex-1 bg-background/50 border-[var(--glass-border)] focus:glow-border"
                />
                <button
                  onClick={sendMessage}
                  disabled={!inputMessage.trim() || isLoading || !isConnected}
                  className="btn-primary px-4 shadow-[0_0_10px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0_0_20px_rgba(37,99,235,0.5)] active:scale-95 rounded-lg"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AIAgentPanel;