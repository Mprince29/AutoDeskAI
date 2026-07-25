"""LLM-as-Judge evaluation rubric service.

Aligns with the video's "observability via rubrics" concept: an auxiliary LLM
scores every completed agent output against structured criteria and persists
the result so a performance trend line can be drawn over time.

Usage (non-blocking fire-and-forget from AgentExecutor):
    asyncio.create_task(judge.evaluate(task, output_text, user_email, agent_type))
"""

import json
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Optional
from loguru import logger


# ── Rubric criteria ─────────────────────────────────────────────────────────

RUBRIC_CRITERIA = {
    "relevance": "Does the output directly address what was asked? (0=off-topic, 10=spot-on)",
    "completeness": "Is the output thorough — nothing important left out? (0=incomplete, 10=fully covered)",
    "accuracy": "Are all facts, dates, names, and data points correct? (0=many errors, 10=fully accurate)",
    "tone": "Is the tone appropriate for the context — professional, concise, not verbose? (0=poor tone, 10=ideal)",
    "actionability": "Does the output give the user something concrete they can act on? (0=vague, 10=immediately usable)",
}

# Weighted average: accuracy and completeness matter most
RUBRIC_WEIGHTS = {
    "relevance": 0.20,
    "completeness": 0.25,
    "accuracy": 0.30,
    "tone": 0.10,
    "actionability": 0.15,
}

JUDGE_MODEL = "groq/llama-3.1-8b-instant"  # Fast, cheap auxiliary judge

JUDGE_SYSTEM = """You are an impartial quality evaluator for an AI assistant platform.
Your job is to score the AI agent's output against a set of rubric criteria.
Respond ONLY with a valid JSON object — no markdown fences, no explanation outside the JSON.

Required format:
{
  "scores": {
    "relevance": <int 0-10>,
    "completeness": <int 0-10>,
    "accuracy": <int 0-10>,
    "tone": <int 0-10>,
    "actionability": <int 0-10>
  },
  "feedback": "<one sentence summarising quality>"
}"""


@dataclass
class EvalScore:
    scores: Dict[str, int]
    overall_score: float
    feedback: str
    judge_model: str = JUDGE_MODEL


class LLMJudge:
    """Evaluate agent output with an auxiliary LLM and persist results."""

    async def evaluate(
        self,
        task: str,
        output_text: str,
        user_email: str,
        agent_type: str = "unknown",
    ) -> Optional[EvalScore]:
        """Score the output and save to AgentEvalLog. Returns None on any error."""
        try:
            score = await self._call_judge(task, output_text)
            if score:
                await self._persist(score, task, output_text, user_email, agent_type)
            return score
        except Exception as e:
            logger.warning(f"LLMJudge evaluation failed (non-critical): {e}")
            return None

    async def _call_judge(self, task: str, output: str) -> Optional[EvalScore]:
        from utils.llm_router import generate, get_text

        criteria_block = "\n".join(
            f"- {k}: {v}" for k, v in RUBRIC_CRITERIA.items()
        )
        user_prompt = (
            f"TASK GIVEN TO AGENT:\n{task[:600]}\n\n"
            f"AGENT OUTPUT:\n{output[:1500]}\n\n"
            f"RUBRIC CRITERIA:\n{criteria_block}\n\n"
            "Score each criterion 0-10 and provide one-sentence feedback."
        )

        messages = [
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]
        resp = await asyncio.to_thread(
            generate,
            role="classifier",    # lightweight role → groq fast model
            messages=messages,
            max_tokens=300,
        )
        raw = get_text(resp)

        if not raw:
            return None

        # Strip markdown fences if the model added them anyway
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        data = json.loads(text)
        scores = {k: max(0, min(10, int(v))) for k, v in data["scores"].items()}
        overall = sum(scores[k] * RUBRIC_WEIGHTS[k] for k in RUBRIC_WEIGHTS if k in scores)
        return EvalScore(
            scores=scores,
            overall_score=round(overall, 2),
            feedback=data.get("feedback", ""),
        )

    @staticmethod
    async def _persist(
        score: EvalScore,
        task: str,
        output: str,
        user_email: str,
        agent_type: str,
    ) -> None:
        from auth.database import SessionLocal
        from models import AgentEvalLog

        db = SessionLocal()
        try:
            log = AgentEvalLog(
                user_email=user_email,
                agent_type=agent_type,
                task_summary=task[:300],
                output_summary=output[:300],
                scores=score.scores,
                overall_score=score.overall_score,
                feedback=score.feedback,
                judge_model=score.judge_model,
            )
            db.add(log)
            db.commit()
        except Exception as e:
            logger.warning(f"Failed to persist eval log: {e}")
        finally:
            db.close()


# Singleton
judge = LLMJudge()
