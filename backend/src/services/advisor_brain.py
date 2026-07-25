"""
Advisor Brain - 3-layer proactive advice engine.

Layer 1: In-memory signal counters (per user, <1ms)
Layer 2: Rule engine - fires hint candidates (<5ms)
Layer 3: Groq micro-LLM call - only when L2 fires (opt-in, ~1s)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional

import litellm
from loguru import logger


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class UserSignals:
    token_window: deque = field(default_factory=lambda: deque(maxlen=20))  # (timestamp, tokens)
    prompt_hashes: deque = field(default_factory=lambda: deque(maxlen=10))
    loop_depth: int = 0
    task_fail_count: int = 0
    agent_reruns: deque = field(default_factory=lambda: deque(maxlen=10))   # timestamps
    model_used: str = ""
    last_prompt_len: int = 0


@dataclass
class Advice:
    rule_id: str
    message: str
    action_label: Optional[str] = None
    action_type: Optional[str] = None  # "switch_model" | "save_template" | "reduce_context" etc.
    icon: str = "💡"


# ── Cooldown tracker ──────────────────────────────────────────────────────────

_COOLDOWNS: dict[str, dict[str, float]] = defaultdict(dict)  # user → rule_id → last_fired_ts

_RULE_COOLDOWNS = {
    "repeated_prompt":   30 * 60,
    "token_spike":       60 * 60,
    "agent_loop":        10 * 60,
    "expensive_model":   60 * 60,
    "repeated_failure":  20 * 60,
    "same_agent_rerun":  30 * 60,
    "context_too_long":  30 * 60,
}


def _cooldown_ok(user_email: str, rule_id: str) -> bool:
    last = _COOLDOWNS[user_email].get(rule_id, 0)
    return (time.time() - last) >= _RULE_COOLDOWNS.get(rule_id, 1800)


def _mark_fired(user_email: str, rule_id: str) -> None:
    _COOLDOWNS[user_email][rule_id] = time.time()


# ── Global signal store ───────────────────────────────────────────────────────

_SIGNALS: dict[str, UserSignals] = defaultdict(UserSignals)


def get_signals(user_email: str) -> UserSignals:
    return _SIGNALS[user_email]


# ── Layer 1: Update signals ───────────────────────────────────────────────────

def update_signals(
    user_email: str,
    *,
    tokens_used: int = 0,
    prompt: str = "",
    loop_depth: int = 0,
    task_failed: bool = False,
    agent_type: str = "",
    model: str = "",
) -> None:
    s = _SIGNALS[user_email]
    now = time.time()

    if tokens_used:
        s.token_window.append((now, tokens_used))

    if prompt:
        h = hashlib.md5(prompt.strip().lower().encode()).hexdigest()
        s.prompt_hashes.append(h)
        s.last_prompt_len = len(prompt)

    s.loop_depth = loop_depth

    if task_failed:
        s.task_fail_count += 1
    else:
        s.task_fail_count = 0  # reset on success

    if agent_type:
        s.agent_reruns.append((now, agent_type))

    if model:
        s.model_used = model


# ── Layer 2: Rule engine ──────────────────────────────────────────────────────

def _tokens_last_5min(s: UserSignals) -> int:
    cutoff = time.time() - 300
    return sum(t for ts, t in s.token_window if ts >= cutoff)


def _prompt_collision_count(s: UserSignals) -> int:
    hashes = list(s.prompt_hashes)
    if not hashes:
        return 0
    return hashes.count(hashes[-1])


def _same_agent_reruns_last_10min(s: UserSignals, agent_type: str) -> int:
    cutoff = time.time() - 600
    return sum(1 for ts, a in s.agent_reruns if ts >= cutoff and a == agent_type)


def check_rules(user_email: str, agent_type: str = "") -> Optional[str]:
    """Return the first matching rule_id or None."""
    s = _SIGNALS[user_email]

    if _prompt_collision_count(s) >= 2 and _cooldown_ok(user_email, "repeated_prompt"):
        return "repeated_prompt"

    if _tokens_last_5min(s) > 10_000 and _cooldown_ok(user_email, "token_spike"):
        return "token_spike"

    if s.loop_depth > 5 and _cooldown_ok(user_email, "agent_loop"):
        return "agent_loop"

    if s.last_prompt_len < 80 and "gpt-4o" in s.model_used and _cooldown_ok(user_email, "expensive_model"):
        return "expensive_model"

    if s.task_fail_count >= 3 and _cooldown_ok(user_email, "repeated_failure"):
        return "repeated_failure"

    if agent_type and _same_agent_reruns_last_10min(s, agent_type) >= 3 and _cooldown_ok(user_email, "same_agent_rerun"):
        return "same_agent_rerun"

    if s.last_prompt_len > 4000 and _cooldown_ok(user_email, "context_too_long"):
        return "context_too_long"

    return None


# ── Layer 3: Micro-LLM advice generation ─────────────────────────────────────

_RULE_CONTEXT = {
    "repeated_prompt":   ("💡", "User is sending the same prompt repeatedly.", "save_template"),
    "token_spike":       ("💸", "User consumed 10k+ tokens in 5 minutes.", "reduce_context"),
    "agent_loop":        ("🔁", "Agent is stuck in a tool call loop.", "simplify_task"),
    "expensive_model":   ("💡", "User is using GPT-4o for a very short/simple prompt.", "switch_model"),
    "repeated_failure":  ("⚠️", "Task has failed 3 times in a row.", "debug_hint"),
    "same_agent_rerun":  ("💡", "User is re-running the same agent 3+ times in 10 minutes.", "save_template"),
    "context_too_long":  ("📏", "User's prompt is very long (4000+ chars).", "reduce_context"),
}

_FALLBACK_ADVICE: dict[str, Advice] = {
    "repeated_prompt":  Advice("repeated_prompt",  "💡 You're sending the same prompt - save it as a template to reuse it in one click.", "Save as Template", "save_template"),
    "token_spike":      Advice("token_spike",       "💸 High token usage detected - try shorter tasks or enable Cost Optimization Mode.", "Enable Cost Mode", "cost_mode"),
    "agent_loop":       Advice("agent_loop",        "🔁 Agent is looping - break the task into smaller steps for better results.", None, "simplify_task"),
    "expensive_model":  Advice("expensive_model",   "💡 You're using GPT-4o for a short task - switch to a faster, cheaper model.", "Switch Model", "switch_model"),
    "repeated_failure": Advice("repeated_failure",  "⚠️ Task keeps failing - check your API key or try rephrasing the request.", None, "debug_hint"),
    "same_agent_rerun": Advice("same_agent_rerun",  "💡 Running this agent repeatedly - save it as a workflow template.", "Save Template", "save_template"),
    "context_too_long": Advice("context_too_long",  "📏 Your prompt is very long - trim it or attach a document instead.", None, "reduce_context"),
}


async def generate_advice(user_email: str, rule_id: str, recent_actions: list[str]) -> Advice:
    """L3: Ask Groq for a one-sentence advice. Falls back to static map if it fails."""
    icon, context, action_type = _RULE_CONTEXT.get(rule_id, ("💡", rule_id, None))
    actions_str = " | ".join(recent_actions[-3:]) if recent_actions else "N/A"

    try:
        resp = await asyncio.to_thread(
            litellm.completion,
            model="groq/llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a concise AI productivity advisor. "
                        "Output ONLY valid JSON with keys: message (string, max 12 words), "
                        "action_label (string or null, max 3 words). No extra text."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Situation: {context}\nRecent actions: {actions_str}\nRule: {rule_id}",
                },
            ],
            max_tokens=80,
            temperature=0.3,
        )
        raw = resp.choices[0].message.content.strip()
        data = json.loads(raw)
        return Advice(
            rule_id=rule_id,
            message=f"{icon} {data.get('message', '')}",
            action_label=data.get("action_label"),
            action_type=action_type,
            icon=icon,
        )
    except Exception as e:
        logger.debug(f"Advisor L3 fallback ({rule_id}): {e}")
        return _FALLBACK_ADVICE.get(rule_id, Advice(rule_id, "💡 Tip: optimize your workflow for better results."))


# ── Public API ────────────────────────────────────────────────────────────────

async def maybe_advise(
    user_email: str,
    agent_type: str = "",
    recent_actions: list[str] | None = None,
) -> Optional[dict]:
    """
    Call after each agent task. Returns advice dict or None.
    Dict shape: { rule_id, message, action_label, action_type, icon }
    """
    rule_id = check_rules(user_email, agent_type)
    if not rule_id:
        return None

    _mark_fired(user_email, rule_id)
    advice = await generate_advice(user_email, rule_id, recent_actions or [])
    return {
        "rule_id": advice.rule_id,
        "message": advice.message,
        "action_label": advice.action_label,
        "action_type": advice.action_type,
        "icon": advice.icon,
    }
