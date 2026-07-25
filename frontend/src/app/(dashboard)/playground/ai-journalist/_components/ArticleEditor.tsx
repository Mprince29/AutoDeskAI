"use client";

import React, { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Copy,
  Check,
  Save,
  Download,
  FileDown,
  Undo,
  Redo,
  Image as ImageIcon,
  Target,
  CheckCircle2,
  BarChart3,
  Zap,
  ShieldAlert,
  Users2,
  Lightbulb,
  AlertCircle,
  TrendingUp,
  Users,
  Link2,
  Type,
  Layout,
  Quote,
  Strikethrough,
  ExternalLink,
  Info,
  Newspaper,
  Mic2,
  Activity,
  Loader2,
  Languages
} from 'lucide-react';
import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react/menus';
import { AuditReport, SocialKit, ArticleData } from '@/types/journalist.types';
import { defaultExtensions } from '@/components/editor/extensions';
import { SmartChart } from './SmartChart';
import GeneratedImageCard from './GeneratedImageCard';
import SocialMediaKit from './SocialMediaKit';
import { calculateStats, useArticleStats } from '@/hooks/use-article-stats';
import { handleDownloadImage, handleExportPDF, handleExportWord } from '@/lib/exports';
import NewspaperCutout from './NewspaperCutout';
import { SEOAnalyzer } from './SEOAnalyzer';
import { AudioBriefingPlayer } from './AudioBriefingPlayer';
import { toastSuccess, toastInfo, toastError } from '@/lib/friendly-errors';
import { AnimatePresence, motion } from 'framer-motion';
import { translateArticle, generateAudioBriefing } from '@/services/journalist.service';

interface ArticleEditorProps {
  id: string;
  title?: string;
  content: string;
  imageUrl?: string | null;
  socialKit?: SocialKit | null;
  audit?: AuditReport | null;
  sources?: Array<{ title: string; url: string; description: string }> | null;
  onSave: (newContent: string) => void;
  onClose?: () => void;
  onStatsChange?: (stats: { words: number; readingTime: number; score: number }) => void;
  onImageUpdate?: (url: string) => void;
  onGenerateImage?: (topic: string, category: string, articleContent?: string, reportId?: number) => Promise<void>;
  onGenerateSocialKit?: (content: string, reportId?: number, options?: { platforms: string[], moreHashtags: boolean, prompt?: string }) => Promise<void>;
  isGeneratingSocialKit?: boolean;
  onManualSave?: (content: string) => Promise<void>;
  isSaving?: boolean;
  brandVoice?: string;
  persona?: string;
  email?: string;
  articleData?: ArticleData | null;
}

