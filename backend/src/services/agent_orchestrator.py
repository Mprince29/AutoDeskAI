"""
Agent Orchestrator - OpenClaw Hub-and-Spoke Multi-Agent Engine

Implements the ROUTER agent's core behaviour: decompose a complex goal into
ordered sub-tasks, delegate each to the best available agent, execute them
in dependency order (with parallelism where possible), then synthesise the
results into a single coherent response.

This module is called by AgentExecutor when the active agent's soul_document
has core_type == "ROUTER".  It works with both:
  - DB-backed custom agents (looked up by user)
  - Built-in AgentType registry entries (fallback when no custom agent matches)

Usage (from AgentExecutor):
    from services.agent_orchestrator import AgentOrchestrator

    orchestrator = AgentOrchestrator()
    async for chunk in orchestrator.orchestrate_stream(
        goal=task_description,
        user_email=user_email,
        db=db,
    ):
        yield chunk
"""

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, List, Optional

from loguru import logger


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class SubTask:
    task_id: str                          # t1, t2, …
    description: str
    required_core_type: str              # CREATOR, RESEARCHER, OBSERVER, etc.
    required_department: Optional[str] = None
    depends_on: List[str] = field(default_factory=list)  # task_ids that must finish first
    result: Optional[str] = None
    status: str = "pending"              # pending | running | done | failed
    duration_ms: float = 0.0


@dataclass
class OrchestrationPlan:
    goal: str
    subtasks: List[SubTask]
    execution_groups: List[List[str]]    # groups of task_ids that can run in parallel


# ── Orchestrator ──────────────────────────────────────────────────────────────

