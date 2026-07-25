"use client";

import React, { useEffect, useState } from "react";
import { 
  Clock, 
  Bell, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Loader2,
  Sparkles,
  Calendar,
  ChevronDown
} from "lucide-react";
import { proactiveService } from "@/services/proactive.service";
import { 
  CARD, 
  sectionLabel, 
  btnPrimary, 
  btnSecondary,
  inputStyle 
} from "./SettingsShared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function CustomTimePicker({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const [open, setOpen] = useState(false);

  const parseTime = (timeStr: string) => {
    if (!timeStr) timeStr = "12:00";
    const [h, m] = timeStr.split(":");
    let hour = parseInt(h, 10);
    const minute = m || "00";
    const period = hour >= 12 ? "PM" : "AM";
    if (hour === 0) hour = 12;
    if (hour > 12) hour -= 12;
    return {
      hour: hour.toString().padStart(2, '0'),
      minute: minute,
      period
    };
  };

  const { hour, minute, period } = parseTime(value);

  const updateTime = (newHour: string, newMin: string, newPeriod: string) => {
    let h24 = parseInt(newHour, 10);
    if (newPeriod === "PM" && h24 !== 12) h24 += 12;
    if (newPeriod === "AM" && h24 === 12) h24 = 0;
    onChange(`${h24.toString().padStart(2, '0')}:${newMin}`);
  };

  const hours = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
  const periods = ["AM", "PM"];

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        const activeEls = document.querySelectorAll('.time-picker-active');
        activeEls.forEach(el => {
          el.scrollIntoView({ block: 'center' });
        });
      }, 10);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button 
          className="w-full pl-9 pr-3 py-2 bg-background border border-border/40 rounded-xl text-xs font-medium focus:border-primary/50 focus:ring-1 focus:ring-primary/50 outline-none transition-all flex items-center justify-between text-left h-[38px] group hover:border-primary/40 hover:bg-muted/20"
        >
          <span className="text-foreground tracking-wide">{hour}:{minute} {period}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform duration-300 group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[240px] p-0 rounded-2xl border-border/50 shadow-2xl overflow-hidden bg-background/95 backdrop-blur-xl animate-in zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out z-[100]" 
        align="start"
      >
        <div className="flex flex-col">
          <div className="bg-primary/5 p-2.5 border-b border-border/50 flex items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Select Time</span>
          </div>
          <div className="flex h-[200px] divide-x divide-border/50 p-1">
            <ScrollArea className="w-1/3 h-full">
              <div className="flex flex-col p-1 gap-1">
                {hours.map(h => (
                  <button
                    key={h}
                    onClick={() => updateTime(h, minute, period)}
                    className={cn(
                      "px-2 py-2 text-sm text-center rounded-xl transition-all font-semibold",
                      h === hour 
                        ? "bg-primary text-white shadow-md scale-105 time-picker-active" 
                        : "text-foreground/70 hover:bg-primary/10 hover:text-primary hover:scale-105"
                    )}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <ScrollArea className="w-1/3 h-full">
              <div className="flex flex-col p-1 gap-1">
                {minutes.map(m => (
                  <button
                    key={m}
                    onClick={() => updateTime(hour, m, period)}
                    className={cn(
                      "px-2 py-2 text-sm text-center rounded-xl transition-all font-semibold",
                      m === minute 
                        ? "bg-primary text-white shadow-md scale-105 time-picker-active" 
                        : "text-foreground/70 hover:bg-primary/10 hover:text-primary hover:scale-105"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <ScrollArea className="w-1/3 h-full">
              <div className="flex flex-col p-1 gap-1">
                {periods.map(p => (
                  <button
                    key={p}
                    onClick={() => updateTime(hour, minute, p)}
                    className={cn(
                      "px-2 py-2 text-sm text-center rounded-xl transition-all font-semibold",
                      p === period 
                        ? "bg-primary text-white shadow-md scale-105 time-picker-active" 
                        : "text-foreground/70 hover:bg-primary/10 hover:text-primary hover:scale-105"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ProactiveSettingsProps {
  userEmail: string;
  showNotification: (msg: string, type?: "success" | "error" | "info") => void;
}

export function ProactiveSettings({ userEmail, showNotification }: ProactiveSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [times, setTimes] = useState<string[]>(["06:00"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userEmail) return;
    fetchSettings();
  }, [userEmail]);

  const fetchSettings = async () => {
    try {
      const res = await proactiveService.getBriefingSettings(userEmail);
      setEnabled(res.enabled);
      if (res.time) {
        setTimes(res.time.split(",").map(t => t.trim()));
      }
    } catch (err) {
      console.error("Failed to fetch briefing settings", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const timeStr = times.join(",");
      await proactiveService.updateBriefingSettings(userEmail, enabled, timeStr);
      showNotification("Briefing settings updated", "success");
    } catch (err: any) {
      showNotification(err.message || "Failed to update settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const addTime = () => {
    if (times.length >= 3) {
      showNotification("Maximum 3 briefings per day", "info");
      return;
    }
    setTimes([...times, "12:00"]);
  };

  const removeTime = (index: number) => {
    if (times.length <= 1) {
      showNotification("At least one time is required if enabled", "info");
      return;
    }
    setTimes(times.filter((_, i) => i !== index));
  };

  const updateTime = (index: number, val: string) => {
    const next = [...times];
    next[index] = val;
    setTimes(next);
  };

  return (
    <div id="daily-briefing-section" style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
      <div className="p-4 border-b border-border/40 flex items-center justify-between bg-primary/5">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted">Daily Briefing</p>
        </div>
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted" />
        ) : (
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={enabled} 
              onChange={e => setEnabled(e.target.checked)} 
              className="sr-only peer" 
            />
            <div className="w-10 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-muted-dark after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary peer-checked:after:bg-white border border-border" />
          </label>
        )}
      </div>

      <div className="p-5 space-y-4 bg-surface/30 min-h-[220px] flex flex-col justify-between">
        <div>
          <p className="text-[11px] text-muted leading-relaxed mb-4">
            Get a simple daily summary of your important emails, upcoming meetings, and tasks. 
            Your briefing will automatically appear in your chat dashboard.
          </p>

          {loading ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Delivery Schedule (Local Time)</span>
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="w-full h-[38px] rounded-xl" />
              </div>
            </div>
          ) : enabled ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Delivery Schedule (Local Time)</span>
                {times.length < 3 && (
                  <button 
                    onClick={addTime}
                    className="text-[10px] font-bold text-primary hover:opacity-80 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Time
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {times.map((time, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none z-10" />
                      <CustomTimePicker value={time} onChange={val => updateTime(idx, val)} />
                    </div>
                    {times.length > 1 && (
                      <button 
                        onClick={() => removeTime(idx)}
                        className="p-2 text-muted hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-primary/5 border border-primary/10 text-center border-dashed">
              <Sparkles className="w-5 h-5 text-primary mx-auto mb-2 opacity-50" />
              <p className="text-[11px] font-bold text-primary">Enable your Daily Briefing to stay on top of your day.</p>
            </div>
          )}
        </div>

        {enabled && (
          <div className="pt-2">
             <button 
              onClick={handleSave}
              disabled={saving}
              className="w-full h-11 bg-primary text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98]"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Save Briefing Schedule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
