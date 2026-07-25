import { Email } from "@/services/api";

export function getEmailCategory(email: Email): string {
  if (email.classification?.category) return email.classification.category;
  if (email.labelIds?.includes("SPAM")) return "spam";
  if (email.labelIds?.includes("IMPORTANT")) return "important";
  return "other";
}