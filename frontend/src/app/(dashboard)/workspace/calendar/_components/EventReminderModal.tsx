import { CalendarEvent } from '@/services/api';
import { Clock, ExternalLink, MapPin, Users, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface EventReminderModalProps {
  event: CalendarEvent;
  isOpen: boolean;
  onClose: () => void;
  onJoin: (event: CalendarEvent) => void;
}

const EventReminderModal: React.FC<EventReminderModalProps> = ({
  event,
  isOpen,
  onClose,
  onJoin
}) => {
  const [timeLeft, setTimeLeft] = useState<number>(600); // 10 minutes in seconds
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Calculate time until event starts
    const eventStart = new Date(event.start).getTime();
    const now = new Date().getTime();
    const timeUntilEvent = Math.max(0, Math.floor((eventStart - now) / 1000));

    setTimeLeft(timeUntilEvent);
    setIsExpired(timeUntilEvent <= 0);

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        const newTime = prev - 1;
        if (newTime <= 0) {
          setIsExpired(true);
          return 0;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [event, isOpen]);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatEventTime = (dateTime: string) => {
    return new Date(dateTime).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[99999] animate-fade-in">
      <div className="bg-surface border border-border rounded-md p-6 w-full max-w-md shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-error/10 rounded-md border border-error/20">
              <Clock className="w-5 h-5 text-error" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Event Reminder</h2>
              <p className="text-muted text-sm">Your event starts soon!</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-background rounded transition-all duration-200"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* Countdown Timer */}
        <div className="mb-6 p-4 bg-error/5 border border-error/20 rounded-md">
          <div className="text-center">
            <div className="text-3xl font-bold text-error mb-1">
              {isExpired ? '00:00' : formatTime(timeLeft)}
            </div>
            <div className="text-sm text-error/80">
              {isExpired ? 'Event has started!' : 'minutes remaining'}
            </div>
          </div>
        </div>

        {/* Event Details */}
        <div className="space-y-4 mb-6">
          <div>
            <h3 className="text-xl font-semibold text-foreground mb-2 line-clamp-2">
              {event.summary}
            </h3>
            {event.description && (
              <p className="text-muted text-sm line-clamp-3">
                {event.description}
              </p>
            )}
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3 text-muted">
              <Clock className="w-4 h-4 text-primary" />
              <span>{formatEventTime(event.start)}</span>
            </div>

            {event.location && (
              <div className="flex items-center gap-3 text-muted">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="line-clamp-1">{event.location}</span>
              </div>
            )}

            {event.attendees && event.attendees.length > 0 && (
              <div className="flex items-center gap-3 text-muted">
                <Users className="w-4 h-4 text-primary" />
                <span>{event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={() => onJoin(event)}
            disabled={isExpired}
            className="btn-primary w-full py-3 text-base"
          >
            <ExternalLink className="w-4 h-4" />
            {isExpired ? 'Event Started' : 'Join Meeting'}
          </button>

          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-2 text-center text-primary hover:text-primary-hover text-sm transition-colors"
            >
              View in Calendar →
            </a>
          )}
        </div>

        {/* Auto-close notice */}
        <div className="mt-4 text-center">
          <p className="text-xs text-muted">
            This reminder will auto-close when the event starts
          </p>
        </div>
      </div>
    </div>
  );
};

export default EventReminderModal;
