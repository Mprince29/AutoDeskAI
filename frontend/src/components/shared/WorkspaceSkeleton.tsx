"use client";
import React from 'react';

interface WorkspaceSkeletonProps {
  variant?: 'list' | 'inbox' | 'inbox-list' | 'calendar';
  count?: number;
}

export default function WorkspaceSkeleton({ variant = 'list', count = 8 }: WorkspaceSkeletonProps) {
  if (variant === 'calendar') {
    return (
      <div className="flex-1 bg-background overflow-hidden animate-pulse flex flex-col">
        {/* Mobile Agenda Skeleton */}
        <div className="flex-1 sm:hidden p-4 space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-muted/10" />
                <div className="flex-1 h-px bg-border/10" />
              </div>
              <div className="space-y-2 pl-2">
                <div className="w-full h-16 rounded-2xl bg-muted/5 border border-border/10" />
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Grid Skeleton */}
        <div className="hidden sm:grid grid-cols-7 h-full w-full gap-px bg-border/20 flex-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="bg-background/50 p-2 flex flex-col gap-2 min-h-[120px]">
              <div className="w-6 h-4 rounded bg-muted/10 self-center" />
              <div className="w-full h-8 rounded-lg bg-muted/5" />
              <div className="w-full h-8 rounded-lg bg-muted/5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'inbox' || variant === 'inbox-list') {
    return (
      <div className="flex-1 bg-background overflow-hidden animate-pulse flex flex-col">
        {/* Category Tabs Skeleton - only for full inbox variant */}
        {variant === 'inbox' && (
          <div className="flex items-center gap-8 px-6 sm:px-8 py-4 border-b border-border/20 overflow-x-auto shrink-0 bg-background/50">
            {[
              { label: 'Primary', icon: true },
              { label: 'Important', icon: true },
              { label: 'Social', icon: true },
              { label: 'Promotions', icon: true }
            ].map((tab, i) => (
              <div key={i} className="flex items-center gap-2.5 shrink-0 pb-1 relative">
                <div className="w-4 h-4 rounded-md bg-muted/10" />
                <div className="space-y-1">
                  <div className="w-16 h-3 rounded bg-muted/10" />
                  <div className="w-10 h-2 rounded bg-muted/5" />
                </div>
                {i === 0 && <div className="absolute -bottom-4 left-0 right-0 h-0.5 bg-primary/40 rounded-full" />}
              </div>
            ))}
          </div>
        )}

        {/* Email Threads List Skeleton */}
        <div className="flex-1 overflow-hidden space-y-px bg-background">
          {Array.from({ length: count > 12 ? count : 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 sm:gap-4 px-4 py-3 sm:py-3.5 border-b border-border/10">
              {/* Checkbox and Star */}
              <div className="hidden sm:flex items-center gap-4 shrink-0">
                <div className="w-4 h-4 rounded-md border border-border/20 bg-muted/5" />
                <div className="w-4 h-4 rounded bg-muted/10" />
              </div>
              
              <div className="flex-1 min-w-0 flex items-center gap-6">
                {/* Sender Name */}
                <div className="w-32 sm:w-48 h-4 rounded bg-muted/10 shrink-0" />
                
                {/* Subject and Snippet Group */}
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="w-[60%] h-4 rounded bg-muted/10" />
                  <div className="w-[85%] h-3 rounded bg-muted/5" />
                </div>

                {/* Date */}
                <div className="w-14 h-3 rounded bg-muted/5 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default List View (Docs, Drive, etc.)
  return (
    <div className="flex-1 bg-surface/5 divide-y divide-border/10 overflow-hidden animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-muted/10" />
              <div className="space-y-2">
                <div className="w-48 h-4 rounded bg-muted/10" />
                <div className="w-24 h-3 rounded bg-muted/5" />
              </div>
            </div>
            <div className="w-8 h-8 rounded-xl bg-muted/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
