export interface ArticleData {
  id?: number;
  topic: string;
  category: string;
  markdown_content: string;
  research_summary?: ResearchSummary;
  outline?: any;
  data_insights?: any[];
  audit?: AuditReport | null;
  image_url?: string;
  social_kit?: SocialKit;
  versions?: ArticleData[];
  session_id?: string;
  sources?: Array<{ title: string; url: string; description: string }>;
  created_at?: string;
  updated_at?: string;
}

export interface SessionEntry {
  session_id: string | null;
  latest_report_id: number;
  topic: string;
  category: string;
  version_count: number;
  created_at: string;
  updated_at?: string;
  image_url?: string;
}

export interface SocialKit {
  platforms: {
    twitter?: string[];
    linkedin?: string;
    instagram?: string;
    facebook?: string;
    newsletter?: string;
  };
  twitter_thread?: string[];
  twitter_tags?: string[];
  linkedin_post?: string;
  linkedin_tags?: string[];
  instagram_caption?: string;
  instagram_tags?: string[];
  facebook_post?: string;
  facebook_tags?: string[];
  newsletter_blurb?: string;
  newsletter_tags?: string[];
  hashtags: string[];
}

export interface ResearchSummary {
  contrarian_perspectives?: string[];
  hidden_challenges?: string[];
  stakeholders?: any[];
  trends?: string[];
  examples?: string[];
  sources?: any[];
  data_insights?: any[];
  core_facts?: any[];
  statistics?: any[];
}

export interface GroundingSource {
  name: string;
  content: string;
}

export interface AuditReport {
  score: number;
  status?: string;
  critique: string;
  sentiment_tone?: string;
  entity_coverage?: string;
  seo_recommendation?: string;
  suggestions: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  articleData?: ArticleData;
  imageUrl?: string | null;
  socialKit?: SocialKit | null;
  pending?: boolean;
  pendingStatuses?: string[];
  progress?: number;
  updatedAt?: number;
  versions?: ArticleData[];
  activeVersionIndex?: number;
}
