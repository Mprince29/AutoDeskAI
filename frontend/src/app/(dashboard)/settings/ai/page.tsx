"use client";

import { useAuth } from "@/context/AuthContext";
import { apiService } from "@/services/api";
import {
  CheckCircle, Loader2, Trash2, TrendingUp
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { StatusLoader as SharedStatusLoader } from "@/components/shared/StatusLoader";
import { useEffect, useState } from "react";
import CostWidget from "@/components/shared/CostWidget";
import AIAgentPanel from "@/components/shared/AIAgentPanel";
import AIResponseControls from "./_components/AIResponseControls";
import { useOnboarding } from "@/hooks/useOnboarding";
import {
  CARD, sectionLabel, PROVIDERS,
  Notification, NotificationType, NotificationToast
} from "../_components/SettingsShared";
import { ConnectionGateway } from "../_components/ConnectionGateway";
import { ConfirmationModal } from "@/components/shared/ConfirmationModal";

export default function AISettingsPage() {
  const { user, loading, preferences, updatePreferences } = useAuth();
  const [notification, setNotification] = useState<Notification | null>(null);
  const [integrations, setIntegrations] = useState<Record<string, { connected: boolean; available: boolean }> | null>(null);

  const isCompanyUser = user?.email?.endsWith("@example.com") ?? false;
  const [useCompanyKeys, setUseCompanyKeys] = useState<boolean>(isCompanyUser);
  const [keyModeLoading, setKeyModeLoading] = useState(false);
  const [ownKeysProvider, setOwnKeysProvider] = useState<string>("");
  const [costOptMode, setCostOptMode] = useState<boolean>(false);
  const [apiKeyPlatform, setApiKeyPlatform] = useState<string | null>(null);
  const [platformToDisconnect, setPlatformToDisconnect] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const { resumeOnboarding } = useOnboarding();

  useEffect(() => {
    resumeOnboarding();
  }, [resumeOnboarding]);

  const showNotification = (message: string, type: NotificationType = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const handleConnectPlatform = (platform: string) => {
    setApiKeyPlatform(platform);
  };

  const handleConnectionSuccess = (platform: string) => {
    setApiKeyPlatform(null);
    if (user?.email) apiService.getIntegrationsStatus(user.email).then(setIntegrations);
  };

  const handleDisconnectPlatform = async (platform: string) => {
    if (!user?.email) return;
    setIsDisconnecting(true);

    try {
      await apiService.revokeIntegration(platform, user.email);
      showNotification(`${platform} disconnected`, "success");
      const status = await apiService.getIntegrationsStatus(user.email);
      setIntegrations(status);
    } catch (err: any) {
      showNotification(err.message || "Failed to disconnect", "error");
    } finally {
      setIsDisconnecting(false);
      setPlatformToDisconnect(null);
    }
  };

  useEffect(() => {
    try {
      setCostOptMode(localStorage.getItem('mc_cost_opt') === 'true');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!user?.email) return;
    Promise.allSettled([
      apiService.getIntegrationsStatus(user.email).then(setIntegrations),
      apiService.getPreferences(user.email).then(prefs => {
        if (prefs.use_company_keys != null) setUseCompanyKeys(prefs.use_company_keys);
      })
    ]);
  }, [user?.email]);

  useEffect(() => {
    if (!user?.email) return;
    // Pre-fetch configs for LLM providers to avoid loading states later
    PROVIDERS.forEach(p => {
      apiService.getApiKeyConfig(p.value, user.email).catch(() => {});
    });
  }, [user?.email]);

  const handlePreferenceChange = async (key: string, value: any) => {
    if (!user) return;
    try {
      await updatePreferences({ [key]: value });
      showNotification("Saved", "success");
    } catch { showNotification("Failed to save", "error"); }
  };

  const handleKeyModeToggle = async (value: boolean) => {
    if (!user?.email) return;
    setKeyModeLoading(true);
    try {
      await apiService.setKeyMode(user.email, value);
      setUseCompanyKeys(value);
      if (!value) {
        setOwnKeysProvider("");
        // Automatically switch to the first connected personal key if current preference is empty/disconnected
        const status = await apiService.getIntegrationsStatus(user.email);
        setIntegrations(status);
        const firstConnected = PROVIDERS.find(p => status[p.value]?.connected)?.value || "";
        await updatePreferences({ llm_provider: firstConnected });
      } else {
        const status = await apiService.getIntegrationsStatus(user.email);
        setIntegrations(status);
      }
      showNotification(value ? "Switched to company keys" : "Switched to personal keys", "success");
    } catch { showNotification("Failed to update", "error"); }
    finally { setKeyModeLoading(false); }
  };

  const toggleCostOpt = (val: boolean) => {
    setCostOptMode(val);
    try { localStorage.setItem('mc_cost_opt', String(val)); } catch { /* ignore */ }
    showNotification(val ? 'Cost Optimization enabled' : 'Cost Optimization disabled', 'success');
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted" /></div>;

  const COMPANY_PRIORITY = ["gemini", "openai", "anthropic", "mistral", "deepseek"];
  const personalConnected = PROVIDERS.find(p => integrations?.[p.value]?.connected)?.value;

  const effectiveProvider = useCompanyKeys
    ? (COMPANY_PRIORITY.find(p => integrations?.[p]?.connected) ?? preferences?.llm_provider ?? "")
    : ownKeysProvider || (preferences?.llm_provider && integrations?.[preferences.llm_provider]?.connected ? preferences.llm_provider : personalConnected) || "";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div id="ai-provider-selector" style={CARD}>
          {sectionLabel("Which AI powers your assistants?")}
          <Select value={effectiveProvider} onValueChange={v => { if (v && v !== '__placeholder__') { if (!useCompanyKeys) setOwnKeysProvider(v); handlePreferenceChange('llm_provider', v); } }}>
            <SelectTrigger className="w-full h-9 mt-2 rounded-lg text-xs border-border/50 bg-background">
              <SelectValue placeholder="Select AI provider" />
            </SelectTrigger>
            <SelectContent className="bg-background/95 backdrop-blur border border-border rounded-xl">
              {PROVIDERS.map(item => (
                <SelectItem key={item.value} value={item.value} className="text-xs py-2">
                  <div className="flex items-center gap-2">
                    {item.icon}
                    <span>{item.label}</span>
                    <span className="text-[10px] text-muted opacity-60">- {item.sub}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted mt-2 leading-relaxed">Changes take effect immediately across all your agents.</p>
        </div>

        {isCompanyUser && (
          <div style={CARD}>
            {sectionLabel("API Key Source")}
            <div className="flex p-1 bg-background mt-2 rounded-lg border border-border/50">
              {[
                { value: true, label: 'Company' },
                { value: false, label: 'Personal' },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => handleKeyModeToggle(opt.value)}
                  disabled={keyModeLoading}
                  className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${useCompanyKeys === opt.value ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-foreground'}`}
                >
                  {opt.label} Keys
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted mt-2 leading-relaxed">
              {useCompanyKeys ? 'Currently using M37 Labs shared API resources.' : 'Currently using your own connected API keys.'}
            </p>
          </div>
        )}
      </div>

      <div id="ai-services-section" style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
        <div className="p-5 border-b border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted">Connected AI Intelligence</p>
          </div>
          <span className="text-[10px] font-bold text-primary px-2 py-0.5 rounded-full bg-primary/5 border border-primary/10">Multi-Model Support</span>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-surface/30">
          {PROVIDERS.map(p => {
            const connected = integrations?.[p.value]?.connected;
            const active = effectiveProvider === p.value;
            return (
              <div 
                key={p.value} 
                className={`group p-4 rounded-2xl border transition-all duration-300 ${
                  active 
                  ? 'bg-background border-primary/30 shadow-[0_4px_20px_rgba(83,74,183,0.08)]' 
                  : 'bg-background/40 border-border/40 hover:border-border/80'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                    active ? 'bg-primary/10 border border-primary/20' : 'bg-surface border border-border/40'
                  }`}>
                    {p.icon}
                  </div>
                  <div className="flex items-center gap-2">
                    {connected ? (
                        <button
                          onClick={() => setPlatformToDisconnect(p.value)}
                          className="px-2 py-1 text-white font-bold text-xs bg-red-500/90 hover:bg-red-400 rounded-lg transition-colors group/trash"
                          title="Remove Key"
                        >
                          Disconnect
                        </button>
                    ) : (
                      <button 
                        onClick={() => handleConnectPlatform(p.value)} 
                        className="text-[10px] font-black uppercase tracking-tighter text-primary hover:opacity-80"
                      >
                        Add Key
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[13px] font-bold text-foreground">{p.label}</p>
                    {active && <span className="text-[8px] font-black bg-primary text-white px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Active</span>}
                  </div>
                  <p className="text-[10px] text-muted font-medium leading-tight">{p.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div id="cost-optimization-section" style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
        <div className={`p-5 flex items-center justify-between transition-all duration-300 ${costOptMode ? 'bg-emerald-500/[0.03] shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]' : 'bg-surface/30'}`}>
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${costOptMode ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-surface border border-border/40'}`}>
              <TrendingUp className={`w-5 h-5 transition-colors ${costOptMode ? 'text-emerald-500' : 'text-muted'}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground tracking-tight">Smart Cost Mode</p>
              <p className="text-[10px] text-muted font-medium leading-tight">Automatically select efficient models for simple analytical tasks</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={costOptMode} onChange={e => toggleCostOpt(e.target.checked)} className="sr-only peer" />
            <div className="w-10 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-muted-dark after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white border border-border shadow-inner" />
          </label>
        </div>
      </div>

      <div id="cost-widget-section">
        <CostWidget />
      </div>
      <div id="response-controls-section">
        <AIResponseControls userEmail={user?.email || ""} />
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

      <ConfirmationModal
        isOpen={platformToDisconnect !== null}
        onClose={() => setPlatformToDisconnect(null)}
        onConfirm={() => platformToDisconnect && handleDisconnectPlatform(platformToDisconnect)}
        title="Disconnect Platform"
        description={`Are you sure you want to disconnect ${platformToDisconnect}? This will remove your personal API key.`}
        confirmText="Disconnect"
        variant="destructive"
        isLoading={isDisconnecting}
      />
    </div>
  );
}

