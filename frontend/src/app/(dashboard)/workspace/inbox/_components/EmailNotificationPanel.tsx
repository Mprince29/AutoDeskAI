"use client";
import { apiService, EmailNotification } from '@/services/api';
import {
  AlertCircle,
  Bell,
  CheckCircle,
  Clock,
  Mail,
  RefreshCw,
  Settings,
  Timer,
  X
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

interface EmailNotificationPanelProps {
  userEmail: string;
  isVisible: boolean;
  onToggleVisibility: () => void;
  onNotificationClick: (emailId: string) => void;
  onRefreshEmails?: () => void;
}

const EmailNotificationPanel: React.FC<EmailNotificationPanelProps> = ({
  userEmail,
  isVisible,
  onToggleVisibility,
  onNotificationClick,
  onRefreshEmails
}) => {
  const [notifications, setNotifications] = useState<EmailNotification[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoReplyDelay, setAutoReplyDelay] = useState(120);
  const countdownRefs = useRef<{ [key: string]: NodeJS.Timeout }>({});

  const loadNotifications = useCallback(async () => {
    try {
      const response = await apiService.getEmailNotifications(userEmail);
      setNotifications(response.notifications);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  }, [userEmail]);

  const loadServiceStatus = useCallback(async () => {
    try {
      const status = await apiService.getAutomatedServiceStatus(userEmail);
      setIsMonitoring(status.is_monitoring);
      setAutoReplyDelay(status.auto_reply_delay);
    } catch (error) {
      console.error('Error loading service status:', error);
    }
  }, [userEmail]);

  useEffect(() => {
    if (isVisible) {
      loadNotifications();
      loadServiceStatus();
    }
  }, [isVisible, userEmail, loadNotifications, loadServiceStatus]);

  useEffect(() => {
    notifications.forEach(notification => {
      if (notification.auto_reply_scheduled && notification.time_until_auto_reply > 0) {
        startCountdown(notification.email_id, notification.time_until_auto_reply);
      }
    });

    const currentRefs = countdownRefs.current;
    return () => {
      Object.values(currentRefs).forEach(timeout => {
        clearInterval(timeout);
      });
    };
  }, [notifications]);

  const startCountdown = (emailId: string, initialTime: number) => {
    if (countdownRefs.current[emailId]) {
      clearInterval(countdownRefs.current[emailId]);
    }

    let timeLeft = Math.max(0, initialTime);

    countdownRefs.current[emailId] = setInterval(() => {
      timeLeft -= 1;

      setNotifications(prev =>
        prev.map(notification =>
          notification.email_id === emailId
            ? { ...notification, time_until_auto_reply: timeLeft }
            : notification
        )
      );

      if (timeLeft <= 0) {
        clearInterval(countdownRefs.current[emailId]);
        delete countdownRefs.current[emailId];
      }
    }, 1000);
  };

  const dismissNotification = async (emailId: string) => {
    try {
      await apiService.dismissEmailNotification(userEmail, emailId);
      setNotifications(prev => prev.filter(n => n.email_id !== emailId));

      if (countdownRefs.current[emailId]) {
        clearInterval(countdownRefs.current[emailId]);
        delete countdownRefs.current[emailId];
      }
    } catch (error) {
      console.error('Error dismissing notification:', error);
    }
  };

  const updateAutoReplyDelay = async (delay: number) => {
    try {
      await apiService.updateAutoReplyDelay(userEmail, delay);
      setAutoReplyDelay(delay);
      setShowSettings(false);
    } catch (error) {
      console.error('Error updating auto-reply delay:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getNotificationIcon = (notification: EmailNotification) => {
    if (notification.auto_reply_scheduled) {
      if (notification.time_until_auto_reply <= 0) {
        return <CheckCircle className="w-4 h-4 text-success" />;
      } else if (notification.time_until_auto_reply <= 30) {
        return <AlertCircle className="w-4 h-4 text-error" />;
      } else {
        return <Timer className="w-4 h-4 text-warning" />;
      }
    } else {
      return <Mail className="w-4 h-4 text-primary" />;
    }
  };

  const getNotificationColor = (notification: EmailNotification) => {
    if (notification.auto_reply_scheduled) {
      if (notification.time_until_auto_reply <= 0) {
        return 'border-success/20 bg-success/5';
      } else if (notification.time_until_auto_reply <= 30) {
        return 'border-error/20 bg-error/5';
      } else {
        return 'border-warning/20 bg-warning/5';
      }
    } else {
      return 'border-primary/20 bg-primary/5';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 md:top-20 md:right-6 md:inset-auto z-50 flex items-center justify-center md:block pointer-events-none">
      <div className="bg-surface border-0 md:border border-border rounded-none md:rounded-xl shadow-2xl w-full h-[100dvh] md:h-auto md:w-96 max-h-none md:max-h-[600px] overflow-hidden flex flex-col pointer-events-auto animate-scale-in">
        {/* Header */}
        <div className="p-4 border-b border-border bg-surface">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-background rounded-xl border border-border">
                <Bell className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className={clsx("w-1.5 h-1.5 rounded-full", isMonitoring ? "bg-success" : "bg-muted")}></div>
                  <span className={isMonitoring ? "text-success" : "text-muted"}>
                    {isMonitoring ? "Monitoring Active" : "Inactive"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-1.5 hover:bg-background rounded transition-colors"
              >
                <Settings className="w-4 h-4 text-muted" />
              </button>
              {onRefreshEmails && (
                <button
                  onClick={onRefreshEmails}
                  className="p-1.5 hover:bg-background rounded transition-colors"
                >
                  <RefreshCw className="w-4 h-4 text-muted" />
                </button>
              )}
              <button
                onClick={onToggleVisibility}
                className="p-2 hover:bg-background rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-muted" />
              </button>
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="p-4 border-b border-border bg-surface/50">
            <h4 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-3">Settings</h4>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-muted block mb-1">Auto-Reply Delay (sec)</label>
                <input
                  type="number"
                  value={autoReplyDelay}
                  onChange={(e) => setAutoReplyDelay(parseInt(e.target.value) || 120)}
                  min="30"
                  max="600"
                  className="input-field py-1.5 text-xs"
                />
              </div>
              <button
                onClick={() => updateAutoReplyDelay(autoReplyDelay)}
                className="btn-primary w-full py-1.5 text-xs"
              >
                Update Delay
              </button>
            </div>
          </div>
        )}

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto bg-background">
          {notifications.length === 0 ? (
            <div className="p-12 text-center">
              <Mail className="w-10 h-10 text-muted mx-auto mb-3" />
              <p className="text-xs text-muted">
                No notifications yet.
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {notifications.map((notification) => (
                <div
                  key={notification.email_id}
                  className={clsx(
                    "p-3 border rounded-md transition-all duration-200 hover:border-border-light cursor-pointer group relative",
                    getNotificationColor(notification)
                  )}
                  onClick={() => onNotificationClick(notification.email_id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {getNotificationIcon(notification)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {notification.sender_name || notification.sender_email}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted mb-2 line-clamp-1">
                        {notification.subject}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-muted">
                        <Clock className="w-3 h-3" />
                        <span>
                          {notification.auto_reply_scheduled ? (
                            notification.time_until_auto_reply > 0
                              ? `Auto-reply in ${formatTime(notification.time_until_auto_reply)}`
                              : 'Auto-reply sent'
                          ) : (
                            'Regular email'
                          )}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotification(notification.email_id);
                      }}
                      className="p-1 hover:bg-background rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3 text-muted" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border bg-surface text-[10px] text-muted flex justify-between">
          <span>{notifications.length} notifications</span>
          <span>Delay: {formatTime(autoReplyDelay)}</span>
        </div>
      </div>
    </div>
  );
};

export default EmailNotificationPanel;