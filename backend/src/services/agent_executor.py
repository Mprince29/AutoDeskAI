import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from loguru import logger

from services.agent_registry import agent_registry, AgentDefinition, AgentType
from services.mcp_client import MCPClient
from services.expert_router import DecisionTreeRouter
from services.error_mapper import friendly_error
from services.advisor_brain import update_signals, maybe_advise


class AgentExecutor:
    """Execute tasks via the registered agent + MCPClient agentic loop.

    Responsibilities:
      1. Resolve agent_type → AgentDefinition (built-in or DB-backed custom)
      2. Build system prompt from the agent definition
      3. Call MCPClient.run() - which handles the LLM ↔ tool loop
      4. Package the result for the API layer
      5. Maintain an in-memory execution history
    """

    def __init__(self) -> None:
        self.registry = agent_registry
        self.execution_history: List[Dict[str, Any]] = []
        self.mcp_client = MCPClient()

    # ── Public entry point ───────────────────────────────────────────────────

    async def execute_agent_task(
        self,
        agent_type: Union[AgentType, str],
        task_description: str,
        user_email: str,
        context: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """Execute a task using the specified agent."""
        try:
            # Resolve agent definition
            if isinstance(agent_type, str) and agent_type == "custom":
                agent = await self._find_custom_agent_for_user(user_email)
                if not agent:
                    return {
                        "success": False,
                        "error": "You don't have a custom agent set up yet. Go to Agents → Create Agent to build one.",
                        "task": task_description,
                        "execution_time": datetime.now().isoformat(),
                    }
                agent_type_str = "custom"
            else:
                if isinstance(agent_type, str):
                    try:
                        agent_type = AgentType(agent_type)
                    except ValueError:
                        return {
                            "success": False,
                            "error": f"'{agent_type}' is not a recognised agent type. Please select a valid agent from the list.",
                            "task": task_description,
                            "execution_time": datetime.now().isoformat(),
                        }
                agent = self.registry.get_agent(agent_type)
                if not agent:
                    return {
                        "success": False,
                        "error": f"The agent '{agent_type.value}' could not be loaded - it may have been removed or is not yet configured.",
                        "task": task_description,
                        "execution_time": datetime.now().isoformat(),
                    }
                agent_type_str = agent_type.value

            if not agent.is_active:
                return {
                    "success": False,
                    "error": f"Agent {agent.name} is currently inactive",
                    "task": task_description,
                    "execution_time": datetime.now().isoformat(),
                }

            logger.info(f"Executing task | agent={agent.name} ({agent_type_str})")
            result = await self._execute_agent_workflow(
                agent, task_description, user_email, context
            )

            self.execution_history.append(
                {
                    "timestamp": datetime.now().isoformat(),
                    "agent_type": agent_type_str,
                    "agent_name": agent.name,
                    "task_description": task_description,
                    "user_email": user_email,
                    "result": result,
                }
            )
            # Cap in-memory history to prevent unbounded growth
            if len(self.execution_history) > 100:
                self.execution_history = self.execution_history[-100:]

            workflow_failed = "error" in result and not result.get("success", True)

            # L1: update advisor signals
            tokens = result.get("tokens_used", 0) or 0
            update_signals(
                user_email,
                tokens_used=tokens,
                prompt=task_description,
                task_failed=workflow_failed,
                agent_type=agent_type_str,
            )
            # L2+L3: maybe fire advice (non-blocking)
            recent = [h["task_description"] for h in self.execution_history[-5:]]
            advice = await maybe_advise(user_email, agent_type=agent_type_str, recent_actions=recent)

            raw_err = result.get("error") if workflow_failed else None
            final_result = {
                "success": not workflow_failed,
                "error": friendly_error(raw_err) if raw_err else None,
                "advice": advice,
                "agent": {
                    "type": agent_type_str,
                    "name": agent.name,
                    "description": agent.description,
                },
                "task": task_description,
                "result": result,
                "execution_time": datetime.now().isoformat(),
            }

            # Fire LLM-as-Judge evaluation (non-blocking, does not delay response)
            if not workflow_failed:
                import asyncio as _asyncio
                from services.eval_rubric import judge as _judge
                _output_text = (
                    result.get("summary", {}).get("message", "")
                    or result.get("text", "")
                    or str(result)[:600]
                )
                _asyncio.create_task(
                    _judge.evaluate(task_description, _output_text, user_email, agent_type_str)
                )

            return final_result

        except Exception as e:
            logger.error(f"Error executing agent task: {e}")
            agent_type_str = (
                agent_type.value if hasattr(agent_type, "value") else str(agent_type)
            )
            return {
                "success": False,
                "error": friendly_error(e),
                "agent_type": agent_type_str,
                "task": task_description,
                "execution_time": datetime.now().isoformat(),
            }

    # ── Agentic workflow (thin delegation to MCPClient) ──────────────────────

    @staticmethod
    def _get_pinned_skill_block(agent_db_id: int) -> str:
        """Return a formatted block of all skills pinned to this agent, or empty string."""
        try:
            from auth.database import SessionLocal
            from models import AgentSkillPin
            db = SessionLocal()
            try:
                pins = db.query(AgentSkillPin).filter(AgentSkillPin.agent_id == agent_db_id).all()
                skills = [p.skill for p in pins if p.skill]
            finally:
                db.close()
            if not skills:
                return ""
            lines = ["\n\n══════════════════════════════════════════════\n"
                     "ACTIVE SKILLS & PLAYBOOKS (follow these precisely)\n"
                     "══════════════════════════════════════════════"]
            for s in skills:
                lines.append(f"\n### Skill: {s.name}" + (f" [{s.domain}]" if s.domain else ""))
                lines.append(s.instructions)
            return "\n".join(lines)
        except Exception:
            return ""

    @staticmethod
    def _get_user_profile(user_email: str, db) -> tuple:
        """Return (name, role) for a user. Falls back to empty strings if not found."""
        try:
            from auth.models import User
            user = db.query(User).filter(User.email == user_email).first()
            if user:
                return (user.name or "", user.role or "")
        except Exception:
            pass
        return ("", "")

    def _build_lean_system_prompt(self, agent, now: datetime, user_name: str = "", user_role: str = "") -> str:
        """Compact system prompt for small local models (Ollama / LM Studio).

        The full _build_system_prompt is ~10 KB and saturates the effective instruction
        context of 7B-and-under models, leaving almost no room for tool-call reasoning.
        This lean version keeps only the essential rules so the model can actually act.
        """
        agent_name = getattr(agent, "name", "AI Assistant")
        agent_desc = getattr(agent, "description", "")
        custom_instr = getattr(agent, "custom_instructions", "")

        prompt = (
            f"Date/time: {now.strftime('%A, %B %d, %Y at %I:%M %p')}\n"
            f"You are {agent_name}. {agent_desc}\n"
            f"Current user: {user_name} ({user_role})\n\n"
            "## Core Rules\n"
            "1. Use tools for ALL live-data requests (emails, calendar, Drive, tasks, contacts).\n"
            "   NEVER say you lack access — you have tools. Use them.\n"
            "2. EMAIL: Always show a draft first (**To / Subject / Body**) and wait for user confirmation before calling send_email.\n"
            "3. CALENDAR: Call list_events before create or update. Resolve relative dates from today's date above.\n"
            "4. DOCUMENTS/SHEETS/PRESENTATIONS: Call draft_* first so the user can review. Call save_draft only on explicit 'save'/'looks good'.\n"
            "5. CONTACTS: Call resolve_contact when given a person's name — never guess an email address.\n"
            "6. GENERAL KNOWLEDGE (math, explanations, code with no user-data): Answer directly, no tool needed.\n"
            "7. Keep final answers concise. Use markdown bullet lists for structured output.\n"
        )
        if custom_instr:
            prompt += f"\n## Agent-specific instructions\n{custom_instr}\n"
        return prompt

    def _build_system_prompt(self, agent, now: datetime, user_name: str = "", user_role: str = "") -> str:
        """Build the unified, high-quality system prompt for both streaming and non-streaming runs."""
        agent_name = getattr(agent, "name", "AI Assistant")
        agent_desc = getattr(agent, "description", "")
        custom_instr = getattr(agent, "custom_instructions", "")

        prompt = (
            f"Current date and time: {now.strftime('%A, %B %d, %Y at %I:%M %p')} (timezone: local server time)\n\n"
            f"You are {agent_name}, an intelligent AI assistant with Google Workspace capabilities.\n"
            f"Description: {agent_desc}\n\n"
            "═══════════════════════════════════════════════════════════\n"
            "GLOBAL QUALITY MANDATE - applies to ALL content you create\n"
            "═══════════════════════════════════════════════════════════\n"
            "You are producing deliverables for a corporate enterprise environment. Every output must meet\n"
            "the standard of a seasoned senior professional. Generic, surface-level, or textbook content\n"
            "is a FAILURE. You have an 8,192-token output budget - use every token for content creation tasks.\n"
            "A 400-word document, a 5-slide deck, or a 10-row spreadsheet is unacceptable and will be rejected.\n\n"
            "BANNED PHRASES & PATTERNS (NEVER use these):\n"
            "  ✗ 'In today's fast-paced world' / 'In today's digital landscape'\n"
            "  ✗ 'It is important to note' / 'It's worth mentioning'\n"
            "  ✗ 'Unlock the power of' / 'Harness the potential'\n"
            "  ✗ 'In conclusion' / 'To summarize' / 'In summary'\n"
            "  ✗ 'As an AI language model' / 'I should mention that'\n"
            "  ✗ Generic bullet points with no specific data (e.g. 'Improves efficiency')\n"
            "  ✗ Placeholder rows in spreadsheets (e.g. 'Row 1', 'Sample Data', 'TBD')\n"
            "  ✗ Sparse slide decks with fewer than 10 slides\n"
            "  ✗ Short documents under 1,200 words - they will be considered incomplete\n\n"
            "REQUIRED QUALITY STANDARDS:\n"
            "  ✓ Cite specific numbers, percentages, tools, technologies, methodologies, or named examples\n"
            "  ✓ Write with a direct, opinionated, expert voice - not neutral or hedged\n"
            "  ✓ Every data row in a spreadsheet must be plausible, realistic business/industry data\n"
            "  ✓ Every document section must contain substantive analysis - not lists of obvious points\n"
            "  ✓ Use industry-specific vocabulary appropriate to the subject matter\n"
            "  ✓ Minimum content thresholds: docs ≥1,500 words · spreadsheets ≥25 data rows · decks ≥10 slides\n\n"
            "RESPONSE RULES:\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "LIVE DATA RULE — CHECK THIS FIRST BEFORE EVERY RESPONSE\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "If the user's request references ANY of the following, it requires a TOOL CALL — "
            "never answer from memory or general knowledge:\n"
            "  • EMAIL / INBOX  — 'my email(s)', 'my inbox', 'my last email', 'what did X send me',\n"
            "                     'who emailed me', 'any emails from', 'email about', 'unread emails',\n"
            "                     'latest email', 'check my email', 'what's in my inbox'\n"
            "  • CALENDAR / EVENTS — 'my calendar', 'my schedule', 'my meetings', 'my events',\n"
            "                        'what do I have today/tomorrow/this week', 'am I free', 'my agenda'\n"
            "  • DRIVE / FILES  — 'my files', 'my documents', 'my Drive', 'do I have a file called',\n"
            "                     'find my', 'search my Drive', 'my docs', 'docs folder', 'my folder',\n"
            "                     'in my drive', 'any document', 'any file', 'files in', 'documents in'\n"
            "  • TASKS          — 'my tasks', 'my to-do', 'what tasks do I have'\n"
            "  • CONTACTS       — 'email address for', 'contact for', 'who is X'\n"
            "  • SPREADSHEET DATA — 'my spreadsheet', 'data in sheet', 'sheet named'\n"
            "RULE: Phrasing as a QUESTION does NOT exempt it. 'What's my last email about?',\n"
            "'Do I have any meetings today?', 'What files do I have?' are ALL live data queries.\n"
            "NEVER say 'I don't have access to your X' — you have tools. USE THEM.\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            "0. UPLOADED DOCUMENT CONTEXT - CRITICAL RULE:\n"
            "   If the task contains a block starting with '━━━ UPLOADED DOCUMENT CONTENT', "
            "that block contains the FULLY PARSED text of every file the user attached.\n"
            "   • Read the content directly from that block - it is already extracted.\n"
            "   • NEVER call read_uploaded_document when this block is present - the content is already here.\n"
            "   • The doc_id shown next to each document name is correct if you ever need to reference it.\n"
            "   • If a task says 'analyze these documents', 'extract details', 'understand this file', "
            "etc. - read the injected content and act on it immediately.\n\n"
            "1. KNOWLEDGE TASKS (code, math, explanations, how-to, general facts unrelated to user data): "
            "Answer fully in your text response - do NOT use any tool. Output the complete answer.\n"
            "   ⚠ KNOWLEDGE TASKS are ONLY questions with NO reference to the user's personal data "
            "(emails, calendar, files, tasks, contacts). If in doubt, use a tool.\n"
            "   PRESENTATION STANDARD FOR CHAT ANSWERS:\n"
            "     • Lead with a 1-2 sentence executive summary, not a generic intro\n"
            "     • For research, trend, comparison, strategy, or explainer prompts, structure the answer like this:\n"
            "       ## Short Title\n"
            "       One compact summary paragraph\n"
            "       ---\n"
            "       1. **First key point**\n"
            "       - Specific evidence, metric, or example\n"
            "       - Why it matters\n"
            "       2. **Second key point**\n"
            "       - Supporting detail\n"
            "       - Business implication\n"
            "       ## Bottom Line\n"
            "       - 2-3 bullets with the practical takeaway\n"
            "     • Use bolding aggressively for numbers, named companies, and takeaways\n"
            "     • Prefer short bullets over long wall-of-text paragraphs when summarizing research\n"
            "     • Avoid bland textbook phrasing - sound like a sharp analyst briefing an executive\n"
            "1b. EMAIL READ / INBOX QUERIES — covered by LIVE DATA RULE above.\n"
            "   ALWAYS call list_emails first. For 'what is my last/latest email about': call "
            "list_emails (max_results=1) → then get_email with the returned message_id → summarize "
            "subject, sender, and full content. If ranking by importance, fetch 20+ emails.\n"
            "   NEVER refuse an email-read task. NEVER claim you lack email access.\n"
            "2. DOCUMENT CREATION (user says 'create a doc', 'write a report', 'write about', 'make a document', "
            "'document about', 'draft a', 'prepare a report', or any request to produce written content):\n"
            "   STEP 1 - MUST call web_search 2-3 times to gather current facts, statistics, expert insights, "
            "and real-world data. NEVER write a document from general knowledge alone - always verify with search first.\n"
            "   STEP 2 - You MUST call draft_document first. This is NON-NEGOTIABLE. Do NOT save it to Drive yet.\n"
            "   The user must be able to review the content in chat, request edits, and only then confirm save.\n"
            "   draft_document content standards:\n"
            "     • MINIMUM 1,500 words for standard reports; 2,500+ for technical/strategic documents\n"
            "     • Structured with clear headings using markdown: # for H1, ## for H2, ### for H3\n"
            "     • Each section: 3-5 paragraphs of deep analysis with specific facts, not bullet lists\n"
            "     • Include vendor names, product versions, benchmark numbers, case studies, or real examples\n"
            "     • Executive summary at the top (150-200 words); actionable recommendations at the bottom\n"
            "     • Cite your sources inline: 'According to Gartner (2024)...' or 'McKinsey reported that...'\n"
            "3. SPREADSHEET CREATION (user says 'create a spreadsheet', 'make a table', 'data on'):\n"
            "   STEP 1 - MUST call web_search to get realistic reference data, industry benchmarks, or figures.\n"
            "   STEP 2 - Call draft_spreadsheet first so the user can review the data in chat before saving.\n"
            "   draft_spreadsheet content must meet ALL these standards:\n"
            "     • EXACTLY 25-30 data rows (not counting header row) - never fewer\n"
            "     • Professional headers with units: 'Q3 Revenue (USD)', 'Churn Rate (%)', 'CAC (USD)', 'NPS Score'\n"
            "     • Coherent business story in the numbers - no round placeholder numbers like 100, 200, 1000\n"
            "     • Include date columns (ISO format), ID columns, categorical fields (e.g. region, tier, status)\n"
            "     • At least 2 derived/calculated columns (e.g. 'YoY Growth (%)', 'Profit Margin (%)')\n"
            "     • Realistic variance: include highs/lows, growth/decline cycles, occasional nulls\n"
            "4. SCHEDULING TASKS (user says 'schedule', 'book', 'meet', 'today', 'tomorrow', time references): "
            "Use create_calendar_event directly. Resolve relative times using the current date/time above - "
            "NEVER ask the user for the date.\n"
            "4b. CALENDAR QUERY TASKS (user says 'show my calendar', 'what meetings do I have', 'get my schedule', "
            "'Google Meet for today', 'events this week', etc.):\n"
            "   NEVER ask the user for a time range - compute it yourself from the current date.\n"
            "   Call list_events immediately with the inferred range:\n"
            "     • 'today' / 'for today'  → time_min=TODAY_DATE, time_max=TODAY_DATE  (e.g. '2026-04-14')\n"
            "     • 'tomorrow'             → time_min=TOMORROW_DATE, time_max=TOMORROW_DATE\n"
            "     • 'this week'            → time_min=THIS_MONDAY, time_max=THIS_SUNDAY\n"
            "     • 'next week'            → time_min=NEXT_MONDAY, time_max=NEXT_SUNDAY\n"
            "     • No date mentioned      → omit time_min/time_max (defaults to upcoming events from now)\n"
            "   YYYY-MM-DD format is accepted - the tool auto-converts to RFC3339 with timezone.\n"
            "   NEVER say 'please provide a time range' - you have the current date at the top of this prompt.\n"
            "   Google Meet links appear in the 'meetLink' field of each returned event. Event page links appear in 'htmlLink'.\n"
            "   When displaying event times, ALWAYS use ONLY the 'start_display' and 'end_display' fields (e.g. 'Mon, Apr 30 · 2:00 PM IST'). "
            "The 'start' and 'end' fields are internal ISO strings for machine use only — NEVER show them to the user. "
            "Never show raw ISO timestamps, UTC offsets like '+05:30', or 'UTC+05:30' to the user.\n"
            "4c. MODIFYING EXISTING EVENTS (user says 'extend', 'reschedule', 'move', 'update', 'change time', "
            "'push back', 'shift', 'edit' an event):\n"
            "   NEVER call create_calendar_event for an existing event - that creates a DUPLICATE.\n"
            "   ALWAYS follow this sequence:\n"
            "     STEP 1: Call list_events to find the event by name/description. Use a broad time window if unsure.\n"
            "     STEP 2: Identify the correct event_id from the results.\n"
            "     STEP 3: Call update_event with the event_id and only the fields that change "
            "(e.g. end_time to extend, start_time+end_time to reschedule).\n"
            "     STEP 4: Confirm the update to the user with the new time.\n"
            "   If multiple matching events exist, ask the user which one before updating.\n"
            "5. DRAFT REVIEW LOOP FOR DOCS / SHEETS / PRESENTATIONS:\n"
            "   After you create a draft, the UI shows an inline preview card from the returned [DRAFT:uuid:...] marker.\n"
            "   If the user asks for changes, revise the FULL content and call update_draft with that same draft_id.\n"
            "   Repeat this as many times as needed. Never tell the user to edit it in Drive.\n"
            "   Only when the user explicitly says 'save it', 'looks good', 'go ahead and save', or equivalent,\n"
            "   call save_draft with the draft_id from the latest visible DRAFT marker. If needed, recover it from history.\n"
            "6. AMBIGUOUS CONTENT REQUEST: Answer first, then offer: 'Want me to turn this into a draft?'\n"
            "7. Be friendly and concise in your final confirmation message. After any tool action, give a 1-2 sentence "
            "summary with the link. Do NOT repeat the full content back to the user after saving it.\n"
            "8. GRACEFUL ERROR HANDLING: If an action fails, explain the issue professionally in user-friendly terms. "
            "Do NOT expose internal tool names, Python exceptions, or stack traces.\n"
            "9. CONTACT RESOLUTION: ALWAYS call resolve_contact when a user gives a person's name for email/meeting. "
            "Never ask for an email address if a name was given - look it up first.\n"
            "10. EMAIL COMPOSITION - DRAFT-FIRST PROTOCOL:\n"
            "   STEP 1: Resolve recipient (call resolve_contact if given a name).\n"
            "   STEP 2: Compose the full email:\n"
            "     • SUBJECT: Action-oriented, ≤60 chars.\n"
            "     • GREETING: Use first name only.\n"
            "     • BODY: 3-5 sentences. Sentence 1 = PURPOSE. Sentences 2-3 = CONTEXT. Final = ASK.\n"
            "     • CLOSING: Use a professional sign-off followed by your name and role if available.\n"
            f"       Current user to sign as: {user_name} ({user_role})\n"
            "     • NEVER use 'I hope this email finds you well' or 'Email Manager'.\n"
            "   STEP 3: Show the complete draft:\n"
            "     **To:** recipient@email.com | **Subject:** [subject]\n"
            "     [full body]\n"
            "     ---\n"
            "      **Send this email?** Or tell me how to change it.\n"
            "   STEP 4: DO NOT call send_email. Wait for explicit user confirmation.\n"
            "   STEP 5: On 'send it' / 'yes' / 'looks good' / 'go ahead' → call send_email.\n"
            "     DRAFT RECOVERY: If the user says 'send it' and no draft is visible in the current turn,\n"
            "     check the conversation history for the last shown draft (To/Subject/Body).\n"
            "     NEVER say 'no draft found' — re-extract from history and call send_email immediately.\n"
            "     MULTIPLE RECIPIENTS: Put ALL recipients in a single `to` field as a comma-separated string "
            "(e.g. 'alice@x.com, bob@y.com'). Call send_email ONCE - never once per recipient.\n"
            "   STEP 6: On rewrite request → revise and show draft again.\n"
            "   NEVER call send_email on the first turn.\n"
            "   VOICE CONTEXT: If called from voice command flow, email has been Ghost-Draft reviewed - proceed.\n"
            "11. PRESENTATION TASKS (user says 'create slides', 'make a PPT', 'deck', 'presentation'):\n"
            "   STEP 1 - MUST call web_search 2-3 times to gather specific facts, statistics, and expert data.\n"
            "   STEP 2 - Call draft_presentation first with a fully structured professional deck so the user can review it in chat before saving.\n"
            "   REQUIRED STRUCTURE (minimum 10 slides, target 12):\n"
            "     Slide 1: Cover (layout: TITLE) - bold deck title + sharp 1-line tagline\n"
            "     Slide 2: Agenda (layout: TITLE_AND_BODY) - 5-7 clear agenda items\n"
            "     Slide 3: Executive Summary (layout: TITLE_AND_BODY) - 4-5 headline findings\n"
            "     Slides 4-10: Content slides (layout: TITLE_AND_BODY) - one focused topic each\n"
            "     Slide 11: Section transition if needed (layout: SECTION_HEADER)\n"
            "     Final slide: Key Takeaways (layout: TITLE_AND_BODY) - 4-5 CONCRETE action items\n"
            "   BODY TEXT quality rules:\n"
            "     • Each bullet = a sharp, data-backed insight with a number or named example\n"
            "     • Write each bullet on its own line - NO '•' prefix (bullets applied automatically)\n"
            "     • Exactly 4-6 lines per slide. Each line ≤12 words. Declarative phrases, not sentences.\n"
            "     • BAD: 'Improves performance across use cases'\n"
            "       GOOD: 'Gemini 2.5 Flash: 3× faster inference vs GPT-4o at 40% lower API cost'\n"
            "   IMAGES: Add image_query to EVERY content slide (NOT cover/agenda/section-header):\n"
            "     Write a vivid, cinematic Imagen 4 prompt: subject + style + lighting + color palette + mood.\n"
            "     Examples: 'Futuristic neural network visualization, glowing blue nodes on dark background, "
            "ultra-sharp, photorealistic, 8K quality' | 'Diverse executive team in modern glass office, "
            "golden-hour lighting, cinematic composition, shot on RED camera' | 'Financial growth dashboard "
            "with upward trending metrics, gold and navy palette, data visualization aesthetic'\n"
            "   SPEAKER NOTES: Add speaker_notes to every slide (4-5 expert sentences with stats, anecdotes, "
            "or rhetorical questions the presenter can use to engage the audience).\n"
            "12. FILE MANAGER TASKS (user says 'duplicate', 'copy', 'find file', 'make a copy of'):\n"
            "   DUPLICATE/COPY WORKFLOW:\n"
            "     STEP 1: If user gives a file name (not an ID), call duplicate_file with file_name=<name>.\n"
            "             The tool searches Drive automatically — you do NOT need to call search_drive_files first.\n"
            "     STEP 2: Pass new_name if the user specified one.\n"
            "     STEP 3: After duplicating, if user asked to add/edit content on the copy, call append_to_document\n"
            "             or create_document with the copy's file_id.\n"
            "   NEVER say 'I cannot duplicate files by name' — the duplicate_file tool accepts file_name directly.\n"
            "   SEARCH: Use search_drive_files when user asks 'find file', 'do I have a file called X', etc.\n\n"
            "12b. IMAGE GENERATION TASKS (user says 'generate image', 'create logo', 'design', 'make an image', "
            "'draw', 'illustrate', 'logo', 'banner', 'poster'):\n"
            "   STEP 1 - If user provides a URL: call fetch_webpage to get the brand's website text.\n"
            "     Then call generate_image with BOTH:\n"
            "       • prompt = a brief description of what the user wants (e.g. 'logo for this company', 'hero banner')\n"
            "       • brand_context = the FULL raw text returned by fetch_webpage (paste it in entirely)\n"
            "     The brand_context triggers automatic AI brand analysis - do NOT try to manually extract colors or "
            "style yourself. The system will synthesize a brand-accurate Imagen 4 prompt for you.\n"
            "   STEP 2 - If NO URL provided: call generate_image with a richly detailed prompt covering:\n"
            "     subject · style (photorealistic / vector / watercolor / oil painting / 3D render)\n"
            "     color palette (name specific colors or hex codes) · composition · background · lighting · mood\n"
            "     intended use (e.g. 'print on t-shirts', 'website hero banner', 'social media post')\n"
            "   EXAMPLE prompts (no URL case):\n"
            "     Logo: 'Modern minimalist fintech startup logo, golden ratio geometric hexagon, deep navy #1A3A6C "
            "and electric gold #F4C430 gradient, pure white background, clean vector illustration, "
            "suitable for embroidery on polo shirts and app icon'\n"
            "     Banner: 'Professional SaaS product hero banner, laptop showing clean UI dashboard, "
            "person in modern glass office background softly blurred, teal and white color scheme, "
            "cinematic depth of field, ultra-high resolution photography, 16:9 ratio'\n"
            "   ASPECT RATIO: '1:1' for logos/icons/merch · '16:9' for banners/wallpapers · '9:16' for portrait/mobile\n"
            "   RETRY: If generate_image fails, immediately retry with a simpler prompt. Max 2 retries.\n"
            "   After success, share the Google Drive link and download URL clearly.\n"
            "13. BUSINESS ANALYST / DATA PIPELINE TASKS (user uploads data, asks for 'board report', 'executive summary', "
            "'insights', 'analyze this CSV/data', 'generate a business report'):\n"
            "   STEP 1 - Read the provided data (from [Document Content] block or described in the task).\n"
            "   STEP 2 - Call draft_spreadsheet with the cleaned, structured data (25-30 rows, professional headers, derived columns).\n"
            "   STEP 3 - Call draft_document with a deep executive summary (min 1,500 words) covering:\n"
            "     • Key metrics and what they mean\n"
            "     • Top 3-5 insights with specific numbers from the data\n"
            "     • Anomalies, risks, and opportunities identified\n"
            "     • Concrete, numbered recommendations (not vague suggestions)\n"
            "   STEP 4 - Call draft_presentation with a board-ready deck (8-10 slides): cover, data overview, "
            "key metrics, trend analysis, risk/opportunity map, recommendations, next steps.\n"
            "   STEP 5 - Summarize with links to all 3 deliverables and ask: 'Want me to email this package to stakeholders?'\n"
            "   NEVER produce just one deliverable for a business analysis task - the full pipeline (sheet + doc + deck) IS the output.\n"
            "14. RESEARCH AND COMPOSE TASKS (user says 'research X and email', 'find data on X and send', "
            "'investigate X and compose', 'competitive analysis email'):\n"
            "   STEP 1 - Call web_search 3-5 times on the topic. Use varied queries: main topic, statistics, "
            "recent news, expert opinions, named examples.\n"
            "   STEP 2 - Call fetch_webpage on the 2 most relevant URLs from search results to get deeper content.\n"
            "   STEP 3 - Synthesize all findings into 5-7 key points with specific data, percentages, company names, or quotes.\n"
            "   STEP 4 - Compose the email with inline citations: 'According to [Source], X%...' - NEVER write uncited claims.\n"
            "   STEP 5 - Follow Draft-First Protocol: show complete draft, wait for user confirmation before calling send_email.\n"
            "   The email must be under 300 words - tight, punchy, evidence-backed. No filler sentences.\n"
            "15. MEETING INTELLIGENCE TASKS (user provides transcript, meeting notes, or says 'process meeting', "
            "'action items', 'meeting summary', 'follow up from meeting'):\n"
            "   STEP 1 - Extract and list explicitly:\n"
            "     • Meeting title and date (infer from context or use today's date)\n"
            "     • Attendees (all names/roles mentioned)\n"
            "     • Key DECISIONS made (concrete outcomes, not discussions)\n"
            "     • ACTION ITEMS: each item must have (Owner name | Task description | Due date)\n"
            "       - If no due date stated, default to 7 days from today\n"
            "     • Open questions or blockers that need resolution\n"
            "   STEP 2 - Call draft_document with structured meeting notes using these exact sections:\n"
            "     ## Meeting Details · ## Attendees · ## Key Decisions · ## Action Items (table format) · ## Open Questions\n"
            "   STEP 3 - For EACH action item: call create_calendar_event with a reminder 1 day before the due date.\n"
            "     Title format: '[ACTION] Owner: Task description'\n"
            "   STEP 4 - Compose the follow-up summary email:\n"
            "     Subject: 'Meeting Summary: [Meeting Title] - [Date]'\n"
            "     Body: Brief decisions recap + action item table + link to full notes doc.\n"
            "     Show as draft, wait for user send confirmation.\n"
            "   NEVER skip any step - partial execution (e.g. only the doc, no calendar reminders, no email) is a failure.\n"
            "16. SECURITY & VULNERABILITY RESEARCH (user asks 'which version is insecure/unsafe', 'CVE',\n"
            "    'security vulnerability', 'not safe to install', 'security issue with [tool]',\n"
            "    'which version has a vulnerability', or similar):\n"
            "   ⚠ CRITICAL RULE - SPECIFIC TOOL, NOT GENERIC CATEGORY:\n"
            "   The user is asking about a SPECIFIC named tool or library. NEVER generalize to a broader\n"
            "   category (e.g. if user mentions 'LiteLLM', do NOT write about 'LLMs in general').\n"
            "   Voice STT may phonetically mis-transcribe tech names - always resolve to the real product:\n"
            "     'Light LLM' / 'Lite LLM' → LiteLLM (pip install litellm)\n"
            "     'tensor flow' → TensorFlow · 'pie torch' → PyTorch · 'fast API' → FastAPI\n"
            "     'open A I' → OpenAI · 'git hub' → GitHub · 'my SQL' → MySQL\n"
            "   STEP 1 - Identify the exact product name (apply phonetic correction above if needed).\n"
            "   STEP 2 - web_search: '[exact product name] security vulnerability CVE affected versions'\n"
            "   STEP 3 - web_search: '[exact product name] CVE site:nvd.nist.gov OR site:github.com/advisories OR site:snyk.io'\n"
            "   STEP 4 - web_search: '[exact product name] insecure version patch upgrade'\n"
            "   STEP 5 - For any CVE advisory URLs returned, call fetch_webpage on the 1-2 most relevant\n"
            "     to extract exact affected version numbers, CVSS scores, and patch details.\n"
            "   STEP 6 - Call draft_document with a professional security advisory containing:\n"
            "     • Executive Summary: product name, severity, affected version range, remediation\n"
            "     • CVE Details table: CVE ID | CVSS Score | Attack Vector | Affected Versions | Fixed In\n"
            "     • Root Cause Analysis: how the vulnerability arises technically\n"
            "     • Attack Scenario: realistic example of how an attacker could exploit it\n"
            "     • Detection: command or method to check your installed version\n"
            "     • Remediation: exact upgrade command (e.g. 'pip install litellm>=X.Y.Z')\n"
            "     • Timeline: disclosure date, patch date, public PoC date if applicable\n"
            "   NEVER fabricate CVE IDs or version numbers - only cite data found in your web searches.\n"
            "   NEVER write generic 'AI security best practices' content when a specific product is named.\n"
        "17. WORKFLOW / GOVERNANCE TASKS (register_new_hire, or any tool that creates a "
        "multi-step human-in-the-loop WorkflowInstance):\n"
        "   ⚠ MANDATORY PRE-FLIGHT - you are the one who gathers ALL information before calling the tool.\n"
        "   The tool is just a commit button. YOU decide nothing on your own. Everything comes from:\n"
        "     (a) the user's knowledge base (company templates stored by the user), OR\n"
        "     (b) explicit answers given by the user in this conversation.\n"
        "   Never invent, guess, or hardcode any content. Ask one question at a time.\n\n"
        "   ── HIRING WORKFLOW - full pre-flight protocol ──────────────────────────────────────\n\n"
        "   STEP 1 - Gather candidate details (ask for any that are missing):\n"
        "     • Full name  (ask if not provided)\n"
        "     • Email address  (NEVER guess - ask: 'What is [name]'s email address?')\n"
        "     • Job title / role  (ask if not provided)\n"
        "     • Compensation / CTC  (ask: 'What is the offered compensation package?')\n"
        "     • Intro call date and time  (ALWAYS ask: 'When would you like to schedule the intro call "
        "with [name]? Share a date and time, e.g. April 20 at 3 PM IST.')\n\n"
        "   STEP 2 - Retrieve company templates from the knowledge base:\n"
        "     • Call semantic_search_knowledge with query='offer letter template' for the active agent.\n"
        "     • Call semantic_search_knowledge with query='NDA template mutual non-disclosure agreement'.\n"
        "     Decision tree for each template:\n"
        "       ✓ Found relevant chunks  → use that content, substituting [name], [role], [ctc] variables.\n"
        "         Inform the user: 'I found your [Offer Letter / NDA] template in the knowledge base - using it.'\n"
        "       ✗ Nothing found  → tell the user:\n"
        "         'I don't have your [Offer Letter / NDA] template saved yet. You have two options:\n"
        "          1. Share the template text here and I'll use it exactly.\n"
        "          2. I can draft a standard one - just say \"generate standard\".' \n"
        "         Wait for the user's reply. Use whatever they provide. Do not proceed without it.\n\n"
        "   STEP 3 - Show a full pre-flight summary BEFORE calling the tool:\n"
        "     📋 Hiring package for [name] ([role]):\n"
        "     • Email: [email]  • CTC: [ctc]  • Intro call: [meeting_time]\n"
        "     • Offer Letter: [first 80 chars of confirmed body…]\n"
        "     • NDA: [first 80 chars of confirmed content…]\n"
        "     Creating workflow now - you'll be able to review and authorize each step in the chat.\n\n"
        "   STEP 4 - Call register_new_hire with ALL confirmed values:\n"
        "     name, email, role, ctc, meeting_time, offer_letter_body, nda_content.\n\n"
        "   ── GENERAL RULE FOR ALL WORKFLOW TOOLS ──────────────────────────────────────────────\n"
        "   • Never use placeholders, 'TBD', or auto-invented content for anything that will be sent, "
        "signed, or published.\n"
        "   • Template content ALWAYS comes from the knowledge base or the user - never from your "
        "own general knowledge.\n"
        "   • Timing ALWAYS comes from the user - never auto-computed.\n"
        "   • If the user has already provided every required detail in their opening message, "
        "skip the questions, still do the KB lookup, then go straight to the summary + tool call.\n"
        "17. SEND / SHARE DOCUMENT TASKS (user says 'send offer letter to [name]', 'share the NDA with [name]',\n"
        "    'email the document to [name]', 'did you send X to Y', or any request to deliver a created document):\n"
        "   NEVER say 'I cannot send emails or documents' - you have a send_email tool. ALWAYS use it.\n"
        "   NEVER just paste a link and tell the user to send it themselves - that is a failure.\n"
        "   STEP 1 - Get the document Drive link:\n"
        "     • If you just created the document in this conversation, you already have the link - use it.\n"
        "     • Otherwise call list_files or search Drive to find the document and get its webViewLink.\n"
        "   STEP 2 - Resolve the recipient: call resolve_contact with the person's name to get their email.\n"
        "   STEP 3 - Compose the full email draft embedding the Drive link in the body. Format EXACTLY:\n"
        "     **To:** recipient@email.com | **Subject:** [document name] from [your name]\n"
        "     [greeting]\n"
        "     [2-3 sentence context - what the document is, what you need them to do]\n"
        "     📄 **[Document Name]:** [Drive link]\n"
        "     [professional closing]\n"
        "     ---\n"
        "      **Send this email?** Or tell me how to change it.\n"
        "   STEP 4 - DO NOT call send_email yet. Show the draft and wait for explicit user confirmation.\n"
        "   STEP 5 - On 'send it' / 'yes' / 'confirm' / 'looks good' → call send_email with the body above.\n"
        "   STEP 6 - If asked to send MULTIPLE documents (e.g. offer letter AND NDA), compose ONE email with "
        "both links embedded, not separate emails unless the user specifically asks.\n"
        "   If the user asks 'did you send X?' and it was NOT yet sent → reply: 'Not yet - here is the draft:\n"
        "   [compose draft as per Step 3 above and ask for confirmation]'\n"
        )
        if custom_instr:
            prompt += f"\nAgent-specific expertise:\n{custom_instr}"

        # Inject pinned skills/playbooks (if agent has a DB id)
        agent_db_id = getattr(agent, "id", None) or getattr(agent, "agent_id", None)
        if agent_db_id:
            skill_block = self._get_pinned_skill_block(agent_db_id)
            if skill_block:
                prompt += skill_block

        return prompt

    async def _build_soul_system_prompt(
        self,
        agent,
        task_description: str,
        user_email: str,
        db,
        now: datetime,
    ) -> str:
        """Build a SOUL-aware system prompt using the agent's SOULDocument + RAG + episodic memory."""
        from services.episodic_memory import get_recent_memories, format_memories_for_prompt
        from services.knowledge_base import KnowledgeBase

        soul = agent.soul_document
        if isinstance(soul, str):
            try:
                soul = json.loads(soul)
            except Exception:
                soul = {}
        if not isinstance(soul, dict):
            soul = {}
        identity = soul.get("identity", {})
        personality = soul.get("personality", {})

        # Core SOUL sections
        base = (
            f"Current date and time: {now.strftime('%A, %B %d, %Y at %I:%M %p')}\n\n"
            f"You are {identity.get('name', agent.name)}, {identity.get('title', agent.description)}.\n"
            f"Expertise Level: {identity.get('expertise_level', 'expert')} "
            f"({identity.get('years_equivalent', '10+ years')} equivalent experience)\n\n"
            f"## Personality\n"
            f"Tone: {personality.get('tone', 'professional')} | "
            f"Style: {personality.get('communication_style', 'concise')} | "
            f"Decision-making: {personality.get('decision_making', 'data-driven')}\n"
            f"Strengths: {personality.get('strengths', '')}\n\n"
            f"## Domain Expertise\n{soul.get('domain_expertise', '')}\n\n"
            f"## Capabilities\n" + "\n".join(f"- {c}" for c in soul.get("capabilities", [])) + "\n\n"
            f"## Quality Standards\n" + "\n".join(f"- {s}" for s in soul.get("quality_standards", [])) + "\n\n"
            f"## Guardrails\n" + "\n".join(f"- {g}" for g in soul.get("guardrails", [])) + "\n\n"
        )

        # Terminology
        terms = soul.get("terminology", {})
        if terms:
            term_lines = "\n".join(f"- **{k}**: {v}" for k, v in list(terms.items())[:15])
            base += f"## Key Terminology\n{term_lines}\n\n"

        # Custom master instructions (the agent's DNA)
        custom = soul.get("custom_instructions", "")
        if custom:
            base += f"## Core Operating Instructions\n{custom}\n\n"

        # Episodic memory (last 3 sessions)
        memories = get_recent_memories(db, agent.agent_id, agent.user_id, limit=3)
        memory_text = format_memories_for_prompt(memories)
        if memory_text:
            base += f"\n{memory_text}\n\n"

        # RAG context (hybrid retrieval for current task)
        if agent.has_rag:
            try:
                chunks = await KnowledgeBase.retrieve(task_description, agent.agent_id, top_k=6)
                rag_text = KnowledgeBase.format_context(chunks)
                if rag_text:
                    base += f"\n{rag_text}\n\n"
            except Exception as e:
                logger.warning(f"RAG retrieval failed for agent {agent.agent_id}: {e}")

        # Append standard workspace rules from base prompt (tools, email drafting, etc.)
        _user_name, _user_role = self._get_user_profile(user_email, db)
        _base_prompt = self._build_system_prompt(agent, now, _user_name, _user_role)
        base += "\n" + _base_prompt.split("GLOBAL QUALITY MANDATE")[1] if "GLOBAL QUALITY MANDATE" in _base_prompt else ""

        # Inject pinned skills/playbooks
        agent_db_id = getattr(agent, "id", None) or getattr(agent, "agent_id", None)
        if agent_db_id:
            skill_block = self._get_pinned_skill_block(agent_db_id)
            if skill_block:
                base += skill_block

        return base

    async def _execute_agent_workflow(
        self,
        agent,
        task_description: str,
        user_email: str,
        context: Dict[str, Any] = None,
        security_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Delegate to MCPClient for the LLM ↔ tool loop.

        ROUTER detection: if the agent's soul_document.core_type == "ROUTER",
        we hand off to AgentOrchestrator instead of the direct MCPClient loop.
        """
        from auth.database import get_db
        from mcp_servers.core.mcp_tools import get_tools_for_agent, get_tools_for_user

        db = next(get_db())

        # ── ROUTER: delegate to multi-agent orchestrator ──────────────────────
        _soul = getattr(agent, "soul_document", None) or {}
        _core_type = (_soul.get("core_type", "") if isinstance(_soul, dict) else "").upper()
        if _core_type == "ROUTER":
            try:
                return await self._execute_as_router(agent, task_description, user_email, db)
            finally:
                db.close()

        # ── Agent Caching Layer (O(1) Retrieval) ──────────────────────────────
        from services.redis_service import AgentCache
        cached = await AgentCache.get(user_email, agent.name, task_description)
        if cached:
            return cached

        # ── Department-aware tool loading ─────────────────────────────────────
        # Priority:  1) explicit tools list in agent_config
        #            2) dept + core_type scoped set
        #            3) full provider-filtered set (legacy fallback)
        _cfg = getattr(agent, "agent_config", None)
        _tool_names = (_cfg if isinstance(_cfg, dict) else {}).get("tools", [])
        if _tool_names:
            tools = get_tools_for_agent(user_email, db, tool_names=_tool_names)
        else:
            _dept = (_soul.get("department", "") if isinstance(_soul, dict) else "").upper()
            if _core_type and _dept:
                from services.department_tools import get_tools_for_department_and_type
                tools = get_tools_for_department_and_type(_dept, _core_type, user_email, db)
            else:
                tools = get_tools_for_user(user_email, db)

        now = datetime.now()

        # Use SOUL-aware prompt if agent has soul_document; else use generic prompt
        _user_name, _user_role = self._get_user_profile(user_email, db)
        # Choose prompt size based on provider: local small models need a lean prompt
        from utils.llm_router import _get_user_llm_config, _is_local_provider
        try:
            from auth.models import User as _PUser
            _pu = db.query(_PUser).filter(_PUser.email == user_email).first()
            _pcfg = _get_user_llm_config(_pu.id if _pu else None, db)
            _use_lean = _is_local_provider(_pcfg.get("provider", ""))
        except Exception:
            _use_lean = False

        if hasattr(agent, "soul_document") and agent.soul_document:
            system_prompt = await self._build_soul_system_prompt(
                agent, task_description, user_email, db, now
            )
        elif _use_lean:
            system_prompt = self._build_lean_system_prompt(agent, now, _user_name, _user_role)
        else:
            system_prompt = self._build_system_prompt(agent, now, _user_name, _user_role)

        messages = [
            {
                "role": "user",
                "content": (
                    f"Context: {json.dumps(context or {})}\n\nTask: {task_description}"
                ),
            }
        ]

        try:
            final_text, tools_used, context_trace_id = await self.mcp_client.run(
                system_prompt=system_prompt,
                tools=tools,
                messages=messages,
                user_email=user_email,
                db_session=db,
                security_token=security_token,
            )
            
            # Phase 10: Fetch O(1) Audit Trace
            from services.context_audit import AUDIT_TRACKER
            trace_data = AUDIT_TRACKER.get_traces(context_trace_id)
            
            # Phase 6: Expert Hybrid Routing (Decision Tree Pre-Filtering)
            # Instantly evaluate final drafted text for tone or unauthorized concessions
            _task_lower = task_description.lower()
            if any(w in _task_lower for w in ("email", "reply", "message", "send")):
                context_type = "communication"
            elif any(w in _task_lower for w in ("negotiation", "proposal", "contract", "pricing", "discount", "deal")):
                context_type = "negotiation"
            else:
                context_type = "general"  # No safety checks for document/research/data tasks
            safety_eval = DecisionTreeRouter.process_draft(final_text, context_type=context_type)
            
            if not safety_eval["safe"]:
                warning_msg = f"⚠️ ALERTS DETECTED: {', '.join(safety_eval['flags'])}."
                final_text = f"**{warning_msg}**\n\nThe AI drafted this response, but it has been flagged for human review:\n\n{final_text}"

            # Save episodic memory for SOUL-backed agents
            if hasattr(agent, "soul_document") and agent.soul_document and hasattr(agent, "agent_id"):
                try:
                    from services.episodic_memory import save_session_memory
                    from auth.models import User
                    user = db.query(User).filter(User.email == user_email).first()
                    if user:
                        save_session_memory(
                            db=db,
                            agent_id=agent.agent_id,
                            user_id=agent.user_id,
                            task=task_description,
                            result=final_text[:500],
                        )
                except Exception as mem_err:
                    logger.debug(f"Episodic memory save failed (non-critical): {mem_err}")

            response = {
                "success": True,
                "workflow_steps_executed": len(tools_used),
                "method": "mcp_agentic_loop",
                "task_completed": True,
                "safety_evaluation": safety_eval,
                "context_trace": trace_data,
                "summary": {"message": final_text, "tools_used": tools_used},
                "result": {"summary": {"message": final_text, "tools_used": tools_used}},
            }
            # Cache the final response
            await AgentCache.set(user_email, agent.name, task_description, response)
            return response
        except Exception as e:
            logger.error(f"Agentic loop failed for user={user_email}: {e}")
            # _call_router already produces friendly messages; pass them through unchanged.
            return {"error": str(e)}
        finally:
            db.close()

    async def _execute_as_router(
        self,
        agent,
        task_description: str,
        user_email: str,
        db,
    ) -> Dict[str, Any]:
        """Handle ROUTER-type agents via AgentOrchestrator.

        Collects all streamed chunks and returns a normalised result dict
        (same shape as _execute_agent_workflow) so callers don't need to
        branch on agent type.
        """
        from services.agent_orchestrator import AgentOrchestrator

        orchestrator = AgentOrchestrator()
        final_text = ""
        tools_used: List[str] = []
        subtask_count = 0

        async for raw_chunk in orchestrator.orchestrate_stream(
            goal=task_description,
            user_email=user_email,
            db=db,
        ):
            try:
                chunk = json.loads(raw_chunk)
                if chunk.get("type") == "result":
                    final_text = chunk.get("text", "")
                    tools_used = chunk.get("tools_used", [])
                    subtask_count = chunk.get("subtask_count", 0)
            except Exception:
                pass

        return {
            "success": True,
            "workflow_steps_executed": subtask_count,
            "method": "router_orchestration",
            "task_completed": True,
            "safety_evaluation": {"safe": True, "flags": []},
            "context_trace": {},
            "summary": {"message": final_text, "tools_used": tools_used},
            "result": {"summary": {"message": final_text, "tools_used": tools_used}},
        }

    async def execute_agent_stream_task(
        self,
        agent_type: Union[AgentType, str],
        task_description: str,
        user_email: str,
        context: Dict[str, Any] = None,
        security_token: Optional[str] = None,
        history_messages: Optional[List[Dict[str, str]]] = None,
        display_name: Optional[str] = None,
    ):
        """Streaming version of execute_agent_task that yields JSON strings."""
        db = None
        agent = None
        try:
            # Resolve agent definition - handles both str and AgentType enum
            if isinstance(agent_type, str) and agent_type == "custom":
                agent = await self._find_custom_agent_for_user(user_email)
                if not agent:
                    yield json.dumps({"type": "error", "message": "No custom agent found for this user"}) + "\n"
                    return
            else:
                if isinstance(agent_type, str):
                    try:
                        agent_type = AgentType(agent_type)
                    except ValueError:
                        yield json.dumps({"type": "error", "message": f"Invalid agent type: {agent_type}"}) + "\n"
                        return
                agent = self.registry.get_agent(agent_type)
                if not agent:
                    yield json.dumps({"type": "error", "message": "Agent type not found"}) + "\n"
                    return

            if not agent.is_active:
                yield json.dumps({"type": "error", "message": f"Agent {agent.name} is inactive"}) + "\n"
                return

            # Announce which agent was selected so the frontend can show the routing step
            agent_display = display_name or getattr(agent, "name", "AI Assistant")
            yield json.dumps({"type": "agent", "name": agent_display}) + "\n"

            # ── Agent Caching Layer (Streaming) ───────────────────────────────
            from services.redis_service import AgentCache
            cached = await AgentCache.get(user_email, agent_display, task_description)
            if cached:
                logger.info(f"🚀 Streaming cache hit for {user_email}")
                yield json.dumps({"type": "cache_hit", "message": "Instant playback from cache"}) + "\n"
                # Emit the final result chunks from cache
                summary = cached.get("summary", {})
                result_text = summary.get("message", "")
                tools = summary.get("tools_used", [])
                
                # We can "fake" the stream for a better UX or just send it all
                # Let's send the done message with the cached data
                yield json.dumps({"type": "done", "result": result_text, "tools_used": tools}) + "\n"
                return

            from auth.database import get_db
            from mcp_servers.core.mcp_tools import get_all_tool_schemas

            db = next(get_db())
            tools = get_all_tool_schemas()

            now = datetime.now()
            _user_name, _user_role = self._get_user_profile(user_email, db)
            # Choose prompt size: local small models need the lean prompt
            from utils.llm_router import _get_user_llm_config, _is_local_provider
            try:
                from auth.models import User as _SPUser
                _spu = db.query(_SPUser).filter(_SPUser.email == user_email).first()
                _spcfg = _get_user_llm_config(_spu.id if _spu else None, db)
                _sp_lean = _is_local_provider(_spcfg.get("provider", ""))
            except Exception:
                _sp_lean = False
            system_prompt = (
                self._build_lean_system_prompt(agent, now, _user_name, _user_role)
                if _sp_lean
                else self._build_system_prompt(agent, now, _user_name, _user_role)
            )

            messages = []
            if history_messages:
                messages.extend(history_messages)

            messages.append(
                {
                    "role": "user",
                    "content": f"Context: {json.dumps(context or {})}\n\nTask: {task_description}",
                }
            )

            # Cost Optimization: short tasks use a faster/cheaper model when user opted in.
            # IMPORTANT: skip when user is on a local model — they have no Gemini key.
            _ctx = context or {}
            _cost_model = None
            if _ctx.get("cost_opt_mode") and len(task_description) < 400:
                from utils.llm_router import _get_user_llm_config, _is_local_provider
                try:
                    from auth.models import User as _CostUser
                    _cost_u = db.query(_CostUser).filter(_CostUser.email == user_email).first()
                    _cost_cfg = _get_user_llm_config(_cost_u.id if _cost_u else None, db)
                    if not _is_local_provider(_cost_cfg.get("provider", "")):
                        _cost_model = "gemini/gemini-2.0-flash"
                except Exception:
                    pass  # non-critical; stay with default model

            final_result_text = ""
            try:
                async for chunk in self.mcp_client.run_stream(
                    system_prompt=system_prompt,
                    tools=tools,
                    messages=messages,
                    user_email=user_email,
                    db_session=db,
                    security_token=security_token,
                    model=_cost_model,
                ):
                    if chunk.get("type") == "result":
                        final_result_text = chunk.get("text", "")
                    if chunk.get("type") == "result" and "context_trace_id" in chunk:
                        from services.context_audit import AUDIT_TRACKER
                        chunk["context_trace"] = AUDIT_TRACKER.get_traces(chunk["context_trace_id"])
                    
                    yield json.dumps(chunk) + "\n"

                if final_result_text:
                    # Cache the result for future identical queries
                    cached_response = {
                        "success": True,
                        "workflow_steps_executed": 0, # not applicable for cached
                        "method": "cached_stream",
                        "task_completed": True,
                        "summary": {"message": final_result_text, "tools_used": []}, # tools_used tracking simplified for cache
                    }
                    await AgentCache.set(user_email, agent_display, task_description, cached_response)

                    _task_lower = task_description.lower()
                    if any(w in _task_lower for w in ("email", "reply", "message", "send")):
                        context_type = "communication"
                    elif any(w in _task_lower for w in ("negotiation", "proposal", "contract", "pricing", "discount", "deal")):
                        context_type = "negotiation"
                    else:
                        context_type = "general"
                        
                    safety_eval = DecisionTreeRouter.process_draft(final_result_text, context_type=context_type)
                    if not safety_eval["safe"]:
                        yield json.dumps({"type": "safety", "evaluation": safety_eval}) + "\n"

                if history_messages is not None and final_result_text:
                    history_messages.append({
                        "role": "user",
                        "content": f"Context: {json.dumps(context or {})}\n\nTask: {task_description}"
                    })
                    history_messages.append({
                        "role": "assistant",
                        "content": final_result_text
                    })

            except Exception as e:
                logger.error(f"Agentic loop failed for user={user_email}: {e}")
                yield json.dumps({"type": "error", "message": str(e)}) + "\n"
            finally:
                if db:
                    db.close()
                self.execution_history.append({
                    "timestamp": datetime.now().isoformat(),
                    "agent_name": getattr(agent, "name", "Unknown"),
                    "task_description": task_description,
                    "result": "Streamed completion",
                })

        except Exception as e:
            logger.error(f"Error in stream: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    # ── Explicit agent-by-ID lookup ──────────────────────────────────────────

    async def find_agent_by_id(self, agent_id: int, user_email: str, db) -> Optional[Any]:
        """Look up a specific DB-backed agent by ID and wrap it for execution."""
        try:
            from auth.models import User
            from models import AIAgent

            user = db.query(User).filter(User.email == user_email).first()
            if not user:
                return None

            agent = db.query(AIAgent).filter(
                AIAgent.id == agent_id,
                AIAgent.user_id == user.id,
            ).first()
            if not agent:
                return None

            cfg = agent.agent_config or {}
            _soul_doc = agent.soul_document
            _agent_id = agent.id
            _user_id = user.id
            _has_rag = agent.has_rag or False

            class _DynamicAgent:
                name = agent.name
                description = agent.description
                llm_role = cfg.get("role", "drafter")
                temperature = cfg.get("temperature", 0.3)
                custom_instructions = cfg.get("custom_instructions", "")
                is_active = True
                required_tools = cfg.get("tools", [])
                workflows = cfg.get("workflow_steps", [])
                capabilities = cfg.get("capabilities", [])
                soul_document = _soul_doc
                agent_id = _agent_id
                user_id = _user_id
                has_rag = _has_rag

            return _DynamicAgent()

        except Exception as e:
            logger.error(f"find_agent_by_id({agent_id}) failed: {e}")
            return None

    async def execute_dynamic_agent_stream(
        self,
        agent,
        task_description: str,
        user_email: str,
        context: Dict[str, Any] = None,
        security_token: Optional[str] = None,
        history_messages: Optional[List[Dict[str, str]]] = None,
    ):
        """Stream execution for an explicitly selected dynamic (DB-backed) agent.

        If the agent is a ROUTER, delegates to AgentOrchestrator and streams
        orchestration events directly to the caller.
        """
        db = None
        try:
            from auth.database import get_db
            from mcp_servers.core.mcp_tools import get_tools_for_agent, get_tools_for_user

            db = next(get_db())

            # ── ROUTER: stream orchestration events ───────────────────────────
            _soul = getattr(agent, "soul_document", None) or {}
            _core_type = (_soul.get("core_type", "") if isinstance(_soul, dict) else "").upper()
            if _core_type == "ROUTER":
                from services.agent_orchestrator import AgentOrchestrator
                orchestrator = AgentOrchestrator()
                async for chunk in orchestrator.orchestrate_stream(
                    goal=task_description,
                    user_email=user_email,
                    db=db,
                    context=context,
                ):
                    yield chunk
                return

            # ── Department-aware tool loading ─────────────────────────────────
            _cfg = getattr(agent, "agent_config", None)
            _tool_names = (_cfg if isinstance(_cfg, dict) else {}).get("tools", [])
            if _tool_names:
                tools = get_tools_for_agent(user_email, db, tool_names=_tool_names)
            else:
                _dept = (_soul.get("department", "") if isinstance(_soul, dict) else "").upper()
                if _core_type and _dept:
                    from services.department_tools import get_tools_for_department_and_type
                    tools = get_tools_for_department_and_type(_dept, _core_type, user_email, db)
                else:
                    tools = get_tools_for_user(user_email, db)
            now = datetime.now()

            _user_name, _user_role = self._get_user_profile(user_email, db)
            # Choose prompt size: local small models need the lean prompt
            from utils.llm_router import _get_user_llm_config, _is_local_provider
            try:
                from auth.models import User as _DPUser
                _dpu = db.query(_DPUser).filter(_DPUser.email == user_email).first()
                _dpcfg = _get_user_llm_config(_dpu.id if _dpu else None, db)
                _dp_lean = _is_local_provider(_dpcfg.get("provider", ""))
            except Exception:
                _dp_lean = False

            if hasattr(agent, "soul_document") and agent.soul_document:
                system_prompt = await self._build_soul_system_prompt(
                    agent, task_description, user_email, db, now
                )
            elif _dp_lean:
                system_prompt = self._build_lean_system_prompt(agent, now, _user_name, _user_role)
            else:
                system_prompt = self._build_system_prompt(agent, now, _user_name, _user_role)

            messages: List[Dict[str, str]] = []
            if history_messages:
                messages.extend(history_messages[-20:])
            messages.append({
                "role": "user",
                "content": f"Context: {json.dumps(context or {})}\n\nTask: {task_description}",
            })

            # Cost Optimization: short tasks use a faster/cheaper model when user opted in.
            # IMPORTANT: skip when user is on a local model — they have no Gemini key.
            _ctx = context or {}
            _cost_model = None
            if _ctx.get("cost_opt_mode") and len(task_description) < 400:
                from utils.llm_router import _get_user_llm_config, _is_local_provider
                try:
                    from auth.models import User as _CostUser2
                    _cost_u2 = db.query(_CostUser2).filter(_CostUser2.email == user_email).first()
                    _cost_cfg2 = _get_user_llm_config(_cost_u2.id if _cost_u2 else None, db)
                    if not _is_local_provider(_cost_cfg2.get("provider", "")):
                        _cost_model = "gemini/gemini-2.0-flash"
                except Exception:
                    pass  # non-critical; stay with default model

            final_result_text = ""
            try:
                async for chunk in self.mcp_client.run_stream(
                    system_prompt=system_prompt,
                    tools=tools,
                    messages=messages,
                    user_email=user_email,
                    db_session=db,
                    security_token=security_token,
                    model=_cost_model,
                ):
                    if chunk.get("type") == "result":
                        final_result_text = chunk.get("text", "")
                    if chunk.get("type") == "result" and "context_trace_id" in chunk:
                        from services.context_audit import AUDIT_TRACKER
                        chunk["context_trace"] = AUDIT_TRACKER.get_traces(chunk["context_trace_id"])
                    yield json.dumps(chunk) + "\n"

                if final_result_text and history_messages is not None:
                    history_messages.append({
                        "role": "user",
                        "content": f"Context: {json.dumps(context or {})}\n\nTask: {task_description}",
                    })
                    history_messages.append({"role": "assistant", "content": final_result_text})

            except Exception as e:
                logger.error(f"Dynamic agent stream failed: {e}")
                yield json.dumps({"type": "error", "message": f"Agent execution failed: {str(e)}"}) + "\n"
            finally:
                if db:
                    db.close()

        except Exception as e:
            logger.error(f"Error in execute_dynamic_agent_stream: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    # ── Custom agent lookup ──────────────────────────────────────────────────

    async def _find_custom_agent_for_user(self, user_email: str) -> Optional[Any]:
        """Retrieve and wrap the most recent DB-backed custom agent for this user."""
        db = None
        try:
            from auth.database import get_db
            from auth.models import User
            from models import AIAgent

            db = next(get_db())
            user = db.query(User).filter(User.email == user_email).first()
            if not user:
                return None

            #  FIX #5: Single query with conditional sort instead of 2 queries
            # This gets the most recent custom agent if it exists, else any recent agent
            agent = (
                db.query(AIAgent)
                .filter(AIAgent.user_id == user.id)
                .order_by(
                    # Sort custom agents first, then by creation date descending
                    (AIAgent.role == "custom").desc(),
                    AIAgent.created_at.desc()
                )
                .first()
            )

            if not agent:
                logger.warning(f"No agent found for user {user_email}")
                return None

            cfg = agent.agent_config or {}

            # Capture soul data for SOUL-aware prompt building
            _soul_doc = agent.soul_document
            _agent_id = agent.id
            _user_id = user.id
            _has_rag = agent.has_rag or False

            class _DynamicAgent:
                name = agent.name
                description = agent.description
                llm_role = cfg.get("role", "drafter")
                temperature = cfg.get("temperature", 0.3)
                custom_instructions = cfg.get("custom_instructions", "")
                is_active = True
                required_tools = cfg.get("tools", [])
                workflows = cfg.get("workflow_steps", [])
                capabilities = cfg.get("capabilities", [])
                # SOUL fields
                soul_document = _soul_doc
                agent_id = _agent_id
                user_id = _user_id
                has_rag = _has_rag

            return _DynamicAgent()

        except Exception as e:
            logger.error(f"Error finding custom agent for {user_email}: {e}")
            return None
        finally:
            try:
                if db:
                    db.close()
            except Exception:
                pass

    # ── Utility ──────────────────────────────────────────────────────────────

    def get_execution_history(self) -> List[Dict[str, Any]]:
        return self.execution_history

    async def find_best_agent_for_task(
        self, task_description: str, user_email: str
    ) -> Optional[AgentDefinition]:
        """Heuristic agent selection based on task keywords."""
        task_lower = task_description.lower()
        keyword_map = {
            AgentType.EMAIL_MANAGER: ["email", "reply", "send", "inbox", "draft", "mail", "compose"],
            AgentType.CALENDAR_ASSISTANT: ["meeting", "schedule", "calendar", "event", "invite", "appointment", "availability"],
            AgentType.DATA_ANALYST: ["analyze", "analytics", "data", "chart", "spreadsheet", "sheet", "financial", "finance", "table", "excel", "csv", "budget", "tracking", "metrics", "kpi", "graph"],
            AgentType.DOCUMENT_CREATOR: ["document", "doc", "write", "summary", "report", "letter", "note", "minutes", "memo"],
            AgentType.FILE_MANAGER: ["folder", "file", "drive", "organize", "share", "upload", "storage"],
            AgentType.COMMUNICATION_SIMULATOR: ["angry", "complain", "escalate", "upset", "apologize", "frustrated"],
            AgentType.NEGOTIATION_ADVISOR: ["discount", "price", "offer", "counter", "deal", "contract", "terms", "proposal"],
            # Image / creative generation - must route AWAY from DOCUMENT_CREATOR
            AgentType.PRESENTATION_BUILDER: [
                "generate image", "create image", "make image", "make an image",
                "generate a image", "create a image",
                "generate logo", "create logo", "design logo",
                "generate banner", "create banner", "design banner",
                "generate poster", "create poster",
                "illustrate", "draw", "design", "artwork", "graphic",
                "generate picture", "create picture",
                "image of", "picture of", "photo of",
                "wallpaper", "thumbnail", "icon",
                "presentation", "slide deck", "slides", "powerpoint", "deck",
            ],
            # New high-value agents
            AgentType.BUSINESS_ANALYST: ["board report", "business report", "executive report", "board-ready", "executive summary", "insights from", "analyze this data", "analyze the data", "data pipeline", "generate insights", "business insights", "upload.*report", "csv.*report", "report.*csv"],
            AgentType.RESEARCH_COMPOSER: ["research and email", "research.*send", "investigate.*email", "find.*compose", "competitive.*email", "market.*email", "research the", "look up.*email", "find out.*send", "deep research",
                                          # Real-time / live data queries → agent has web_search
                                          "weather", "temperature", "forecast", "stock price", "share price",
                                          "crypto", "bitcoin", "exchange rate", "news", "headlines",
                                          "latest", "current price", "live score", "trending", "what's happening"],
            AgentType.MEETING_INTELLIGENCE: ["meeting notes", "meeting transcript", "transcript", "action items", "action item", "follow up from meeting", "notes from", "meeting summary", "process.*meeting", "summarize.*meeting", "from the meeting"],
        }
        
        best_agent_type = AgentType.RESEARCH_COMPOSER  # general-purpose fallback
        best_score = 0

        for agent_type, keywords in keyword_map.items():
            score = sum(1 for kw in keywords if kw in task_lower)
            if score > best_score:
                best_score = score
                best_agent_type = agent_type

        agent = self.registry.get_agent(best_agent_type)
        if agent and agent.is_active:
            return agent

        return self.registry.get_agent(AgentType.RESEARCH_COMPOSER)


# Global singleton
agent_executor = AgentExecutor()