export default function ArticleEditor({
  id: _id,
  title = 'Article',
  content,
  imageUrl,
  socialKit,
  audit,
  sources,
  onSave,
  onClose: _onClose,
  onStatsChange,
  onImageUpdate: _onImageUpdate,
  onGenerateImage,
  onGenerateSocialKit,
  isGeneratingSocialKit = false,
  onManualSave,
  isSaving = false,
  brandVoice = "Professional",
  persona = "Analytical",
  email = "",
  articleData
}: ArticleEditorProps) {
  const [copied, setCopied] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("Cover image generated via AI based on article content.");

  const [activeTab, setActiveTab] = useState<'facts' | 'stats' | 'trends' | 'perspectives' | 'stakeholders' | 'examples'>('facts');
  const [activeEditorialTab, setActiveEditorialTab] = useState<'insights' | 'audit' | 'sources'>('insights');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'link' | 'image'>('link');
  const [modalUrl, setModalUrl] = useState("");
  const [viewMode, setViewMode] = useState<'editor' | 'newspaper' | 'social'>('editor');
  const [showSEO, setShowSEO] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState("English");
  const [isTranslating, setIsTranslating] = useState(false);

  const { updateStats } = useArticleStats();

  const handleRegenerateImage = () => {
    if (onGenerateImage && articleData) {
      onGenerateImage(articleData.topic, articleData.category || "General", articleData.markdown_content, articleData.id);
    }
  };

  const handleEditPrompt = (newPrompt: string) => {
    if (newPrompt && newPrompt.trim() !== "" && newPrompt !== imagePrompt) {
      setImagePrompt(newPrompt);
      if (onGenerateImage && articleData) {
        // Here we override the topic/category context with the custom prompt if needed, 
        // but the backend uses the topic for DALL-E. For custom prompt, we can pass it as topic.
        onGenerateImage(newPrompt, articleData.category || "General", articleData.markdown_content, articleData.id);
      }
    }
  };

  const editor = useEditor({
    extensions: defaultExtensions,
    content: content.split(/#+\s*(?:References|Sources)/i)[0].replace(/^---$/gm, '').trim(),
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'prose prose-premium dark:prose-invert max-w-none focus:outline-none min-h-[600px] text-foreground',
      },
    },
    immediatelyRender: false,
    onTransaction: ({ editor }) => {
      setCanUndo(editor.can().undo());
      setCanRedo(editor.can().redo());
    },
    onUpdate: ({ editor }) => {
      const markdown = (editor as unknown as { getMarkdown: () => string }).getMarkdown();
      const text = editor.getText();
      const newStats = updateStats(text);

      onStatsChange?.({
        words: newStats.words,
        readingTime: newStats.readingTime,
        score: newStats.score
      });

      // Notify parent of content changes
      onSave(markdown);
    }
  });



  const handleCopy = () => {
    if (!editor) return;
    const markdown = (editor as unknown as { getMarkdown: () => string }).getMarkdown();
    const cleanContent = markdown.replace(/^#+\s/gm, '');
    navigator.clipboard.writeText(cleanContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopySocialContent = (type: string, content: string | string[]) => {
    let textToCopy = "";
    if (type === 'X' && Array.isArray(content)) {
      textToCopy = content.map((post, i) => `${i + 1}/ ${post}`).join('\n\n');
    } else {
      textToCopy = Array.isArray(content) ? content.join('\n\n') : content;
    }
    navigator.clipboard.writeText(textToCopy);
  };

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    setModalUrl(previousUrl || "");
    setModalType('link');
    setModalOpen(true);
  };

  const insertImage = () => {
    setModalUrl("");
    setModalType('image');
    setModalOpen(true);
  };

  const handleApplyModal = () => {
    if (!editor) return;
    if (modalType === 'link') {
      if (modalUrl === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: modalUrl }).run();
      }
    } else {
      if (modalUrl) {
        editor?.chain().focus().setImage({ src: modalUrl }).run();
      }
    }
    setModalOpen(false);
  };

  const handleGenerateAudio = async () => {
    if (!email || !editor) return;
    setIsGeneratingAudio(true);
    toastInfo("Initializing AI Newsroom for audio briefing...");
    
    try {
      const markdown = editor.getText({ blockSeparator: "\n\n" });
      const result = await generateAudioBriefing(markdown, email, articleData?.id);
      
      if (result.audio_b64) {
        const audioBlob = new Blob(
          [Uint8Array.from(atob(result.audio_b64), c => c.charCodeAt(0))],
          { type: 'audio/wav' }
        );
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        toastSuccess("AI Audio Briefing is ready to play!");
      }
    } catch (err) {
      toastError(err, "audio_briefing");
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleTranslate = async (lang: string) => {
    if (lang === language || !editor) return;
    setIsTranslating(true);
    toastInfo(`Translating article to ${lang}...`);
    try {
      const markdown = editor.getText({ blockSeparator: "\n\n" });
      const result = await translateArticle(markdown, lang, email);
      if (result.translated_content) {
        editor.commands.setContent(result.translated_content);
        onSave(result.translated_content);
        setLanguage(lang);
        toastSuccess(`Article translated to ${lang}!`);
      }
    } catch (err) {
      toastError(err, "translate");
    } finally {
      setIsTranslating(false);
    }
  };

  const stats = editor ? calculateStats(editor.getText()) : null;

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden h-full selection:bg-primary/20 selection:text-primary">
      {/* Premium Toolbar */}
      <div className="sticky top-0 z-40 py-1.5 sm:py-2 px-4 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between no-print gap-3 sm:gap-4 bg-background/90 backdrop-blur-xl">
        <div className="flex items-center gap-4 overflow-x-auto whitespace-nowrap w-full sm:w-auto pb-1 sm:pb-0">
          {/* History Group */}
          <div className="flex items-center bg-surface-hover/40 p-0.5 rounded-lg border border-border/20">
            <button
              onClick={() => editor?.chain().focus().undo().run()}
              disabled={!canUndo}
              className="p-1.5 rounded-md hover:bg-surface transition-all disabled:opacity-20 text-muted-dark hover:text-foreground"
              title="Undo"
            >
              <Undo size={15} />
            </button>
            <button
              onClick={() => editor?.chain().focus().redo().run()}
              disabled={!canRedo}
              className="p-1.5 rounded-md hover:bg-surface transition-all disabled:opacity-20 text-muted-dark hover:text-foreground"
              title="Redo"
            >
              <Redo size={15} />
            </button>
          </div>

          <div className="w-[1px] h-4 bg-border/40" />

          {/* Text Style Group */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('bold') ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Bold"
            >
              <Bold size={15} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('italic') ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Italic"
            >
              <Italic size={15} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('strike') ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Strikethrough"
            >
              <Strikethrough size={15} />
            </button>
          </div>

          <div className="w-[1px] h-4 bg-border/40" />

          {/* Headings */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('heading', { level: 1 }) ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Heading 1"
            >
              <Heading1 size={15} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('heading', { level: 2 }) ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Heading 2"
            >
              <Heading2 size={15} />
            </button>
          </div>

          <div className="w-[1px] h-4 bg-border/40" />

          {/* Lists & Quotes */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('bulletList') ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Bullet List"
            >
              <List size={15} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('orderedList') ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Ordered List"
            >
              <ListOrdered size={15} />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              className={`p-2 rounded-md transition-all ${editor?.isActive('blockquote') ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Blockquote"
            >
              <Quote size={15} />
            </button>
          </div>

          <div className="w-[1px] h-4 bg-border/40" />

          {/* Insert Items */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={setLink}
              className={`p-2 rounded-md transition-all ${editor?.isActive('link') ? 'text-primary bg-primary/10 shadow-inner' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              title="Add Link"
            >
              <Link2 size={15} />
            </button>
            <button
              onClick={() => insertImage()}
              className="p-2 rounded-md text-muted-dark hover:bg-surface hover:text-foreground transition-all"
              title="Insert Image"
            >
              <ImageIcon size={15} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto shrink-0 w-full sm:w-auto overflow-x-auto hide-scrollbar pb-1 sm:pb-0 justify-start sm:justify-end">
          {/* Stats Badge */}
          {stats && (
            <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-surface/50 border border-border/40 text-[10px] font-bold tracking-tight">
              <div className="flex items-center gap-1.5 text-muted-dark">
                <Type size={12} className="text-primary/60" />
                <span>{stats.words} WORDS</span>
              </div>
              <div className="w-[1px] h-3 bg-border/40" />
              <div className="flex items-center gap-1.5 text-muted-dark">
                <Layout size={12} className="text-primary/60" />
                <span>{stats.readingTime} MIN READ</span>
              </div>
            </div>
          )}

          {/* Persona & Brand Voice Badges */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="px-2.5 py-1.5 rounded-xl bg-primary/5 border border-primary/20 text-[9px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5 shadow-sm">
              <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
              {persona}
            </div>
            <div className="px-2.5 py-1.5 rounded-xl bg-success/5 border border-success/20 text-[9px] font-black uppercase tracking-widest text-success flex items-center gap-1.5 shadow-sm">
              <div className="w-1 h-1 rounded-full bg-success animate-pulse" />
              {brandVoice}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center bg-surface/40 p-0.5 rounded-lg border border-border/20">
              <button
                onClick={() => setViewMode(v => v === 'editor' ? 'newspaper' : 'editor')}
                className={`p-2 rounded-md transition-all ${viewMode === 'newspaper' ? 'text-primary bg-primary/10' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
                title={viewMode === 'newspaper' ? 'Back to Editor' : 'Newspaper View'}
              >
                <Newspaper size={15} />
              </button>
              <button
                onClick={() => setShowSEO(p => !p)}
                className={`p-2 rounded-md transition-all ${showSEO ? 'text-primary bg-primary/10' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
                title="SEO & Intelligence Audit"
              >
                <Activity size={15} />
              </button>
              <button
                onClick={handleGenerateAudio}
                disabled={isGeneratingAudio}
                className={`p-2 rounded-md transition-all ${isGeneratingAudio ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
                title="Generate AI Audio Briefing"
              >
                {isGeneratingAudio ? <Loader2 size={15} className="animate-spin" /> : <Mic2 size={15} />}
              </button>
            </div>

            <div className="flex items-center bg-surface/40 p-0.5 rounded-lg border border-border/20">
              <div className="relative group/lang">
                <button
                  className={`p-2 rounded-md transition-all ${isTranslating ? 'animate-pulse text-primary' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
                  title="Translate Article"
                >
                  <Languages size={15} />
                </button>
                <div className="absolute z-[100] top-full right-0 mt-1 hidden group-hover/lang:block bg-background border border-border shadow-xl rounded-xl p-1 min-w-[120px]">
                    {['English', 'Hindi', 'Spanish', 'French', 'German'].map(lang => (
                      <button 
                        key={lang}
                        onClick={() => handleTranslate(lang)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-bold hover:bg-surface transition-colors ${language === lang ? 'text-primary' : 'text-muted'}`}
                      >
                        {lang}
                      </button>
                    ))}
                </div>
              </div>
            </div>

            <div className="flex items-center bg-surface/40 p-0.5 rounded-lg border border-border/20">
              <button
                onClick={handleCopy}
                title="Copy as plain text"
                className={`p-2 rounded-md transition-all ${copied ? 'text-success bg-success/10' : 'text-muted-dark hover:bg-surface hover:text-foreground'}`}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              {onManualSave && (
                <button
                  onClick={() => editor && onManualSave((editor as any).getMarkdown())}
                  disabled={isSaving}
                  title="Save as new version"
                  className={`p-2 rounded-md transition-all ${isSaving ? 'opacity-50' : 'text-muted-dark hover:bg-surface hover:text-foreground hover:text-primary'}`}
                >
                  <Save size={15} className={isSaving ? "animate-pulse" : ""} />
                </button>
              )}
            </div>

            <div className="flex items-center bg-surface/40 p-0.5 rounded-lg border border-border/20">
              <button
                onClick={() => {
                  const allSources = [
                    ...(sources || []),
                    ...(articleData?.research_summary?.sources || []),
                    ...(articleData?.sources || [])
                  ];
                  const uniqueSources = allSources.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
                  
                  const dataInsights = [
                    ...(articleData?.data_insights || []),
                    ...(articleData?.research_summary?.data_insights || [])
                  ];
                  const uniqueInsights = dataInsights.filter((v, i, a) => a.findIndex(t => t.label === v.label) === i);
                  handleExportWord(title, editor?.getHTML() || "", imageUrl, socialKit, audit, articleData?.research_summary, uniqueSources, stats, uniqueInsights);
                }}
                title="Export as Word"
                className="p-2 rounded-md text-muted-dark hover:bg-surface hover:text-foreground transition-all"
              >
                <FileDown size={15} />
              </button>
              <button
                onClick={() => {
                  const allSources = [
                    ...(sources || []),
                    ...(articleData?.research_summary?.sources || []),
                    ...(articleData?.sources || [])
                  ];
                  const uniqueSources = allSources.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);

                  const dataInsights = [
                    ...(articleData?.data_insights || []),
                    ...(articleData?.research_summary?.data_insights || [])
                  ];
                  const uniqueInsights = dataInsights.filter((v, i, a) => a.findIndex(t => t.label === v.label) === i);
                  handleExportPDF(title, editor?.getHTML() || "", imageUrl, socialKit, audit, articleData?.research_summary, uniqueSources, stats, uniqueInsights);
                }}
                title="Print / Export PDF"
                className="p-2 rounded-md text-muted-dark hover:bg-surface hover:text-foreground transition-all"
              >
                <Download size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Tiptap Bubble Menu */}
        {editor && (
          <TiptapBubbleMenu
            editor={editor}
            options={{
              placement: 'top',
            }}
            className="flex items-center gap-1 bg-background shadow-2xl border border-border/80 p-1 rounded-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200"
          >
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive('bold') ? 'text-primary bg-primary/10' : 'text-muted-dark hover:bg-surface'}`}
            >
              <Bold size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive('italic') ? 'text-primary bg-primary/10' : 'text-muted-dark hover:bg-surface'}`}
            >
              <Italic size={14} />
            </button>
            <div className="w-[1px] h-4 bg-border/60 mx-1" />
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 2 }) ? 'text-primary bg-primary/10' : 'text-muted-dark hover:bg-surface'}`}
            >
              <Heading2 size={14} />
            </button>
            <button
              onClick={setLink}
              className={`p-1.5 rounded-lg transition-colors ${editor.isActive('link') ? 'text-primary bg-primary/10' : 'text-muted-dark hover:bg-surface'}`}
            >
              <Link2 size={14} />
            </button>
          </TiptapBubbleMenu>
        )}

        {/* Editor Area with Refined Aesthetics */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface/10">
          <div className="w-full p-4 space-y-8">
            {viewMode === 'newspaper' ? (
              <NewspaperCutout 
                title={title}
                content={content}
                imageUrl={imageUrl}
              />
            ) : (
              <div className="paper-sheet prose-premium relative p-4 h-auto">
                <EditorContent editor={editor} />
              </div>
            )}

            {/* top keywords stats */}
            {stats && stats.keywords.length > 0 && (
              <div className="mt-8 mb-4 space-y-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Top Keywords</h3>
                <div className="flex flex-wrap gap-1.5">
                  {stats.keywords.map(([key, count], i) => (
                    <div key={i} className="px-2.5 py-1 text-xs rounded font-semibold bg-primary/10 border border-primary/20 flex items-center gap-2">
                      <span className="text-primary">{key}</span>
                      <span className="text-primary/60">{count}X</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Image Card */}
            {imageUrl && (
              <GeneratedImageCard
                imageUrl={imageUrl}
                prompt={imagePrompt}
                onRegenerate={handleRegenerateImage}
                onEditPrompt={handleEditPrompt}
                onDownload={() => handleDownloadImage(imageUrl, title)}
                isGenerating={isGeneratingImage}
              />
            )}
            
            {/* Social Media Kit */}
            {socialKit && (
              <SocialMediaKit
                data={[
                  { platform: 'X', content: socialKit.twitter_thread ? (Array.isArray(socialKit.twitter_thread) ? socialKit.twitter_thread.join('\n\n') : socialKit.twitter_thread) : "", tags: socialKit.twitter_tags || ['Content', 'AI'], charLimit: 280 },
                  { platform: 'LinkedIn', content: socialKit.linkedin_post || "", tags: socialKit.linkedin_tags || ['Professional', 'Update'], charLimit: 3000 },
                  { platform: 'Instagram', content: socialKit.instagram_caption || "", tags: socialKit.instagram_tags || ['Visual', 'Narrative'], charLimit: 2200 },
                  { platform: 'Facebook', content: socialKit.facebook_post || "", tags: socialKit.facebook_tags || ['Social', 'Community'], charLimit: 5000 },
                  { platform: 'Newsletter', content: socialKit.newsletter_blurb || "", tags: socialKit.newsletter_tags || ['Newsletter', 'Digest'], charLimit: 1000 }
                ]}
                onCopy={(platform, content) => handleCopySocialContent(platform, content)}
                onRegenerate={(options) => onGenerateSocialKit && onGenerateSocialKit(content, articleData?.id, options)}
                isGenerating={isGeneratingSocialKit}
                imageUrl={imageUrl}
              />
            )}
            {/* Editorial Intelligence Dashboard (Tabs: Insights, Audit, Sources) */}
            <div className="space-y-6 my-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="flex items-center gap-3">
                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                <div className="px-4 py-1.5 rounded-full border border-border bg-surface/50 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  Editorial Intelligence
                </div>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
              </div>

              {/* Tab Navigation */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-surface/40 border border-border/50 overflow-x-auto no-scrollbar">
                {[
                  { id: 'insights', label: 'Data Intelligence', icon: BarChart3, color: 'text-primary' },
                  { id: 'audit', label: 'Journalist Pro Audit', icon: AlertCircle, color: 'text-warning' },
                  { id: 'sources', label: 'Verified Sources', icon: Link2, color: 'text-success' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveEditorialTab(tab.id as 'insights' | 'audit' | 'sources')}
                    className={`w-full flex items-center justify-center border border-border/60 gap-2 px-4 py-2 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${activeEditorialTab === tab.id
                        ? 'bg-background text-foreground'
                        : 'text-muted hover:text-foreground hover:bg-background/40'
                      }`}
                  >
                    <tab.icon size={14} className={activeEditorialTab === tab.id ? tab.color : 'text-muted/60'} />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="min-h-[200px]">
                {/* Data Insights Tab */}
                {activeEditorialTab === 'insights' && (
                  <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {(() => {
                      const dataInsights = [
                        ...(articleData?.data_insights || []),
                        ...(articleData?.research_summary?.data_insights || [])
                      ];
                      const uniqueInsights = dataInsights.filter((v, i, a) => a.findIndex(t => t.label === v.label) === i);
                      return uniqueInsights.length > 0 ? (
                        <SmartChart data={uniqueInsights} title={`${title.slice(0, 30)} - Statistical Analysis`} />
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No statistical insights extracted for this article.</div>
                      );
                    })()}
                  </div>
                )}

                {/* Audit Tab */}
                {activeEditorialTab === 'audit' && (
                  <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <div className={`p-5 rounded-3xl bg-surface/30 border border-border/60 no-print transition-all duration-500 ${!audit ? 'opacity-50 grayscale' : 'opacity-100'}`}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <AlertCircle size={18} className="text-primary" />
                          <h3 className="text-sm font-bold text-foreground">Journalist Pro Audit</h3>
                        </div>
                        {audit ? (
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${audit.status === 'Passed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                            {audit.status}
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-surface text-muted text-[10px] font-bold uppercase animate-pulse">Analyzing...</span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 rounded-xl bg-background/50 border border-border/40">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp size={14} className="text-primary" />
                            <span className="text-[11px] font-bold uppercase text-muted">Sentiment & Tone</span>
                          </div>
                          <p className="text-[12px] text-muted-dark leading-relaxed">
                            {audit?.sentiment_tone || "Evaluating tone consistency and investigative depth..."}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-background/50 border border-border/40">
                          <div className="flex items-center gap-2 mb-2">
                            <Users size={14} className="text-primary" />
                            <span className="text-[11px] font-bold uppercase text-muted">Entity Coverage</span>
                          </div>
                          <p className="text-[12px] text-muted-dark leading-relaxed">
                            {audit?.entity_coverage || "Analyzing stakeholder coverage and grounding citations quality..."}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 p-3 rounded-xl bg-background border border-border/40">
                        <div className="flex items-center gap-2 mb-1">
                          <Target size={14} className="text-primary" />
                          <span className="text-[11px] font-bold text-primary">SEO Recommendation</span>
                        </div>
                        <p className="text-[11px] text-muted-dark italic">
                          {audit?.seo_recommendation || `Optimizing semantic relevance for "${title}"...`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sources Tab */}
                {activeEditorialTab === 'sources' && (
                  <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {(() => {
                      const allSources = [
                        ...(sources || []),
                        ...(articleData?.research_summary?.sources || []),
                        ...(articleData?.sources || [])
                      ];
                      const normalizedSources = allSources.filter((source) =>
                        source &&
                        typeof source === "object" &&
                        typeof source.url === "string" &&
                        source.url.trim().length > 0
                      );
                      const uniqueSources = normalizedSources.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
                      return uniqueSources.length > 0 ? (
                        <div className="p-4 rounded-3xl bg-surface/30 border border-border/60">
                          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-6 flex items-center gap-2">
                            <div className="w-8 h-[1px] bg-primary/30"></div>
                            Verified Sources & References
                          </div>
                          <div className="grid grid-cols-1 gap-x-12 gap-y-2">
                            {uniqueSources.map((source, i) => (
                              <div key={i} className="group flex gap-4">
                                <div className="flex flex-col items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-[10px] font-bold text-muted group-hover:bg-primary group-hover:text-white transition-all shadow-sm">
                                    {i + 1}
                                  </div>
                                  <div className="flex-1 w-[1px] bg-border/40 group-last:hidden" />
                                </div>
                                <div className="pb-4">
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[14px] font-bold text-foreground hover:text-primary transition-colors flex items-center gap-2 mb-1.5 underline decoration-border group-hover:decoration-primary/40 underline-offset-4"
                                  >
                                    {source.title}
                                    <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </a>
                                  <p className="text-[12px] text-muted-dark leading-relaxed line-clamp-2">
                                    {source.description}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No verified sources recorded for this report.</div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Research & Intelligence Dashboard */}
            {articleData?.research_summary && (
              <div className="space-y-6 mt-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex items-center gap-3">
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                  <div className="px-4 py-1.5 rounded-full border border-border bg-surface/50 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                    Research Intelligence
                  </div>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                </div>

                {/* Tab Navigation */}
                <div className="flex items-center gap-1 p-1 rounded-xl bg-surface/40 border border-border/50 overflow-x-auto no-scrollbar">
                  {[
                    { id: 'facts', label: 'Core Facts', icon: CheckCircle2, color: 'text-success' },
                    { id: 'stats', label: 'Statistics', icon: BarChart3, color: 'text-primary' },
                    { id: 'trends', label: 'Trends', icon: Zap, color: 'text-warning' },
                    { id: 'perspectives', label: 'Perspectives', icon: ShieldAlert, color: 'text-destructive' },
                    { id: 'stakeholders', label: 'Stakeholders', icon: Users2, color: 'text-primary' },
                    { id: 'examples', label: 'Examples', icon: Lightbulb, color: 'text-success' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as 'facts' | 'stats' | 'trends' | 'perspectives' | 'stakeholders' | 'examples')}
                      className={`w-full flex items-center justify-center border border-border/60 gap-2 px-4 py-2 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${activeTab === tab.id
                          ? 'bg-background text-foreground'
                          : 'text-muted hover:text-foreground hover:bg-background/40'
                        }`}
                    >
                      <tab.icon size={14} className={activeTab === tab.id ? tab.color : 'text-muted/60'} />
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="h-auto">
                  {/* Core Facts Tab */}
                  {activeTab === 'facts' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {(articleData.research_summary.core_facts?.length || 0) > 0 ? (
                        <div className="p-4 rounded-3xl bg-surface/30 border border-border/60">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-2xl bg-success/10 flex items-center justify-center text-success">
                              <CheckCircle2 size={20} />
                            </div>
                            <div>
                              <h4 className="text-[14px] font-bold text-foreground">Core Investigative Facts</h4>
                              <p className="text-[11px] text-muted">Primary verified data points discovered.</p>
                            </div>
                          </div>
                          <ul className="">
                            {articleData.research_summary.core_facts?.map((fact, i) => (
                              <li key={i} className="text-[13px] text-muted-dark leading-relaxed flex items-start gap-3 p-2 rounded-2xl hover:bg-background/40 transition-colors">
                                <span className="w-2 h-2 rounded-full bg-success/40 mt-1.5 shrink-0" />
                                {typeof fact === 'string' ? fact : JSON.stringify(fact)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No core facts available for this research stage.</div>
                      )}
                    </div>
                  )}

                  {/* Statistics Tab */}
                  {activeTab === 'stats' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {(articleData.research_summary.statistics?.length || 0) > 0 ? (
                        <div className="p-4 rounded-3xl bg-surface/30 border border-border/60">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                              <BarChart3 size={20} />
                            </div>
                            <div>
                              <h4 className="text-[14px] font-bold text-foreground">Statistical Deep-Dive</h4>
                              <p className="text-[11px] text-muted">Quantitative metrics and hard evidence.</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            {articleData.research_summary.statistics?.map((stat, i) => (
                              <div key={i} className="p-5 rounded-2xl bg-background/40 border border-border/40 text-[13px] text-primary font-medium hover:scale-[1.01] transition-transform">
                                <span className="text-[10px] uppercase font-bold text-muted/60 block mb-1">Evidence Point {i + 1}</span>
                                {typeof stat === 'string' ? stat : JSON.stringify(stat)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No statistical data found during research.</div>
                      )}
                    </div>
                  )}

                  {/* Trends Tab */}
                  {activeTab === 'trends' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {(articleData.research_summary.trends?.length || 0) > 0 ? (
                        <div className="p-4 rounded-3xl bg-surface/30 border border-border/60">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-2xl bg-warning/10 flex items-center justify-center text-warning">
                              <Zap size={20} />
                            </div>
                            <div>
                              <h4 className="text-[14px] font-bold text-foreground">Emerging Trends</h4>
                              <p className="text-[11px] text-muted">Future directions and market shifts discovered.</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {articleData.research_summary.trends?.map((trend, i) => (
                              <span key={i} className="px-5 py-3 rounded-2xl bg-warning/5 border border-warning/10 text-[12px] font-bold text-warning-dark hover:bg-warning/10 transition-colors">
                                {typeof trend === 'string' ? trend : JSON.stringify(trend)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No emerging trends identified in this query.</div>
                      )}
                    </div>
                  )}

                  {/* Perspectives Tab */}
                  {activeTab === 'perspectives' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {((articleData.research_summary.hidden_challenges?.length || 0) > 0 || (articleData.research_summary.contrarian_perspectives?.length || 0) > 0) ? (
                        <div className="p-4 rounded-3xl bg-surface/30 border border-border/60">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-2xl bg-destructive/10 flex items-center justify-center text-destructive">
                              <ShieldAlert size={20} />
                            </div>
                            <div>
                              <h4 className="text-[14px] font-bold text-foreground">Critical & Contrarian Viewpoints</h4>
                              <p className="text-[11px] text-muted">Bottlenecks, challenges, and alternative theories.</p>
                            </div>
                          </div>
                          <div className="space-y-4">
                            {articleData.research_summary.hidden_challenges?.map((challenge, i) => (
                              <div key={i} className="text-[13px] text-muted-dark border-l-4 border-destructive/20 pl-5 py-2 italic bg-destructive/5 rounded-r-2xl">
                                <span className="font-bold text-[10px] uppercase text-destructive/60 block mb-1">Hidden Challenge</span>
                                {typeof challenge === 'string' ? challenge : JSON.stringify(challenge)}
                              </div>
                            ))}
                            {articleData.research_summary.contrarian_perspectives?.map((perspective, i) => (
                              <div key={i} className="text-[13px] text-muted-dark border-l-4 border-primary/20 pl-5 py-2 bg-primary/5 rounded-r-2xl">
                                <span className="font-bold text-[10px] uppercase text-primary/60 block mb-1">Contrarian View</span>
                                {typeof perspective === 'string' ? perspective : JSON.stringify(perspective)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No critical perspectives found for this topic.</div>
                      )}
                    </div>
                  )}

                  {/* Stakeholders Tab */}
                  {activeTab === 'stakeholders' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {(articleData.research_summary.stakeholders?.length || 0) > 0 ? (
                        <div className="p-4 rounded-3xl bg-surface/30 border border-border/60">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                              <Users2 size={20} />
                            </div>
                            <div>
                              <h4 className="text-[14px] font-bold text-foreground">Stakeholder Ecosystem</h4>
                              <p className="text-[11px] text-muted">Key players and their economic incentives.</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            {articleData.research_summary.stakeholders?.map((stakeholder, i) => {
                              if (typeof stakeholder === 'string') {
                                return (
                                  <p key={i} className="inline-flex px-4 py-2 rounded-2xl bg-primary/5 border border-primary/10 text-[12px] font-bold text-primary w-fit">
                                    {stakeholder}
                                  </p>
                                );
                              }
                              return (
                                <div key={i} className="p-5 rounded-2xl bg-background/40 border border-border/40 hover:border-primary/30 transition-all group">
                                  <div className="font-bold text-[14px] text-foreground mb-3 flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-primary/40 shrink-0" />
                                    {stakeholder.name}
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                                    <div className="space-y-1.5 p-3 rounded-xl bg-surface/40">
                                      <span className="text-[10px] uppercase font-bold tracking-tight text-muted">Economic Incentive</span>
                                      <p className="text-[12px] text-muted-dark leading-relaxed">{stakeholder.incentive}</p>
                                    </div>
                                    <div className="space-y-1.5 p-3 rounded-xl bg-destructive/5">
                                      <span className="text-[10px] uppercase font-bold tracking-tight text-destructive/60">Potential Conflict</span>
                                      <p className="text-[12px] text-muted-dark leading-relaxed">{stakeholder.conflict}</p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No stakeholders identified in the current research context.</div>
                      )}
                    </div>
                  )}

                  {/* Examples Tab */}
                  {activeTab === 'examples' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {(articleData.research_summary.examples?.length || 0) > 0 ? (
                        <div className="p-4 rounded-3xl bg-surface/30 border border-border/60">
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-2xl bg-success/10 flex items-center justify-center text-success">
                              <Lightbulb size={20} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-[14px] font-bold text-foreground">Comparative Examples</h4>
                                <div className="group relative">
                                  <button className="p-1 rounded-full hover:bg-surface transition-colors text-muted hover:text-primary">
                                    <Info size={14} />
                                  </button>
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 p-3 bg-foreground text-background text-[10px] rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-50">
                                    <div className="space-y-2">
                                      <p className="font-bold border-b border-background/20 pb-1 mb-2">Research Glossary</p>
                                      <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-success" />
                                        <span><strong>Success:</strong> Proven solution or positive case study.</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-red-400" />
                                        <span><strong>Failure:</strong> Historical lesson or project bottleneck.</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                        <span><strong>Neutral:</strong> Key entity or strategic context point.</span>
                                      </div>
                                    </div>
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-foreground" />
                                  </div>
                                </div>
                              </div>
                              <p className="text-[11px] text-muted">Real-world case studies and success stories.</p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            {articleData.research_summary.examples?.map((example, i) => {
                              const isObject = typeof example === 'object' && example !== null;
                              const type = isObject ? (example as Record<string, unknown>).type as string : 'Case Study';
                              const scenario = isObject ? (example as Record<string, unknown>).scenario as string : example;

                              return (
                                <div key={i} className="p-5 rounded-2xl bg-background/40 border border-border/40 text-[13px] text-muted-dark hover:border-success/30 transition-all">
                                  <div className="flex items-center justify-between mb-3">
                                    <span className="font-bold text-foreground text-[11px] uppercase tracking-wider">Example {i + 1}</span>
                                    {isObject && (
                                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-tight ${type?.toLowerCase() === 'success' ? 'bg-success/10 text-success border border-success/20' :
                                          type?.toLowerCase() === 'failure' ? 'bg-destructive/10 text-destructive border border-destructive/20' :
                                            'bg-primary/10 text-primary border border-primary/20'
                                        }`}>
                                        {type}
                                      </span>
                                    )}
                                  </div>
                                  <div className="leading-relaxed">
                                    {scenario}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 text-muted italic text-[12px]">No comparative examples found for this investigation.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SEO Analyzer Sidebar */}
        {showSEO && (
          <motion.div 
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="w-[320px] hidden lg:block shrink-0 h-full border-l border-border/40 bg-surface/20 backdrop-blur-xl z-30"
          >
            <SEOAnalyzer 
              content={editor?.getText() || ""} 
              topic={articleData?.topic || title} 
              audit={audit}
            />
          </motion.div>
        )}

        <AnimatePresence>
          {audioUrl && (
            <AudioBriefingPlayer 
              key="audio-briefing-player"
              audioUrl={audioUrl} 
              title={title} 
              onClose={() => setAudioUrl(null)} 
            />
          )}
        </AnimatePresence>
      </div>

      {/* Editor Modal for Link/Image */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-background border border-border shadow-2xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${modalType === 'link' ? 'bg-primary/10 text-primary' : 'bg-[var(--primary)]/10 text-[var(--primary)]'}`}>
                  {modalType === 'link' ? <Link2 size={20} /> : <ImageIcon size={20} />}
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-foreground">
                    {modalType === 'link' ? 'Insert Link' : 'Insert Image'}
                  </h3>
                  <p className="text-[11px] text-muted-dark">
                    {modalType === 'link' ? 'Point this selection to a web address.' : 'Provide a public URL for your visual asset.'}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted">URL Address</label>
                  <input
                    autoFocus
                    type="text"
                    value={modalUrl}
                    onChange={(e) => setModalUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleApplyModal()}
                    placeholder="https://example.com/..."
                    className="w-full px-4 py-3 rounded-xl bg-surface border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none text-[13px] transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 mt-8">
                <button
                  onClick={() => setModalOpen(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border text-[12px] font-bold text-muted-dark hover:bg-surface transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyModal}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-[12px] font-bold text-white transition-all ${modalType === 'link' ? 'bg-primary hover:bg-primary-dark' : 'bg-[var(--primary)] hover:bg-[var(--primary-hover)]'}`}
                >
                  Apply {modalType === 'link' ? 'Link' : 'Image'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
