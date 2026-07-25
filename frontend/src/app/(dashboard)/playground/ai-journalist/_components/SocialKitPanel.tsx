import React, { useState } from "react";
import { Share2, Check, Copy } from "lucide-react";
import { SocialKit } from "../types";

export function SocialKitPanel({ kit }: { kit: SocialKit }) {
  const [tab, setTab] = useState<"twitter" | "linkedin" | "newsletter">("twitter");
  const [copied, setCopied] = useState(false);

  const content = tab === "twitter"
    ? kit.twitter_thread.map((t, i) => `${i + 1}. ${t}`).join("\n\n")
    : tab === "linkedin" ? kit.linkedin_post
    : kit.newsletter_blurb;

  const copy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-4 rounded-xl border border-[#97C459]/40 bg-[#EAF3DE]/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#97C459]/20">
        <div className="flex items-center gap-2">
          <Share2 size={13} className="text-[#3B6D11]" />
          <span className="text-[11px] font-bold text-[#3B6D11]">Social Media Kit</span>
        </div>
        <button onClick={copy} className="flex items-center gap-1 text-[10px] font-semibold text-[#3B6D11] hover:opacity-70">
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="flex gap-0 border-b border-[#97C459]/20">
        {(["twitter", "linkedin", "newsletter"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[10px] font-bold capitalize transition-colors ${tab === t ? "bg-[#97C459]/20 text-[#3B6D11]" : "text-[#639922]/60 hover:text-[#3B6D11]"}`}
          >
            {t === "twitter" ? "X / Twitter" : t === "linkedin" ? "LinkedIn" : "Newsletter"}
          </button>
        ))}
      </div>
      <div className="px-3 py-2 max-h-40 overflow-y-auto">
        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}
