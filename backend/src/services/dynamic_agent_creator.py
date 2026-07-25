from typing import Dict, List, Any, Optional, Callable, Awaitable
from datetime import datetime
import json
import asyncio
from loguru import logger

from services.agent_registry import agent_registry, AgentType, ToolType, AgentDefinition, AgentCapability, AgentWorkflow
from utils.llm_router import agenerate as llm_agenerate
from models import AIAgent, AgentConfig
from sqlalchemy.orm import Session


# ── v2 Brain-powered creation ──────────────────────────────────────────────────

def _looks_gibberish(text: str) -> bool:
    """Return True when text appears to be random/nonsensical characters.

    Uses the same two-signal heuristic as the chat route:
      1. Vowel ratio < 20%
      2. A run of 4+ consecutive consonants
    All non-trivial words (>3 chars) must fail for the whole text to be rejected.
    """
    import re as _re

    def _word_bad(word: str) -> bool:
        w = _re.sub(r"[^a-z]", "", word.lower())
        if len(w) < 4:
            return False
        if sum(1 for c in w if c in "aeiou") / len(w) < 0.20:
            return True
        max_run = max(
            (len(m.group()) for m in _re.finditer(r"[^aeiou]+", w)),
            default=0,
        )
        return max_run >= 4

    words = text.strip().lower().split()
    if not words:
        return True
    non_trivial = [w for w in words if len(w) > 3]
    if not non_trivial:
        return False
    return sum(1 for w in non_trivial if _word_bad(w)) == len(non_trivial)


class AgentCreationInput:
    """Input for the v2 Brain-powered creation pipeline."""

    def __init__(
        self,
        task: str,
        industry: str,
        role: Optional[str] = None,
        job_title: Optional[str] = None,
        company_website: Optional[str] = None,
        company_name: Optional[str] = None,
        agent_name: Optional[str] = None,
    ):
        if not task or len(task.strip()) < 5:
            raise ValueError("task must be at least 5 characters")
        if not industry or len(industry.strip()) < 2:
            raise ValueError("industry is required")
        if _looks_gibberish(task):
            raise ValueError("task must be a meaningful description, not random characters")
        if _looks_gibberish(industry):
            raise ValueError("industry must be a real domain (e.g. 'B2B SaaS', 'Healthcare', 'E-commerce')")
        self.task = task.strip()
        self.industry = industry.strip()
        self.role = (role or "").strip() or None
        self.job_title = (job_title or "").strip() or None
        self.company_website = (company_website or "").strip() or None
        self.company_name = (company_name or "").strip() or None
        self.agent_name = (agent_name or "").strip() or None


