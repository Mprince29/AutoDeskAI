import { Table2, Newspaper, MessagesSquare } from "lucide-react";

export interface Tool {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  href: string;
  color: string;
}

export const TOOLS: Tool[] = [
  {
    id: "csv-cleaner",
    icon: Table2,
    label: "CSV Cleaner",
    description: "Upload a messy spreadsheet and get back a clean, fixed version instantly. Removes duplicates, fixes formatting, and fills in missing values.",
    href: "/playground/csv-cleaner",
    color: "#10B981",
  },
  {
    id: "ai-journalist",
    icon: Newspaper,
    label: "AI Journalist",
    description: "Generate high-fidelity long-form articles with live web research, SEO optimization, AI cover images, editorial audits, and a full social media kit.",
    href: "/playground/ai-journalist",
    color: "#6366f1",
  },
  {
    id: "social-media",
    icon: MessagesSquare,
    label: "Social Media Intelligence",
    description: "Generate AI news digests by region, scan social posts for reputation management, and approve on-brand comments before posting them manually.",
    href: "/playground/social-media",
    color: "#0ea5e9",
  },
];
