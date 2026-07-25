"use client";

import React from 'react';
import { SiX, SiInstagram, SiFacebook } from 'react-icons/si';
import { FaLinkedinIn, FaRegComment, FaHeart, FaRetweet, FaShareAlt, FaRegHeart, FaRegBookmark } from 'react-icons/fa';
import { motion } from 'framer-motion';
import { MoreHorizontal, ShieldCheck, Mail, Send, MessageCircle, ThumbsUp, Share2, Bookmark, Download, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';

interface SocialMediaCutoutProps {
  platform: 'X' | 'LinkedIn' | 'Instagram' | 'Facebook' | 'Newsletter';
  content: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  date?: string;
  imageUrl?: string | null;
}

export default function SocialMediaCutout({
  platform,
  content,
  authorName = "AutoDeskAI AI",
  authorHandle = "@autodeskai_ai",
  authorAvatar = "https://api.dicebear.com/7.x/bottts/svg?seed=autodeskai",
  date = "2h",
  imageUrl
}: SocialMediaCutoutProps) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setIsDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: platform === 'X' || platform === 'Instagram' ? '#000000' : '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `${platform.toLowerCase()}-cutout.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to download social media cutout:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const wrapWithDownload = (content: React.ReactNode) => (
    <div className="relative group/cutout max-w-fit mx-auto">
      <button
        onClick={handleDownload}
        disabled={isDownloading}
        className="absolute -top-3 -right-3 z-50 p-2 rounded-full bg-primary text-white shadow-lg hover:scale-110 active:scale-95 transition-all opacity-0 group-hover/cutout:opacity-100 disabled:opacity-50"
        title="Download as Image"
      >
        {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      </button>
      <div ref={cardRef}>
        {content}
      </div>
    </div>
  );

  // X (Twitter) Layout
  if (platform === 'X') {
    return wrapWithDownload(
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-[550px] mx-auto bg-black text-white p-4 rounded-xl border border-white/10 font-sans"
      >
        <div className="flex justify-between items-start mb-3">
          <div className="flex gap-3">
            <img src={authorAvatar} alt="Avatar" crossOrigin="anonymous" className="w-12 h-12 rounded-full border border-white/10" />
            <div>
              <div className="flex items-center gap-1">
                <span className="font-bold text-[15px]">{authorName}</span>
                <ShieldCheck size={14} className="text-[#1D9BF0] fill-[#1D9BF0]" />
              </div>
              <div className="text-[#71767b] text-[15px]">
                {authorHandle} · {date}
              </div>
            </div>
          </div>
          <button className="text-[#71767b]">
            <MoreHorizontal size={18} />
          </button>
        </div>

        <div className="text-[15px] leading-normal mb-3 whitespace-pre-wrap">
          {content}
        </div>

        {imageUrl && (
          <div className="rounded-2xl border border-white/10 overflow-hidden mb-3">
            <img src={imageUrl} alt="Post content" crossOrigin="anonymous" className="w-full object-cover max-h-[300px]" />
          </div>
        )}

        <div className="flex justify-between text-[#71767b] pt-1 border-t border-white/5">
          <div className="flex items-center gap-2 hover:text-[#1D9BF0] transition-colors cursor-pointer p-2 rounded-full hover:bg-[#1D9BF0]/10">
            <FaRegComment size={14} />
            <span className="text-[13px]">42</span>
          </div>
          <div className="flex items-center gap-2 hover:text-[#00BA7C] transition-colors cursor-pointer p-2 rounded-full hover:bg-[#00BA7C]/10">
            <FaRetweet size={16} />
            <span className="text-[13px]">128</span>
          </div>
          <div className="flex items-center gap-2 hover:text-[#F91880] transition-colors cursor-pointer p-2 rounded-full hover:bg-[#F91880]/10">
            <FaHeart size={14} />
            <span className="text-[13px]">1.2K</span>
          </div>
          <div className="flex items-center gap-2 hover:text-[#1D9BF0] transition-colors cursor-pointer p-2 rounded-full hover:bg-[#1D9BF0]/10">
            <FaShareAlt size={14} />
          </div>
        </div>
      </motion.div>
    );
  }

  // LinkedIn Layout
  if (platform === 'LinkedIn') {
    return wrapWithDownload(
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-[550px] mx-auto bg-white text-black p-4 rounded-xl border border-gray-200 font-sans"
      >
        <div className="flex justify-between items-start mb-3">
          <div className="flex gap-2">
            <img src={authorAvatar} alt="Avatar" crossOrigin="anonymous" className="w-12 h-12 rounded" />
            <div>
              <div className="flex items-center gap-1">
                <span className="font-bold text-[14px] hover:text-[#0a66c2] hover:underline cursor-pointer">{authorName}</span>
                <span className="text-gray-500 text-[12px] font-normal"> · 1st</span>
              </div>
              <div className="text-gray-500 text-[12px] leading-tight">
                AI Research Assistant at AutoDeskAI
              </div>
              <div className="text-gray-500 text-[12px] flex items-center gap-1 mt-0.5">
                {date} · <span className="text-[10px]">🌐</span>
              </div>
            </div>
          </div>
          <button className="text-gray-500">
            <MoreHorizontal size={20} />
          </button>
        </div>

        <div className="text-[14px] leading-relaxed mb-4 whitespace-pre-wrap">
          {content}
        </div>

        {imageUrl && (
          <div className="border border-gray-100 overflow-hidden mb-4 -mx-4">
            <img src={imageUrl} alt="Post content" crossOrigin="anonymous" className="w-full object-cover max-h-[400px]" />
          </div>
        )}

        <div className="flex items-center justify-between pb-2 border-b border-gray-100 mb-1">
          <div className="flex items-center">
            <div className="flex -space-x-1 items-center mr-2">
               <div className="w-4 h-4 bg-[#0a66c2] rounded-full flex items-center justify-center border border-white"><FaHeart size={8} color="white" /></div>
               <div className="w-4 h-4 bg-[#e7a33e] rounded-full flex items-center justify-center border border-white"><span className="text-[8px] text-white">👏</span></div>
            </div>
            <span className="text-[12px] text-gray-500 hover:text-[#0a66c2] hover:underline cursor-pointer">Prabhat Singh and 256 others</span>
          </div>
          <div className="text-[12px] text-gray-500">
             <span className="hover:text-[#0a66c2] hover:underline cursor-pointer">12 comments</span> · <span className="hover:text-[#0a66c2] hover:underline cursor-pointer">8 shares</span>
          </div>
        </div>

        <div className="flex justify-between px-2 pt-1">
          <div className="flex items-center gap-1.5 text-gray-600 hover:bg-gray-100 p-2 rounded transition-colors cursor-pointer">
            <FaRegComment size={18} />
            <span className="text-[14px] font-semibold">Comment</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600 hover:bg-gray-100 p-2 rounded transition-colors cursor-pointer">
            <FaRetweet size={18} />
            <span className="text-[14px] font-semibold">Repost</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600 hover:bg-gray-100 p-2 rounded transition-colors cursor-pointer">
            <FaShareAlt size={18} />
            <span className="text-[14px] font-semibold">Send</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // Instagram Layout
  if (platform === 'Instagram') {
    return wrapWithDownload(
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-[450px] mx-auto bg-black text-white rounded-xl border border-white/10 overflow-hidden font-sans"
      >
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <div className="p-[2px] rounded-full bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]">
              <img src={authorAvatar} alt="Avatar" crossOrigin="anonymous" className="w-8 h-8 rounded-full border-2 border-black" />
            </div>
            <span className="font-bold text-[13px]">{authorName}</span>
          </div>
          <MoreHorizontal size={18} />
        </div>

        <div className="aspect-square bg-zinc-900 flex items-center justify-center overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt="Instagram post" crossOrigin="anonymous" className="w-full h-full object-cover" />
          ) : (
            <SiInstagram size={60} className="opacity-20" />
          )}
        </div>

        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <FaRegHeart size={22} className="hover:text-red-500 transition-colors cursor-pointer" />
              <MessageCircle size={22} className="hover:text-gray-400 transition-colors cursor-pointer" />
              <Send size={22} className="hover:text-gray-400 transition-colors cursor-pointer" />
            </div>
            <Bookmark size={22} className="hover:text-gray-400 transition-colors cursor-pointer" />
          </div>
          
          <div className="font-bold text-[13px] mb-1">1,234 likes</div>
          
          <div className="text-[13px] leading-snug">
            <span className="font-bold mr-2">{authorName}</span>
            {content.slice(0, 150)}{content.length > 150 ? '...' : ''}
          </div>
          
          <div className="text-[12px] text-gray-500 mt-2 uppercase">December 15</div>
        </div>
      </motion.div>
    );
  }

  // Facebook Layout
  if (platform === 'Facebook') {
    return wrapWithDownload(
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-[550px] mx-auto bg-white text-black rounded-xl border border-gray-300 overflow-hidden font-sans"
      >
        <div className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={authorAvatar} alt="Avatar" crossOrigin="anonymous" className="w-10 h-10 rounded-full" />
            <div>
              <div className="font-bold text-[14px] hover:underline cursor-pointer">{authorName}</div>
              <div className="text-[12px] text-gray-500 flex items-center gap-1">
                {date} · 🌎
              </div>
            </div>
          </div>
          <MoreHorizontal size={20} className="text-gray-500" />
        </div>

        <div className="px-3 pb-3 text-[14px] leading-normal whitespace-pre-wrap">
          {content}
        </div>

        {imageUrl && (
          <div className="border-t border-b border-gray-100">
            <img src={imageUrl} alt="Facebook post" crossOrigin="anonymous" className="w-full object-cover max-h-[400px]" />
          </div>
        )}

        <div className="p-3">
          <div className="flex items-center justify-between text-[13px] text-gray-500 pb-2 border-b border-gray-200">
            <div className="flex items-center gap-1">
              <div className="flex -space-x-1">
                <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center border border-white"><ThumbsUp size={8} color="white" fill="white" /></div>
                <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center border border-white"><FaHeart size={8} color="white" /></div>
              </div>
              <span>128</span>
            </div>
            <div>42 comments · 15 shares</div>
          </div>

          <div className="flex justify-around pt-1">
            <div className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-100 rounded transition-colors cursor-pointer text-gray-600 font-semibold text-[13px]">
              <ThumbsUp size={16} /> Like
            </div>
            <div className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-100 rounded transition-colors cursor-pointer text-gray-600 font-semibold text-[13px]">
              <MessageCircle size={16} /> Comment
            </div>
            <div className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-100 rounded transition-colors cursor-pointer text-gray-600 font-semibold text-[13px]">
              <Share2 size={16} /> Share
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // Newsletter Layout
  return wrapWithDownload(
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-[600px] mx-auto bg-[#fafafa] text-[#333] rounded-xl border border-gray-200 overflow-hidden font-serif"
    >
      <div className="bg-primary p-6 text-white text-center">
        <Mail size={32} className="mx-auto mb-2 opacity-50" />
        <h2 className="text-xl font-bold tracking-tight uppercase">The Weekly Dispatch</h2>
        <p className="text-[10px] tracking-widest opacity-70 font-sans">INTELLIGENCE FOR THE MODERN ERA</p>
      </div>
      
      <div className="p-8 bg-white m-4 rounded shadow-sm border border-gray-100">
        <div className="text-[12px] text-gray-400 mb-4 font-sans tracking-wide">ISSUE #042 • {new Date().toLocaleDateString()}</div>
        
        <h1 className="text-2xl font-bold mb-6 leading-tight border-b-2 border-primary/20 pb-4">
          Insights from the AutoDeskAI AI Network
        </h1>

        <div className="text-[15px] leading-relaxed mb-6 whitespace-pre-wrap">
          {content}
        </div>

        {imageUrl && (
          <div className="mb-6">
            <img src={imageUrl} alt="Newsletter image" crossOrigin="anonymous" className="w-full rounded border border-gray-100" />
          </div>
        )}

        <div className="bg-surface/50 p-4 rounded-lg border border-border/40 font-sans">
          <p className="text-[13px] font-bold text-primary mb-1">Stay Ahead of the Curve</p>
          <p className="text-[12px] text-muted-dark leading-relaxed">
            You're receiving this because you're part of the AutoDeskAI intelligence network.
          </p>
        </div>
      </div>

      <div className="p-6 text-center text-[11px] text-gray-400 font-sans border-t border-gray-100">
        Sent with ⚡ by AutoDeskAI AI • <span className="underline cursor-pointer">Unsubscribe</span>
      </div>
    </motion.div>
  );
}
