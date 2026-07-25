"use client";

import React, { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  FileText,
  FolderOpen,
  ImageIcon,
  Inbox,
  Monitor,
  Pencil,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle
} from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import { cn } from "@/lib/utils";
import type { EmailTemplateSetup, SavedTemplate, TemplateValidationIssue } from "../../state/types";

type TemplateStep = "writing" | "template" | "assets" | "preview";
type PickerAccept = "pdf" | "html" | "image";
type PickerFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedAt: string;
  source: "current" | "saved";
  html?: string;
  sizeKb?: number;
  url?: string;
  emailSafe?: boolean;
};

const requiredVariables = ["firstName", "company", "personalizedOpener", "body", "ctaUrl", "repName"];

const sampleTemplateHtml = `<!doctype html>
<html>
  <body style="margin:0;background:#f7f7fb;font-family:Arial,Helvetica,sans-serif;color:#17171c;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7fb;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e7e8ef;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:30px 34px 8px;font-size:13px;color:#5e6ad2;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">M37 Labs</td>
            </tr>
            <tr>
              <td style="padding:0 34px 32px;font-size:15px;line-height:1.65;">
                <p style="margin:16px 0;">Hi {{firstName}},</p>
                <p style="margin:16px 0;">{{personalizedOpener}}</p>
                <p style="margin:16px 0;">{{body}}</p>
                <p style="margin:24px 0 20px;"><a href="{{ctaUrl}}" style="display:inline-block;background:#5e6ad2;color:#ffffff;text-decoration:none;border-radius:9px;padding:11px 16px;font-weight:700;">See the idea</a></p>
                <p style="margin:16px 0;color:#606575;">Best,<br />{{repName}}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
    : "Not yet";

const hasBlockingErrors = (setup?: EmailTemplateSetup) =>
  setup?.htmlTemplate?.issues.some((issue) => issue.severity === "error") ?? true;

const canActivateTemplate = (setup?: EmailTemplateSetup) =>
  Boolean(setup?.guideline && setup.sentFolder.status === "ready" && setup.previewHtml && !hasBlockingErrors(setup));

function StatusPill({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider",
      ready ? "border-success/30 bg-success/10 text-success" : "border-border bg-surface text-muted-dark"
    )}>
      <CheckCircle2 size={12} aria-hidden />
      {label}
    </span>
  );
}

function DrivePickerModal({
  open,
  onClose,
  accept,
  files,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  accept: PickerAccept;
  files: PickerFile[];
  onSelect: (file: PickerFile) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = files.filter((f) => {
    if (accept === "pdf" && f.mimeType !== "application/pdf") return false;
    if (accept === "html" && f.mimeType !== "text/html") return false;
    if (accept === "image" && !f.mimeType.startsWith("image/")) return false;
    return f.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drive-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            key="drive-modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ pointerEvents: "none" }}
          >
            <div className="w-full max-w-md rounded-xl border border-border bg-surface  overflow-hidden" style={{ pointerEvents: "auto" }}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-background">
                <div className="flex items-center gap-2">
                  <FolderOpen size={14} className="text-muted-dark" aria-hidden />
                  <span className="text-[13px] font-bold text-foreground">Pick from project files</span>
                </div>
                <button onClick={onClose} className="inline-flex items-center justify-center rounded-lg h-7 w-7 text-muted-dark hover:bg-surface-hover hover:text-foreground transition">
                  <X size={14} aria-hidden />
                </button>
              </div>
              <div className="p-3 bg-background/50">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search files…"
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground placeholder:text-muted-dark focus:outline-none focus:border-primary"
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-border/60 border-t border-border">
                {filtered.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs font-semibold text-muted-dark">No matching files found.</p>
                ) : filtered.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => { onSelect(file); onClose(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-hover"
                  >
                    <FileText size={14} className="shrink-0 text-muted-dark" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-foreground">{file.name}</p>
                      <p className="text-[11px] text-muted-dark font-medium mt-0.5">
                        {file.source === "saved" ? "Saved template" : "Current project"} · {formatDate(file.modifiedAt)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="border-t border-border px-4 py-3 bg-background/30">
                <p className="text-[11px] font-medium text-muted-dark">Showing real files collected from this project and its saved templates.</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function AccordionStep({
  id, activeStep, onToggle, title, icon: Icon, ready, summary, children
}: {
  id: TemplateStep;
  activeStep: TemplateStep;
  onToggle: (step: TemplateStep) => void;
  title: string;
  icon: React.ElementType;
  ready: boolean;
  summary: string;
  children: React.ReactNode;
}) {
  const open = activeStep === id;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface ">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex min-h-[72px] w-full items-center gap-3 px-4.5 text-left transition hover:bg-surface-hover/50"
      >
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
          ready ? "border-success/30 bg-success/10 text-success" : "border-border bg-background text-muted-dark"
        )}>
          <Icon size={16} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">{title}</h2>
            {ready ? <StatusPill ready label="Ready" /> : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-dark font-medium">{summary}</p>
        </div>
        <ChevronDown size={16} className={cn("shrink-0 text-muted-dark transition-transform duration-200", open && "rotate-180 text-foreground")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="border-t border-border px-4.5 py-4 bg-background/30">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ValidationList({ issues }: { issues: TemplateValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-xs font-semibold text-success ">
        <ShieldCheck size={14} aria-hidden />
        HTML is safe to preview and activate.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <div key={issue.id} className={cn(
          "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs font-semibold leading-relaxed ",
          issue.severity === "error" ? "border-error/30 bg-error/10 text-error" : "border-warning/30 bg-warning/10 text-warning"
        )}>
          {issue.severity === "error" ? <XCircle className="mt-0.5 shrink-0" size={14} aria-hidden /> : <AlertTriangle className="mt-0.5 shrink-0" size={14} aria-hidden />}
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function UploadRow({ label, description, onUpload, onDrivePick }: {
  label: string;
  description: string;
  onUpload: () => void;
  onDrivePick: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
      <div>
        <p className="text-xs font-bold text-foreground uppercase tracking-wider">{label}</p>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-dark font-medium">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          onClick={onUpload}
          className="inline-flex h-8.5 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold text-foreground transition hover:border-primary"
        >
          <Upload size={13} aria-hidden />
          Upload file
        </button>
        <button
          onClick={onDrivePick}
          className="inline-flex h-8.5 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold text-muted-dark transition hover:border-sky-500/50 hover:text-foreground"
        >
          <FolderOpen size={12} aria-hidden />
          Project files
        </button>
      </div>
    </div>
  );
}

export function TemplatesTab() {
  const projectId = useOutreachStore((state) => state.projectId);
  const setup = useOutreachStore((state) => state.templateSetup);
  const savedTemplates = useOutreachStore((state) => state.savedTemplates);

  const uploadGuideline = useOutreachStore((state) => state.uploadGuideline);
  const indexSentFolder = useOutreachStore((state) => state.indexSentFolder);
  const clearSentFolder = useOutreachStore((state) => state.clearSentFolder);
  const uploadHtmlTemplate = useOutreachStore((state) => state.uploadHtmlTemplate);
  const uploadBrandAsset = useOutreachStore((state) => state.uploadBrandAsset);
  const generateTemplatePreview = useOutreachStore((state) => state.generateTemplatePreview);
  const activateTemplateAction = useOutreachStore((state) => state.activateTemplate);
  const saveTemplateAction = useOutreachStore((state) => state.saveTemplate);
  const loadSavedTemplateAction = useOutreachStore((state) => state.loadTemplate);
  const deleteSavedTemplateAction = useOutreachStore((state) => state.deleteTemplate);
  const renameSavedTemplateAction = useOutreachStore((state) => state.renameTemplate);

  const guidelineInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const [notice, setNotice] = useState("");
  const [activeStep, setActiveStep] = useState<TemplateStep>("writing");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [drivePicker, setDrivePicker] = useState<{ open: boolean; accept: PickerAccept }>({ open: false, accept: "pdf" });

  const [indexing, setIndexing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [activating, setActivating] = useState(false);

  const projectFiles = useMemo<PickerFile[]>(() => {
    const deduped = new Map<string, PickerFile>();

    const addFile = (file: PickerFile | null) => {
      if (!file) return;
      const key = `${file.mimeType}:${file.name}:${file.source}:${file.modifiedAt}`;
      if (!deduped.has(key)) deduped.set(key, file);
    };

    if (setup.guideline) {
      addFile({
        id: `guideline-current-${setup.guideline.uploadedAt}`,
        name: setup.guideline.fileName,
        mimeType: "application/pdf",
        modifiedAt: setup.guideline.uploadedAt,
        source: "current",
        sizeKb: setup.guideline.sizeKb,
      });
    }

    if (setup.htmlTemplate) {
      addFile({
        id: `html-current-${setup.htmlTemplate.uploadedAt}`,
        name: setup.htmlTemplate.fileName,
        mimeType: "text/html",
        modifiedAt: setup.htmlTemplate.uploadedAt,
        source: "current",
        html: setup.htmlTemplate.html,
      });
    }

    setup.assets.forEach((asset) => {
      addFile({
        id: asset.id,
        name: asset.name,
        mimeType: asset.type,
        modifiedAt: setup.previewGeneratedAt ?? new Date().toISOString(),
        source: "current",
        sizeKb: asset.sizeKb,
        url: asset.url,
        emailSafe: asset.emailSafe,
      });
    });

    savedTemplates.forEach((template) => {
      if (template.setup.guideline) {
        addFile({
          id: `guideline-saved-${template.id}`,
          name: template.setup.guideline.fileName,
          mimeType: "application/pdf",
          modifiedAt: template.setup.guideline.uploadedAt,
          source: "saved",
          sizeKb: template.setup.guideline.sizeKb,
        });
      }

      if (template.setup.htmlTemplate) {
        addFile({
          id: `html-saved-${template.id}`,
          name: template.setup.htmlTemplate.fileName,
          mimeType: "text/html",
          modifiedAt: template.setup.htmlTemplate.uploadedAt,
          source: "saved",
          html: template.setup.htmlTemplate.html,
        });
      }

      template.setup.assets.forEach((asset) => {
        addFile({
          id: `${template.id}-${asset.id}`,
          name: asset.name,
          mimeType: asset.type,
          modifiedAt: template.createdAt,
          source: "saved",
          sizeKb: asset.sizeKb,
          url: asset.url,
          emailSafe: asset.emailSafe,
        });
      });
    });

    return [...deduped.values()].sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());
  }, [savedTemplates, setup]);

  const handleGuidelineFile = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { setNotice("Guidelines must be a PDF."); return; }
    setNotice("");
    void uploadGuideline(file.name, Math.ceil(file.size / 1024));
  };

  const handleHtmlFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".html")) { setNotice("Templates must be .html files."); return; }
    const html = await file.text();
    setNotice("");
    await uploadHtmlTemplate(file.name, html);
    setActiveStep("template");
  };

  const handleAssetFile = async (file?: File) => {
    if (!file) return;
    const valid = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
    if (!valid.some((ext) => file.name.toLowerCase().endsWith(ext))) { setNotice("Brand assets should be PNG, JPG, WEBP, or SVG."); return; }
    setNotice("");
    const fileUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await uploadBrandAsset({
      name: file.name,
      type: file.type || "application/octet-stream",
      sizeKb: Math.ceil(file.size / 1024),
      url: fileUrl,
      emailSafe: ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type)
    });
    setActiveStep("assets");
  };

  const handleSentFolderIndex = async () => {
    setIndexing(true);
    await indexSentFolder();
    setIndexing(false);
    setActiveStep("template");
  };

  const handleGeneratePreview = async () => {
    setPreviewing(true);
    await generateTemplatePreview();
    setPreviewing(false);
    setActiveStep("preview");
  };

  const handleActivate = async () => {
    setActivating(true);
    await activateTemplateAction();
    setActivating(false);
  };

  const handleSave = async () => {
    if (saveName.trim()) {
      await saveTemplateAction(saveName.trim());
      setSaveModalOpen(false);
      setSaveName("");
    }
  };

  const handleRename = async (id: string) => {
    if (renameValue.trim()) {
      await renameSavedTemplateAction(id, renameValue.trim());
      setRenamingId(null);
      setRenameValue("");
    }
  };

  const blockingErrors = hasBlockingErrors(setup);
  const guidelineReady = Boolean(setup.guideline);
  const sentReady = setup.sentFolder.status === "ready";
  const writingReady = guidelineReady && sentReady;
  const htmlReady = Boolean(setup.htmlTemplate && !blockingErrors);
  const assetsReady = setup.assets.length > 0;
  const previewReady = Boolean(setup.previewHtml);
  const activationReady = canActivateTemplate(setup);

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      {/* Hidden file inputs */}
      <input ref={guidelineInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => handleGuidelineFile(e.target.files?.[0])} />
      <input ref={htmlInputRef} type="file" accept=".html,text/html" className="hidden" onChange={(e) => { void handleHtmlFile(e.target.files?.[0]); }} />
      <input ref={assetInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" className="hidden" onChange={(e) => { void handleAssetFile(e.target.files?.[0]); }} />

      {/* Drive picker */}
      <DrivePickerModal
        open={drivePicker.open}
        accept={drivePicker.accept}
        files={projectFiles}
        onClose={() => setDrivePicker((p) => ({ ...p, open: false }))}
        onSelect={async (file) => {
          if (drivePicker.accept === "pdf") {
            await uploadGuideline(file.name, file.sizeKb ?? 142);
          } else if (drivePicker.accept === "html") {
            await uploadHtmlTemplate(file.name, file.html ?? sampleTemplateHtml);
            setActiveStep("template");
          }
          else {
            await uploadBrandAsset({
              name: file.name,
              type: file.mimeType,
              sizeKb: file.sizeKb ?? 84,
              url: file.url ?? "",
              emailSafe: file.emailSafe ?? file.mimeType.startsWith("image/")
            });
            setActiveStep("assets");
          }
        }}
      />

      {/* Save template modal */}
      <AnimatePresence>
        {saveModalOpen && (
          <>
            <motion.div key="save-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setSaveModalOpen(false)} />
            <motion.div key="save-modal" initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ pointerEvents: "none" }}>
              <div className="w-full max-w-sm rounded-xl border border-border bg-surface  overflow-hidden" style={{ pointerEvents: "auto" }}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-background">
                  <span className="text-sm font-bold text-foreground">Save template</span>
                  <button onClick={() => setSaveModalOpen(false)} className="inline-flex items-center justify-center rounded-lg h-7 w-7 text-muted-dark hover:bg-surface-hover hover:text-foreground transition">
                    <X size={14} aria-hidden />
                  </button>
                </div>
                <div className="p-4 bg-background/50">
                  <label className="block text-xs font-bold text-muted-dark uppercase tracking-wider mb-2">Template name</label>
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                    placeholder="e.g. eBic founder outreach v2"
                    className="h-9.5 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-dark focus:outline-none focus:border-primary"
                    autoFocus
                  />
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={!saveName.trim()}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-white transition hover:bg-primary-hover disabled:opacity-40"
                    >
                      <Save size={13} aria-hidden />
                      Save
                    </button>
                    <button onClick={() => setSaveModalOpen(false)} className="h-9 rounded-lg border border-border bg-surface px-4 text-xs font-bold text-muted-dark transition hover:bg-surface-hover hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="w-full">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
              <Sparkles size={14} className="text-primary animate-pulse" aria-hidden />
              Templates
            </p>
            <h1 className="mt-2 text-[24px] font-extrabold tracking-tight text-foreground">Set up one polished outbound email</h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-dark font-medium">Upload HTML, add writing style, preview, then activate. Save named templates to swap out campaigns.</p>
          </div>
          <button
            onClick={() => setSaveModalOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-xs font-bold text-muted-dark transition hover:border-primary hover:text-foreground "
          >
            <Save size={14} aria-hidden />
            Save template
          </button>
        </div>

        {/* Saved templates list */}
        {savedTemplates.length > 0 && (
          <FadeUp delay={0}>
            <div className="mb-5 rounded-xl border border-border bg-surface p-4.5 ">
              <p className="mb-3 text-xs font-bold text-foreground uppercase tracking-wider">Saved templates</p>
              <div className="space-y-2">
                {savedTemplates.map((tpl: SavedTemplate) => (
                  <div key={tpl.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-2.5 ">
                    <FileText size={14} className="shrink-0 text-muted-dark" aria-hidden />
                    <div className="min-w-0 flex-1">
                      {renamingId === tpl.id ? (
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(tpl.id);
                            if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                          }}
                          className="h-7 w-full rounded border border-primary bg-surface px-2 text-xs text-foreground focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <p className="truncate text-xs font-bold text-foreground">{tpl.name}</p>
                      )}
                      <p className="text-[11px] text-muted-dark font-semibold mt-0.5">Saved {formatDate(tpl.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => loadSavedTemplateAction(tpl.id)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-muted-dark transition hover:border-primary hover:text-foreground"
                      >
                        <FolderOpen size={12} aria-hidden />
                        Load
                      </button>
                      <button
                        onClick={() => { setRenamingId(tpl.id); setRenameValue(tpl.name); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-dark transition hover:bg-surface-hover hover:text-foreground"
                        aria-label="Rename"
                      >
                        <Pencil size={12} aria-hidden />
                      </button>
                      <button
                        onClick={() => deleteSavedTemplateAction(tpl.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-dark transition hover:bg-surface-hover hover:text-error"
                        aria-label="Delete"
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeUp>
        )}

        {notice && (
          <div className="mb-4 rounded-lg border border-warning/20 bg-warning/10 px-3.5 py-2.5 text-xs font-semibold text-warning">{notice}</div>
        )}

        <div className="mb-4 grid gap-2 grid-cols-2 lg:grid-cols-4 font-semibold">
          <StatusPill ready={writingReady} label="Writing style" />
          <StatusPill ready={htmlReady} label="Email template" />
          <StatusPill ready={assetsReady} label="Brand assets" />
          <StatusPill ready={previewReady} label={setup.isActive ? "Active" : "Preview"} />
        </div>

        <div className="space-y-3.5">
          <FadeUp delay={0.04}>
            <AccordionStep id="writing" activeStep={activeStep} onToggle={setActiveStep} title="Writing style" icon={FileText} ready={writingReady}
              summary={writingReady ? `${setup.guideline?.fileName || "PDF"} · ${setup.sentFolder.indexedCount} sent emails indexed` : "Upload PDF guideline and read sent-email style context"}>
              <div className="grid gap-3.5 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-background p-4 ">
                  <UploadRow
                    label="PDF guideline"
                    description="Brand voice, writing rules, examples, and claims to avoid."
                    onUpload={() => guidelineInputRef.current?.click()}
                    onDrivePick={() => setDrivePicker({ open: true, accept: "pdf" })}
                  />
                  {setup.guideline && (
                    <div className="mt-3.5 rounded-lg bg-surface px-3 py-2 text-xs font-medium border border-border ">
                      <span className="block text-foreground font-bold">{setup.guideline.fileName}</span>
                      <span className="text-muted-dark block mt-0.5">{setup.guideline.sizeKb} KB · {formatDate(setup.guideline.uploadedAt)}</span>
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-background p-4 ">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-foreground uppercase tracking-wider">Sent folder scan</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted-dark font-medium">Read-only tone context from sent emails.</p>
                    </div>
                    <button
                      onClick={handleSentFolderIndex}
                      disabled={indexing}
                      className="inline-flex h-8.5 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-foreground transition hover:border-primary disabled:opacity-50"
                    >
                      {indexing ? <RefreshCw size={13} className="animate-spin" /> : <Inbox size={13} aria-hidden />}
                      {sentReady ? "Re-index" : "Scan sent"}
                    </button>
                  </div>
                  {sentReady && (
                    <div className="mt-3.5 rounded-lg bg-surface px-3 py-2.5 text-xs font-medium border border-border ">
                      <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5 mb-1.5">
                        <span className="text-foreground font-bold">{setup.sentFolder.indexedCount} emails indexed</span>
                        <button onClick={() => clearSentFolder()} className="text-muted hover:text-foreground font-bold transition">Clear</button>
                      </div>
                      <span className="text-muted-dark text-[11px] font-semibold">Last run {formatDate(setup.sentFolder.lastIndexedAt)}</span>
                      <p className="mt-2 leading-relaxed text-muted-dark font-medium">{setup.sentFolder.summary}</p>
                    </div>
                  )}
                </div>
              </div>
            </AccordionStep>
          </FadeUp>

          <FadeUp delay={0.08}>
            <AccordionStep id="template" activeStep={activeStep} onToggle={setActiveStep} title="Email template" icon={FileCode2} ready={htmlReady}
              summary={setup.htmlTemplate ? `${setup.htmlTemplate.fileName} · ${setup.htmlTemplate.variables.length} variables · ${blockingErrors ? "needs fixes" : "valid"}` : "Upload email-ready HTML file"}>
              <div className="rounded-lg border border-border bg-background p-4 ">
                <UploadRow
                  label="Final HTML file"
                  description="AutoDeskAI validates placeholders. It does not convert design files."
                  onUpload={() => htmlInputRef.current?.click()}
                  onDrivePick={() => setDrivePicker({ open: true, accept: "html" })}
                />
                <div className="mt-2.5">
                  <button
                    onClick={() => uploadHtmlTemplate("sample-ebic-email.html", sampleTemplateHtml)}
                    className="inline-flex h-7.5 items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-bold text-muted-dark transition hover:border-primary hover:text-foreground"
                  >
                    <Play size={11} aria-hidden />
                    Use sample template
                  </button>
                </div>
                {setup.htmlTemplate ? (
                  <div className="mt-4 grid gap-3.5 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <div className="rounded-lg bg-surface px-3 py-2 text-xs border border-border ">
                      <span className="block truncate text-foreground font-bold">{setup.htmlTemplate.fileName}</span>
                      <span className="text-muted-dark block mt-0.5">Uploaded {formatDate(setup.htmlTemplate.uploadedAt)}</span>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {setup.htmlTemplate.variables.map((v) => (
                          <span key={v} className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-mono text-muted-dark">{"{{"}{v}{"}}"}</span>
                        ))}
                      </div>
                    </div>
                    <ValidationList issues={setup.htmlTemplate.issues} />
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-xs font-semibold text-muted-dark text-center bg-surface/30">
                    Required placeholders: {requiredVariables.map((v) => `{{${v}}}`).join(", ")}.
                  </div>
                )}
              </div>
            </AccordionStep>
          </FadeUp>

          <FadeUp delay={0.12}>
            <AccordionStep id="assets" activeStep={activeStep} onToggle={setActiveStep} title="Brand assets" icon={ImageIcon} ready={assetsReady}
              summary={assetsReady ? `${setup.assets.length} assets uploaded` : "Upload logos or email-safe imagery"}>
              <div className="rounded-lg border border-border bg-background p-4 ">
                <UploadRow
                  label="Images used by the HTML"
                  description="PNG, JPG, JPEG, and WEBP are safest. SVG can be stored but should be tested."
                  onUpload={() => assetInputRef.current?.click()}
                  onDrivePick={() => setDrivePicker({ open: true, accept: "image" })}
                />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {setup.assets.length ? (
                    setup.assets.map((asset) => (
                      <div key={asset.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5 ">
                        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-background border border-border">
                          {asset.type.startsWith("image/") ? <img src={asset.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={14} aria-hidden />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{asset.name}</p>
                          <p className="text-[11px] text-muted-dark font-medium mt-0.5">{asset.sizeKb} KB · {asset.emailSafe ? "email-safe" : "test before send"}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-4.5 text-xs font-semibold text-muted-dark text-center bg-surface/30 sm:col-span-2">
                      No brand assets uploaded yet. Hosted image URLs in the HTML will still work.
                    </div>
                  )}
                </div>
              </div>
            </AccordionStep>
          </FadeUp>

          <FadeUp delay={0.16}>
            <AccordionStep id="preview" activeStep={activeStep} onToggle={setActiveStep} title="Preview" icon={Monitor} ready={previewReady}
              summary={setup.isActive ? "Template is active" : activationReady ? "Preview generated and safe to activate" : previewReady ? "Preview generated" : "Generate email preview before activation"}>
              <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="rounded-lg border border-border bg-background p-4 ">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold text-foreground uppercase tracking-wider">Activation</p>
                    <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ",
                      setup.isActive ? "border-success/30 bg-success/10 text-success" : activationReady ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-surface text-muted-dark")}>
                      {setup.isActive ? "Active" : activationReady ? "Safe" : "Incomplete"}
                    </span>
                  </div>
                  <div className="mt-3.5 grid grid-cols-2 gap-2 text-center">
                    <StatusPill ready={writingReady} label="Style" />
                    <StatusPill ready={htmlReady} label="HTML" />
                    <StatusPill ready={previewReady} label="Preview" />
                    <StatusPill ready={setup.isActive} label="Active" />
                  </div>
                  <div className="mt-4.5 space-y-2">
                    <button
                      onClick={handleGeneratePreview}
                      disabled={!setup.htmlTemplate || blockingErrors || previewing}
                      className="inline-flex h-9.5 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-foreground transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-45  active:scale-95"
                    >
                      {previewing ? <RefreshCw size={13} className="animate-spin" /> : <Monitor size={13} aria-hidden />}
                      Preview email
                    </button>
                    <button
                      onClick={handleActivate}
                      disabled={!activationReady || activating || setup.isActive}
                      className="inline-flex h-9.5 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-45  active:scale-95"
                    >
                      {activating ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} aria-hidden />}
                      Activate template
                    </button>
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-[#0d0d0f] ">
                  <div className="flex items-center justify-between border-b border-border/80 px-3.5 py-2.5 bg-background">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-error" />
                      <span className="h-2.5 w-2.5 rounded-full bg-warning" />
                      <span className="h-2.5 w-2.5 rounded-full bg-success" />
                    </div>
                    <span className="text-[11px] font-semibold text-muted-dark">Desktop/Mobile Preview (Sarah @ Mint PR)</span>
                  </div>
                  {setup.previewHtml ? (
                    <div className="grid gap-3.5 p-3.5 xl:grid-cols-[minmax(0,1fr)_220px]">
                      <div>
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-dark uppercase tracking-wider"><Monitor size={13} aria-hidden />Desktop</div>
                        <iframe title="Desktop email preview" srcDoc={setup.previewHtml} className="h-[400px] w-full rounded-lg border border-border bg-white" />
                      </div>
                      <div>
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-dark uppercase tracking-wider"><Phone size={13} aria-hidden />Mobile</div>
                        <div className="mx-auto max-w-[200px] rounded-[24px] border border-border bg-black p-2">
                          <iframe title="Mobile email preview" srcDoc={setup.previewHtml} className="h-[340px] w-full rounded-[16px] bg-white" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[300px] flex-col items-center justify-center p-8 text-center bg-background/20">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-muted-dark ">
                        <FileCode2 size={16} aria-hidden />
                      </div>
                      <p className="mt-4 text-xs font-bold text-foreground">No preview generated</p>
                      <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-muted-dark font-medium">Upload valid HTML, then click preview to load with sample lead variables before campaign activation.</p>
                    </div>
                  )}
                </div>
              </div>
            </AccordionStep>
          </FadeUp>
        </div>
      </div>
    </main>
  );
}
export default TemplatesTab;
