"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Key,
  ExternalLink, CheckCircle2,
  ArrowRight, ShieldCheck, Zap,
  X
} from "lucide-react";

import { apiService } from "@/services/api";
import {
  sectionLabel, inputStyle, type NotificationType, getPlatformIcon
} from "@/app/(dashboard)/settings/_components/SettingsShared";

interface Step {
  type: "action" | "input" | "text" | "oauth";
  label?: string;
  url?: string;
  description?: string | string[];
  field?: string;
}

interface ConnectionGatewayProps {
  platform: string;
  email: string;
  onClose: () => void;
  onSuccess: (platform: string) => void;
  showNotification: (msg: string, type: NotificationType) => void;
}

export function ConnectionGateway({ platform, email, onClose, onSuccess, showNotification }: ConnectionGatewayProps) {
  const [authType, setAuthType] = useState<string>("");
  const [uiFlow, setUiFlow] = useState<Step[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fieldDefs, setFieldDefs] = useState<any[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [validationStatus, setValidationStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await apiService.getApiKeyConfig(platform, email);
        setAuthType(config.auth_type);
        setFieldDefs(config.fields || []);
        setUiFlow(config.ui_flow || []);
        setFields({});
        // Default to manual if it's api_key, otherwise auto
        setIsManualMode(config.auth_type === "api_key" || config.auth_type === "bot_token");
        containerRef.current?.scrollIntoView({ behavior: "smooth" });
      } catch {
        showNotification("Failed to load connection form", "error");
        onClose();
      }
    };
    loadConfig();
  }, [platform, email]);

  const handleConnect = async () => {
    try {
      setValidationStatus("checking");
      setIsSubmitting(true);
      await apiService.saveApiKey(platform, email, fields);
      setValidationStatus("valid");
      showNotification(`${platform} connected!`, "success");
      setTimeout(() => onSuccess(platform), 1000);
    } catch (err: any) {
      setValidationStatus("invalid");
      showNotification(err.message || "Failed to save", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = () => {
    // Standard OAuth2 flow
    window.location.href = `/api/integrations/${platform}/connect?email=${encodeURIComponent(email)}`;
  };

  const nextStep = () => {
    if (currentStepIdx < uiFlow.length - 1) {
      setCurrentStepIdx(currentStepIdx + 1);
    } else {
      handleConnect();
    }
  };

  const prevStep = () => {
    if (currentStepIdx > 0) setCurrentStepIdx(currentStepIdx - 1);
  };

  const renderDescription = (description?: string | string[]) => {
    if (!description) return null;
    return (
      <div className="bg-surface/20 border border-border/50 rounded-lg px-3.5 py-4">
        {Array.isArray(description) ? (
          <ul className="list-disc pl-4 space-y-2 marker:text-primary/70">
            {description.map((point, i) => (
              <li key={i} className="text-sm text-foreground/80 leading-relaxed pl-1">{point}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground/80 leading-relaxed">{description}</p>
        )}
      </div>
    );
  };

  // Render logic for different step types
  const renderStepContent = (step: Step) => {
    switch (step.type) {
      case "action":
        return (
          <div className="flex flex-col gap-3">
            {renderDescription(step.description)}
            <a
              href={step.url}
              target="_blank"
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-primary/10 text-primary font-bold hover:bg-primary/20 transition-all border border-primary/20"
            >
              {step.label || "Open Page"} <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        );
      case "input":
        const fieldDef = fieldDefs.find(f => f.name === step.field);
        return (
          <div className="flex flex-col gap-3">
            {renderDescription(step.description)}
            <div className="relative">
              <input
                type={fieldDef?.type || "text"}
                placeholder={fieldDef?.placeholder || `Paste ${step.label} here...`}
                style={inputStyle}
                value={fields[step.field || ""] || ""}
                onChange={e => setFields(prev => ({ ...prev, [step.field || ""]: e.target.value }))}
                className="pr-10"
              />
              {fields[step.field || ""] && (
                <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
              )}
            </div>
          </div>
        );
      case "text":
        return renderDescription(step.description);
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/5 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="absolute inset-0" onClick={onClose} />

      <div
        ref={containerRef}
        className="relative flex flex-col gap-6 max-w-2xl w-full bg-surface border border-border shadow-2xl rounded-2xl p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-150"
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="w-9" />

          <div className="flex flex-col items-center">
            <div className="mb-1">
              {getPlatformIcon(platform, "w-6 h-6")}
            </div>
            <h2 className="text-lg font-bold">Connect {platform.charAt(0).toUpperCase() + platform.slice(1)}</h2>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Gateway Setup</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        {!authType ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground animate-pulse">Loading...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {!isManualMode && authType === "oauth2" ? (
              <div className="flex flex-col gap-6">
                <div className="p-8 text-center flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
                    <Zap className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-1">Instant Connect</h3>
                    <p className="text-sm text-muted-foreground px-4">
                      Grant AutoDeskAI access to your {platform} account in one click. No keys required.
                    </p>
                  </div>

                  <button
                    onClick={handleOAuth}
                    className="w-full mt-4 flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-primary text-white font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary/20"
                  >
                    Connect with {platform.charAt(0).toUpperCase() + platform.slice(1)}
                    <ArrowRight className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => setIsManualMode(true)}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors mt-2"
                  >
                    Do it manually instead
                  </button>
                </div>
              </div>
            ) : (
              <>
                {uiFlow.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {uiFlow.map((step, idx) => {
                      const isActive = idx === currentStepIdx;
                      const isCompleted = idx < currentStepIdx;
                      const isFuture = idx > currentStepIdx;

                      return (
                        <div
                          key={idx}
                          className={`relative flex gap-5 transition-all duration-700 ${isFuture ? "opacity-30 grayscale-[0.5]" : "opacity-100"
                            }`}
                        >
                          {idx !== uiFlow.length - 1 && (
                            <div className="absolute left-4 top-10 bottom-0 w-[2px] -translate-x-1/2 overflow-hidden bg-border/30 rounded-full">
                              <div
                                className={`h-full w-full transition-all duration-1000 ease-in-out ${isCompleted ? "bg-primary" : "bg-transparent"
                                  }`}
                              />
                            </div>
                          )}

                          <div className="relative z-10 shrink-0">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 transition-all duration-500 ${isActive
                                ? "bg-primary border-primary text-white scale-110" :
                                isCompleted
                                  ? "bg-primary/10 border-primary text-primary" :
                                  "bg-surface border-border text-muted-foreground"
                              }`}>
                              {isCompleted ? <CheckCircle2 className="w-4 h-4 animate-in zoom-in duration-300" /> : idx + 1}
                            </div>
                          </div>

                          <div className="flex-1 pb-8">
                            <div className="flex flex-col">
                              <h4 className={`text-sm font-bold tracking-tight transition-all duration-300 ${isActive ? "text-foreground translate-x-1" : "text-muted-foreground"
                                }`}>
                                {step.label || `Step ${idx + 1}`}
                              </h4>

                              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isActive ? "max-h-[600px] opacity-100 mt-4" : "max-h-0 opacity-0"
                                }`}>
                                <div className="bg-background/60 backdrop-blur-md border border-border/60 rounded-xl p-4 flex flex-col gap-5 shadow-sm">
                                  <div className="animate-in fade-in slide-in-from-top-2 duration-500">
                                    {renderStepContent(step)}
                                  </div>

                                  <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
                                    {idx > 0 && (
                                      <button
                                        onClick={prevStep}
                                        className="flex-1 py-2.5 px-4 rounded-xl border border-border hover:bg-muted transition-all font-bold text-[10px] uppercase tracking-widest"
                                      >
                                        Back
                                      </button>
                                    )}
                                    <button
                                      onClick={nextStep}
                                      disabled={isSubmitting || (step.type === "input" && !fields[step.field || ""])}
                                      className={`${idx > 0 ? 'flex-[2]' : 'w-full'} py-2.5 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${isSubmitting || (step.type === "input" && !fields[step.field || ""])
                                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                                          : "bg-primary text-white hover:shadow-xl hover:shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                                        }`}
                                    >
                                      {isSubmitting ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : idx === uiFlow.length - 1 ? (
                                        <span className="flex items-center gap-2">Finish Setup <Zap className="w-3 h-3 fill-current" /></span>
                                      ) : (
                                        <span className="flex items-center gap-2">Continue <ArrowRight className="w-3.5 h-3.5" /></span>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {isCompleted && step.type === "input" && fields[step.field || ""] && (
                                <div className="flex items-center gap-2 mt-2 ml-1 animate-in fade-in slide-in-from-left-2 duration-500">
                                  <div className="w-1 h-1 rounded-full bg-primary/40" />
                                  <p className="text-[10px] text-primary/80 font-bold uppercase tracking-tighter">
                                    Verified • {fields[step.field || ""].replace(/./g, '•').slice(0, 16)}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {validationStatus !== "idle" && (
                      <div className={`p-4 rounded-xl border flex items-center gap-4 animate-in zoom-in-95 duration-300 ${validationStatus === "checking" ? "bg-blue-500/5 border-blue-500/20 text-blue-500" :
                          validationStatus === "valid" ? "bg-green-500/5 border-green-500/20 text-green-500" :
                            "bg-red-500/5 border-red-500/20 text-red-500 shadow-lg shadow-red-500/5"
                        }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${validationStatus === "checking" ? "bg-blue-500/10" :
                            validationStatus === "valid" ? "bg-green-500/10" :
                              "bg-red-500/10"
                          }`}>
                          {validationStatus === "checking" ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : validationStatus === "valid" ? (
                            <ShieldCheck className="w-4 h-4" />
                          ) : (
                            <Key className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-bold leading-tight">
                            {validationStatus === "checking" ? "Security Check" :
                              validationStatus === "valid" ? "Authenticated" :
                                "Access Denied"}
                          </p>
                          <p className="text-[10px] opacity-80 font-medium">
                            {validationStatus === "checking" ? "Verifying your connection securely..." :
                              validationStatus === "valid" ? "Credentials verified and securely stored." :
                                "The API key provided appears to be invalid."}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 border border-border/50 rounded-xl bg-background/50">
                    {sectionLabel("Credentials")}
                    <div className="flex flex-col gap-4 mb-6">
                      {fieldDefs.map(f => (
                        <div key={f.name}>
                          <label className="text-xs text-muted-foreground block mb-1">{f.label}</label>
                          <input
                            type={f.type}
                            placeholder={f.placeholder}
                            style={inputStyle}
                            value={fields[f.name] || ''}
                            onChange={e => setFields(prev => ({ ...prev, [f.name]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleConnect}
                        disabled={isSubmitting}
                        className="flex-[2] py-3 px-4 rounded-xl bg-primary text-white font-bold hover:scale-[1.02] transition-all"
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Connect"}
                      </button>
                      <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-border hover:bg-muted font-semibold">Cancel</button>
                    </div>
                  </div>
                )}

                {isManualMode && authType === "oauth2" && (
                  <button
                    onClick={() => setIsManualMode(false)}
                    className="text-[10px] text-center text-muted-foreground hover:text-primary transition-colors uppercase tracking-widest mt-2"
                  >
                    Switch back to automatic connection
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}