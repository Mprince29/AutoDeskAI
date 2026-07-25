"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export interface AdvisorAdvice {
  rule_id: string;
  message: string;
  action_label?: string | null;
  action_type?: string | null;
  icon?: string;
}

interface Props {
  advice: AdvisorAdvice | null;
  onDismiss: () => void;
  onAction?: (action_type: string) => void;
}

export default function AdvisorToast({ advice, onDismiss, onAction }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!advice) { setVisible(false); return; }
    setVisible(true);
    const timer = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 300); }, 6000);
    return () => clearTimeout(timer);
  }, [advice]);

  if (!advice) return null;

  const handleDismiss = () => { setVisible(false); setTimeout(onDismiss, 300); };

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 max-w-sm transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#1a1a2e]/95 backdrop-blur-md px-4 py-3 shadow-2xl">
        <span className="mt-0.5 text-lg select-none">{advice.icon || "💡"}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/90 leading-snug">{advice.message}</p>
          {advice.action_label && advice.action_type && (
            <button
              onClick={() => onAction?.(advice.action_type!)}
              className="mt-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {advice.action_label} →
            </button>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="mt-0.5 text-white/40 hover:text-white/80 transition-colors flex-shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
