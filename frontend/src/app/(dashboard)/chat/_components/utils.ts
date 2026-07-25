const _QA_FRONT_RE = /^(what[\s'"]|how[\s'"]|why[\s'"]|who[\s'"]|when[\s'"]|where[\s'"]|explain |tell me |describe |define |can you |give me |is there |are there |what's |whats |could you |summarize |compare |difference |pros and cons|advantages|disadvantages|what is |what are |what does |what do |how does |how do |how can |is it |are they |do you |did you |should i |help me understand|list the|list all|show me)/i;
const _TASK_FRONT_RE = /^(create|make|build|generate|send|schedule|write|compose|draft|upload|analyze|search|find|fetch|set up|setup|delete|remove|update|edit|book|translate|organize|organise|push|pull|commit|merge|comment|invite|post|message|sync|export|import|get|move|add|react)/i;
const _PLATFORM_TASK_RE = /\b(github|jira|trello|slack|discord|telegram)\b.*(issue|ticket|card|board|channel|repo|repository|message|history|reaction|comment|bot)/i;
const _EMBEDDED_TASK_FRONT_RE = /\b(create|make|build|generate|send|schedule|write|compose|draft|upload|save|download|analyze|search|find|fetch|set up|setup|delete|remove|update|edit|modify|add|insert|book|organise|organize|hire|invite|register|deploy|run|execute|start|stop|cancel|remind|notify|summarize|translate|convert|export|import|merge|push|pull)\b/i;

export function isTaskRequest(text: string): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || t.endsWith('?')) return false;
  if (_PLATFORM_TASK_RE.test(t)) return true;
  if (_QA_FRONT_RE.test(t)) return false;
  if (_TASK_FRONT_RE.test(t)) return true;
  if (!_EMBEDDED_TASK_FRONT_RE.test(t)) return false;
  return false;
}

export interface AgentSuggestion { name: string; description: string; role: string }

export function detectAgentSuggestion(text: string): AgentSuggestion {
  const t = text.toLowerCase();
  if (/github|repo|repository|branch|commit|pull request|pr|push|merge/.test(t))
    return { name: 'Engineering Lead', description: 'Manages GitHub repositories, issues, and code workflows', role: 'engineering_lead' };
  if (/jira|ticket|issue|sprint|backlog/.test(t))
    return { name: 'Project Manager', description: 'Manages Jira tickets, sprints, and project backlogs', role: 'project_manager' };
  if (/slack|channel|dm|message|slak/.test(t))
    return { name: 'Communications Sync', description: 'Manages Slack messages, channels, and team notifications', role: 'communications_sync' };
  if (/discord|server|thread|community/.test(t))
    return { name: 'Community Manager', description: 'Moderates Discord servers, threads, and community outreach', role: 'community_manager' };
  if (/trello|board|card|kanban|column/.test(t))
    return { name: 'Kanban Assistant', description: 'Organizes Trello boards, cards, and workflow columns', role: 'kanban_assistant' };
  if (/telegram|tlg|tg |bot /i.test(t))
    return { name: 'Telegram Liaison', description: 'Manages incoming messages and outbound alerts via Telegram bots', role: 'telegram_liaison' };
  if (/document|doc|report|memo|write/.test(t))
    return { name: 'Document Creator', description: 'Creates reports, memos, and Google Docs', role: 'document_creator' };
  if (/spreadsheet|sheet|csv|excel|data table/.test(t))
    return { name: 'Data Analyst', description: 'Creates spreadsheets and analyzes data', role: 'data_analyst' };
  if (/presentation|ppt|slides|deck|pitch/.test(t))
    return { name: 'Presentation Builder', description: 'Builds professional slide decks in Google Slides', role: 'presentation_builder' };
  if (/form|survey|questionnaire/.test(t))
    return { name: 'Form Builder', description: 'Creates surveys and Google Forms', role: 'form_builder' };
  if (/image|picture|logo|banner|design|draw/.test(t))
    return { name: 'Image Generator', description: 'Generates images and visual content with AI', role: 'image_generator' };
  if (/email|send mail|reply|inbox|compose/.test(t))
    return { name: 'Email Manager', description: 'Sends and manages emails via Gmail', role: 'email_manager' };
  if (/meeting|schedule|calendar|event|appointment/.test(t))
    return { name: 'Calendar Assistant', description: 'Schedules meetings and manages calendar events', role: 'calendar_assistant' };
  if (/translate|translation|language/.test(t))
    return { name: 'Translator', description: 'Translates content between languages', role: 'translator' };
  if (/drive|file|folder|storage|upload/.test(t))
    return { name: 'File Manager', description: 'Manages Google Drive files and folders', role: 'file_manager' };
  if (/task|todo|checklist|reminder/.test(t))
    return { name: 'Task Manager', description: 'Creates and manages tasks and to-do lists', role: 'task_manager' };
  return { name: 'AI Agent', description: 'Handles this type of task with Google Workspace tools', role: 'custom' };
}
