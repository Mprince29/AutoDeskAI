"use client";

import React from 'react';
import { Newspaper, Download, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toPng } from 'html-to-image';

interface NewspaperCutoutProps {
  title: string;
  content: string;
  date?: string;
  imageUrl?: string | null;
  author?: string;
}

export default function NewspaperCutout({
  title,
  content,
  date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
  imageUrl,
  author = "AutoDeskAI AI"
}: NewspaperCutoutProps) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const paperRef = React.useRef<HTMLDivElement>(null);

  // Clean and split content into paragraphs, stopping at Sources/References
  const paragraphs = React.useMemo(() => {
    const rawParagraphs = content.split('\n\n').filter(p => p.trim());
    const filtered = [];
    for (const p of rawParagraphs) {
      const cleaned = p.trim().toLowerCase();
      // Stop if we hit a sources or references section
      if (
        cleaned.includes('sources') ||
        cleaned.includes('references') ||
        cleaned.startsWith('###') ||
        cleaned.startsWith('##')
      ) {
        // Only stop if it's likely a header at the end, not just a mention in text
        if (cleaned.length < 50 && (cleaned.includes('source') || cleaned.includes('reference'))) {
          break;
        }
      }

      // Clean markdown: remove bold (**), remove links ([text](url) -> text), remove headers (#)
      const processed = p
        .replace(/^#+\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

      filtered.push(processed);
    }
    return filtered;
  }, [content]);

  const handleDownload = async () => {
    if (!paperRef.current) return;

    setIsDownloading(true);
    try {
      // Small delay to ensure styles are applied
      await new Promise(resolve => setTimeout(resolve, 100));

      const dataUrl = await toPng(paperRef.current, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: '#f4f1ea',
        style: {
          transform: 'scale(1)',
        }
      });

      const link = document.createElement('a');
      link.download = `newspaper-${title.slice(0, 20).toLowerCase().replace(/\s+/g, '-')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to download newspaper image:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="relative group/newspaper max-w-5xl mx-auto my-12">
      {/* Download Floating Action Button */}
      <button
        onClick={handleDownload}
        disabled={isDownloading}
        className="absolute -top-4 -right-4 z-50 p-3 rounded-full bg-primary text-white shadow-xl hover:scale-110 active:scale-95 transition-all opacity-0 group-hover/newspaper:opacity-100 disabled:opacity-50"
        title="Download as Image"
      >
        {isDownloading ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
      </button>

      <motion.div
        ref={paperRef}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#f4f1ea] text-[#1a1a1a] border border-[#d1cec4] relative font-serif"
        style={{ fontFamily: 'var(--font-playfair), serif' }}
      >
        {/* Paper Texture Overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.05] mix-blend-multiply bg-[url('https://www.transparenttextures.com/patterns/paper.png')]" />

        {/* Subtle Edge Burn/Vignette */}
        <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.05)]" />

        {/* Header / Masthead */}
        <div className="p-8 pb-4">
          <div className="flex flex-col items-center justify-center text-[10px] uppercase tracking-[0.2em] font-bold border-b-2 border-[#1a1a1a] pb-2 mb-4">
            <span className="text-4xl md:text-6xl font-black tracking-[-0.05em] leading-none mb-1">THE MIGHTY DISPATCH</span>
            <span className="text-[9px] tracking-[0.4em] opacity-60">GLOBAL INTELLIGENCE & ANALYSIS</span>
          </div>
          <span>{date}</span>
        </div>

        <div className="px-10 pb-10">
          <div className="grid grid-cols-1">
            {/* Lead Image Area */}
            {imageUrl && (
              <div className="md:col-span-12 lg:col-span-8">
                <div className="relative group overflow-hidden border-2 border-[#1a1a1a]">
                  <img
                    src={imageUrl}
                    alt="Article feature"
                    crossOrigin="anonymous"
                    className="w-full h-[500px] object-cover grayscale brightness-90 contrast-125 hover:scale-105 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                </div>
              </div>
            )}

            {/* Main Content Columns */}
            <div className="md:col-span-12 mt-4">
              <div className="columns-1 md:columns-2 lg:columns-3 gap-12 text-[17px] leading-[1.6] text-justify space-y-6">
                {paragraphs.map((p, i) => (
                  <p
                    key={i}
                    className={`mb-4 ${i === 0 ? 'first-letter:float-left first-letter:text-8xl first-letter:font-black first-letter:mr-4 first-letter:mt-2 first-letter:leading-[0.8] first-letter:border-r-4 first-letter:border-b-4 first-letter:border-[#1a1a1a] first-letter:pr-3 first-letter:pb-1' : ''}`}
                  >
                    {p}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
