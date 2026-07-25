import React from 'react';
import { Zap } from 'lucide-react';

import {
  SiGoogle,
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiGoogledocs,
  SiGooglesheets,
  SiGoogleforms,
  SiGoogleslides,
  SiGithub,
  SiSlack,
  SiDiscord,
  SiJira,
  SiTrello,
  SiTelegram,
} from 'react-icons/si';
import { FaLinkedin } from 'react-icons/fa';
import { FiGlobe, FiSearch } from 'react-icons/fi';
import { BsStars } from 'react-icons/bs';

// Gemini AI icon
export const GeminiIcon = SiGoogle;

// Gmail icon
export const GmailIcon = SiGmail;

// Google Calendar icon
export const GoogleCalendarIcon = SiGooglecalendar;

// Google Drive icon
export const GoogleDriveIcon = SiGoogledrive;

// Google Docs icon
export const GoogleDocsIcon = SiGoogledocs;

// Google Sheets icon
export const GoogleSheetsIcon = SiGooglesheets;

// Google Forms icon
export const GoogleFormsIcon = SiGoogleforms;

// Google Slides icon
export const GoogleSlidesIcon = SiGoogleslides;

// Imagen / AI Image Generation icon
export const ImagenIcon = BsStars;

// Fetch Webpage / Browser icon
export const FetchWebIcon = FiGlobe;

// Google Search / Web icon
export const SearchIcon = FiSearch;

// GitHub icon
export const GitHubIcon = SiGithub;

// Slack icon
export const SlackIcon = SiSlack;

// Discord icon
export const DiscordIcon = SiDiscord;

// Jira icon
export const JiraIcon = SiJira;

// Trello icon
export const TrelloIcon = SiTrello;

// Telegram icon
export const TelegramIcon = SiTelegram;

// LinkedIn icon
export const LinkedInIcon = FaLinkedin;

// ── Tool name → icon component mapping ────────────────────────────────────────
export const ToolIconMap: Record<string, React.FC> = {
  // AI Thinking
  thinking: GeminiIcon,

  // Drive / Docs
  create_document: GoogleDocsIcon,
  create_folder: GoogleDriveIcon,
  share_file: GoogleDriveIcon,
  get_file_info: GoogleDriveIcon,

  // Gmail
  send_email: GmailIcon,
  list_emails: GmailIcon,
  get_email: GmailIcon,
  delete_email: GmailIcon,
  modify_labels: GmailIcon,
  create_draft: GmailIcon,
  get_drafts: GmailIcon,
  send_draft: GmailIcon,
  delete_draft: GmailIcon,

  // Calendar
  create_calendar_event: GoogleCalendarIcon,
  list_events: GoogleCalendarIcon,
  check_availability: GoogleCalendarIcon,
  delete_event: GoogleCalendarIcon,
  suggest_times: GoogleCalendarIcon,

  // Sheets
  create_spreadsheet: GoogleSheetsIcon,
  get_sheet_data: GoogleSheetsIcon,
  write_sheet_data: GoogleSheetsIcon,
  append_rows: GoogleSheetsIcon,

  // Forms
  create_form: GoogleFormsIcon,
  get_form_responses: GoogleFormsIcon,

  // Slides
  create_presentation: GoogleSlidesIcon,
  get_presentation: GoogleSlidesIcon,

  // Search
  web_search: SearchIcon,

  // Image generation
  generate_image: ImagenIcon,

  // Web fetch
  fetch_webpage: FetchWebIcon,

  // GitHub
  github_get_repo_context: GitHubIcon,
  github_create_issue: GitHubIcon,
  github_search_issues: GitHubIcon,
  github_get_file: GitHubIcon,

  // Jira
  jira_get_issue: JiraIcon,
  jira_create_ticket: JiraIcon,
  jira_search: JiraIcon,
  jira_add_comment: JiraIcon,

  // Trello
  trello_get_boards: TrelloIcon,
  trello_create_card: TrelloIcon,
  trello_move_card: TrelloIcon,

  // Slack
  slack_send_message: SlackIcon,
  slack_get_history: SlackIcon,
  slack_add_reaction: SlackIcon,

  // Discord
  discord_send_message: DiscordIcon,
  discord_get_history: DiscordIcon,

  // Telegram
  telegram_send_message: TelegramIcon,
  telegram_get_history: TelegramIcon,

  // LinkedIn
  post_to_linkedin: LinkedInIcon,
  get_linkedin_profile: LinkedInIcon,

  // Fallback
  fallback: Zap,
};

export function getToolIcon(toolName: string): React.FC {
  return ToolIconMap[toolName] ?? ToolIconMap.fallback;
}

