"use client";
import { useAuth } from "@/context/AuthContext";
import {
  AlertCircle,
  Clock,
  Edit,
  MessageSquare,
  Send,
  Trash2,
  User,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";

interface Draft {
  id: string;
  messageId?: string;
  subject?: string;
  to?: string;
  date?: string;
  body?: string;
}

interface DraftsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDraftSent?: () => void;
  onDraftDeleted?: () => void;
  onEmailSent?: () => void;
}

export default function DraftsModal({
  isOpen,
  onClose,
  onDraftSent,
  onDraftDeleted,
  onEmailSent
}: DraftsModalProps) {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadDrafts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadDrafts = async () => {
    if (!user?.email) {
      setError("User not authenticated");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { apiService } = await import("@/services/api");

      const result = await apiService.getDrafts(user.email, 50);
      setDrafts(result.drafts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drafts");
    } finally {
      setLoading(false);
    }
  };

  const handleSendDraft = async (draftId: string) => {
    if (!user?.email) {
      setError("User not authenticated");
      return;
    }

    try {
      const { apiService } = await import("@/services/api");

      await apiService.sendDraft(user.email, draftId);

      setSuccess("Draft sent successfully!");
      setTimeout(() => {
        setSuccess("");
        loadDrafts();
        onDraftSent?.();
        onEmailSent?.();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send draft");
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    if (!user?.email) {
      setError("User not authenticated");
      return;
    }

    if (!confirm("Are you sure you want to delete this draft?")) {
      return;
    }

    try {
      const { apiService } = await import("@/services/api");

      await apiService.deleteDraft(user.email, draftId);

      setSuccess("Draft deleted successfully!");
      setTimeout(() => {
        setSuccess("");
        loadDrafts();
        onDraftDeleted?.();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete draft");
    }
  };

  const handleEditDraft = (draft: Draft) => {
    setSelectedDraft(draft);
    setShowEditModal(true);
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[99999] animate-fade-in">
      <div className="bg-surface border border-border rounded-md p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md border border-primary/20">
              <MessageSquare className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground">Draft Emails</h2>
              <p className="text-muted text-sm">
                Manage your saved draft emails
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-background rounded transition-colors"
          >
            <XCircle className="w-6 h-6 text-muted" />
          </button>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/20 rounded-md">
            <div className="flex items-center gap-2 text-error">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-success/10 border border-success/20 rounded-md">
            <div className="flex items-center gap-2 text-success">
              <MessageSquare className="w-4 h-4" />
              <span>{success}</span>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-primary">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span>Loading drafts...</span>
            </div>
          </div>
        ) : drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-6xl mb-4">📝</div>
            <h3 className="text-xl font-semibold text-foreground mb-2">No drafts found</h3>
            <p className="text-muted text-center">
              You don&apos;t have any saved draft emails
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="bg-background border border-border rounded-md p-4 hover:border-border-light transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-foreground line-clamp-1">
                      {draft.subject || "No Subject"}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-muted mt-1">
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span>{draft.to || "No recipient"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{draft.date ? formatDate(draft.date) : "No date"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleEditDraft(draft)}
                      className="p-2 hover:bg-surface rounded transition-colors"
                      title="Edit draft"
                    >
                      <Edit className="w-4 h-4 text-primary" />
                    </button>
                    <button
                      onClick={() => handleSendDraft(draft.id)}
                      className="p-2 hover:bg-surface rounded transition-colors"
                      title="Send draft"
                    >
                      <Send className="w-4 h-4 text-success" />
                    </button>
                    <button
                      onClick={() => handleDeleteDraft(draft.id)}
                      className="p-2 hover:bg-surface rounded transition-colors"
                      title="Delete draft"
                    >
                      <Trash2 className="w-4 h-4 text-error" />
                    </button>
                  </div>
                </div>

                {draft.body && (
                  <p className="text-muted text-sm line-clamp-3">
                    {draft.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-4 mt-8 pt-6 border-t border-border">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            Close
          </button>
        </div>
      </div>

      {/* Edit Draft Modal */}
      {showEditModal && selectedDraft && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[999999] animate-fade-in">
          <div className="bg-surface border border-border rounded-md p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-md border border-primary/20">
                  <Edit className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Edit Draft</h2>
                  <p className="text-muted text-sm">
                    Modify your draft email
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-2 hover:bg-background rounded transition-colors"
              >
                <XCircle className="w-6 h-6 text-muted" />
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  To *
                </label>
                <input
                  type="email"
                  value={selectedDraft.to}
                  onChange={(e) => setSelectedDraft({ ...selectedDraft, to: e.target.value })}
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Subject *
                </label>
                <input
                  type="text"
                  value={selectedDraft.subject}
                  onChange={(e) => setSelectedDraft({ ...selectedDraft, subject: e.target.value })}
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Message *
                </label>
                <textarea
                  value={selectedDraft.body}
                  onChange={(e) => setSelectedDraft({ ...selectedDraft, body: e.target.value })}
                  className="input-field w-full"
                  rows={8}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 mt-8 pt-6 border-t border-border">
              <button
                onClick={() => setShowEditModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowEditModal(false);
                }}
                className="btn-primary"
              >
                Update Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}