import { MessagesSquare } from "lucide-react";

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
    id: "social-media",
    icon: MessagesSquare,
    label: "Social Media Intelligence",
    description: "Generate AI news digests by region, scan social posts for reputation management, and approve on-brand comments before posting them manually.",
    href: "/playground/social-media",
    color: "#0ea5e9",
  },
];
