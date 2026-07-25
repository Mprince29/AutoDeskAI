"use client";

import { useAuth } from "@/context/AuthContext";
import { apiService } from "@/services/api";
import {
  SiGmail, SiGooglecalendar, SiGoogledrive,
  SiGoogledocs, SiGooglesheets, SiGoogleslides, SiGoogleforms, SiGoogletasks,
  SiGoogle, SiSlack, SiNotion, SiTrello, SiDiscord, SiTelegram, SiCaldotcom
} from "react-icons/si";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CARD,
  Notification, NotificationType, NotificationToast
} from "../_components/SettingsShared";
import { ConnectionGateway } from "../_components/ConnectionGateway";
import { useOnboarding } from "@/hooks/useOnboarding";

const OAUTH_PLATFORMS = ["slack", "github", "notion", "discord", "calcom"/*, "jira", "linkedin"*/];

export default function IntegrationsPage() {
  const { user, loading, preferences, updatePreferences } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notification, setNotification] = useState<Notification | null>(null);

  const [integrations, setIntegrations] = useState<Record<string, { connected: boolean; available: boolean }> | null>(null);
  const [googleReauthState, setGoogleReauthState] = useState<'idle' | 'disconnecting' | 'redirecting'>('idle');
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingPlatformId, setDisconnectingPlatformId] = useState<string | null>(null);
  const [googleTokenValid, setGoogleTokenValid] = useState<boolean | null>(null);
  const [googleTokenError, setGoogleTokenError] = useState<string | null>(null);

  const [apiKeyPlatform, setApiKeyPlatform] = useState<string | null>(null);

  const { resumeOnboarding } = useOnboarding();

  useEffect(() => {
    resumeOnboarding();
  }, [resumeOnboarding]);

  const showNotification = (message: string, type: NotificationType = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  useEffect(() => {
    if (!user?.email) return;
    apiService.getIntegrationsStatus(user.email)
      .then(setIntegrations)
      .catch(() => setIntegrations({}));
  }, [user?.email]);

  // Validate the stored Google token is actually usable (not just present)
  useEffect(() => {
    if (!user?.email || !(preferences?.gmail_connected || preferences?.calendar_connected)) return;
    apiService.validateGoogleConnection(user.email).then(res => {
      setGoogleTokenValid(res.valid);
      setGoogleTokenError(res.valid ? null : (res.error ?? "Token invalid"));
    });
  }, [user?.email, preferences?.gmail_connected, preferences?.calendar_connected]);

  useEffect(() => {
    if (!user?.email) return;
    // Pre-fetch configs only for API-key platforms (not OAuth — those return redirects)
    const apiKeyPlatforms = ['trello', 'telegram'];
    apiKeyPlatforms.forEach(p => {
      apiService.getApiKeyConfig(p, user.email).catch(() => { });
    });
  }, [user?.email]);

  // OAuth Callback handling
  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected) {
      showNotification(`${connected} connected successfully!`, "success");
      router.replace("/settings/integrations");
      if (user?.email) apiService.getIntegrationsStatus(user.email).then(setIntegrations);
    }
  }, [searchParams, user?.email, router]);

  const handleDisconnectGoogle = async () => {
    if (!user) return;
    try {
      setGoogleReauthState('disconnecting');
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/clear-all-google-tokens?email=${encodeURIComponent(user.email)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}`, 'Content-Type': 'application/json' }
      });
      updatePreferences({ gmail_connected: false, calendar_connected: false } as any);
      showNotification("Google Workspace disconnected", "warning");
    } catch {
      showNotification("Failed to disconnect", "error");
    } finally { setGoogleReauthState('idle'); }
  };

  const handleConnectPlatform = async (platform: string) => {
    if (!user?.email) return;
    if (OAUTH_PLATFORMS.includes(platform)) {
      setConnectingPlatform(platform);
      try {
        await apiService.connectOAuth(platform, user.email);
        setIntegrations(await apiService.getIntegrationsStatus(user.email));
        showNotification(`${platform} connected!`, "success");
      } catch (err: any) { 
        showNotification(err.message || "Connection failed", "error"); 
      } finally {
        setConnectingPlatform(null);
      }
    } else {
      setApiKeyPlatform(platform);
    }
  };

  const handleConnectionSuccess = (_platform: string) => {
    setApiKeyPlatform(null);
    if (user?.email) apiService.getIntegrationsStatus(user.email).then(setIntegrations);
  };

  const handleDisconnect = async (platform: string) => {
    if (!user?.email) return;
    setDisconnectingPlatformId(platform);
    try {
      await apiService.revokeIntegration(platform, user.email);
      setIntegrations(prev => prev ? { ...prev, [platform]: { connected: false, available: true } } : null);
      showNotification(`${platform} disconnected`, "warning");
    } catch { showNotification("Failed to disconnect", "error"); }
    finally { setDisconnectingPlatformId(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted" /></div>;

  const googleOk = !!(preferences?.gmail_connected || preferences?.calendar_connected);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Google token invalid warning banner */}
      {googleOk && googleTokenValid === false && googleTokenError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <p className="text-xs font-medium flex-1">
            Google connection issue: {googleTokenError}
          </p>
          <button
            onClick={() => window.location.href = apiService.getGmailAuthUrl(user?.email || '')}
            className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/40 transition-colors"
          >
            Reconnect
          </button>
        </div>
      )}

      {/* Google Workspace Section */}
      <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
        <div className="p-5 border-b border-border/40 flex justify-between items-center bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-background border border-border/60 flex items-center justify-center shadow-sm">
              <SiGoogle className="w-5 h-5 text-[#4285F4]" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">Google Workspace</p>
              <p className="text-[10px] text-muted font-medium">Email, Calendar, and Productivity tools</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {googleOk && (
              <button
                onClick={handleDisconnectGoogle}
                disabled={googleReauthState === 'disconnecting'}
                className="text-[10px] font-bold text-red-500/70 hover:text-red-500 transition-colors uppercase tracking-widest px-3 disabled:opacity-50 flex items-center gap-1"
              >
                {googleReauthState === 'disconnecting' ? <><Loader2 className="w-3 h-3 animate-spin" /> Disconnecting...</> : 'Disconnect'}
              </button>
            )}
            <button
              onClick={() => window.location.href = apiService.getGmailAuthUrl(user?.email || '')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${googleOk ? 'bg-background border border-border/60 hover:bg-surface' : 'bg-primary text-white hover:opacity-90'}`}
            >
              {googleOk ? 'Reconnect' : 'Connect Account'}
            </button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 bg-surface/30">
          {[
            { label: 'Gmail', ok: preferences?.gmail_connected, icon: <SiGmail className="w-4 h-4 text-[#EA4335]" /> },
            { label: 'Calendar', ok: preferences?.calendar_connected, icon: <SiGooglecalendar className="w-4 h-4 text-[#4285F4]" /> },
            { label: 'Drive', ok: googleOk, icon: <SiGoogledrive className="w-4 h-4 text-[#34A853]" /> },
            { label: 'Docs', ok: googleOk, icon: <SiGoogledocs className="w-4 h-4 text-[#4285F4]" /> },
            { label: 'Sheets', ok: googleOk, icon: <SiGooglesheets className="w-4 h-4 text-[#0F9D58]" /> },
            { label: 'Slides', ok: googleOk, icon: <SiGoogleslides className="w-4 h-4 text-[#FBBC04]" /> },
            { label: 'Forms', ok: googleOk, icon: <SiGoogleforms className="w-4 h-4 text-[#7248B9]" /> },
            { label: 'Tasks', ok: googleOk, icon: <SiGoogletasks className="w-4 h-4 text-[#4285F4]" /> },
          ].map(s => (
            <div
              key={s.label}
              className={`group flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${s.ok
                  ? 'bg-background border-emerald-500/20 shadow-[0_2px_10px_rgba(16,185,129,0.05)]'
                  : 'bg-background/40 border-border/40 opacity-60 grayscale'
                }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg ${s.ok ? 'bg-surface border border-border/40' : 'bg-transparent'}`}>
                  {s.icon}
                </div>
                <span className={`text-[11px] font-bold ${s.ok ? 'text-foreground' : 'text-muted'}`}>{s.label}</span>
              </div>
              {s.ok && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />}
            </div>
          ))}
        </div>
      </div>

      {/* Other Platforms Section */}
      <div id="other-platforms-section" style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
        <div className="p-5 border-b border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted">Cloud Ecosystem</p>
          </div>
          <span className="text-[10px] font-bold text-primary px-2 py-0.5 rounded-full bg-primary/5 border border-primary/10">More coming soon</span>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-surface/30">
          {[
            { key: 'slack', label: 'Slack', icon: <SiSlack className="w-4 h-4 text-[#4A154B]" />, desc: 'Real-time notifications' },
            { key: 'notion', label: 'Notion', icon: <SiNotion className="w-4 h-4" />, desc: 'Document syncing' },
            { key: 'trello', label: 'Trello', icon: <SiTrello className="w-4 h-4 text-[#0052CC]" />, desc: 'Task management' },
            { key: 'discord', label: 'Discord', icon: <SiDiscord className="w-4 h-4 text-[#5865F2]" />, desc: 'Community updates' },
            { key: 'telegram', label: 'Telegram', icon: <SiTelegram className="w-4 h-4 text-[#229ED9]" />, desc: 'Mobile alerts' },
            { key: 'calcom', label: 'Cal.com', icon: <SiCaldotcom className="w-4 h-4 text-[#111827]" />, desc: 'Booking & scheduling' },
          ].map(p => {
            const conn = integrations?.[p.key]?.connected;
            return (
              <div
                key={p.key}
                className={`group p-4 rounded-2xl border transition-all duration-300 hover:shadow-lg ${conn
                    ? 'bg-background border-primary/20'
                    : 'bg-background/40 border-border/40 hover:border-border/80'
                  }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${conn ? 'bg-primary/5 border border-primary/10' : 'bg-surface border border-border/40'
                    }`}>
                    {p.icon}
                  </div>
                  {conn ? (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter">Active</span>
                    </div>
                  ) : (
                    <span className="text-[9px] font-bold text-muted uppercase tracking-tight">Disconnected</span>
                  )}
                </div>


                <div className="flex justify-between items-center">
                  <div className="">
                    <p className="text-[13px] font-bold text-foreground mb-0.5">{p.label}</p>
                    <p className="text-[10px] text-muted font-medium leading-tight">{p.desc}</p>
                  </div>
                  {conn ? (
                    <button
                      onClick={() => handleDisconnect(p.key)}
                      disabled={disconnectingPlatformId === p.key}
                      className="w-fit px-2 py-1 rounded-lg text-[10px] font-bold text-red-500 bg-red-500/10 transition-all hover:bg-red-500 hover:text-white border border-transparent hover:border-red-500/20 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {disconnectingPlatformId === p.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Disconnect"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnectPlatform(p.key)}
                      disabled={connectingPlatform === p.key}
                      className="w-fit px-2 py-1 rounded-lg text-[10px] font-bold text-primary bg-primary/5 hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      {connectingPlatform === p.key ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting...</>
                      ) : (
                        <>Connect <ChevronRight className="w-3.5 h-3.5" /></>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {apiKeyPlatform && (
        <ConnectionGateway
          platform={apiKeyPlatform}
          email={user?.email || ""}
          onClose={() => setApiKeyPlatform(null)}
          onSuccess={handleConnectionSuccess}
          showNotification={showNotification}
        />
      )}

      {notification && <NotificationToast n={notification} onClose={() => setNotification(null)} />}

    </div>
  );
}