class AgentOrchestrator:
    """Decomposes a goal and delegates sub-tasks to specialised agents.

    Key design decisions:
    - MAX_SUBTASKS=6 prevents runaway decomposition
    - Topological sort enables parallelism across independent sub-tasks
    - Each sub-task receives context from its dependencies
    - Aggregation is LLM-powered; falls back to concatenation on failure
    - All errors are caught per-subtask so one failure doesn't abort the plan
    """

    MAX_SUBTASKS = 6
    PARALLEL_LIMIT = 3  # max concurrent sub-tasks to avoid rate limits

    # ── Public interface ──────────────────────────────────────────────────────

    async def orchestrate_stream(
        self,
        goal: str,
        user_email: str,
        db,
        context: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[str, None]:
        """Main streaming entry point.

        Yields JSON strings matching the existing chunk protocol:
          {"type": "orchestration_start", "goal": "..."}
          {"type": "plan", "subtasks": [...]}
          {"type": "subtask_start", "id": "t1", "description": "..."}
          {"type": "chunk", "text": "..."}           ← forwarded from sub-agent
          {"type": "subtask_done", "id": "t1", "preview": "..."}
          {"type": "aggregating"}
          {"type": "result", "text": "...", "tools_used": [...]}
        """
        _start = time.monotonic()

        yield json.dumps({"type": "orchestration_start", "goal": goal[:120]}) + "\n"

        # ── Step 1: Load user's available agents ──────────────────────────────
        available_agents = await self._load_user_agents(user_email, db)

        # ── Step 2: Decompose goal into sub-tasks ─────────────────────────────
        try:
            plan = await self._decompose(goal, available_agents)
        except Exception as exc:
            logger.error(f"Orchestrator decompose failed: {exc}")
            # Fall back to single-task execution
            plan = OrchestrationPlan(
                goal=goal,
                subtasks=[SubTask("t1", goal, "CUSTOM")],
                execution_groups=[["t1"]],
            )

        yield json.dumps({
            "type": "plan",
            "subtasks": [
                {
                    "id": s.task_id,
                    "description": s.description,
                    "core_type": s.required_core_type,
                    "depends_on": s.depends_on,
                }
                for s in plan.subtasks
            ],
        }) + "\n"

        # ── Step 3: Execute groups in order ───────────────────────────────────
        all_tools_used: List[str] = []

        for group in plan.execution_groups:
            group_tasks = [t for t in plan.subtasks if t.task_id in group]

            if len(group_tasks) == 1:
                # Sequential - stream output inline
                task = group_tasks[0]
                yield json.dumps({
                    "type": "subtask_start",
                    "id": task.task_id,
                    "description": task.description[:100],
                    "core_type": task.required_core_type,
                }) + "\n"

                result, tools = await self._execute_subtask(
                    task, plan, user_email, db, available_agents
                )
                task.result = result
                task.status = "done" if not result.startswith("[ERROR") else "failed"
                task.duration_ms = 0
                all_tools_used.extend(tools)

                yield json.dumps({
                    "type": "subtask_done",
                    "id": task.task_id,
                    "status": task.status,
                    "preview": (result or "")[:200],
                }) + "\n"

            else:
                # Parallel - execute concurrently, yield completions as they arrive
                semaphore = asyncio.Semaphore(self.PARALLEL_LIMIT)

                async def _guarded(t: SubTask):
                    async with semaphore:
                        return t, await self._execute_subtask(
                            t, plan, user_email, db, available_agents
                        )

                coros = [_guarded(t) for t in group_tasks]
                for future in asyncio.as_completed(coros):
                    try:
                        task, (result, tools) = await future
                        task.result = result
                        task.status = "done" if not result.startswith("[ERROR") else "failed"
                        all_tools_used.extend(tools)
                        yield json.dumps({
                            "type": "subtask_done",
                            "id": task.task_id,
                            "status": task.status,
                            "preview": (result or "")[:200],
                        }) + "\n"
                    except Exception as exc:
                        logger.error(f"Parallel sub-task failed: {exc}")

        # ── Step 4: Aggregate ─────────────────────────────────────────────────
        yield json.dumps({"type": "aggregating"}) + "\n"

        final_text = await self._aggregate(goal, plan.subtasks)
        elapsed_ms = round((time.monotonic() - _start) * 1000)

        yield json.dumps({
            "type": "result",
            "text": final_text,
            "tools_used": list(set(all_tools_used)),
            "subtask_count": len(plan.subtasks),
            "duration_ms": elapsed_ms,
        }) + "\n"

    # ── Decomposition ─────────────────────────────────────────────────────────

    async def _decompose(
        self, goal: str, available_agents: List[Any]
    ) -> OrchestrationPlan:
        """Ask the LLM to split the goal into ≤MAX_SUBTASKS ordered sub-tasks."""
        from utils.llm_router import agenerate

        agent_summary = "\n".join(
            f"  - {getattr(a, 'name', '?')} "
            f"(type={self._soul_field(a, 'core_type', 'CUSTOM')}, "
            f"dept={self._soul_field(a, 'department', 'GLOBAL')})"
            for a in available_agents[:15]
        ) or "  (no custom agents - use built-in core types)"

        valid_types = (
            "ROUTER, CREATOR, SENSOR, DISTRIBUTOR, OBSERVER, "
            "OPERATIONS, RESEARCHER, FUNNEL, MEMORY, CUSTOM"
        )

        prompt = (
            f"You are a Senior Task Orchestrator. Decompose this goal into ≤{self.MAX_SUBTASKS} "
            f"sub-tasks for specialised AI agents.\n\n"
            f"GOAL: {goal}\n\n"
            f"AVAILABLE AGENTS:\n{agent_summary}\n\n"
            f"VALID CORE TYPES: {valid_types}\n\n"
            "MANDATORY PROTOCOL:\n"
            "1. RESEARCH FIRST: For complex business processes (Hiring, Sales, Procurement, etc.), "
            "the VERY FIRST sub-task MUST be a 'RESEARCHER' task to query the Knowledge Base for "
            "Company SOPs, legal requirements, and platform-specific workflows. Do NOT guess the process.\n"
            "2. TOOL MAPPING: Assign tasks to specific departments (HR, SALES, OPS) if an agent matches.\n"
            "3. DEPENDENCY: Subsequent tasks MUST depend on the research findings (t1).\n"
            "4. COHERENCE: Each description must be a specific actionable command.\n\n"
            "Return ONLY valid JSON:\n"
            '{"subtasks": ['
            '{"task_id":"t1","description":"Research Company SOPs and legal requirements for [Goal] in the Knowledge Base","required_core_type":"RESEARCHER","depends_on":[]},'
            '{"task_id":"t2","description":"Execute [Next Step] based on research findings","required_core_type":"CREATOR","depends_on":["t1"]}'
            "]}"
        )

        resp = await agenerate(
            role="drafter",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=800,
        )
        raw = resp.choices[0].message.content.strip()

        # Strip markdown code fences if present
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0]
        elif "```" in raw:
            raw = raw.split("```")[1].split("```")[0]

        data = json.loads(raw)
        subtasks = [
            SubTask(
                task_id=s["task_id"],
                description=s["description"],
                required_core_type=s.get("required_core_type", "CUSTOM").upper(),
                required_department=s.get("required_department"),
                depends_on=s.get("depends_on", []),
            )
            for s in data.get("subtasks", [])[:self.MAX_SUBTASKS]
        ]

        if not subtasks:
            subtasks = [SubTask("t1", goal, "CUSTOM")]

        return OrchestrationPlan(
            goal=goal,
            subtasks=subtasks,
            execution_groups=self._topological_groups(subtasks),
        )

    # ── Topological sort → execution groups ──────────────────────────────────

    @staticmethod
    def _topological_groups(subtasks: List[SubTask]) -> List[List[str]]:
        """Group tasks that can run in parallel (all deps complete)."""
        completed: set = set()
        groups: List[List[str]] = []
        remaining = list(subtasks)

        while remaining:
            ready = [t for t in remaining if all(d in completed for d in t.depends_on)]
            if not ready:
                # Circular dependency guard - run remaining sequentially
                ready = remaining
            groups.append([t.task_id for t in ready])
            completed.update(t.task_id for t in ready)
            remaining = [t for t in remaining if t.task_id not in completed]

        return groups

    # ── Sub-task execution ────────────────────────────────────────────────────

    async def _execute_subtask(
        self,
        subtask: SubTask,
        plan: OrchestrationPlan,
        user_email: str,
        db,
        available_agents: List[Any],
    ) -> tuple[str, List[str]]:
        """Execute one sub-task; returns (result_text, tools_used_list)."""

        # Build context from completed dependencies
        dep_context = "\n\n".join(
            f"[Result of '{t.description[:60]}']\n{t.result[:600]}"
            for dep_id in subtask.depends_on
            for t in plan.subtasks
            if t.task_id == dep_id and t.result
        )

        task_with_context = subtask.description
        if dep_context:
            task_with_context = (
                f"{subtask.description}\n\n"
                f"--- Context from earlier steps ---\n{dep_context}"
            )

        # Select the best agent
        agent = self._select_agent(subtask.required_core_type, available_agents)

        from services.agent_executor import AgentExecutor
        executor = AgentExecutor()

        try:
            if agent is not None:
                # DB-backed custom agent
                result = await executor._execute_agent_workflow(
                    agent, task_with_context, user_email, {}, security_token=None
                )
            else:
                # Fall back to built-in agent type
                result = await executor.execute_agent_task(
                    subtask.required_core_type.lower(),
                    task_with_context,
                    user_email,
                    {},
                )

            # Normalise result shape
            if isinstance(result, dict):
                summary = result.get("summary", {})
                text = (
                    summary.get("message")
                    or result.get("result", {}).get("summary", {}).get("message")
                    or result.get("error")
                    or str(result)
                )
                tools_used = summary.get("tools_used", []) or []
            else:
                text = str(result)
                tools_used = []

            return text or "[No result returned]", tools_used

        except Exception as exc:
            logger.error(f"Sub-task {subtask.task_id} ({subtask.required_core_type}) failed: {exc}")
            return f"[ERROR: {exc}]", []

    # ── Agent selection ───────────────────────────────────────────────────────

    def _select_agent(self, required_core_type: str, available_agents: List[Any]) -> Optional[Any]:
        """Return the best matching user agent, or None to fall back to built-in."""
        ctype = required_core_type.upper()

        # Exact soul_document.core_type match
        for agent in available_agents:
            if self._soul_field(agent, "core_type", "").upper() == ctype:
                return agent

        # Name contains the type keyword
        for agent in available_agents:
            name = getattr(agent, "name", "").lower()
            if ctype.lower() in name:
                return agent

        return None  # caller will use built-in executor

    # ── Aggregation ───────────────────────────────────────────────────────────

    async def _aggregate(self, goal: str, subtasks: List[SubTask]) -> str:
        """Synthesise all sub-task results into a final coherent response."""
        from utils.llm_router import agenerate

        completed = [t for t in subtasks if t.result and t.status == "done"]

        if not completed:
            return "All sub-tasks failed - no results to aggregate."

        if len(completed) == 1:
            return completed[0].result  # nothing to merge

        sections = "\n\n".join(
            f"### {t.description[:80]}\n{t.result[:1000]}"
            for t in completed
        )

        prompt = (
            f"You are synthesising the output of a multi-agent workflow.\n\n"
            f"ORIGINAL GOAL: {goal}\n\n"
            f"SUB-TASK RESULTS:\n{sections}\n\n"
            "Write a single, coherent, professional response that fully addresses "
            "the original goal. Integrate all findings. Be concise and actionable. "
            "Do not repeat section headers or the original goal in your response."
        )

        try:
            resp = await agenerate(
                role="drafter",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=2500,
            )
            return resp.choices[0].message.content.strip()
        except Exception as exc:
            logger.warning(f"Aggregation LLM call failed ({exc}) - concatenating results")
            return "\n\n---\n\n".join(
                f"**{t.description}**\n{t.result}" for t in completed
            )

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _soul_field(agent: Any, field: str, default: str = "") -> str:
        soul = getattr(agent, "soul_document", None) or {}
        if isinstance(soul, dict):
            return soul.get(field, default)
        return default

    async def _load_user_agents(self, user_email: str, db) -> List[Any]:
        """Load the user's DB-backed agents and wrap them for execution."""
        try:
            from auth.models import User
            from models import AIAgent

            user = db.query(User).filter(User.email == user_email).first()
            if not user:
                return []

            agents = (
                db.query(AIAgent)
                .filter(AIAgent.user_id == user.id, AIAgent.is_active == True)  # noqa: E712
                .order_by(AIAgent.created_at.desc())
                .limit(30)
                .all()
            )

            wrapped = []
            for a in agents:
                cfg = a.agent_config or {}

                class _W:
                    pass

                w = _W()
                w.name = a.name
                w.description = a.description
                w.soul_document = a.soul_document
                w.agent_config = cfg
                w.is_active = True
                w.agent_id = a.id
                w.user_id = user.id
                w.has_rag = a.has_rag or False
                w.llm_role = cfg.get("role", "drafter")
                w.temperature = cfg.get("temperature", 0.3)
                w.custom_instructions = cfg.get("custom_instructions", "")
                w.required_tools = cfg.get("tools", [])
                w.workflows = cfg.get("workflow_steps", [])
                w.capabilities = cfg.get("capabilities", [])
                wrapped.append(w)

            return wrapped

        except Exception as exc:
            logger.error(f"_load_user_agents failed: {exc}")
            return []
