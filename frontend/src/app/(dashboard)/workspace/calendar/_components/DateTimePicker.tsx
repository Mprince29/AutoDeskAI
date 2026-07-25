import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  timezone?: string;
  isEndTime?: boolean;
  startDate?: string;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const DateTimePicker: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  label,
  required = false,
  timezone,
  isEndTime = false,
  startDate = ''
}) => {
  const [showCal, setShowCal] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date());
  const [localDate, setLocalDate] = useState('');   // YYYY-MM-DD
  const [hour, setHour] = useState('12');            // 1-12
  const [minute, setMinute] = useState('00');        // 00-59
  const [isAM, setIsAM] = useState(true);
  const calRef = useRef<HTMLDivElement>(null);

  // Parse incoming ISO value → local fields
  useEffect(() => {
    if (!value) return;
    const date = new Date(value);
    const effectiveTZ = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: effectiveTZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).formatToParts(date);

    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const yyyy = get('year');
    const mm   = get('month');
    const dd   = get('day');
    const h    = parseInt(get('hour'));
    const min  = get('minute');
    const ampm = get('dayPeriod')?.toUpperCase();

    setLocalDate(`${yyyy}-${mm}-${dd}`);
    setHour(String(h || 12));
    setMinute(min);
    setIsAM(ampm === 'AM');
    setCalMonth(new Date(parseInt(yyyy), parseInt(mm) - 1, 1));
  }, [value, timezone]);

  // When isEndTime and no date yet, use startDate
  useEffect(() => {
    if (isEndTime && startDate && !localDate) {
      setLocalDate(startDate);
    }
  }, [isEndTime, startDate, localDate]);

  // Emit updated ISO string
  const emit = (date: string, h: string, min: string, am: boolean) => {
    if (!date) return;
    let hour24 = parseInt(h) % 12;
    if (!am) hour24 += 12;
    const iso = `${date}T${String(hour24).padStart(2,'0')}:${min.padStart(2,'0')}:00`;
    onChange(iso);
  };

  const pickDate = (yyyy: number, mm: number, dd: number) => {
    const d = `${yyyy}-${String(mm+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    setLocalDate(d);
    setShowCal(false);
    emit(d, hour, minute, isAM);
  };

  const handleHour = (v: string) => {
    let n = parseInt(v.replace(/\D/g,'')) || 1;
    n = Math.max(1, Math.min(12, n));
    const s = String(n);
    setHour(s);
    emit(localDate, s, minute, isAM);
  };

  const handleMinute = (v: string) => {
    let n = parseInt(v.replace(/\D/g,''));
    if (isNaN(n)) n = 0;
    n = Math.max(0, Math.min(59, n));
    const s = String(n).padStart(2,'0');
    setMinute(s);
    emit(localDate, hour, s, isAM);
  };

  const toggleAMPM = (am: boolean) => {
    setIsAM(am);
    emit(localDate, hour, minute, am);
  };

  // Close calendar on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setShowCal(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Calendar grid
  const calDays = () => {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const first = new Date(y, m, 1).getDay();
    const last  = new Date(y, m+1, 0).getDate();
    const prev  = new Date(y, m, 0).getDate();
    const cells: { d: number; m: number; y: number; cur: boolean }[] = [];
    for (let i = first-1; i >= 0; i--)
      cells.push({ d: prev-i, m: m-1 < 0 ? 11 : m-1, y: m-1 < 0 ? y-1 : y, cur: false });
    for (let d = 1; d <= last; d++)
      cells.push({ d, m, y, cur: true });
    while (cells.length < 42)
      cells.push({ d: cells.length-first-last+1, m: m+1 > 11 ? 0 : m+1, y: m+1 > 11 ? y+1 : y, cur: false });
    return cells;
  };

  const selectedParts = localDate ? localDate.split('-').map(Number) : null;
  const today = new Date();
  const displayDate = localDate
    ? new Date(`${localDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-muted uppercase tracking-wider block">
        {label}{required && ' *'}
      </label>

      {/* Date button — skip for isEndTime (same day) */}
      {!isEndTime && (
        <div className="relative" ref={calRef}>
          <button
            type="button"
            onClick={() => setShowCal(v => !v)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-surface/50 border border-border/40 rounded-xl text-sm text-left hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          >
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <span className={displayDate ? 'text-foreground' : 'text-muted/40'}>
              {displayDate || 'Pick a date'}
            </span>
          </button>

          {showCal && (
            <div className="absolute top-full left-0 mt-2 z-50 bg-background border border-border/30 rounded-2xl shadow-2xl p-4 w-[300px]">
              {/* Month nav */}
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => setCalMonth(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}
                  className="p-1 hover:bg-surface rounded-lg transition-all"
                >
                  <ChevronLeft className="w-4 h-4 text-muted" />
                </button>
                <span className="text-sm font-bold text-foreground">
                  {MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}
                </span>
                <button
                  type="button"
                  onClick={() => setCalMonth(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}
                  className="p-1 hover:bg-surface rounded-lg transition-all"
                >
                  <ChevronRight className="w-4 h-4 text-muted" />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-[10px] font-bold text-muted/60 py-1">{d}</div>
                ))}
              </div>

              {/* Days */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {calDays().map((cell, i) => {
                  const isSelected = selectedParts &&
                    cell.y === selectedParts[0] &&
                    cell.m === selectedParts[1]-1 &&
                    cell.d === selectedParts[2];
                  const isToday = cell.cur &&
                    cell.d === today.getDate() &&
                    cell.m === today.getMonth() &&
                    cell.y === today.getFullYear();
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pickDate(cell.y, cell.m, cell.d)}
                      className={`h-8 w-full rounded-lg text-xs font-medium transition-all
                        ${isSelected ? 'bg-primary text-white font-bold' :
                          isToday ? 'border border-primary/40 text-primary font-bold' :
                          cell.cur ? 'text-foreground hover:bg-surface' :
                          'text-muted/30 hover:bg-surface/50'}`}
                    >
                      {cell.d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* End-time: show date as read-only badge */}
      {isEndTime && localDate && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-surface/30 border border-border/30 rounded-xl">
          <Calendar className="w-4 h-4 text-muted shrink-0" />
          <span className="text-sm text-muted/70">{displayDate}</span>
        </div>
      )}

      {/* Time row */}
      <div className="flex items-center gap-2">
        {/* Hour */}
        <div className="flex items-center bg-surface/50 border border-border/40 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all flex-1">
          <input
            type="text"
            inputMode="numeric"
            value={hour}
            onChange={e => handleHour(e.target.value)}
            onFocus={e => e.target.select()}
            className="w-full bg-transparent text-center text-sm font-semibold py-2.5 outline-none text-foreground"
            maxLength={2}
          />
          <span className="text-muted/40 font-bold px-0.5">:</span>
          <input
            type="text"
            inputMode="numeric"
            value={minute}
            onChange={e => handleMinute(e.target.value)}
            onFocus={e => e.target.select()}
            className="w-full bg-transparent text-center text-sm font-semibold py-2.5 outline-none text-foreground"
            maxLength={2}
          />
        </div>

        {/* AM/PM */}
        <div className="flex bg-surface/50 border border-border/40 rounded-xl overflow-hidden shrink-0">
          {(['AM','PM'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => toggleAMPM(p === 'AM')}
              className={`px-4 py-2.5 text-xs font-bold transition-all
                ${(p === 'AM') === isAM
                  ? 'bg-primary text-white'
                  : 'text-muted hover:bg-surface-hover'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      {localDate && (
        <p className="text-[10px] text-muted/60 mt-0.5">
          {displayDate} at {hour}:{minute} {isAM ? 'AM' : 'PM'}
          {timezone && ` · ${timezone}`}
        </p>
      )}
    </div>
  );
};

export default DateTimePicker;
