"use client";
import React, { useState, useEffect } from "react";

interface StatusLoaderProps {
  statuses: string[];
  title?: string;
}

export function StatusLoader({ statuses}: StatusLoaderProps) {
  const [visible, setVisible] = useState(0);
  const [dot, setDot] = useState(0);

  // Track latest visible step
  useEffect(() => {
    if (statuses.length === 0) return;
    setVisible(statuses.length - 1);
  }, [statuses]);

  // Animate dots
  useEffect(() => {
    const t = setInterval(() => setDot((d) => (d + 1) % 3), 300);
    return () => clearInterval(t);
  }, []);

  // Reusable dot loader
  const DotLoader = () => (
    <div className="flex gap-1 mt-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full bg-primary transition-all duration-300 ${
            dot === i ? "opacity-100 scale-110" : "opacity-30"
          }`}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 py-3 px-4 bg-background/40 rounded-2xl backdrop-blur-md w-full">
      {/* Empty state */}
      {statuses.length === 0 ? (
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <DotLoader />
          <span className="text-foreground font-bold">Waiting...</span>
        </div>
      ) : (
        statuses.map((s, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 text-[11px] font-mono transition-all duration-500 ${
              i === visible ? "opacity-100 translate-x-1" : "opacity-30"
            }`}
          >
            {/* Loader or Check */}
            <div className="w-6 flex justify-center">
              {i === visible ? (
                <DotLoader />
              ) : (
                <span className="text-success text-sm">✓</span>
              )}
            </div>

            {/* Text */}
            <span className={i === visible ? "text-foreground font-bold" : "text-muted"}>
              {s}
            </span>
          </div>
        ))
      )}
    </div>
  );
}