export interface Contact {
  id: number;
  name: string;
  email: string;
  nickname?: string;
  phone?: string;
  company?: string;
  title?: string;
  notes?: string;
  tags?: string[];
  created_at: string;
}

export interface ContactCreate {
  name: string;
  email: string;
  nickname?: string;
  phone?: string;
  company?: string;
  title?: string;
  notes?: string;
  tags?: string[];
}
