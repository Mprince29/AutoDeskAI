"use client";
import { toastError } from "@/lib/friendly-errors";
import AIAgentPanel from "@/components/shared/AIAgentPanel";
import DateTimePicker from "./_components/DateTimePicker";
import EventReminderModal from "./_components/EventReminderModal";
import { useAuth } from "@/context/AuthContext";
import { CalendarEvent, CalendarReminder, Contact, apiService } from "@/services/api";
import {
  getBrowserTimezone,
} from "@/utils/timezoneUtils";
import {
  Calendar,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  Users,
  Video,
  X,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWorkspaceStore } from "@/store/workspaceStore";
import WorkspaceSkeleton from "@/components/shared/WorkspaceSkeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiGooglecalendar } from "react-icons/si";

export default function CalendarPage() {
  const { user, loading, preferences } = useAuth();
  const router = useRouter();

  const {
    events,
    fetchingCalendar: fetching,
    currentDate,
    setCurrentDate,
    loadEvents,
  } = useWorkspaceStore();

  const [filter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reminderEvent, setReminderEvent] = useState<CalendarEvent | null>(null);
  const [showReminder, setShowReminder] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const eventsRef = useRef<CalendarEvent[]>([]);
  const reminderEventRef = useRef<CalendarEvent | null>(null);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [newEvent, setNewEvent] = useState({
    summary: "",
    description: "",
    startTime: "",
    duration: 60,
    location: ""
  });
  // Attendee chips
  const [attendeeChips, setAttendeeChips] = useState<string[]>([]);
  const [attendeeInput, setAttendeeInput] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactDropdown, setContactDropdown] = useState<Contact[]>([]);
  const attendeeRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view !== 'month' && scrollContainerRef.current) {
      // Scroll to 8 AM (8 * 60px = 480px)
      scrollContainerRef.current.scrollTop = 480;
    }
  }, [view]);

  const hasMounted = useRef(false);

  // Persist calendar date across page reloads
  useEffect(() => {
    const savedDate = sessionStorage.getItem('calendar_current_date');
    if (savedDate) {
      const d = new Date(savedDate);
      if (!isNaN(d.getTime())) {
        setCurrentDate(d);
      }
    }
  }, [setCurrentDate]);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (currentDate) {
      sessionStorage.setItem('calendar_current_date', currentDate.toISOString());
    }
  }, [currentDate]);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || !preferences?.calendar_connected) return;

    const startReminderMonitoring = async () => {
      try {
        await apiService.startCalendarReminders(user.email);
      } catch (error) {
        console.error('Failed to start calendar reminder monitoring:', error);
      }
    };

    startReminderMonitoring();

    return () => {
      if (user) {
        apiService.stopCalendarReminders(user.email).catch(console.error);
      }
    };
  }, [user, preferences?.calendar_connected]);

  // Keep refs in sync with state so the EventSource handler can read
  // the latest values without triggering reconnects on every event load.
  useEffect(() => { eventsRef.current = events; }, [events]);
  useEffect(() => { reminderEventRef.current = reminderEvent; }, [reminderEvent]);

  // EventSource: only reconnect when user email changes, NOT on every event load.
  useEffect(() => {
    if (!user?.email) return;

    const base = process.env.NEXT_PUBLIC_API_URL;
    const es = new EventSource(`${base}/api/calendar/reminder-updates?email=${encodeURIComponent(user.email)}`);

    const onReminder = async () => {
      try {
        const remindersResponse = await apiService.getCalendarReminders(user.email);
        if (remindersResponse.success && remindersResponse.reminders.length > 0) {
          const latestReminder = (remindersResponse.reminders as CalendarReminder[])[0];
          // Read from refs - no stale closures, no reconnect on state change
          const event = eventsRef.current.find(e => e.id === latestReminder.event_id);
          const current = reminderEventRef.current;
          if (event && (!current || current.id !== event.id)) {
            setReminderEvent(event);
            setShowReminder(true);
          }
        }
      } catch (error) {
        console.error('Error fetching calendar reminders:', error);
      }
    };

    es.addEventListener('reminder', onReminder);
    es.onerror = () => { try { es.close(); } catch { } };

    return () => {
      try { es.removeEventListener('reminder', onReminder); } catch { }
      try { es.close(); } catch { }
    };
  }, [user?.email]); // ← only reconnect when user changes

  useEffect(() => {
    if (user?.email && preferences?.calendar_connected) {
      loadEvents(user.email, currentDate);
    }
  }, [user?.email, currentDate, loadEvents, preferences?.calendar_connected]);

  const getCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const days = [];
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month - 1, prevMonthLastDay - i), isCurrentMonth: false });
    }
    for (let i = 1; i <= lastDayOfMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remainingSlots = 42 - days.length;
    for (let i = 1; i <= remainingSlots; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  };

  const getWeekDays = () => {
    const day = currentDate.getDay();
    const diff = currentDate.getDate() - day; // Adjust to Sunday
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(diff);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      days.push({ date: d, isCurrentMonth: d.getMonth() === currentDate.getMonth() });
    }
    return days;
  };

  const getDayDays = () => {
    return [{ date: new Date(currentDate), isCurrentMonth: true }];
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  };

  const getEventsForDay = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate.getDate() === date.getDate() && eventDate.getMonth() === date.getMonth() && eventDate.getFullYear() === date.getFullYear();
    });
  };

  const filteredEventsForGrid = (eventsList: CalendarEvent[]) => {
    return eventsList.filter(event => {
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        return event.summary?.toLowerCase().includes(searchLower) || event.description?.toLowerCase().includes(searchLower);
      }
      if (filter !== "all") return event.status === filter;
      return true;
    });
  };

  const formatEventTime = (dateTime: string) => {
    const date = new Date(dateTime);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const minutesStr = minutes === 0 ? '' : `:${minutes < 10 ? '0' + minutes : minutes}`;
    return `${hours}${minutesStr}${ampm}`;
  };

  const calculateEventLayout = (dayEvents: CalendarEvent[]) => {
    if (dayEvents.length === 0) return [];

    // Sort by start time
    const sorted = [...dayEvents].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    const columns: CalendarEvent[][] = [];
    const eventToLayout = new Map<string, { column: number; totalColumns: number }>();

    sorted.forEach(event => {
      let placed = false;
      const start = new Date(event.start).getTime();

      for (let i = 0; i < columns.length; i++) {
        const lastEventInCol = columns[i][columns[i].length - 1];
        if (new Date(lastEventInCol.end).getTime() <= start) {
          columns[i].push(event);
          eventToLayout.set(event.id, { column: i, totalColumns: 0 });
          placed = true;
          break;
        }
      }

      if (!placed) {
        columns.push([event]);
        eventToLayout.set(event.id, { column: columns.length - 1, totalColumns: 0 });
      }
    });

    // Assign totalColumns based on groups of overlapping columns
    // Simplification: use columns.length as totalColumns for all events in the cluster
    sorted.forEach(event => {
      const layout = eventToLayout.get(event.id)!;
      layout.totalColumns = columns.length;
    });

    return sorted.map(event => ({
      event,
      ...eventToLayout.get(event.id)!
    }));
  };

  const handlePrev = () => {
    if (view === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else if (view === 'week') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    }
  };

  const handleNext = () => {
    if (view === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else if (view === 'week') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    }
  };

  const handleToday = () => setCurrentDate(new Date());

  // Load contacts once when create modal opens
  useEffect(() => {
    if (showCreateModal && user?.email && contacts.length === 0) {
      apiService.getContacts(user.email).then(setContacts).catch(() => {});
    }
  }, [showCreateModal, user?.email]);

  const handleAttendeeInput = (val: string) => {
    setAttendeeInput(val);
    if (val.trim().length < 1) { setContactDropdown([]); return; }
    const q = val.toLowerCase();
    setContactDropdown(
      contacts.filter(c =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
      ).slice(0, 6)
    );
  };

  const addAttendee = (email: string) => {
    const trimmed = email.trim();
    if (trimmed && !attendeeChips.includes(trimmed)) {
      setAttendeeChips(prev => [...prev, trimmed]);
    }
    setAttendeeInput("");
    setContactDropdown([]);
    attendeeRef.current?.focus();
  };

  const removeAttendee = (email: string) => setAttendeeChips(prev => prev.filter(e => e !== email));

  const handleAttendeeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && attendeeInput.trim()) {
      e.preventDefault();
      addAttendee(attendeeInput);
    }
    if (e.key === "Backspace" && !attendeeInput && attendeeChips.length > 0) {
      setAttendeeChips(prev => prev.slice(0, -1));
    }
  };

  const handleCreateEvent = async () => {
    if (!user || !newEvent.summary || !newEvent.startTime) {
      toastError("Please fill in all required fields");
      return;
    }
    setIsCreating(true);
    try {
      const attendees = attendeeChips.length > 0 ? attendeeChips : [];
      const [datePart, timePart] = newEvent.startTime.split('T');
      const [hours, minutes] = timePart.split(':').map(Number);
      const endMinutes = hours * 60 + minutes + newEvent.duration;
      const endH = Math.floor(endMinutes / 60) % 24;
      const endM = endMinutes % 60;
      const endTimeLocal = `${datePart}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
      await apiService.createEvent(user.email, { summary: newEvent.summary, description: newEvent.description, attendees, duration: `${newEvent.duration} minutes`, location: newEvent.location }, newEvent.startTime, endTimeLocal);
      setNewEvent({ summary: "", description: "", startTime: "", duration: 60, location: "" });
      setAttendeeChips([]);
      setAttendeeInput("");
      setShowCreateModal(false);
      await loadEvents(user.email, currentDate, true);
    } catch (err) {
      console.error("Failed to create event:", err);
      toastError("Failed to create event");
    } finally {
      setIsCreating(false);
    }
  };

  const getMeetLink = (event: CalendarEvent) =>
    event.meetLink ||
    event.description?.match(/https:\/\/meet\.google\.com\/[^\s"<)]+/)?.[0] ||
    event.location?.match(/https:\/\/meet\.google\.com\/[^\s"<)]+/)?.[0] ||
    event.description?.match(/(https?:\/\/[^\s"<)]+)/)?.[0] ||
    event.location?.match(/(https?:\/\/[^\s"<)]+)/)?.[0] ||
    event.htmlLink;

  const handleJoinEvent = (event: CalendarEvent) => {
    const link = getMeetLink(event);
    if (link) window.open(link, '_blank');
  };

  const handleCloseReminder = () => {
    setShowReminder(false);
    setReminderEvent(null);
  };



  return (
    <div className="h-screen w-full flex flex-col bg-background text-foreground overflow-hidden">
      <main className="flex-1 min-h-0 w-full max-w-full overflow-hidden">
        {/* MAIN GRID WORKSPACE */}
        <div className="h-full flex flex-col overflow-hidden bg-background relative">
          {/* Calendar Header - more compact on mobile */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-4 shrink-0 border-b border-border/30 bg-background/50 backdrop-blur-xl">
            {/* Row 1: icon + title + nav controls */}
            <div className="flex items-center justify-between sm:justify-start gap-4 flex-1 sm:flex-none">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <SiGooglecalendar className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base sm:text-xl font-black tracking-tight leading-none mb-1">Smart Calendar</h1>
                  <p className="text-[10px] text-muted" style={{ lineHeight: 1.4, maxWidth: 240 }}>
                    View, create & manage events. Auto-fixes conflicts.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground mr-2 flex items-center gap-2">
                  {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  {fetching && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                </span>
                <button
                  onClick={handleToday}
                  className="hidden md:flex px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover border border-border/40 text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Today
                </button>
                <div className="flex items-center bg-surface/50 rounded-lg p-0.5 border border-border/40">
                  <button onClick={handlePrev} className="p-1.5 hover:bg-background/40 rounded-md text-muted hover:text-foreground transition-all">
                    <ChevronRight className="w-4 h-4 rotate-180" />
                  </button>
                  <button onClick={handleNext} className="p-1.5 hover:bg-background/40 rounded-md text-muted hover:text-foreground transition-all">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Row 2: View Switcher & Search Actions */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center bg-surface-elevated/50 rounded-xl p-1 border border-border/20">
                {(['month', 'week', 'day'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${view === v ? 'bg-primary text-white shadow-lg shadow-primary/25' : 'text-muted hover:text-foreground'
                      }`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <div className="relative group flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted group-focus-within:text-primary transition-colors" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full sm:w-44 bg-surface/30 py-2.5 pl-9 pr-3 text-xs font-bold border border-border/20 focus:border-primary/30 focus:bg-background transition-all outline-none rounded-xl"
                />
              </div>

              <button
                onClick={() => setShowCreateModal(true)}
                className="hidden sm:flex btn-primary shrink-0 px-4 py-2.5 shadow-lg shadow-primary/20"
              >
                <Plus className="w-4 h-4" />
                <span>New Event</span>
              </button>
            </div>
          </div>

          {loading || !preferences ? (
            <WorkspaceSkeleton variant="calendar" />
          ) : (
            <>
              {/* Floating Action Button for Mobile */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCreateModal(true)}
            className="sm:hidden fixed bottom-6 right-6 z-[90] w-14 h-14 rounded-2xl bg-primary text-white shadow-2xl shadow-primary/30 flex items-center justify-center border border-white/20"
          >
            <Plus className="w-7 h-7" />
          </motion.button>

          {/* Day Headers - hidden on mobile month view */}
          <div className={`hidden sm:grid ${view === 'day' ? 'grid-cols-[60px_1fr]' : 'grid-cols-[60px_repeat(7,1fr)]'} border-b border-border/50 bg-background/30 shrink-0`}>
            <div className="w-[60px]" />
            {(view === 'month' ? ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] :
              view === 'week' ? getWeekDays() :
                [{ date: currentDate }]
            ).map((day, idx) => {
              const date = typeof day === 'string' ? null : day.date;
              const label = typeof day === 'string' ? day : date!.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
              const today = date && isToday(date);

              return (
                <div key={idx} className="flex flex-col items-center py-2 border-l border-border/10">
                  <span className="text-[10px] font-black text-muted/70 tracking-[0.2em] mb-1">{label}</span>
                  {date && (
                    <span className={`text-xs font-black w-7 h-7 flex items-center justify-center rounded-full transition-all ${today ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-110' : 'text-foreground/60'}`}>
                      {date.getDate()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Calendar Content */}
          {preferences && !preferences.calendar_connected ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500 bg-surface/[0.02]">
              <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6 border border-primary/20">
                <Calendar className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-black text-foreground mb-3">Sync your Calendar</h2>
              <p className="text-muted text-sm max-w-sm mb-8 leading-relaxed">
                Stay on top of your schedule. Connect your Google Calendar to view events, manage meetings, and get AI-powered reminders.
              </p>
              <button
                onClick={() => {
                  if (user?.email) {
                    window.location.href = apiService.getCalendarAuthUrl(user.email);
                  }
                }}
                className="btn-primary px-8 py-3 rounded-2xl shadow-xl shadow-primary/20 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Connect Google Calendar</span>
              </button>
            </div>
          ) : view === 'month' ? (
            <>
              {/* Mobile Agenda View */}
              <div className="flex-1 sm:hidden overflow-y-auto bg-surface/[0.02] p-4 space-y-6">
                {getCalendarDays()
                  .filter(d => d.isCurrentMonth)
                  .map(d => ({ date: d.date, events: filteredEventsForGrid(getEventsForDay(d.date)) }))
                  .filter(item => item.events.length > 0).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted/40 animate-fade-in py-20">
                    <Calendar className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-sm font-bold uppercase tracking-widest">No events scheduled</p>
                  </div>
                ) : (
                  getCalendarDays()
                    .filter(d => d.isCurrentMonth)
                    .map(d => ({ date: d.date, dayEvents: filteredEventsForGrid(getEventsForDay(d.date)) }))
                    .filter(item => item.dayEvents.length > 0)
                    .map(({ date, dayEvents }, idx) => (
                      <div key={idx} className="space-y-3">
                        <div className="flex items-center gap-3 sticky top-0 bg-background/80 backdrop-blur-md z-10 py-1">
                          <div className={`w-10 h-10 rounded-2xl flex flex-col items-center justify-center border transition-all ${isToday(date) ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20' : 'bg-surface border-border/30 text-foreground/70'}`}>
                            <span className="text-[10px] font-black leading-none mb-0.5">{date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
                            <span className="text-sm font-black leading-none">{date.getDate()}</span>
                          </div>
                          <div className="flex-1 h-px bg-border/20" />
                        </div>

                        <div className="space-y-2 pl-2">
                          {dayEvents.map((event, eIdx) => {
                            const isConfirmed = event.status === 'confirmed';
                            return (
                              <div
                                key={eIdx}
                                onClick={() => setSelectedEvent(event)}
                                className="flex items-center gap-3 p-4 rounded-2xl bg-surface/40 border border-border/20 hover:border-primary/30 transition-all active:scale-[0.98]"
                              >
                                <div className={`w-1.5 h-8 rounded-full ${isConfirmed ? 'bg-primary' : event.status === 'tentative' ? 'bg-warning' : 'bg-primary'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-foreground truncate">{event.summary}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Clock className="w-3 h-3 text-muted/60" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted/50">
                                      {formatEventTime(event.start)}
                                    </span>
                                  </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-muted/30" />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                )}
              </div>

              {/* Desktop Month Grid */}
              <div className="hidden sm:grid flex-1 min-h-0 grid-cols-7 grid-rows-6" style={{ gridAutoRows: '1fr' }}>
                {getCalendarDays().map(({ date, isCurrentMonth }, idx) => {
                  const dayEvents = filteredEventsForGrid(getEventsForDay(date));
                  const today = isToday(date);

                  return (
                    <div
                      key={idx}
                      className={`relative flex flex-col border-r border-b border-border/40 p-1.5 transition-colors hover:bg-surface/40 group/cell min-h-0 overflow-hidden ${!isCurrentMonth ? 'opacity-25' : ''}`}
                    >
                      <div className="flex items-center justify-center mb-1 shrink-0">
                        <span className={`text-sm font-bold leading-none ${today ? 'w-6 h-6 flex items-center justify-center bg-primary text-white rounded-full text-xs' : 'text-muted/60 group-hover/cell:text-foreground transition-colors'}`}>
                          {date.getDate()}
                        </span>
                      </div>

                      <div className="flex-1 flex flex-col min-h-0 overflow-hidden gap-1">
                        <div className="overflow-hidden space-y-2 min-h-0">
                          {dayEvents.slice(0, 2).map((event, eIdx) => {
                            const isConfirmed = event.status === 'confirmed';
                            return (
                              <div
                                key={eIdx}
                                onClick={() => setSelectedEvent(event)}
                                className={`cursor-pointer rounded px-1.5 py-0.5 transition-all ${isConfirmed
                                  ? 'bg-primary text-white hover:bg-primary/90'
                                  : 'bg-surface/80 border border-border/30 hover:bg-surface'
                                  }`}
                              >
                                <p className={`text-xs truncate leading-tight font-medium ${isConfirmed ? 'text-white' : 'text-foreground/80'}`}>
                                  {!isConfirmed && <span className="opacity-50 mr-0.5">{formatEventTime(event.start)}</span>}
                                  {event.summary}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                        {dayEvents.length > 2 && (
                          <button
                            onClick={() => setSelectedDay(date)}
                            className="shrink-0 w-full  text-left text-xs font-semibold text-primary/60 hover:text-primary pl-1 transition-colors leading-none"
                          >
                            +{dayEvents.length - 2} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar relative bg-surface/[0.02]">
              <div className={`grid ${view === 'day' ? 'grid-cols-[60px_1fr]' : 'grid-cols-[60px_repeat(7,1fr)]'} relative`} style={{ height: '1440px' }}>
                {/* Time Column Labels */}
                <div className="col-start-1 col-end-2 flex flex-col pointer-events-none">
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="h-[60px] border-b border-border/[0.02] flex items-start justify-center pr-2">
                      <span className="text-[9px] font-black text-muted/40 uppercase tracking-tighter mt-[-6px] bg-background px-1">
                        {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Day Columns */}
                {(view === 'week' ? getWeekDays() : getDayDays()).map((day, dIdx) => {
                  const dayLayouts = calculateEventLayout(getEventsForDay(day.date));
                  return (
                    <div key={dIdx} className="relative border-l border-border/20 h-full group/col hover:bg-surface/[0.01] transition-colors">
                      {/* Hour line background */}
                      {Array.from({ length: 24 }).map((_, h) => (
                        <div key={h} className="h-[60px] border-b border-border/10 w-full" />
                      ))}

                      {/* Events */}
                      {dayLayouts.map(({ event, column, totalColumns }, eIdx) => {
                        const startDate = new Date(event.start);
                        const endDate = new Date(event.end);
                        const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
                        const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
                        const duration = Math.max(endMinutes - startMinutes, 30);

                        const top = (startMinutes / 60) * 60;
                        const height = (duration / 60) * 60;
                        const isConfirmed = event.status === 'confirmed';
                        const statusColor = event.status === 'confirmed' ? 'var(--primary)' : event.status === 'tentative' ? 'var(--warning)' : 'var(--primary)';

                        const left = (column / totalColumns) * 100;
                        const width = (1 / totalColumns) * 100;

                        return (
                          <div
                            key={eIdx}
                            onClick={() => setSelectedEvent(event)}
                            className={`absolute rounded-xl p-2 border shadow-lg cursor-pointer transition-all hover:scale-[1.01] hover:z-50 overflow-hidden group/event ${isConfirmed
                                ? 'bg-primary/90 text-white border-white/20'
                                : 'bg-surface/90 backdrop-blur-md text-foreground border-border/40 hover:border-primary/40'
                              }`}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `${left + 1}%`,
                              width: `${width - 2}%`,
                              minHeight: '28px'
                            }}
                          >
                            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full opacity-80" style={{ background: statusColor }} />
                            <p className={`text-[10px] font-black leading-none truncate mb-1 ${isConfirmed ? 'text-white' : 'text-foreground'}`}>
                              {event.summary}
                            </p>
                            {height > 35 && (
                              <div className="flex items-center gap-1.5 opacity-70">
                                <Clock className="w-2.5 h-2.5" />
                                <span className="text-[9px] font-bold">
                                  {formatEventTime(event.start)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </>
        )}
      </div>


        {/* ── Day Events Modal ───────────────────────────────────────── */}
        <AnimatePresence>
          {selectedDay && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedDay(null)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }} className="relative w-full max-w-md bg-background border border-border/30 rounded-2xl p-6 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-base font-black text-foreground">{selectedDay.toLocaleDateString('en-US', { weekday: 'long' })}</h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary mt-0.5">{selectedDay.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>
                  </div>
                  <button onClick={() => setSelectedDay(null)} className="p-1.5 hover:bg-surface rounded-lg transition-all"><X className="w-4 h-4 text-muted" /></button>
                </div>
                <div className="space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                  {filteredEventsForGrid(getEventsForDay(selectedDay)).map((event, idx) => (
                    <button key={idx} onClick={() => { setSelectedDay(null); setSelectedEvent(event); }} className="w-full flex items-center justify-between p-3.5 bg-surface/50 border border-border/20 rounded-xl hover:border-primary/30 hover:bg-surface transition-all group text-left">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${event.status === 'confirmed' ? 'bg-primary' : event.status === 'tentative' ? 'bg-yellow-500' : 'bg-muted'}`} />
                        <div>
                          <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{event.summary}</p>
                          <p className="text-[10px] text-muted mt-0.5">{formatEventTime(event.start)} – {formatEventTime(event.end)}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-muted/40 group-hover:translate-x-0.5 transition-transform shrink-0" />
                    </button>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── Event Detail Modal ─────────────────────────────────────── */}
        <AnimatePresence>
          {selectedEvent && (
            <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedEvent(null)} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }} className="relative w-full max-w-md bg-background border border-border/30 rounded-2xl shadow-2xl overflow-hidden">
                {/* Color bar */}
                <div className={`h-1.5 w-full ${selectedEvent.status === 'confirmed' ? 'bg-primary' : selectedEvent.status === 'tentative' ? 'bg-yellow-500' : 'bg-muted'}`} />

                <div className="p-6">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-black text-foreground leading-snug">{selectedEvent.summary}</h2>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${selectedEvent.status === 'confirmed' ? 'bg-primary/10 text-primary' : selectedEvent.status === 'tentative' ? 'bg-yellow-500/10 text-yellow-600' : 'bg-muted/20 text-muted'}`}>
                          {selectedEvent.status}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => setSelectedEvent(null)} className="p-1.5 hover:bg-surface rounded-lg transition-all shrink-0 mt-0.5">
                      <X className="w-4 h-4 text-muted" />
                    </button>
                  </div>

                  {/* Details rows */}
                  <div className="space-y-3">
                    {/* Date & time */}
                    <div className="flex items-start gap-3 p-3 bg-surface/50 rounded-xl">
                      <Clock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {new Date(selectedEvent.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </p>
                        <p className="text-[11px] text-muted mt-0.5">
                          {formatEventTime(selectedEvent.start)} – {formatEventTime(selectedEvent.end)}
                        </p>
                      </div>
                    </div>

                    {/* Location / Meet link */}
                    {(selectedEvent.location || selectedEvent.meetLink) && (
                      <div className="flex items-start gap-3 p-3 bg-surface/50 rounded-xl">
                        <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <p className="text-xs text-foreground break-all">{selectedEvent.location || selectedEvent.meetLink}</p>
                      </div>
                    )}

                    {/* Attendees */}
                    {selectedEvent.attendees?.length > 0 && (
                      <div className="flex items-start gap-3 p-3 bg-surface/50 rounded-xl">
                        <Users className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div className="flex flex-wrap gap-1.5">
                          {selectedEvent.attendees.map((a, i) => (
                            <span key={i} className="text-[10px] bg-primary/8 border border-primary/15 text-foreground/80 px-2 py-0.5 rounded-full">{a}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    {selectedEvent.description && (
                      <div className="p-3 bg-surface/50 rounded-xl">
                        <p className="text-[11px] text-muted leading-relaxed whitespace-pre-line line-clamp-4">{selectedEvent.description.replace(/<[^>]*>/g, '').trim()}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 flex gap-2.5">
                    {getMeetLink(selectedEvent) && getMeetLink(selectedEvent) !== selectedEvent.htmlLink && (
                      <button
                        onClick={() => handleJoinEvent(selectedEvent)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                      >
                        <Video className="w-4 h-4" />
                        Join Now
                      </button>
                    )}
                    {selectedEvent.htmlLink && (
                      <a
                        href={selectedEvent.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-border/40 bg-surface/50 rounded-xl text-xs font-medium text-muted hover:text-foreground hover:border-border transition-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open in Calendar
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── Create Event Modal ─────────────────────────────────────── */}
        <AnimatePresence>
          {showCreateModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCreateModal(false)} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }} className="relative w-full max-w-lg h-[100dvh] md:h-auto md:max-h-[90vh] bg-background border-0 md:border border-border/30 rounded-none md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border/20 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-black text-foreground">New Event</h2>
                      <p className="text-[10px] text-muted">Add to Google Calendar</p>
                    </div>
                  </div>
                  <button onClick={() => setShowCreateModal(false)} className="p-1.5 hover:bg-surface rounded-lg transition-all">
                    <X className="w-4 h-4 text-muted" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">
                  {/* Title */}
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 block">Event title *</label>
                    <input
                      autoFocus
                      type="text"
                      value={newEvent.summary}
                      onChange={(e) => setNewEvent({ ...newEvent, summary: e.target.value })}
                      className="w-full bg-surface/50 border border-border/40 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted/40"
                      placeholder="What's the event?"
                    />
                  </div>

                  {/* Date/Time + Duration */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <DateTimePicker value={newEvent.startTime} onChange={(v) => setNewEvent({ ...newEvent, startTime: v })} label="Start time *" timezone={preferences?.timezone || getBrowserTimezone()} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 block">Duration</label>
                      <Select value={String(newEvent.duration)} onValueChange={(v) => setNewEvent({ ...newEvent, duration: parseInt(v) })}>
                        <SelectTrigger className="w-full h-[46px] bg-surface/50 border-border/40 rounded-xl px-4 text-sm shadow-none focus:ring-2 focus:ring-primary/20">
                          <SelectValue placeholder="Duration" />
                        </SelectTrigger>
                        <SelectContent className="bg-background/95 backdrop-blur-xl border-border/30 rounded-xl shadow-2xl">
                          {[15, 30, 45, 60, 90, 120, 180, 240].map(m => (
                            <SelectItem key={m} value={String(m)} className="rounded-lg text-sm">
                              {m < 60 ? `${m} min` : `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Participants with contact search */}
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 block">
                      <Users className="w-3 h-3 inline mr-1" />Participants
                    </label>
                    <div className="relative">
                      <div
                        className="min-h-[46px] w-full bg-surface/50 border border-border/40 rounded-xl px-3 py-2 flex flex-wrap gap-1.5 items-center focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all cursor-text"
                        onClick={() => attendeeRef.current?.focus()}
                      >
                        {attendeeChips.map(email => (
                          <span key={email} className="flex items-center gap-1 bg-primary/10 border border-primary/20 text-primary text-[11px] font-medium px-2 py-0.5 rounded-full">
                            {contacts.find(c => c.email === email)?.name || email}
                            <button type="button" onClick={(ev) => { ev.stopPropagation(); removeAttendee(email); }} className="hover:text-red-500 transition-colors ml-0.5">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                        <input
                          ref={attendeeRef}
                          type="email"
                          value={attendeeInput}
                          onChange={(e) => handleAttendeeInput(e.target.value)}
                          onKeyDown={handleAttendeeKeyDown}
                          onBlur={() => setTimeout(() => setContactDropdown([]), 150)}
                          className="flex-1 min-w-[140px] bg-transparent outline-none text-sm placeholder:text-muted/40 py-0.5"
                          placeholder={attendeeChips.length === 0 ? "Search contacts or type email…" : "Add more…"}
                        />
                      </div>

                      {/* Contact dropdown */}
                      {contactDropdown.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1.5 bg-background border border-border/30 rounded-xl shadow-xl overflow-hidden z-10">
                          {contactDropdown.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={() => addAttendee(c.email)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface transition-colors text-left"
                            >
                              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-bold text-primary">{c.name.charAt(0).toUpperCase()}</span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{c.name}</p>
                                <p className="text-[10px] text-muted truncate">{c.email}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-muted/60 mt-1 ml-1">Press Enter or comma to add · Backspace to remove</p>
                  </div>

                  {/* Location */}
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 block">
                      <MapPin className="w-3 h-3 inline mr-1" />Location
                    </label>
                    <input
                      type="text"
                      value={newEvent.location}
                      onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                      className="w-full bg-surface/50 border border-border/40 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted/40"
                      placeholder="Add location or Meet link…"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5 block">Description</label>
                    <textarea
                      value={newEvent.description}
                      onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                      className="w-full bg-surface/50 border border-border/40 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all min-h-[80px] resize-none placeholder:text-muted/40"
                      placeholder="Add description…"
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border/20 flex items-center gap-3 shrink-0">
                  <button onClick={() => setShowCreateModal(false)} className="px-5 py-2.5 bg-surface border border-border/40 rounded-xl text-sm font-medium text-foreground hover:bg-surface-hover transition-all">
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateEvent}
                    disabled={!newEvent.summary || !newEvent.startTime || isCreating}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:hover:bg-primary shadow-lg shadow-primary/20"
                  >
                    {isCreating ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : <><CheckCircle className="w-4 h-4" />Create Event</>}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {isAgentOpen && (
          <div className="fixed inset-0 z-[110] flex items-end justify-end pointer-events-none">
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="m-8 pointer-events-auto">
              <AIAgentPanel userEmail={user?.email || ''} isExpanded={true} onToggleExpanded={() => setIsAgentOpen(false)} onProcessEmails={() => loadEvents(user?.email || "", currentDate, true)} />
            </motion.div>
          </div>
        )}

        {reminderEvent && (
          <EventReminderModal event={reminderEvent} isOpen={showReminder} onClose={handleCloseReminder} onJoin={handleJoinEvent} />
        )}
      </main>
    </div>
  );
}
