import { useState, useCallback } from "react";
import { Email, apiService } from "@/services/api";

export interface EmailLoadResult {
  emails: Email[];
  loading: boolean;
  error: string | null;
  lastRefreshTime: Date | null;
  aiProcessing: boolean;
  reload: () => Promise<void>;
  setError: (msg: string) => void;
  reset: () => void;
  setAiProcessing: (processing: boolean) => void;
}

export function useEmailLoader(userEmail: string | undefined): EmailLoadResult {
  const LIMIT = 20;
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  const reset = useCallback(() => {
    setEmails([]);
    setError(null);
    setLoading(false);
    setAiProcessing(false);
    setLastRefreshTime(null);
  }, []);

  const reload = useCallback(async () => {
    if (!userEmail) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch all emails at once (classify=false)
      const allEmailsResult = await apiService.getEmails(userEmail, LIMIT, undefined, false);
      setEmails(allEmailsResult.emails || []);
      setLastRefreshTime(new Date());
      setLoading(false);

      // AI processing if needed
      const emailsNeedingAI = (allEmailsResult.emails || []).filter(
        (email: Email) => !email.ai_processed && (!email.classification || email.classification.confidence < 0.7)
      );
      
      if (emailsNeedingAI.length > 0) {
        setAiProcessing(true);
        try {
          const emailIds = emailsNeedingAI.map((email: Email) => email.id);
          await apiService.processSpecificEmails(userEmail, emailIds);
          
          // Only refresh those specific emails
          const updatedEmailsResult = await apiService.getEmailsByIds(userEmail, emailIds, true);
          
          // Merge updated emails into state
          setEmails((prev) =>
            prev.map((e) => updatedEmailsResult.emails.find((u: Email) => u.id === e.id) || e)
          );
        } catch (err: unknown) {
          console.error('AI Processing Error:', err);
          setError(err instanceof Error ? err.message : "Failed to process emails with AI");
        } finally {
          setAiProcessing(false);
        }
      }
    } catch (err: unknown) {
      console.error('Email Loading Error:', err);
      setError(err instanceof Error ? err.message : "Failed to fetch emails");
      setEmails([]); // Clear emails on error
      setLoading(false);
    }
  }, [userEmail]);

  return { emails, loading, error, lastRefreshTime, aiProcessing, reload, setError, reset, setAiProcessing };
}