// ── Brand background + border classes ─────────────────────────────────────────
export const ToolBgMap: Record<string, string> = {
  create_document: 'bg-blue-500/15 border-blue-500/30',
  get_file_info: 'bg-blue-500/15 border-blue-500/30',
  create_folder: 'bg-teal-500/15 border-teal-500/30',
  share_file: 'bg-teal-500/15 border-teal-500/30',

  send_email: 'bg-red-500/15 border-red-500/30',
  list_emails: 'bg-red-500/15 border-red-500/30',
  get_email: 'bg-red-500/15 border-red-500/30',
  delete_email: 'bg-red-500/15 border-red-500/30',
  modify_labels: 'bg-red-500/15 border-red-500/30',
  create_draft: 'bg-red-500/15 border-red-500/30',
  get_drafts: 'bg-red-500/15 border-red-500/30',
  send_draft: 'bg-red-500/15 border-red-500/30',
  delete_draft: 'bg-red-500/15 border-red-500/30',

  create_calendar_event: 'bg-indigo-500/15 border-indigo-500/30',
  list_events: 'bg-indigo-500/15 border-indigo-500/30',
  check_availability: 'bg-indigo-500/15 border-indigo-500/30',
  delete_event: 'bg-indigo-500/15 border-indigo-500/30',
  suggest_times: 'bg-indigo-500/15 border-indigo-500/30',

  create_spreadsheet: 'bg-green-500/15 border-green-500/30',
  get_sheet_data: 'bg-green-500/15 border-green-500/30',
  write_sheet_data: 'bg-green-500/15 border-green-500/30',
  append_rows: 'bg-green-500/15 border-green-500/30',

  create_form: 'bg-purple-500/15 border-purple-500/30',
  get_form_responses: 'bg-purple-500/15 border-purple-500/30',

  create_presentation: 'bg-amber-500/15 border-amber-500/30',
  get_presentation: 'bg-amber-500/15 border-amber-500/30',

  web_search: 'bg-blue-400/15 border-blue-400/30',

  generate_image: 'bg-purple-500/15 border-purple-500/30',
  fetch_webpage: 'bg-slate-500/15 border-slate-500/30',

  // GitHub - dark gray
  github_get_repo_context: 'bg-slate-500/15 border-slate-500/30',
  github_create_issue: 'bg-slate-500/15 border-slate-500/30',
  github_search_issues: 'bg-slate-500/15 border-slate-500/30',
  github_get_file: 'bg-slate-500/15 border-slate-500/30',

  // Jira - blue-600
  jira_get_issue: 'bg-blue-600/15 border-blue-600/30',
  jira_create_ticket: 'bg-blue-600/15 border-blue-600/30',
  jira_search: 'bg-blue-600/15 border-blue-600/30',
  jira_add_comment: 'bg-blue-600/15 border-blue-600/30',

  // Trello - sky-500
  trello_get_boards: 'bg-sky-500/15 border-sky-500/30',
  trello_create_card: 'bg-sky-500/15 border-sky-500/30',
  trello_move_card: 'bg-sky-500/15 border-sky-500/30',

  // Slack - fuchsia-500
  slack_send_message: 'bg-fuchsia-500/15 border-fuchsia-500/30',
  slack_get_history: 'bg-fuchsia-500/15 border-fuchsia-500/30',
  slack_add_reaction: 'bg-fuchsia-500/15 border-fuchsia-500/30',

  // Discord - indigo-500
  discord_send_message: 'bg-indigo-500/15 border-indigo-500/30',
  discord_get_history: 'bg-indigo-500/15 border-indigo-500/30',

  // Telegram - sky-400
  telegram_send_message: 'bg-sky-400/15 border-sky-400/30',
  telegram_get_history: 'bg-sky-400/15 border-sky-400/30',

  // LinkedIn - blue-600
  post_to_linkedin: 'bg-blue-600/15 border-blue-600/30',
  get_linkedin_profile: 'bg-blue-600/15 border-blue-600/30',

  fallback: 'bg-surface border-border',
};

// ── Human-readable action labels ───────────────────────────────────────────────
export const ToolDescriptionMap: Record<string, string> = {
  create_document: 'Writing to Google Docs',
  create_folder: 'Creating Drive folder',
  share_file: 'Sharing file on Drive',
  get_file_info: 'Reading file from Drive',

  send_email: 'Sending Gmail message',
  list_emails: 'Reading Gmail inbox',
  get_email: 'Opening email thread',
  delete_email: 'Deleting email',
  modify_labels: 'Labeling email',
  create_draft: 'Drafting email',
  get_drafts: 'Reading drafts',
  send_draft: 'Sending draft email',
  delete_draft: 'Deleting draft',

  create_calendar_event: 'Scheduling Calendar event',
  list_events: 'Reading Calendar events',
  check_availability: 'Checking availability',
  delete_event: 'Canceling Calendar event',
  suggest_times: 'Finding free time slots',

  create_spreadsheet: 'Building Google Sheet',
  get_sheet_data: 'Reading spreadsheet data',
  write_sheet_data: 'Writing to Google Sheet',
  append_rows: 'Appending rows to Sheet',

  create_form: 'Building Google Form',
  get_form_responses: 'Reading form responses',

  create_presentation: 'Creating Google Slides',
  get_presentation: 'Reading presentation',

  web_search: 'Searching the web',

  generate_image: 'Generating image with Imagen 3',
  fetch_webpage: 'Reading webpage content',

  // GitHub
  github_get_repo_context: 'Reading GitHub repository',
  github_create_issue: 'Creating GitHub issue',
  github_search_issues: 'Searching GitHub issues',
  github_get_file: 'Reading file from GitHub',

  // Jira
  jira_get_issue: 'Fetching Jira issue',
  jira_create_ticket: 'Creating Jira ticket',
  jira_search: 'Searching Jira with JQL',
  jira_add_comment: 'Adding Jira comment',

  // Trello
  trello_get_boards: 'Reading Trello boards',
  trello_create_card: 'Creating Trello card',
  trello_move_card: 'Moving Trello card',

  // Slack
  slack_send_message: 'Sending Slack message',
  slack_get_history: 'Reading Slack channel',
  slack_add_reaction: 'Reacting on Slack',

  // Discord
  discord_send_message: 'Sending Discord message',
  discord_get_history: 'Reading Discord channel',

  // Telegram
  telegram_send_message: 'Sending Telegram message',
  telegram_get_history: 'Reading Telegram history',

  // LinkedIn
  post_to_linkedin: 'Posting to LinkedIn',
  get_linkedin_profile: 'Reading LinkedIn profile',

  fallback: 'Processing task',
};
