"use client";

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Volume2, X, RotateCcw, Headset, Download, Loader2 } from 'lucide-react';

interface AudioBriefingPlayerProps {
  audioUrl: string;
  onClose: () => void;
  title: string;
}

export function AudioBriefingPlayer({ audioUrl, onClose, title }: AudioBriefingPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const onTimeUpdate = () => {
    if (audioRef.current) {
      const current = audioRef.current.currentTime;
      const total = audioRef.current.duration;
      setCurrentTime(current);
      if (total > 0) {
        setProgress((current / total) * 100);
      }
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `briefing-${title.slice(0, 20)}.mp3`;
    link.click();
  };

  return (
    <motion.div 
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed bottom-6 right-6 z-[60] w-[340px] bg-black/90 backdrop-blur-2xl border border-white/10 rounded-[28px] p-5 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)]"
    >
      <audio 
        ref={audioRef} 
        src={audioUrl} 
        onTimeUpdate={onTimeUpdate} 
        onLoadedMetadata={onLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />
      
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/20 flex items-center justify-center text-primary border border-primary/20">
            <Headset size={20} />
          </div>
          <div>
            <h4 className="text-[12px] font-bold text-white tracking-tight">AI News Briefing</h4>
            <p className="text-[10px] text-white/50 font-medium uppercase tracking-widest truncate w-[180px]">{title}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Waveform Visualization (Animated) */}
      <div className="flex items-center justify-between gap-1 h-12 mb-4 px-2">
        {Array.from({ length: 24 }).map((_, i) => (
          <motion.div
            key={i}
            animate={{ 
              height: isPlaying ? [10, Math.random() * 40 + 10, 10] : 10 
            }}
            transition={{ 
              repeat: Infinity, 
              duration: 0.5 + Math.random(),
              ease: "easeInOut"
            }}
            className="w-1 bg-primary/40 rounded-full"
          />
        ))}
      </div>

      {/* Progress Bar */}
      <div className="space-y-1 mb-4">
        <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-white/40">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <button className="text-white/40 hover:text-white transition-colors">
          <RotateCcw size={18} />
        </button>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={togglePlay}
            className="w-14 h-14 rounded-full bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
          >
            {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" className="ml-1" />}
          </button>
        </div>

        <button onClick={handleDownload} className="text-white/40 hover:text-white transition-colors">
          <Download size={18} />
        </button>
      </div>
    </motion.div>
  );
}
