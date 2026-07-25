"use client";

import React, { useState } from 'react';
import { Check, Copy, Mail, RefreshCw, Settings2, AlertTriangle, Hash } from 'lucide-react';
import { SiX, SiInstagram, SiFacebook } from 'react-icons/si';
import { FaLinkedinIn } from 'react-icons/fa6';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import SocialMediaCutout from './SocialMediaCutout';
import { Layout, Type } from 'lucide-react';

interface SocialCard {
  platform: 'X' | 'LinkedIn' | 'Instagram' | 'Facebook' | 'Newsletter';
  content: string;
  tags: string[];
  charLimit: number;
}

interface SocialMediaKitProps {
  data: SocialCard[];
  onCopy?: (platform: string, content: string | string[]) => void;
  onRegenerate?: (options: { platforms: string[], moreHashtags: boolean, prompt?: string }) => void;
  isGenerating?: boolean;
  imageUrl?: string | null;
}

export default function SocialMediaKit({ data, onCopy, onRegenerate, isGenerating, imageUrl }: SocialMediaKitProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedPartIndex, setCopiedPartIndex] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['X', 'LinkedIn', 'Instagram', 'Facebook', 'Newsletter']);
  const [moreHashtags, setMoreHashtags] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [showCutouts, setShowCutouts] = useState(false);

  const handleCopy = (text: string, index: number, platform?: string, partIdx?: number) => {
    if (onCopy && platform) {
      onCopy(platform, text);
    } else {
      navigator.clipboard.writeText(text);
    }
    
    if (partIdx !== undefined) {
      setCopiedPartIndex(`${index}-${partIdx}`);
      setTimeout(() => setCopiedPartIndex(null), 2000);
    } else {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) 
        ? prev.filter(p => p !== platform) 
        : [...prev, platform]
    );
  };

  const handleRegenerateClick = () => {
    if (onRegenerate && selectedPlatforms.length > 0) {
      onRegenerate({ platforms: selectedPlatforms, moreHashtags, prompt: regenPrompt });
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'X': return <SiX size={10} color="white" />;
      case 'LinkedIn': return <FaLinkedinIn size={11} color="white" />;
      case 'Instagram': return <SiInstagram size={10} color="white" />;
      case 'Facebook': return <SiFacebook size={18} color="Blue" />;
      case 'Newsletter': return <Mail size={11} stroke="white" />;
      default: return null;
    }
  };

  const getPlatformClass = (platform: string) => {
    switch (platform) {
      case 'X': return 'platform-x';
      case 'LinkedIn': return 'platform-linkedin';
      case 'Instagram': return 'platform-instagram';
      case 'Facebook': return 'platform-facebook';
      case 'Newsletter': return 'platform-newsletter';
      default: return '';
    }
  };

  const renderCards = (platform: SocialCard["platform"]) => {
    const filtered = data.filter((card) => card.platform === platform);

    if (filtered.length === 0) {
      return (
        <div className="text-sm text-muted italic px-2 py-4">
          No content available for {platform}.
        </div>
      );
    }

    return filtered.map((card, idx) => {
      // Split content into parts by double newlines if it's over the limit or has multiple logical sections
      const hasDoubleNewlines = card.content.includes('\n\n');
      const parts = hasDoubleNewlines ? card.content.split('\n\n').filter(p => p.trim()) : [card.content];
      
      // We consider it "multi-part" if there's more than 1 part and it's either X or it exceeds the total limit
      const isMultiPart = parts.length > 1;
      
      const overLimitParts = parts.filter(p => p.length > card.charLimit);
      const isOverLimit = overLimitParts.length > 0;
      
      // Extract hashtags from content to supplement the tags list
      const extractedTags = Array.from(card.content.matchAll(/#(\w+)/g)).map(m => m[1]);
      const allTags = Array.from(new Set([...card.tags, ...extractedTags]));

      const platformName = card.platform === 'Newsletter' ? 'Newsletter blurb' : card.platform;
      const partLabel = card.platform === 'X' ? 'tweets' : 'parts';

      return (
        <div key={idx} className={`border-thin rounded-lg bg-background overflow-hidden flex flex-col mb-3 last:mb-0 transition-all ${isOverLimit ? 'ring-1 ring-red-500/30' : ''}`}>

          {/* Header */}
          <div className="p-3 border-thin-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-md flex items-center justify-center ${getPlatformClass(card.platform)}`}>
                {getPlatformIcon(card.platform)}
              </div>
              <span className="text-[12px] font-semibold">
                {platformName}
                {isMultiPart && ` (${parts.length} ${partLabel})`}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <span
                className={`text-[11px] font-mono font-bold ${
                  isOverLimit
                    ? 'text-red-500'
                    : card.content.length > (card.charLimit * (isMultiPart ? parts.length : 1)) * 0.9
                    ? 'text-amber-500'
                    : 'text-muted'
                }`}
              >
                {isMultiPart 
                  ? `Avg ${Math.round(card.content.length / parts.length)} / ${card.charLimit}`
                  : `${card.content.length} / ${card.charLimit}`
                }
              </span>

              <button
                onClick={() => handleCopy(card.content, idx, card.platform)}
                className="text-xs flex items-center gap-1.5 text-foreground hover:text-foreground/80 transition"
              >
                {copiedIndex === idx ? <Check size={10} /> : <Copy size={10} />}
                {copiedIndex === idx ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-4 py-3 max-h-[500px] overflow-y-auto bg-surface/20">
            {showCutouts ? (
              <div className="py-4">
                <SocialMediaCutout 
                  platform={card.platform}
                  content={card.platform === 'X' && card.content.includes('\n\n') ? card.content.split('\n\n')[0] : card.content}
                  imageUrl={imageUrl}
                />
              </div>
            ) : isMultiPart ? (
              <div className="space-y-4">
                {parts.map((part, pIdx) => {
                  const partOver = part.length > card.charLimit;
                  const isPartCopied = copiedPartIndex === `${idx}-${pIdx}`;
                  return (
                    <div key={pIdx} className={`relative p-3 rounded-lg border ${partOver ? 'border-red-500/30 bg-red-500/5' : 'border-border/30 bg-background/50'}`}>
                      <div className="absolute -left-2 top-4 w-4 h-4 rounded-full bg-surface border-2 border-border flex items-center justify-center text-[8px] font-bold">
                        {pIdx + 1}
                      </div>
                      <div className="absolute right-2 top-2 z-10">
                        <button
                          onClick={() => handleCopy(part, idx, card.platform, pIdx)}
                          className="p-1 rounded bg-background/80 border border-border/50 hover:bg-background transition-colors text-muted hover:text-foreground"
                        >
                          {isPartCopied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                        </button>
                      </div>
                      <p className="text-[13px] whitespace-pre-wrap break-words leading-relaxed pr-6">
                        {part}
                      </p>
                      <div className={`mt-2 text-[10px] font-mono text-right ${partOver ? 'text-red-500 font-bold' : 'text-muted'}`}>
                        {part.length} / {card.charLimit}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13.5px] whitespace-pre-wrap break-words">
                {card.content || (
                  <span className="italic text-muted">
                    No content generated.
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Tags */}
          <div className="px-3 pb-3 flex flex-wrap gap-1.5 mt-2">
            {allTags.map((tag, tIdx) => (
              <span
                key={tIdx}
                className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="section-block no-print">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div style={{margin: 0}} className="section-label">Social media kit</div>
          
          <div className="flex items-center bg-surface/60 p-0.5 rounded-lg border border-border/40">
            <button
              onClick={() => setShowCutouts(false)}
              className={`p-1.5 rounded-md transition-all ${!showCutouts ? 'text-primary bg-background shadow-sm' : 'text-muted-dark hover:text-foreground'}`}
              title="List View"
            >
              <Type size={14} />
            </button>
            <button
              onClick={() => setShowCutouts(true)}
              className={`p-1.5 rounded-md transition-all ${showCutouts ? 'text-primary bg-background shadow-sm' : 'text-muted-dark hover:text-foreground'}`}
              title="Visual Cutouts"
            >
              <Layout size={14} />
            </button>
          </div>
        </div>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-2 text-[11px] font-bold uppercase tracking-wider">
              <Settings2 size={14} />
              Regenerate Kit
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-4 bg-background border-border shadow-2xl" align="end">
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-[12px] font-bold text-foreground">Select Platforms</h4>
                <div className="grid grid-cols-2 gap-2">
                  {['X', 'LinkedIn', 'Instagram', 'Facebook', 'Newsletter'].map((p) => (
                    <div key={p} className="flex items-center space-x-2">
                      <Checkbox 
                        id={`regen-${p}`} 
                        checked={selectedPlatforms.includes(p)}
                        onCheckedChange={() => togglePlatform(p)}
                        className="border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:text-white"
                      />
                      <Label htmlFor={`regen-${p}`} className="text-[11px] font-medium cursor-pointer">{p}</Label>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="h-[1px] bg-border/20" />
              
              <div className="flex items-center justify-between group cursor-pointer" onClick={() => setMoreHashtags(!moreHashtags)}>
                <div className="space-y-0.5">
                  <Label className="text-[12px] font-bold cursor-pointer">More Hashtags</Label>
                  <p className="text-[10px] text-muted">Increase hashtag density</p>
                </div>
                <Checkbox 
                  checked={moreHashtags} 
                  onCheckedChange={(checked) => setMoreHashtags(!!checked)}
                  className="border-primary/50 data-[state=checked]:bg-primary data-[state=checked]:text-white"
                />
              </div>

              <div className="h-[1px] bg-border/20" />
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-[12px] font-bold">Refinement Prompt</Label>
                  <span className="text-[10px] text-muted-dark opacity-60 font-medium">(Optional)</span>
                </div>
                <textarea 
                  value={regenPrompt}
                  onChange={(e) => setRegenPrompt(e.target.value)}
                  className="w-full min-h-[70px] text-[11px] bg-surface/40 border-thin rounded-lg p-2 focus:outline-none focus:border-primary/50 text-foreground resize-none"
                  placeholder="E.g. Make it more professional, focus on the tech impact..."
                />
              </div>

              <Button 
                className="w-full h-10 gap-2 text-[12px] font-bold bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20" 
                onClick={handleRegenerateClick}
                disabled={isGenerating || selectedPlatforms.length === 0}
              >
                {isGenerating ? (
                  <>
                    <RefreshCw size={14} className="animate-spin text-white" />
                    <span className="text-white">Regenerating...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} className="text-white" />
                    <span className="text-white">Regenerate Selected</span>
                  </>
                )}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Tabs defaultValue="X" className="w-full">
        {/* Full-width Tabs */}
        <TabsList className="mb-3 w-full grid grid-cols-5 bg-surface p-1 rounded-lg">
          <TabsTrigger value="X"><SiX className='w-4 h-4' /></TabsTrigger>
          <TabsTrigger value="LinkedIn"><FaLinkedinIn className='w-4 h-4' /></TabsTrigger>
          <TabsTrigger value="Instagram"><SiInstagram className='w-4 h-4' /></TabsTrigger>
          <TabsTrigger value="Facebook"><SiFacebook className='w-4 h-4' /></TabsTrigger>
          <TabsTrigger value="Newsletter"><Mail className='w-4 h-4' /></TabsTrigger>
        </TabsList>

        {/* Tab Content */}
        <TabsContent value="X" className="mt-0">
          {renderCards("X")}
        </TabsContent>

        <TabsContent value="LinkedIn" className="mt-0">
          {renderCards("LinkedIn")}
        </TabsContent>

        <TabsContent value="Instagram" className="mt-0">
          {renderCards("Instagram")}
        </TabsContent>

        <TabsContent value="Facebook" className="mt-0">
          {renderCards("Facebook")}
        </TabsContent>

        <TabsContent value="Newsletter" className="mt-0">
          {renderCards("Newsletter")}
        </TabsContent>
      </Tabs>
    </div>
  );
}

