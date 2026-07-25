export interface Tool {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  href: string;
  color: string;
}

export const TOOLS: Tool[] = [];
