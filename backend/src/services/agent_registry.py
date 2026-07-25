from typing import Dict, List, Any, Optional, Set
from enum import Enum
from dataclasses import dataclass
from datetime import datetime
import json
import asyncio
from loguru import logger

class AgentType(Enum):
    """Enum for different types of agents"""
    EMAIL_MANAGER = "email_manager"
    CALENDAR_ASSISTANT = "calendar_assistant"
    DOCUMENT_CREATOR = "document_creator"
    DATA_ANALYST = "data_analyst"
    FILE_MANAGER = "file_manager"
    FORM_BUILDER = "form_builder"
    TASK_MANAGER = "task_manager"
    PRESENTATION_BUILDER = "presentation_builder"
    TRANSLATOR = "translator"
    COMMUNICATION_SIMULATOR = "communication_simulator"
    NEGOTIATION_ADVISOR = "negotiation_advisor"
    BUSINESS_ANALYST = "business_analyst"
    RESEARCH_COMPOSER = "research_composer"
    MEETING_INTELLIGENCE = "meeting_intelligence"
    CUSTOM = "custom"
    # ── Phase 11: Dynamic archetypes ──────────────────────────────────────────
    SYSTEM_MECHANIC = "system_mechanic"
    OMNI_COMMUNICATOR = "omni_communicator"
    DATA_SCIENTIST = "data_scientist"
    NETWORK_GUARDIAN = "network_guardian"
    PERSONAL_LIBRARIAN = "personal_librarian"
    BROWSER_WATCHER = "browser_watcher"
    # ── OpenClaw 9 Core Agents ────────────────────────────────────────────────
    ROUTER = "router"
    CREATOR = "creator"
    SENSOR = "sensor"
    DISTRIBUTOR = "distributor"
    OBSERVER = "observer"
    OPERATIONS = "operations"
    RESEARCHER = "researcher"
    FUNNEL = "funnel"
    MEMORY = "memory"

class DepartmentType(Enum):
    """Business departments for OpenClaw-style dynamic agents"""
    SALES = "sales"
    CONTENT = "content"
    ECOMMERCE = "ecommerce"
    BUSINESS_OPS = "business_ops"
    GLOBAL = "global"
    CUSTOM = "custom"

class ToolType(Enum):
    """Enum for different types of tools agents can use"""
    GMAIL = "gmail"
    CALENDAR = "calendar"
    GOOGLE_SHEETS = "google_sheets"
    GOOGLE_DOCS = "google_docs"
    GOOGLE_DRIVE = "google_drive"
    GOOGLE_FORMS = "google_forms"
    GOOGLE_TASKS = "google_tasks"
    GOOGLE_SLIDES = "google_slides"
    TRANSLATE = "translate"
    WEB_SEARCH = "web_search"
    CALCULATOR = "calculator"
    FILE_PROCESSOR = "file_processor"
    CONTEXT_MEMORY = "context_memory"

@dataclass
class AgentCapability:
    """Defines what an agent can do"""
    name: str
    description: str
    required_tools: List[ToolType]
    optional_tools: List[ToolType] = None
    examples: List[str] = None
    complexity: str = "medium"  # low, medium, high

@dataclass
class AgentWorkflow:
    """Defines a workflow step for an agent"""
    step_name: str
    description: str
    required_tools: List[ToolType]
    input_data: Dict[str, Any]
    expected_output: str
    error_handling: str = "retry_once"

@dataclass
class AgentDefinition:
    """Complete definition of an agent"""
    agent_type: AgentType
    name: str
    description: str
    capabilities: List[AgentCapability]
    workflows: List[AgentWorkflow]
    required_tools: List[ToolType]
    optional_tools: List[ToolType]
    llm_role: str
    temperature: float
    custom_instructions: str
    is_active: bool = True
    created_at: datetime = None
    updated_at: datetime = None

