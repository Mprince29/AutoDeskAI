export interface AuditReport {
  status: "Passed" | "Failed" | "Warning";
  sentiment_tone: string;
  entity_coverage: string;
  seo_recommendation: string;
}

export interface SocialKit {
  twitter_thread: string[];
  linkedin_post: string;
  newsletter_blurb: string;
}