async def create_agent_v2(
    user_id: int,
    inp: AgentCreationInput,
    db: Session,
    progress_fn: Optional[Callable[..., Awaitable[None]]] = None,
) -> AIAgent:
    """
    Brain-powered v2 creation pipeline.
    BackgroundResearcher → AgentBrain (5 stages) → QualityGate → DB persist.
    Raises on failure - transactional, no partial state.
    Optional progress_fn(stage, progress, message, **extra) for SSE streaming.
    """
    from services.background_researcher import BackgroundResearcher, ResearchInput
    from services.agent_brain import AgentBrain
    from services.knowledge_base import KnowledgeBase

    async def _emit(stage: str, progress: float, message: str, **extra):
        if progress_fn:
            try:
                await progress_fn(stage=stage, progress=progress, message=message, **extra)
            except Exception:
                pass

    researcher = BackgroundResearcher()
    brain = AgentBrain()

    # Pre-flight Validation: Check if the request is gibberish
    await _emit("validation", 0.02, "Validating agent request...")
    validation_prompt = f"""
    Evaluate if this AI agent request makes logical sense or if it is gibberish/nonsense.
    TASK: {inp.task}
    INDUSTRY: {inp.industry}
    ROLE: {inp.role or 'N/A'}

    Return a JSON object with two keys:
    1. "is_valid": boolean (true if it makes sense, false if it looks like random keyboard mashing or complete nonsense)
    2. "reason": string (a brief explanation why it's invalid, or empty if valid)
    """
    try:
        val_res = await llm_agenerate(
            role="drafter",
            messages=[{"role": "user", "content": validation_prompt}],
            user_id=user_id,
            db=db,
            temperature=0.1,
            response_format="json_object"
        )
        val_text = getattr(val_res.choices[0].message, 'content', '{}').strip()
        import re
        val_text = re.sub(r"^```(?:json)?\s*", "", val_text, flags=re.IGNORECASE)
        val_text = re.sub(r"\s*```$", "", val_text)
        val_data = json.loads(val_text)
        if not val_data.get("is_valid", True):
            reason = val_data.get("reason", "The provided task or industry appears to be invalid or nonsense.")
            raise ValueError(f"Invalid Request: {reason}")
    except ValueError:
        raise
    except Exception as e:
        logger.warning(f"Gibberish validation skipped due to LLM error: {e}")

    research_inp = ResearchInput(
        task=inp.task,
        industry=inp.industry,
        role=inp.role,
        job_title=inp.job_title,
        company_website=inp.company_website,
        company_name=inp.company_name,
    )

    agent_id_for_cleanup: Optional[int] = None

    try:
        # Phase 1: Research
        await _emit("research", 0.05, f"Searching for {inp.industry} expertise and best practices...")
        logger.info(f"AgentBrain v2: researching '{inp.task}' in '{inp.industry}'")
        facts = await researcher.research(research_inp, user_id=user_id, db=db)
        logger.info(f"  {len(facts)} facts collected")
        await _emit("research.done", 0.22, f"Collected {len(facts)} facts from {len(set(f.source for f in facts)) if hasattr(facts[0], 'source') else 'multiple'} sources" if facts else "Research complete")

        # Phase 2-4: Brain pipeline
        await _emit("brain.fuse", 0.30, "Fusing and deduplicating facts...")
        await _emit("brain.rank", 0.40, f"Ranking facts by relevance to: {inp.task[:60]}...")
        await _emit("brain.compile", 0.52, "Compiling domain knowledge and workflows...")
        await _emit("brain.validate", 0.65, "Validating knowledge completeness and filling gaps...")
        await _emit("brain.soul", 0.78, "Synthesizing agent identity, personality and master prompt...")
        soul, quality, benchmark_score = await brain.run(facts, research_inp, researcher=researcher, user_id=user_id, db=db)

        if not quality.passed:
            logger.warning(f"QualityGate score={quality.overall:.2f}: {quality.failures}")

        passed_dims = sum(1 for d in ["completeness", "specificity", "consistency", "actionability", "knowledge_depth"]
                          if getattr(quality, d, 0) >= 0.7)
        await _emit("quality", 0.88, f"Quality gate: {passed_dims}/5 dimensions passed (score: {quality.overall:.0%})")
        await _emit("benchmark", 0.94, "Running benchmark tests against role-specific prompts...")

        # Phase 5: Persist
        agent_name = inp.agent_name or soul.identity.get("name", f"{inp.industry} Expert")
        agent_role = soul.identity.get("title", inp.role or inp.task)

        agent_config = {
            "name": agent_name,
            "role": agent_role,
            "description": soul.domain_expertise[:500],
            "capabilities": soul.capabilities,
            "tools": [],
            "workflow_steps": soul.workflows[:3],
            "llm_role": "drafter",
            "temperature": 0.3,
            "custom_instructions": soul.custom_instructions,
        }

        agent = AIAgent(
            name=agent_name,
            description=f"{agent_role} - {inp.industry} specialist",
            role=agent_role,
            agent_config=agent_config,
            user_id=user_id,
            status="idle",
            is_active=True,
            performance_score=benchmark_score,
            benchmark_score=benchmark_score,
            soul_document={
                "identity": soul.identity,
                "personality": soul.personality,
                "domain_expertise": soul.domain_expertise,
                "capabilities": soul.capabilities,
                "workflows": soul.workflows,
                "quality_standards": soul.quality_standards,
                "terminology": soul.terminology,
                "guardrails": soul.guardrails,
                "custom_instructions": soul.custom_instructions,
            },
            research_context={
                "facts_collected": len(facts),
                "quality_score": quality.overall,
                "quality_passed": quality.passed,
                "benchmark_score": benchmark_score,
            },
            has_rag=False,
            industry=inp.industry,
            task_context=inp.task,
            company_website=inp.company_website,
        )

        db.add(agent)
        db.flush()
        agent_id_for_cleanup = agent.id
        db.commit()
        db.refresh(agent)

        logger.info(f"AgentBrain v2: created agent id={agent.id} '{agent_name}' (q={quality.overall:.2f}, bench={benchmark_score:.2f})")
        await _emit("done", 1.0, f"Agent '{agent_name}' is ready!", agent={
            "id": agent.id,
            "name": agent.name,
            "role": agent.role,
            "industry": agent.industry,
            "benchmark_score": agent.benchmark_score,
            "quality_score": quality.overall,
            "capabilities": (agent.soul_document or {}).get("capabilities", [])[:5],
        })
        return agent

    except Exception as e:
        db.rollback()
        if agent_id_for_cleanup:
            try:
                KnowledgeBase.delete_agent_knowledge(agent_id_for_cleanup)
            except Exception:
                pass
        logger.error(f"AgentBrain v2 failed: {e}")
        raise


