import React, { ReactNode } from "react";
import { Mail, Search, NotebookText, Calendar, Table2, Newspaper, Sparkles, Zap, Brain, MessageSquare } from "lucide-react";

export interface SuggestedPrompt {
  title: string;
  desc: string;
  prompt: string;
  icon: ReactNode;
}

export interface DynamicContent {
  greeting: string;
  dayGreeting: string;
  subtitle: string;
  prompts: SuggestedPrompt[];
}

const PROMPT_POOL: SuggestedPrompt[] = [
  // Outreach Intelligence
  {
    title: "Find Leads",
    desc: "Discover new prospects",
    prompt: "Find me high-growth SaaS companies in San Francisco that recently raised Series B funding.",
    icon: <Search className="w-4 h-4" />
  },
  {
    title: "Draft Outreach",
    desc: "Personalized email draft",
    prompt: "Draft a personalized LinkedIn outreach message for a CTO of a Fintech company about our AI automation tools.",
    icon: <Mail className="w-4 h-4" />
  },
  {
    title: "Campaign Ideas",
    desc: "Brainstorm outreach angles",
    prompt: "Give me 5 creative subject lines for a cold outreach campaign targeting marketing managers.",
    icon: <Zap className="w-4 h-4" />
  },
  
  // AI Journalist
  {
    title: "Write Article",
    desc: "Long-form research content",
    prompt: "Research the current state of Generative AI in healthcare and write a 1000-word deep-dive article.",
    icon: <Newspaper className="w-4 h-4" />
  },
  {
    title: "SEO Audit",
    desc: "Optimize your content",
    prompt: "Perform an SEO audit on the latest trends in sustainable energy and suggest keywords for a blog post.",
    icon: <Sparkles className="w-4 h-4" />
  },
  {
    title: "News Summary",
    desc: "Daily industry briefing",
    prompt: "Summarize the top 3 tech news stories from this morning regarding cloud computing.",
    icon: <NotebookText className="w-4 h-4" />
  },

  // CSV Cleaner / Data
  {
    title: "Clean Data",
    desc: "Fix messy spreadsheets",
    prompt: "Help me clean a CSV file with inconsistent date formats and duplicate email addresses.",
    icon: <Table2 className="w-4 h-4" />
  },
  {
    title: "Format List",
    desc: "Standardize your lead lists",
    prompt: "Standardize this list of company names to their official legal names and add their LinkedIn domains.",
    icon: <Brain className="w-4 h-4" />
  },

  // Productivity / Workspace
  {
    title: "Summarize Inbox",
    desc: "Get caught up quickly",
    prompt: "Summarize my most important emails from the last 24 hours and highlight any action items.",
    icon: <MessageSquare className="w-4 h-4" />
  },
  {
    title: "Schedule Sync",
    desc: "Quick calendar management",
    prompt: "Find a 30-minute slot for a team sync tomorrow afternoon and draft the invite.",
    icon: <Calendar className="w-4 h-4" />
  },
  {
    title: "Meeting Prep",
    desc: "Get ready for your day",
    prompt: "Prepare a briefing for my 2 PM meeting with the product team based on our last discussion.",
    icon: <NotebookText className="w-4 h-4" />
  },
  {
    title: "Priority Tasks",
    desc: "Identify what's urgent",
    prompt: "What are my top 3 high-priority tasks for today based on my current projects?",
    icon: <Zap className="w-4 h-4" />
  }
];

const GREETINGS = {
  morning: [
    "Rise and shine",
    "Good morning",
    "Start your day strong",
    "Ready for a productive morning?",
    "Morning briefing ready"
  ],
  afternoon: [
    "Good afternoon",
    "Power through the day",
    "Mid-day momentum",
    "Hope your day is going well",
    "Afternoon session active"
  ],
  evening: [
    "Good evening",
    "Wrapping up the day?",
    "Evening focus session",
    "Final stretch for today",
    "Reviewing the day's progress"
  ],
  night: [
    "Working late?",
    "Night owl mode",
    "Quiet hours productivity",
    "Good night",
    "Burning the midnight oil"
  ]
};

const SUBTITLES = [
  "What's on your mind today?",
  "How can I assist your workflow?",
  "Ready to take on the next challenge?",
  "Let's make some progress together.",
  "Your AI command center is ready.",
  "What shall we build today?",
  "Searching for something specific?",
  "Need help with research or outreach?"
];

export function getDynamicContent(userName: string): DynamicContent {
  const now = new Date();
  const hour = now.getHours();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  
  // Seed for randomization that changes hourly but is consistent within the hour
  const seed = dayOfYear + hour;
  
  let greetingPool;
  if (hour >= 5 && hour < 12) greetingPool = GREETINGS.morning;
  else if (hour >= 12 && hour < 17) greetingPool = GREETINGS.afternoon;
  else if (hour >= 17 && hour < 21) greetingPool = GREETINGS.evening;
  else greetingPool = GREETINGS.night;

  const greetingBase = greetingPool[seed % greetingPool.length];
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  const firstName = userName?.split(' ')[0] || 'there';
  
  const greeting = `${greetingBase}, ${firstName}`;
  const subtitle = SUBTITLES[seed % SUBTITLES.length];

  // Pick 4 unique prompts from the pool using the seed
  const prompts: SuggestedPrompt[] = [];
  const tempPool = [...PROMPT_POOL];
  
  for (let i = 0; i < 4; i++) {
    const index = (seed + i * 7) % tempPool.length;
    prompts.push(tempPool.splice(index, 1)[0]);
  }

  const dayGreeting = `Happy ${dayName}, ${firstName}`;

  return { greeting, dayGreeting, subtitle, prompts };
}