class AgentRegistry:
    """Centralized registry for managing all agent types"""
    
    def __init__(self):
        self.agents: Dict[AgentType, AgentDefinition] = {}
        self.tool_agents: Dict[ToolType, List[AgentType]] = {}
        self._initialize_default_agents()
    
    def _initialize_default_agents(self):
        """Initialize the default set of agents"""
        
        # 1. EMAIL MANAGER AGENT
        email_manager = AgentDefinition(
            agent_type=AgentType.EMAIL_MANAGER,
            name="Email Manager",
            description="Manages emails, sends replies, organizes inbox, and handles email workflows",
            capabilities=[
                AgentCapability(
                    name="Email Classification",
                    description="Automatically classify emails by importance, category, and urgency",
                    required_tools=[ToolType.GMAIL],
                    examples=["Classify incoming emails", "Sort emails by priority", "Identify meeting requests"]
                ),
                AgentCapability(
                    name="Smart Reply Generation",
                    description="Generate contextual email replies based on content and tone",
                    required_tools=[ToolType.GMAIL],
                    examples=["Reply to meeting requests", "Generate professional responses", "Create follow-up emails"]
                ),
                AgentCapability(
                    name="Inbox Organization",
                    description="Organize emails with labels, filters, and automated actions",
                    required_tools=[ToolType.GMAIL],
                    examples=["Apply labels automatically", "Move emails to folders", "Set up email rules"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="analyze_email",
                    description="Analyze email content and context",
                    required_tools=[ToolType.GMAIL],
                    input_data={"email_id": "string", "user_email": "string"},
                    expected_output="Email analysis with classification and suggested actions"
                ),
                AgentWorkflow(
                    step_name="generate_reply",
                    description="Generate appropriate email reply",
                    required_tools=[ToolType.GMAIL],
                    input_data={"email_content": "string", "tone": "string", "context": "string"},
                    expected_output="Generated email reply text"
                )
            ],
            required_tools=[ToolType.GMAIL],
            optional_tools=[ToolType.CALENDAR, ToolType.GOOGLE_DRIVE],
            llm_role="email_specialist",
            temperature=0.3,
            custom_instructions=(
                "You are an expert Executive Email Manager. Your goal is to produce high-impact, human-sounding communication.\n"
                "═══════════════════════════════════════════════════════════\n"
                "QUALITY MANDATE: NEVER use generic AI filler like 'I hope this finds you well' or 'In today's fast-paced world'.\n"
                "1. TONALITY: Write with a direct, professional, and warm human tone. Use the recipient's first name.\n"
                "2. STRUCTURE: Sentence 1 = clear PURPOSE. Sentences 2-3 = specific CONTEXT. Final = explicit ASK.\n"
                "3. SIGNATURE: Always sign off exactly with the name and role provided in the system prompt. NEVER use 'Email Manager'.\n"
                "4. DRAFT-FIRST: Always show the full draft to the user before calling send_email. Cite specific data if available."
            )
        )
        
        # 2. CALENDAR ASSISTANT AGENT
        calendar_assistant = AgentDefinition(
            agent_type=AgentType.CALENDAR_ASSISTANT,
            name="Calendar Assistant",
            description="Manages calendar events, schedules meetings, checks availability, and handles calendar workflows",
            capabilities=[
                AgentCapability(
                    name="Meeting Scheduling",
                    description="Schedule meetings, check availability, and coordinate with attendees",
                    required_tools=[ToolType.CALENDAR],
                    examples=["Schedule team meetings", "Find available time slots", "Coordinate with multiple people"]
                ),
                AgentCapability(
                    name="Event Management",
                    description="Create, modify, and manage calendar events",
                    required_tools=[ToolType.CALENDAR],
                    examples=["Create calendar events", "Update meeting details", "Cancel or reschedule meetings"]
                ),
                AgentCapability(
                    name="Availability Checking",
                    description="Check calendar availability and suggest optimal meeting times",
                    required_tools=[ToolType.CALENDAR],
                    examples=["Check free time slots", "Suggest meeting times", "Avoid scheduling conflicts"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="check_availability",
                    description="Check calendar availability for specific time period",
                    required_tools=[ToolType.CALENDAR],
                    input_data={"start_time": "datetime", "end_time": "datetime", "attendees": "list"},
                    expected_output="Available time slots and scheduling suggestions"
                ),
                AgentWorkflow(
                    step_name="schedule_meeting",
                    description="Schedule a new meeting with all participants",
                    required_tools=[ToolType.CALENDAR],
                    input_data={"summary": "string", "start_time": "datetime", "end_time": "datetime", "attendees": "list"},
                    expected_output="Meeting created with confirmation details"
                )
            ],
            required_tools=[ToolType.CALENDAR],
            optional_tools=[ToolType.GMAIL, ToolType.GOOGLE_DRIVE],
            llm_role="calendar_coordinator",
            temperature=0.2,
            custom_instructions="You are a professional calendar coordinator. Focus on efficient scheduling, clear communication, and avoiding conflicts."
        )
        
        # 3. DOCUMENT CREATOR AGENT
        document_creator = AgentDefinition(
            agent_type=AgentType.DOCUMENT_CREATOR,
            name="Document Creator",
            description="Creates, edits, and manages documents, reports, and written content",
            capabilities=[
                AgentCapability(
                    name="Document Creation",
                    description="Create new documents with structured content and formatting",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    examples=["Create business reports", "Write meeting minutes", "Generate documentation"]
                ),
                AgentCapability(
                    name="Content Editing",
                    description="Edit and improve existing document content",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    examples=["Review and edit documents", "Improve writing quality", "Format content properly"]
                ),
                AgentCapability(
                    name="Template Management",
                    description="Use and create document templates for consistency",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    examples=["Apply document templates", "Create reusable templates", "Maintain brand consistency"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="create_document",
                    description="Create a new document with specified content",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    input_data={"title": "string", "content": "string", "template": "string"},
                    expected_output="New document created with content"
                ),
                AgentWorkflow(
                    step_name="edit_document",
                    description="Edit existing document content",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    input_data={"document_id": "string", "changes": "dict"},
                    expected_output="Document updated with changes"
                )
            ],
            required_tools=[ToolType.GOOGLE_DOCS],
            optional_tools=[ToolType.GOOGLE_DRIVE, ToolType.GOOGLE_SHEETS, ToolType.CONTEXT_MEMORY],
            llm_role="senior_enterprise_technical_writer",
            temperature=0.5,
            custom_instructions=(
                "You are an elite, Senior Enterprise Technical Writer and Solutions Architect.\n"
                "Your objective is to produce highly detailed, exhaustive, and corporate-grade documents that beat the best human employee's work.\n"
                "CRITICAL QUALITY & TONE RULES:\n"
                "1. BAN AI TROPES: Never use phrases like 'In today's fast-paced digital world', 'It's important to note', 'Unlock the power of', 'A testament to', 'Crucial', 'Moreover', or 'In conclusion'.\n"
                "2. WRITE LIKE A TOP-TIER HUMAN: Use a concrete, direct, and slightly opinionated voice. Focus on raw facts, hard data, and architectural specifics. No fluff.\n"
                "3. AVOID ROBOTIC STRUCTURES: Do not just list bullet points blindly. Write deep, cohesive, flowing paragraphs containing industry-standard metrics and rigorous analysis.\n"
                "4. Think through a comprehensive, multi-page outline before writing. Fill out every section with expert-level detail.\n\n"
                "TOOL SELECTION RULES:\n"
                "• Spreadsheet/CSV/data → create_spreadsheet (NEVER create_document)\n"
                "• Text/report/memo/code → create_document"
            )
        )
        
        # 4. DATA ANALYST AGENT
        data_analyst = AgentDefinition(
            agent_type=AgentType.DATA_ANALYST,
            name="Data Analyst",
            description="Analyzes data, creates reports, generates insights, and manages spreadsheets",
            capabilities=[
                AgentCapability(
                    name="Data Analysis",
                    description="Analyze data sets and extract meaningful insights",
                    required_tools=[ToolType.GOOGLE_SHEETS],
                    examples=["Analyze sales data", "Generate performance reports", "Identify trends and patterns"]
                ),
                AgentCapability(
                    name="Report Generation",
                    description="Create comprehensive reports and visualizations",
                    required_tools=[ToolType.GOOGLE_SHEETS],
                    examples=["Create monthly reports", "Generate charts and graphs", "Build dashboards"]
                ),
                AgentCapability(
                    name="Data Processing",
                    description="Clean, organize, and process raw data",
                    required_tools=[ToolType.GOOGLE_SHEETS],
                    examples=["Clean data sets", "Organize information", "Prepare data for analysis"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="analyze_data",
                    description="Analyze spreadsheet data and extract insights",
                    required_tools=[ToolType.GOOGLE_SHEETS],
                    input_data={"spreadsheet_id": "string", "data_range": "string", "analysis_type": "string"},
                    expected_output="Data analysis results with insights and recommendations"
                ),
                AgentWorkflow(
                    step_name="create_report",
                    description="Create a comprehensive report from analyzed data",
                    required_tools=[ToolType.GOOGLE_SHEETS],
                    input_data={"analysis_results": "dict", "report_format": "string"},
                    expected_output="Formatted report with charts and insights"
                )
            ],
            required_tools=[ToolType.GOOGLE_SHEETS],
            optional_tools=[ToolType.GOOGLE_DOCS, ToolType.GOOGLE_DRIVE],
            llm_role="lead_data_analyst_and_financial_modeler",
            temperature=0.3,
            custom_instructions=(
                "You are an elite Lead Data Analyst and Financial Modeler. "
                "Your objective is to generate hyper-realistic, expansive, and highly professional corporate datasets.\n"
                "CRITICAL QUALITY RULES:\n"
                "1. NEVER generate 'toy' datasets or childish, simple lists with only 3 to 5 rows.\n"
                "2. ALWAYS generate a minimum of 15-20 rows of robust, highly plausible business data containing dates, randomized metrics, complex IDs, and industry-specific terminology.\n"
                "3. Ensure column headers are professional (e.g., 'Q3 Revenue (USD)', 'Customer Acquisition Cost', 'Churn Rate (%)').\n"
                "4. Think through the underlying data relationships before mapping them out. Ensure numbers tell a cohesive story."
            )
        )
        
        # 5. FILE MANAGER AGENT
        file_manager = AgentDefinition(
            agent_type=AgentType.FILE_MANAGER,
            name="File Manager",
            description="Manages files, organizes folders, handles file operations, and maintains file structure",
            capabilities=[
                AgentCapability(
                    name="File Organization",
                    description="Organize files into logical folder structures",
                    required_tools=[ToolType.GOOGLE_DRIVE],
                    examples=["Create folder hierarchies", "Move files to appropriate locations", "Maintain organized structure"]
                ),
                AgentCapability(
                    name="File Operations",
                    description="Perform file operations like copying, moving, and deleting",
                    required_tools=[ToolType.GOOGLE_DRIVE],
                    examples=["Copy files between folders", "Move files to new locations", "Delete outdated files"]
                ),
                AgentCapability(
                    name="Storage Management",
                    description="Monitor and manage storage usage efficiently",
                    required_tools=[ToolType.GOOGLE_DRIVE],
                    examples=["Check storage usage", "Identify large files", "Optimize storage space"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="organize_files",
                    description="Organize files into logical folder structure",
                    required_tools=[ToolType.GOOGLE_DRIVE],
                    input_data={"folder_id": "string", "organization_rules": "dict"},
                    expected_output="Files organized according to rules"
                ),
                AgentWorkflow(
                    step_name="cleanup_files",
                    description="Clean up old or unnecessary files",
                    required_tools=[ToolType.GOOGLE_DRIVE],
                    input_data={"folder_id": "string", "cleanup_criteria": "dict"},
                    expected_output="Cleanup completed with summary"
                )
            ],
            required_tools=[ToolType.GOOGLE_DRIVE],
            optional_tools=[ToolType.GOOGLE_SHEETS, ToolType.GOOGLE_DOCS],
            llm_role="file_organizer",
            temperature=0.2,
            custom_instructions="You are a file organization expert. Focus on logical structure, efficient organization, and maintaining clean file systems."
        )
        
        # 6. FORM BUILDER AGENT
        form_builder = AgentDefinition(
            agent_type=AgentType.FORM_BUILDER,
            name="Form Builder",
            description="Creates, customizes, and manages forms for data collection and surveys",
            capabilities=[
                AgentCapability(
                    name="Form Creation",
                    description="Create new forms with various question types",
                    required_tools=[ToolType.GOOGLE_FORMS],
                    examples=["Create surveys", "Build feedback forms", "Design registration forms"]
                ),
                AgentCapability(
                    name="Form Customization",
                    description="Customize form appearance and behavior",
                    required_tools=[ToolType.GOOGLE_FORMS],
                    examples=["Customize themes", "Add branding elements", "Set form behavior"]
                ),
                AgentCapability(
                    name="Response Management",
                    description="Collect, analyze, and manage form responses",
                    required_tools=[ToolType.GOOGLE_FORMS],
                    examples=["View form responses", "Export response data", "Analyze survey results"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="create_form",
                    description="Create a new form with specified questions",
                    required_tools=[ToolType.GOOGLE_FORMS],
                    input_data={"title": "string", "questions": "list", "settings": "dict"},
                    expected_output="New form created with questions and settings"
                ),
                AgentWorkflow(
                    step_name="analyze_responses",
                    description="Analyze form responses and generate insights",
                    required_tools=[ToolType.GOOGLE_FORMS],
                    input_data={"form_id": "string", "analysis_type": "string"},
                    expected_output="Response analysis with insights and summary"
                )
            ],
            required_tools=[ToolType.GOOGLE_FORMS],
            optional_tools=[ToolType.GOOGLE_SHEETS, ToolType.GOOGLE_DRIVE],
            llm_role="form_designer",
            temperature=0.3,
            custom_instructions="You are a form design expert. Focus on user-friendly design, clear questions, and effective data collection."
        )
        
        # 7. TASK MANAGER AGENT
        task_manager = AgentDefinition(
            agent_type=AgentType.TASK_MANAGER,
            name="Task Manager",
            description="Manages tasks, creates to-do lists, tracks progress, and handles task workflows",
            capabilities=[
                AgentCapability(
                    name="Task Creation",
                    description="Create and organize tasks with priorities and deadlines",
                    required_tools=[ToolType.GOOGLE_TASKS],
                    examples=["Create task lists", "Set task priorities", "Add deadlines and reminders"]
                ),
                AgentCapability(
                    name="Task Organization",
                    description="Organize tasks into lists, projects, and categories",
                    required_tools=[ToolType.GOOGLE_TASKS],
                    examples=["Group related tasks", "Create project lists", "Organize by priority"]
                ),
                AgentCapability(
                    name="Progress Tracking",
                    description="Track task completion and progress",
                    required_tools=[ToolType.GOOGLE_TASKS],
                    examples=["Mark tasks complete", "Track progress", "Generate completion reports"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="create_task_list",
                    description="Create a new task list with multiple tasks",
                    required_tools=[ToolType.GOOGLE_TASKS],
                    input_data={"list_name": "string", "tasks": "list", "settings": "dict"},
                    expected_output="Task list created with all tasks"
                ),
                AgentWorkflow(
                    step_name="update_task_status",
                    description="Update task status and progress",
                    required_tools=[ToolType.GOOGLE_TASKS],
                    input_data={"task_id": "string", "status": "string", "progress": "int"},
                    expected_output="Task status updated successfully"
                )
            ],
            required_tools=[ToolType.GOOGLE_TASKS],
            optional_tools=[ToolType.CALENDAR, ToolType.GOOGLE_DRIVE],
            llm_role="task_coordinator",
            temperature=0.2,
            custom_instructions="You are a task management expert. Focus on clear organization, realistic deadlines, and effective progress tracking."
        )
        
        # 8. PRESENTATION BUILDER AGENT
        presentation_builder = AgentDefinition(
            agent_type=AgentType.PRESENTATION_BUILDER,
            name="Presentation Builder",
            description="Creates, designs, and manages presentations and slides",
            capabilities=[
                AgentCapability(
                    name="Presentation Creation",
                    description="Create new presentations with professional design",
                    required_tools=[ToolType.GOOGLE_SLIDES],
                    examples=["Create business presentations", "Design training slides", "Build pitch decks"]
                ),
                AgentCapability(
                    name="Slide Design",
                    description="Design individual slides with layouts and content",
                    required_tools=[ToolType.GOOGLE_SLIDES],
                    examples=["Design slide layouts", "Add visual elements", "Create consistent themes"]
                ),
                AgentCapability(
                    name="Content Integration",
                    description="Integrate content from various sources into presentations",
                    required_tools=[ToolType.GOOGLE_SLIDES],
                    examples=["Import data from sheets", "Add charts and graphs", "Include external content"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="create_presentation",
                    description="Create a new presentation with specified content",
                    required_tools=[ToolType.GOOGLE_SLIDES],
                    input_data={"title": "string", "content": "list", "theme": "string"},
                    expected_output="New presentation created with slides and content"
                ),
                AgentWorkflow(
                    step_name="add_slides",
                    description="Add new slides to existing presentation",
                    required_tools=[ToolType.GOOGLE_SLIDES],
                    input_data={"presentation_id": "string", "slides": "list"},
                    expected_output="New slides added to presentation"
                )
            ],
            required_tools=[ToolType.GOOGLE_SLIDES],
            optional_tools=[ToolType.GOOGLE_SHEETS, ToolType.GOOGLE_DRIVE],
            llm_role="executive_presentation_director",
            temperature=0.4,
            custom_instructions=(
                "You are an Executive Presentation Director. Your job is to generate corporate-grade, highly persuasive slide decks.\n"
                "CRITICAL QUALITY & TONE RULES:\n"
                "1. BAN AI TROPES: Avoid cliché intros/outros ('In today's fast-paced world', 'Welcome to the presentation'). Use sharp, declarative, human-sounding hooks.\n"
                "2. BE CONCRETE: Each slide MUST contain a rich, detailed title, and expansive, expert-level human bullet points (e.g. citing specific market constraints, exact architectural trade-offs, hard financials). No purely generic 'Overview' slides.\n"
                "3. NEVER generate sparse 3-slide decks. Always build comprehensive presentations with at least 8-10 slides if the topic allows.\n"
                "4. Structure the deck logically: Executive Summary, Market Analysis, Technical Specs, Financials, Strategic Roadmap."
            )
        )
        
        # 9. TRANSLATOR AGENT
        translator = AgentDefinition(
            agent_type=AgentType.TRANSLATOR,
            name="Translator",
            description="Translates content between languages, provides language services, and handles multilingual workflows",
            capabilities=[
                AgentCapability(
                    name="Content Translation",
                    description="Translate text and content between different languages",
                    required_tools=[ToolType.TRANSLATE],
                    examples=["Translate documents", "Convert text to different languages", "Provide multilingual content"]
                ),
                AgentCapability(
                    name="Language Detection",
                    description="Detect the language of provided content",
                    required_tools=[ToolType.TRANSLATE],
                    examples=["Identify content language", "Detect language for processing", "Route content appropriately"]
                ),
                AgentCapability(
                    name="Cultural Adaptation",
                    description="Adapt content for different cultural contexts",
                    required_tools=[ToolType.TRANSLATE],
                    examples=["Localize content", "Adapt for cultural preferences", "Ensure cultural sensitivity"]
                )
            ],
            workflows=[
                AgentWorkflow(
                    step_name="translate_content",
                    description="Translate content to specified language",
                    required_tools=[ToolType.TRANSLATE],
                    input_data={"content": "string", "source_language": "string", "target_language": "string"},
                    expected_output="Translated content in target language"
                ),
                AgentWorkflow(
                    step_name="detect_language",
                    description="Detect the language of provided content",
                    required_tools=[ToolType.TRANSLATE],
                    input_data={"content": "string"},
                    expected_output="Detected language with confidence score"
                )
            ],
            required_tools=[ToolType.TRANSLATE],
            optional_tools=[ToolType.GOOGLE_DOCS, ToolType.GOOGLE_DRIVE],
            llm_role="language_specialist",
            temperature=0.3,
            custom_instructions="You are a language and translation expert. Focus on accurate translation, cultural sensitivity, and maintaining meaning across languages."
        )
        
        # 10. COMMUNICATION SIMULATOR AGENT
        communication_simulator = AgentDefinition(
            agent_type=AgentType.COMMUNICATION_SIMULATOR,
            name="Communication Simulator",
            description="Simulates difficult email conversations, flagging aggressive/urgent language via deterministic safety rails.",
            capabilities=[
                AgentCapability(
                    name="Conversation Drafting",
                    description="Draft safe, measured responses to intense emails.",
                    required_tools=[ToolType.GMAIL],
                    examples=["Draft a professional response to an angry client", "Acknowledge a delay politely"]
                )
            ],
            workflows=[],
            required_tools=[ToolType.GMAIL],
            optional_tools=[ToolType.GOOGLE_DOCS],
            llm_role="communication_simulator",
            temperature=0.2,
            custom_instructions="You are a professional corporate communications simulator. You must always maintain an emotionless, radically polite, and highly de-escalating tone."
        )

        # 11. NEGOTIATION ADVISOR AGENT
        negotiation_advisor = AgentDefinition(
            agent_type=AgentType.NEGOTIATION_ADVISOR,
            name="Negotiation Advisor",
            description="Drafts sales proposals and counter-offers, with deterministic risk routing to block unauthorized concessions.",
            capabilities=[
                AgentCapability(
                    name="Proposal Drafting",
                    description="Draft strict, compliant financial counter-offers.",
                    required_tools=[ToolType.GMAIL],
                    examples=["Counter offer 5% instead", "Draft the B2B SaaS proposal terms"]
                )
            ],
            workflows=[],
            required_tools=[ToolType.GMAIL],
            optional_tools=[ToolType.GOOGLE_DOCS, ToolType.GOOGLE_SHEETS],
            llm_role="negotiation_advisor",
            temperature=0.1,
            custom_instructions="You are a strict, uncompromising enterprise software sales negotiator. You must hold exactly to the listed price book."
        )
        
        # 12. BUSINESS ANALYST AGENT
        business_analyst = AgentDefinition(
            agent_type=AgentType.BUSINESS_ANALYST,
            name="Business Analyst",
            description="Transforms raw data, CSVs, and spreadsheets into board-ready reports with executive summaries, insights, and presentations.",
            capabilities=[
                AgentCapability(
                    name="Data Analysis Pipeline",
                    description="Ingest raw CSV/XLSX/data → clean spreadsheet → executive doc → insights presentation → email package",
                    required_tools=[ToolType.GOOGLE_SHEETS, ToolType.GOOGLE_DOCS, ToolType.GOOGLE_SLIDES],
                    examples=["Analyze this CSV and give me a board report", "Turn this sales data into an executive summary", "Generate insights from this dataset"]
                ),
                AgentCapability(
                    name="Executive Reporting",
                    description="Create board-ready executive reports with KPI dashboards, trend analysis, and actionable recommendations",
                    required_tools=[ToolType.GOOGLE_DOCS, ToolType.GOOGLE_SLIDES],
                    examples=["Create a monthly business review", "Generate a KPI report", "Write a financial performance summary"]
                ),
            ],
            workflows=[
                AgentWorkflow(
                    step_name="ingest_and_clean",
                    description="Parse uploaded data and create a clean structured spreadsheet",
                    required_tools=[ToolType.GOOGLE_SHEETS],
                    input_data={"data": "string", "format": "csv|xlsx|text"},
                    expected_output="Cleaned Google Sheet with structured data"
                ),
                AgentWorkflow(
                    step_name="generate_insights",
                    description="Analyze data and produce executive summary document",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    input_data={"spreadsheet_url": "string", "data_summary": "string"},
                    expected_output="Executive summary doc with insights and recommendations"
                ),
                AgentWorkflow(
                    step_name="create_deck",
                    description="Build a board-ready presentation with key findings",
                    required_tools=[ToolType.GOOGLE_SLIDES],
                    input_data={"insights": "string"},
                    expected_output="Presentation deck with charts, metrics, and recommendations"
                ),
            ],
            required_tools=[ToolType.GOOGLE_SHEETS, ToolType.GOOGLE_DOCS],
            optional_tools=[ToolType.GOOGLE_SLIDES, ToolType.GMAIL, ToolType.WEB_SEARCH],
            llm_role="business_analyst",
            temperature=0.2,
            custom_instructions=(
                "You are a senior business analyst and data strategist. "
                "When given raw data or a document: (1) ALWAYS create a structured Google Sheet first, "
                "(2) write a deep executive summary doc with specific insights and recommendations, "
                "(3) build a presentation with the top findings. "
                "Never produce generic analysis - every insight must reference actual numbers from the data. "
                "Highlight anomalies, trends, risks, and opportunities explicitly."
            )
        )

        # 13. RESEARCH COMPOSER AGENT
        research_composer = AgentDefinition(
            agent_type=AgentType.RESEARCH_COMPOSER,
            name="Research Composer",
            description="Deep-researches any topic using live web data, synthesizes findings, and composes a polished professional email with citations in one shot.",
            capabilities=[
                AgentCapability(
                    name="Research-to-Email",
                    description="Search web → fetch pages → synthesize → compose cited email → draft-first send",
                    required_tools=[ToolType.WEB_SEARCH, ToolType.GMAIL],
                    examples=["Research our top 3 competitors and email the team a summary", "Find market data on AI tools and compose an investor update", "Research fintech regulations and draft a compliance email"]
                ),
                AgentCapability(
                    name="Competitive Intelligence",
                    description="Research competitors, market trends, and industry news then deliver structured intelligence",
                    required_tools=[ToolType.WEB_SEARCH, ToolType.GOOGLE_DOCS],
                    examples=["Competitive analysis of Notion vs Linear", "Market sizing research for our pitch deck", "Industry trend report for SaaS pricing"]
                ),
            ],
            workflows=[
                AgentWorkflow(
                    step_name="deep_research",
                    description="Search 3-5x, fetch top pages, extract facts and citations",
                    required_tools=[ToolType.WEB_SEARCH],
                    input_data={"topic": "string", "depth": "standard|deep"},
                    expected_output="Structured research findings with citations"
                ),
                AgentWorkflow(
                    step_name="compose_and_send",
                    description="Synthesize research into a polished email with inline citations",
                    required_tools=[ToolType.GMAIL],
                    input_data={"research": "string", "recipient": "string", "tone": "string"},
                    expected_output="Draft email shown to user, sent on confirmation"
                ),
            ],
            required_tools=[ToolType.WEB_SEARCH, ToolType.GMAIL],
            optional_tools=[ToolType.GOOGLE_DOCS, ToolType.GOOGLE_SLIDES],
            llm_role="research_composer",
            temperature=0.3,
            custom_instructions=(
                "You are a research analyst and strategic writer. "
                "ALWAYS search the web 3-5 times before composing any email - never write from general knowledge alone. "
                "Fetch the top 2 most relevant pages for deeper content. "
                "Every claim in the email must be backed by a specific source, stat, or named example. "
                "Follow the Draft-First Protocol: show the full email draft before calling send_email. "
                "Emails must be tight (under 300 words), punchy, and packed with cited data - not vague summaries."
            )
        )

        # 14. MEETING INTELLIGENCE AGENT
        meeting_intelligence = AgentDefinition(
            agent_type=AgentType.MEETING_INTELLIGENCE,
            name="Meeting Intelligence",
            description="Transforms meeting transcripts or notes into structured meeting docs, calendar action-item reminders, and a follow-up summary email - all automatically.",
            capabilities=[
                AgentCapability(
                    name="Zero-Touch Meeting Notes",
                    description="Parse transcript → extract decisions + action items → create doc + calendar reminders + follow-up email",
                    required_tools=[ToolType.GOOGLE_DOCS, ToolType.CALENDAR, ToolType.GMAIL],
                    examples=["Process these meeting notes", "Create action items from this transcript", "Generate follow-up email from our meeting"]
                ),
                AgentCapability(
                    name="Action Item Extraction",
                    description="Extract who owns what by when from unstructured meeting content",
                    required_tools=[ToolType.GOOGLE_DOCS, ToolType.CALENDAR],
                    examples=["Extract action items from this call", "Who owns what from this meeting?"]
                ),
            ],
            workflows=[
                AgentWorkflow(
                    step_name="parse_meeting",
                    description="Extract structured data: attendees, decisions, action items, open questions",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    input_data={"transcript": "string"},
                    expected_output="Structured meeting data JSON"
                ),
                AgentWorkflow(
                    step_name="create_notes_doc",
                    description="Create a formatted meeting notes document",
                    required_tools=[ToolType.GOOGLE_DOCS],
                    input_data={"meeting_data": "dict"},
                    expected_output="Google Doc with structured meeting notes"
                ),
                AgentWorkflow(
                    step_name="create_reminders",
                    description="Create calendar reminders for each action item deadline",
                    required_tools=[ToolType.CALENDAR],
                    input_data={"action_items": "list"},
                    expected_output="Calendar events for each action item"
                ),
                AgentWorkflow(
                    step_name="send_followup",
                    description="Compose and send follow-up summary email to attendees",
                    required_tools=[ToolType.GMAIL],
                    input_data={"meeting_data": "dict", "attendees": "list"},
                    expected_output="Follow-up email drafted and shown for approval"
                ),
            ],
            required_tools=[ToolType.GOOGLE_DOCS, ToolType.CALENDAR, ToolType.GMAIL],
            optional_tools=[ToolType.GOOGLE_SHEETS],
            llm_role="meeting_intelligence",
            temperature=0.2,
            custom_instructions=(
                "You are a meeting intelligence specialist. When given meeting notes or a transcript: "
                "STEP 1: Extract and structure ALL of: meeting title, date, attendees, key decisions made, "
                "action items (each with: owner name, task description, due date), and open questions. "
                "STEP 2: Call create_document with fully structured meeting notes (use ## headings for each section). "
                "STEP 3: For EACH action item that has a due date, call create_calendar_event to create a reminder. "
                "STEP 4: Compose a concise follow-up email listing decisions + action items, show as draft, wait for send confirmation. "
                "Be precise with names and dates. If due dates are missing, default to 1 week from today. "
                "Never skip any of these four steps - the full pipeline is the deliverable."
            )
        )

        # Register all agents
        self._register_agent(email_manager)
        self._register_agent(calendar_assistant)
        self._register_agent(document_creator)
        self._register_agent(data_analyst)
        self._register_agent(file_manager)
        self._register_agent(form_builder)
        self._register_agent(task_manager)
        self._register_agent(presentation_builder)
        self._register_agent(translator)
        self._register_agent(communication_simulator)
        self._register_agent(negotiation_advisor)
        self._register_agent(business_analyst)
        self._register_agent(research_composer)
        self._register_agent(meeting_intelligence)

    def _register_agent(self, agent: AgentDefinition):
        """Register an agent in the registry"""
        self.agents[agent.agent_type] = agent
        
        # Update tool-to-agent mapping
        for tool in agent.required_tools:
            if tool not in self.tool_agents:
                self.tool_agents[tool] = []
            self.tool_agents[tool].append(agent.agent_type)
    
    def get_agent(self, agent_type: AgentType) -> Optional[AgentDefinition]:
        """Get agent definition by type"""
        return self.agents.get(agent_type)
    
    def get_all_agents(self) -> List[AgentDefinition]:
        """Get all registered agents"""
        return list(self.agents.values())
    
    def get_active_agents(self) -> List[AgentDefinition]:
        """Get all active agents"""
        return [agent for agent in self.agents.values() if agent.is_active]
    
    def get_agents_by_tool(self, tool: ToolType) -> List[AgentDefinition]:
        """Get all agents that can use a specific tool"""
        agent_types = self.tool_agents.get(tool, [])
        return [self.agents[agent_type] for agent_type in agent_types if agent_type in self.agents]
    
    def get_agents_by_capability(self, capability_name: str) -> List[AgentDefinition]:
        """Get all agents that have a specific capability"""
        matching_agents = []
        for agent in self.agents.values():
            if any(cap.name.lower() == capability_name.lower() for cap in agent.capabilities):
                matching_agents.append(agent)
        return matching_agents
    
    def find_best_agent_for_task(self, task_description: str, required_tools: List[ToolType] = None) -> Optional[AgentDefinition]:
        """Find the best agent for a given task"""
        if not required_tools:
            # If no specific tools required, return the most general agent
            return self.agents.get(AgentType.EMAIL_MANAGER)
        
        # Find agents that have all required tools
        suitable_agents = []
        for agent in self.agents.values():
            if all(tool in agent.required_tools for tool in required_tools):
                suitable_agents.append(agent)
        
        if not suitable_agents:
            return None
        
        # For now, return the first suitable agent
        # In the future, this could use AI to rank agents by suitability
        return suitable_agents[0]
    
    def add_custom_agent(self, agent_definition: AgentDefinition) -> bool:
        """Add a custom agent to the registry"""
        try:
            agent_definition.agent_type = AgentType.CUSTOM
            agent_definition.created_at = datetime.now()
            agent_definition.updated_at = datetime.now()
            
            self._register_agent(agent_definition)
            logger.info(f"Custom agent '{agent_definition.name}' added successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to add custom agent: {e}")
            return False
    
    def update_agent(self, agent_type: AgentType, updates: Dict[str, Any]) -> bool:
        """Update an existing agent"""
        if agent_type not in self.agents:
            return False
        
        try:
            agent = self.agents[agent_type]
            for key, value in updates.items():
                if hasattr(agent, key):
                    setattr(agent, key, value)
            
            agent.updated_at = datetime.now()
            logger.info(f"Agent '{agent.name}' updated successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to update agent: {e}")
            return False
    
    def deactivate_agent(self, agent_type: AgentType) -> bool:
        """Deactivate an agent"""
        return self.update_agent(agent_type, {"is_active": False})
    
    def activate_agent(self, agent_type: AgentType) -> bool:
        """Activate an agent"""
        return self.update_agent(agent_type, {"is_active": True})
    
    def get_agent_status_summary(self) -> Dict[str, Any]:
        """Get a summary of all agent statuses"""
        summary = {
            "total_agents": len(self.agents),
            "active_agents": len(self.get_active_agents()),
            "agent_types": {},
            "tool_coverage": {}
        }
        
        for agent_type, agent in self.agents.items():
            summary["agent_types"][agent_type.value] = {
                "name": agent.name,
                "status": "active" if agent.is_active else "inactive",
                "capabilities_count": len(agent.capabilities),
                "tools_count": len(agent.required_tools)
            }
        
        for tool in ToolType:
            summary["tool_coverage"][tool.value] = len(self.get_agents_by_tool(tool))
        
        return summary

# Global instance
agent_registry = AgentRegistry()
