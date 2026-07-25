"use client";

import React, { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';

interface LeadTimezoneCellProps {
    timezone?: string | null;
}

export function LeadTimezoneCell({ timezone }: LeadTimezoneCellProps) {
    const [localTime, setLocalTime] = useState<string>('');

    useEffect(() => {
        if (!timezone) return;
        const update = () => {
            try {
                setLocalTime(new Date().toLocaleTimeString('en-US', {
                    timeZone: timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                }));
            } catch {
                setLocalTime('');
            }
        };
        update();
        const id = setInterval(update, 30000);
        return () => clearInterval(id);
    }, [timezone]);

    if (!timezone) {
        return <span className="text-muted-foreground/30 text-[11px]">-</span>;
    }

    const label = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
    return (
        <div className="inline-flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1 bg-primary/10 border border-primary/20 rounded-lg px-2 py-1">
                <Globe size={9} className="text-primary" />
                <span className="text-[10px] font-normal text-primary uppercase tracking-widest truncate max-w-[90px]">{label}</span>
            </div>
            {localTime && (
                <span className="text-[9px] text-muted-foreground/50 font-mono">{localTime}</span>
            )}
        </div>
    );
}