class DynamicAgentCreator:
    """Creates AI agents dynamically based on user prompts"""
    
    def __init__(self, db_session: Session):
        self.db = db_session
        self.registry = agent_registry
    
    def _build_tool_catalog_text(self) -> str:
        """Render the live tool registry as a readable list for the LLM prompt.

        Each line: `tool_name (category) [GATE_FLAGS]: short description`
        Only the first 90 chars of the description are included to keep the
        prompt concise.
        """
        from mcp_servers.core.mcp_tools import get_tool_catalog
        lines = []
        for t in get_tool_catalog():
            flags = []
            if t["approval_required"]:
                flags.append("REQUIRES_APPROVAL")
            if t["credentials_required"]:
                flags.append("NEEDS_EXTERNAL_CREDENTIALS")
            flag_str = f" [{', '.join(flags)}]" if flags else ""
            desc_short = t["description"][:90].replace("\n", " ")
            lines.append(f"  - {t['name']} ({t['category']}){flag_str}: {desc_short}")
        return "\n".join(lines)

    def _compute_gating_policy(self, tool_names: List[str]) -> Dict[str, List[str]]:
        """Inspect chosen tools and return which require approval / credentials."""
        from mcp_servers.core.mcp_tools import _TOOL_REGISTRY
        approval = [t for t in tool_names if _TOOL_REGISTRY.get(t, {}).get("approval_required")]
        creds = [t for t in tool_names if _TOOL_REGISTRY.get(t, {}).get("credentials_required")]
        return {
            "approval_required_tools": approval,
            "credential_required_tools": creds,
        }

    async def create_agent_from_prompt(
        self,
        user_id: int,
        user_prompt: str,
        user_email: str,
        agent_name: Optional[str] = None,
        role_description: Optional[str] = None,
        blueprint_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new agent from user prompt using LLM analysis"""
        try:
            logger.info(f"Creating agent from prompt: {user_prompt}")

            # Resolve blueprint seed if provided
            blueprint = None
            if blueprint_id:
                from services.agent_blueprints import BLUEPRINT_REGISTRY
                blueprint = BLUEPRINT_REGISTRY.get(blueprint_id)
                if blueprint:
                    logger.info(f"Using blueprint seed: {blueprint.archetype_name}")

            # Step 1: Analyze the prompt and create agent template
            agent_template = await self._analyze_prompt_and_create_template(
                user_prompt,
                agent_name,
                role_description,
                blueprint=blueprint,
                user_id=user_id,
                db=self.db
            )

            # Step 2: Generate detailed agent configuration
            agent_config = await self._generate_agent_config(
                user_prompt,
                agent_template,
                agent_name,
                role_description,
                blueprint=blueprint,
                user_id=user_id,
                db=self.db
            )
            
            # Step 3: Attach gating policy to config
            chosen_tools = agent_config.get("required_tools", [])
            agent_config["gating_policy"] = self._compute_gating_policy(chosen_tools)

            # Step 4: Create the agent in the database
            agent = await self._create_agent_in_db(user_id, agent_config, user_email)

            # Step 5: Register the agent in the registry
            await self._register_dynamic_agent(agent_config)
            
            logger.info(f"Successfully created agent: {agent.name}")
            
            # Transform capabilities to simple strings for consistency
            capabilities_list = []
            if agent_config.get("capabilities"):
                for cap in agent_config["capabilities"]:
                    if isinstance(cap, dict) and "name" in cap:
                        capabilities_list.append(cap["name"])
                    elif isinstance(cap, str):
                        capabilities_list.append(cap)
                    else:
                        capabilities_list.append(str(cap))
            
            # Check if agent requires external APIs
            required_apis = []
            if agent_config.get("required_tools"):
                for tool in agent_config["required_tools"]:
                    if tool in ["google_sheets", "google_drive", "google_docs", "google_forms", "google_tasks", "google_slides"]:
                        required_apis.append(tool)
            
            api_message = ""
            if required_apis:
                api_message = f" This agent requires API keys for: {', '.join(required_apis)}. Please add them in the API Keys section."
            
            return {
                "success": True,
                "agent": {
                    "id": agent.id,
                    "name": agent.name,
                    "description": agent.description,
                    "capabilities": capabilities_list,  # Now consistent with get_user_agents
                    "tools": agent_config.get("required_tools", []),
                    "workflows": agent_config.get("workflows", [])
                },
                "message": f"Agent '{agent.name}' created successfully with {len(capabilities_list)} capabilities.{api_message}",
                "required_apis": required_apis,
                "api_required": len(required_apis) > 0
            }
            
        except Exception as e:
            logger.error(f"Error creating agent from prompt: {e}")
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to create agent"
            }
    
    async def _analyze_prompt_and_create_template(
        self,
        user_prompt: str,
        agent_name: Optional[str] = None,
        role_description: Optional[str] = None,
        blueprint=None,
        user_id: Optional[int] = None,
        db: Optional[Session] = None,
    ) -> Dict[str, Any]:
        """Use LLM to analyze the prompt and create an agent template."""

        name_hint = f"AGENT_NAME: {agent_name}" if agent_name else "AGENT_NAME: Generate a descriptive name for the agent"
        role_hint = f"AGENT_ROLE: {role_description}" if role_description else "AGENT_ROLE: Generate the primary role/purpose"

        # Blueprint seed: pre-suggest tools so the LLM refines rather than guesses
        blueprint_hint = ""
        if blueprint:
            seed_tools = ", ".join(blueprint.suggested_tool_names)
            blueprint_hint = (
                f"\nBLUEPRINT CONTEXT: This agent is based on the '{blueprint.archetype_name}' archetype.\n"
                f"Suggested starting tools: {seed_tools}\n"
                f"Suggested instructions seed: {blueprint.suggested_instructions[:300]}\n"
            )

        from services.core_definitions import CORE_AGENTS, DEPARTMENTS
        core_types_desc = "\n".join([f"          - {k}: {v['description']}" for k, v in CORE_AGENTS.items()])
        depts_desc = "\n".join([f"          - {k}: {v['description']}" for k, v in DEPARTMENTS.items()])

        tool_catalog_text = self._build_tool_catalog_text()

        analysis_prompt = f"""
        Analyze this user prompt and create a comprehensive agent template.
        You are an Architect tasked with classifying this agent into our Core × Department matrix, IF it fits.
        If it's entirely novel, you may invent a new CORE_TYPE and/or DEPARTMENT string (e.g., "LEGAL", "CRYPTO", "MEDIATOR").

        AVAILABLE CORE TYPES:
{core_types_desc}

        AVAILABLE DEPARTMENTS:
{depts_desc}

        USER PROMPT: {user_prompt}
        {name_hint}
        {role_hint}
        {blueprint_hint}

        AVAILABLE TOOLS (choose ONLY the ones this agent actually needs):
{tool_catalog_text}

        Create a JSON template for an AI agent that can fulfill this request. Include:

        1. AGENT_NAME: {agent_name if agent_name else "A descriptive name for the agent"}
        2. AGENT_ROLE: {role_description if role_description else "The primary role/purpose"}
        3. CORE_TYPE: The chosen core type (e.g., "ROUTER", "RESEARCHER", or a custom word).
        4. DEPARTMENT: The chosen department (e.g., "SALES", "ECOMMERCE", or a custom word).
        5. CAPABILITIES: List of 3-5 specific capabilities this agent should have
        6. REQUIRED_TOOLS: List of tool names chosen from the AVAILABLE TOOLS list above
        7. WORKFLOW_STEPS: List of 3-5 workflow steps the agent should follow
        8. LLM_ROLE: Specific role for the LLM (e.g., "data_analyst", "content_creator", "project_manager")
        9. TEMPERATURE: LLM temperature (0.1-0.8, lower for precise tasks, higher for creative tasks)
        10. CUSTOM_INSTRUCTIONS: Specific instructions for this agent's behavior

        Return ONLY valid JSON, no other text.
        """
        
        try:
            response = await llm_agenerate(
                role="drafter",
                messages=[
                    {"role": "system", "content": "You are an expert at analyzing user requirements and creating AI agent templates. Return only valid JSON."},
                    {"role": "user", "content": analysis_prompt}
                ],
                user_id=user_id,
                db=db,
                temperature=0.3,
                max_tokens=1500,
                response_format="json_object"
            )
            
            content = response.choices[0].message.content.strip()
            
            # Parse the JSON response
            try:
                template = json.loads(content)
                logger.info(f"Generated agent template: {template.get('AGENT_NAME', 'Unknown')}")
                return template
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse LLM response as JSON: {e}")
                # Fallback template
                return self._create_fallback_template(user_prompt)
                
        except Exception as e:
            logger.error(f"Error in LLM analysis: {e}")
            return self._create_fallback_template(user_prompt)
    
    def _create_fallback_template(self, user_prompt: str) -> Dict[str, Any]:
        """Create a fallback template if LLM analysis fails"""
        return {
            "AGENT_NAME": f"Custom Agent for {user_prompt[:30]}...",
            "AGENT_ROLE": "Custom task execution",
            "CORE_TYPE": "CUSTOM",
            "DEPARTMENT": "CUSTOM",
            "CAPABILITIES": ["Task Analysis", "Execution Planning", "Result Delivery"],
            "REQUIRED_TOOLS": ["google_docs", "google_sheets"],
            "WORKFLOW_STEPS": ["analyze_request", "plan_execution", "execute_task", "deliver_results"],
            "LLM_ROLE": "task_executor",
            "TEMPERATURE": 0.3,
            "CUSTOM_INSTRUCTIONS": f"Execute tasks related to: {user_prompt}"
        }
    
    async def _generate_agent_config(
        self,
        user_prompt: str,
        template: Dict[str, Any],
        agent_name: Optional[str] = None,
        role_description: Optional[str] = None,
        blueprint=None,
        user_id: Optional[int] = None,
        db: Optional[Session] = None,
    ) -> Dict[str, Any]:
        """Generate detailed agent configuration from template."""

        name_field = f"1. name: {agent_name}" if agent_name else "1. name: Agent name"
        role_field = f"2. role: {role_description}" if role_description else "2. role: Detailed role description"

        blueprint_instr = ""
        if blueprint:
            blueprint_instr = (
                f"\nBLUEPRINT INSTRUCTIONS TO FOLLOW:\n{blueprint.suggested_instructions}\n"
            )

        config_prompt = f"""
        Based on this template, create a detailed agent configuration:

        TEMPLATE: {json.dumps(template, indent=2)}
        USER_PROMPT: {user_prompt}
        {name_field}
        {role_field}
        {blueprint_instr}

        Create a detailed JSON configuration with:

        {name_field}
        {role_field}
        3. core_type: Transferred directly from the TEMPLATE.
        4. department: Transferred directly from the TEMPLATE.
        5. description: Detailed description of what this agent does
        6. capabilities: Array of capability objects with name, description, examples
        7. workflows: Array of workflow objects with step_name, description, input_data, expected_output
        8. required_tools: Array of tool names (use exact names from the template's REQUIRED_TOOLS)
        9. optional_tools: Array of optional tool names
        10. llm_role: LLM role for this agent
        11. temperature: LLM temperature setting
        12. custom_instructions: Detailed instructions for the agent

        Return ONLY valid JSON, no other text.
        """
        
        try:
            response = await llm_agenerate(
                role="drafter",
                messages=[
                    {"role": "system", "content": "You are an expert at creating detailed AI agent configurations. Return only valid JSON."},
                    {"role": "user", "content": config_prompt}
                ],
                user_id=user_id,
                db=db,
                temperature=0.2,
                max_tokens=2000,
                response_format="json_object"
            )
            
            content = response.choices[0].message.content.strip()
            
            try:
                config = json.loads(content)
                logger.info(f"Generated agent config for: {config.get('name', 'Unknown')}")
                return config
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse agent config JSON: {e}")
                return self._create_fallback_config(template, user_prompt)
                
        except Exception as e:
            logger.error(f"Error generating agent config: {e}")
            return self._create_fallback_config(template, user_prompt)
    
    def _create_fallback_config(self, template: Dict[str, Any], user_prompt: str) -> Dict[str, Any]:
        """Create fallback configuration if LLM generation fails"""
        return {
            "name": template.get("AGENT_NAME", "Custom Agent"),
            "core_type": template.get("CORE_TYPE", "CUSTOM"),
            "department": template.get("DEPARTMENT", "CUSTOM"),
            "description": f"Custom agent created to handle: {user_prompt}",
            "capabilities": [
                {
                    "name": cap,
                    "description": f"Ability to {cap.lower()}",
                    "examples": [f"Example of {cap.lower()}"]
                }
                for cap in template.get("CAPABILITIES", ["Task Execution"])
            ],
            "workflows": [
                {
                    "step_name": step,
                    "description": f"Execute {step}",
                    "input_data": {"task": "string"},
                    "expected_output": f"Result of {step}"
                }
                for step in template.get("WORKFLOW_STEPS", ["analyze", "execute", "deliver"])
            ],
            "required_tools": template.get("REQUIRED_TOOLS", ["google_docs"]),
            "optional_tools": [],
            "llm_role": "custom",  # Always set to "custom" for dynamically created agents
            "temperature": template.get("TEMPERATURE", 0.3),
            "custom_instructions": template.get("CUSTOM_INSTRUCTIONS", f"Handle tasks related to: {user_prompt}")
        }
    
    async def _create_agent_in_db(self, user_id: int, agent_config: Dict[str, Any], user_email: str) -> AIAgent:
        """Create the agent in the database"""
        
        # Transform capabilities from dict format to string format
        capabilities_list = []
        if agent_config.get("capabilities"):
            for cap in agent_config["capabilities"]:
                if isinstance(cap, dict) and "name" in cap:
                    capabilities_list.append(cap["name"])
                elif isinstance(cap, str):
                    capabilities_list.append(cap)
                else:
                    capabilities_list.append(str(cap))
        
        # Transform workflow steps from JSON strings to dicts if needed
        workflow_steps_list = []
        if agent_config.get("workflows"):
            for workflow in agent_config["workflows"]:
                if isinstance(workflow, str):
                    try:
                        workflow_dict = json.loads(workflow)
                        workflow_steps_list.append(workflow_dict)
                    except json.JSONDecodeError:
                        workflow_steps_list.append({"step_name": "Unknown", "description": workflow})
                elif isinstance(workflow, dict):
                    workflow_steps_list.append(workflow)
                else:
                    workflow_steps_list.append({"step_name": "Unknown", "description": str(workflow)})
        
        # Create AgentConfig object
        config_obj = AgentConfig(
            name=agent_config["name"],
            description=agent_config["description"],
            role="custom",  # Always set role to "custom" for dynamically created agents
            capabilities=capabilities_list,
            tools=agent_config.get("required_tools", []),
            workflow_steps=workflow_steps_list,
            core_type=agent_config.get("core_type"),
            department=agent_config.get("department"),
            llm_role=agent_config.get("llm_role", "custom"),
            temperature=agent_config.get("temperature", 0.3),
            custom_instructions=agent_config.get("custom_instructions", "")
        )
        
        # Create AIAgent
        agent = AIAgent(
            user_id=user_id,
            name=agent_config["name"],
            description=agent_config["description"],
            role="custom",  # Always set role to "custom" for dynamically created agents
            agent_config=config_obj.dict()
        )
        
        self.db.add(agent)
        self.db.commit()
        self.db.refresh(agent)
        
        logger.info(f"Created agent in database: {agent.name} (ID: {agent.id})")
        return agent
    
    async def _register_dynamic_agent(self, agent_config: Dict[str, Any]) -> bool:
        """Register the dynamically created agent in the registry"""
        try:
            # Create AgentDefinition for registry
            # Note: required_tools stored as plain List[str] - no ToolType enum mapping.
            # The ToolType enum only covers the original 12 built-in tools; dynamic agents
            # may reference any tool from the registry (including Phase 3+ tools).
            # Storing strings avoids silent drops caused by hasattr(ToolType, ...) filtering.
            raw_tools: List[str] = agent_config.get("required_tools", [])
            raw_optional: List[str] = agent_config.get("optional_tools", [])

            agent_def = AgentDefinition(
                agent_type=AgentType.CUSTOM,
                name=agent_config["name"],
                description=agent_config["description"],
                capabilities=[
                    AgentCapability(
                        name=cap["name"],
                        description=cap["description"],
                        required_tools=[],   # string tools stored on agent_config, not here
                        examples=cap.get("examples", [])
                    )
                    for cap in agent_config.get("capabilities", [])
                ],
                workflows=[
                    AgentWorkflow(
                        step_name=workflow["step_name"],
                        description=workflow["description"],
                        required_tools=[],
                        input_data=workflow.get("input_data", {}),
                        expected_output=workflow.get("expected_output", "")
                    )
                    for workflow in agent_config.get("workflows", [])
                ],
                required_tools=[],   # authoritative list lives in agent_config["tools"]
                optional_tools=[],
                llm_role=agent_config.get("llm_role", "custom"),
                temperature=agent_config.get("temperature", 0.3),
                custom_instructions=agent_config.get("custom_instructions", ""),
                created_at=datetime.now(),
                updated_at=datetime.now()
            )
            
            # Add to registry
            success = self.registry.add_custom_agent(agent_def)

            if success:
                logger.info(f"Successfully registered dynamic agent: {agent_config['name']}")
            else:
                logger.warning(f"Failed to register dynamic agent: {agent_config['name']}")

            return success

        except Exception as e:
            logger.error(f"Error registering dynamic agent: {e}")
            return False
    
    async def get_user_agents(self, user_id: int) -> List[Dict[str, Any]]:
        """Get only the custom agents created by this user (excludes platform defaults)."""
        import asyncio as _asyncio
        try:
            agents = await _asyncio.to_thread(
                lambda: self.db.query(AIAgent).filter(
                    AIAgent.user_id == user_id,
                    AIAgent.is_default == False,
                ).all()
            )
            
            agent_list = []
            for agent in agents:
                agent_config = agent.agent_config
                
                # Ensure agent_config is a dictionary
                if not isinstance(agent_config, dict):
                    logger.warning(f"Agent {agent.id} has invalid agent_config format: {type(agent_config)}")
                    agent_config = {}
                
                # Safely extract capabilities, ensuring they're strings
                capabilities = []
                if agent_config.get("capabilities"):
                    for cap in agent_config["capabilities"]:
                        if isinstance(cap, str):
                            capabilities.append(cap)
                        elif isinstance(cap, dict) and "name" in cap:
                            capabilities.append(cap["name"])
                        else:
                            capabilities.append(str(cap))
                
                # Safely extract tools
                tools = agent_config.get("tools", [])
                if not isinstance(tools, list):
                    tools = []
                
                # Safely extract workflows and normalize to List[Dict]
                raw_workflows = agent_config.get("workflow_steps", [])
                workflows = []
                if isinstance(raw_workflows, list):
                    for w in raw_workflows:
                        if isinstance(w, dict):
                            workflows.append(w)
                        elif isinstance(w, str):
                            # Normalize string to dict for Pydantic/Frontend consistency
                            workflows.append({"step_name": w, "description": w})
                        else:
                            workflows.append({"step_name": "Step", "description": str(w)})
                
                agent_list.append({
                    "id": agent.id,
                    "name": agent.name,
                    "description": agent.description,
                    "role": agent.role,
                    "industry": getattr(agent, "industry", None),
                    "benchmark_score": getattr(agent, "benchmark_score", None),
                    "research_context": getattr(agent, "research_context", None),
                    "has_rag": getattr(agent, "has_rag", False),
                    "agent_config": agent_config,
                    "capabilities": capabilities,
                    "tools": tools,
                    "workflows": workflows,
                    "created_at": agent.created_at.isoformat() if agent.created_at else None,
                    "is_default": bool(getattr(agent, "is_default", False)),
                })
            
            return agent_list
            
        except Exception as e:
            logger.error(f"Error getting user agents: {e}")
            return []
    
    async def delete_user_agent(self, user_id: int, agent_id: int) -> bool:
        """Delete a user's agent"""
        try:
            agent = self.db.query(AIAgent).filter(
                AIAgent.id == agent_id,
                AIAgent.user_id == user_id
            ).first()
            
            if not agent:
                return False
            
            # Remove from registry if it's a custom agent
            if agent.role == "custom":
                # Find and remove from registry
                for agent_type, agent_def in self.registry.agents.items():
                    if agent_def.name == agent.name:
                        self.registry.deactivate_agent(agent_type)
                        break
            
            # Remove from database
            self.db.delete(agent)
            self.db.commit()

            # Purge ChromaDB collection if agent had RAG
            if agent.has_rag:
                try:
                    from services.knowledge_base import KnowledgeBase
                    KnowledgeBase.delete_agent_knowledge(agent.id)
                except Exception as rag_err:
                    logger.warning(f"RAG cleanup failed for agent {agent.id}: {rag_err}")

            logger.info(f"Deleted agent: {agent.name}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting agent: {e}")
            self.db.rollback()
            return False
