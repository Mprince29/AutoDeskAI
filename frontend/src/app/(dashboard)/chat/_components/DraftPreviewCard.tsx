"use client";

import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, ExternalLink, FileSpreadsheet, FileText, Pencil, Presentation, RefreshCw, Save } from "lucide-react";

import { ContentDraft, apiService } from "@/services/api";
import { toastError, toastSuccess } from "@/lib/friendly-errors";

function parseDelimitedRows(content: string): string[][] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  return lines.map((line) => {
    const delimiter = line.includes("\t") ? "\t" : ",";
    return line.split(delimiter).map((cell) => cell.trim());
  });
}

function getDraftIcon(type: string) {
  if (type === "spreadsheet") return FileSpreadsheet;
  if (type === "presentation") return Presentation;
  return FileText;
}

function DraftDocumentPreview({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function DraftSpreadsheetPreview({ content }: { content: string }) {
  const rows = useMemo(() => parseDelimitedRows(content), [content]);
  if (rows.length === 0) {
    return <p className="text-xs text-muted">No rows yet.</p>;
  }

  const [header, ...body] = rows;

  return (
    <div className="overflow-x-auto rounded-xl border border-border/50">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-surface/70">
          <tr>
            {header.map((cell, index) => (
              <th key={`${cell}-${index}`} className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] text-muted">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className="border-t border-border/40">
              {row.map((cell, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top text-foreground/85">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DraftPresentationPreview({ content }: { content: string }) {
  let slides: Array<Record<string, string>> = [];
  try {
    slides = JSON.parse(content);
  } catch {
    return <p className="text-xs text-muted">Could not render slides preview yet.</p>;
  }

  return (
    <div className="space-y-3">
      {slides.map((slide, index) => {
        const bullets = (slide.body_text || "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

        return (
          <div key={`slide-${index}`} className="rounded-xl border border-border/50 bg-surface/30 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">
                  Slide {index + 1}
                </p>
                <h4 className="text-sm font-semibold text-foreground">{slide.title_text || `Slide ${index + 1}`}</h4>
              </div>
              {slide.layout ? (
                <span className="rounded-md border border-border/50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                  {slide.layout.replaceAll("_", " ")}
                </span>
              ) : null}
            </div>

            {bullets.length > 0 ? (
              <ul className="space-y-2 text-xs text-foreground/85">
                {bullets.map((bullet, bulletIndex) => (
                  <li key={`bullet-${index}-${bulletIndex}`} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No bullet content yet.</p>
            )}

            {slide.speaker_notes ? (
              <div className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-[11px] text-muted">
                {slide.speaker_notes}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function DraftPreviewCard({
  draftId,
  userEmail,
  refreshToken,
}: {
  draftId: string;
  userEmail: string;
  refreshToken?: string;
}) {
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedContent, setEditedContent] = useState("");

  const loadDraft = async () => {
    try {
      setIsLoading(true);
      const nextDraft = await apiService.getDraft(userEmail, draftId);
      if (nextDraft === null) {
        // Draft was already saved/removed — show saved state silently
        setIsLoading(false);
        return;
      }
      setDraft(nextDraft);
      if (!isEditing) {
        setEditedTitle(nextDraft.title);
        setEditedContent(nextDraft.content);
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Could not load draft");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, userEmail, refreshToken]);

  const handleUpdate = async () => {
    if (!draft) return;
    try {
      const nextDraft = await apiService.updateDraft(userEmail, draft.id, {
        title: editedTitle,
        content: editedContent,
      });
      setDraft(nextDraft);
      setEditedTitle(nextDraft.title);
      setEditedContent(nextDraft.content);
      setIsEditing(false);
      toastSuccess("Draft updated");
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Could not update draft");
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    try {
      setIsSaving(true);
      const res = await apiService.saveDraft(userEmail, draft.id);
      setDraft(res.draft);
      setIsEditing(false);
      toastSuccess("Draft saved");
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Could not save draft");
    } finally {
      setIsSaving(false);
    }
  };

  const Icon = getDraftIcon(draft?.draft_type || "document");

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b border-primary/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">
              In-Chat Draft
            </p>
            <p className="text-sm font-semibold text-foreground">
              {draft?.title || "Loading draft..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {draft?.status === "saved" ? (
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Saved
            </span>
          ) : null}

          <button
            onClick={loadDraft}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted transition-colors hover:border-primary/40 hover:text-primary"
            title="Refresh draft"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {isLoading ? (
          <p className="text-xs text-muted">Loading preview...</p>
        ) : !draft ? (
          <p className="text-xs text-muted">Draft not available.</p>
        ) : (
          <>
            {draft.saved_url ? (
              <a
                href={draft.saved_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/15"
              >
                Open saved file
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}

            {isEditing ? (
              <div className="space-y-3">
                <input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="w-full rounded-xl border border-border/50 bg-surface/50 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/40"
                  placeholder="Draft title"
                />
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="min-h-[240px] w-full rounded-xl border border-border/50 bg-surface/50 px-3 py-3 text-xs text-foreground outline-none transition-colors focus:border-primary/40"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleUpdate}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Update draft
                  </button>
                  <button
                    onClick={() => {
                      setEditedTitle(draft.title);
                      setEditedContent(draft.content);
                      setIsEditing(false);
                    }}
                    className="rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {draft.draft_type === "spreadsheet" ? (
                  <DraftSpreadsheetPreview content={draft.content} />
                ) : draft.draft_type === "presentation" ? (
                  <DraftPresentationPreview content={draft.content} />
                ) : (
                  <DraftDocumentPreview content={draft.content} />
                )}

                <div className="flex flex-wrap gap-2">
                  {draft.status !== "saved" ? (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Quick edit
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {isSaving ? "Saving..." : "Save to Drive"}
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
