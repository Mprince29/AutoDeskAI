import re
from typing import Dict, Any, List
from loguru import logger

class DecisionTreeRouter:
    """
    O(depth) deterministic routing engine.
    Intercepts communication and negotiation drafts before they reach an LLM.
    If a known rule is violated, it instantly flags the payload without costing LLM tokens.
    """
    
    # Pre-compiled regex patterns for maximum O(1) matching speed
    URGENT_PATTERN = re.compile(r'\b(asap|urgent|immediately|end of day|eod)\b', re.IGNORECASE)
    AGGRESSIVE_PATTERN = re.compile(r'\b(unacceptable|disappointed|failure|breach|sue|lawyer)\b', re.IGNORECASE)
    CONCESSION_PATTERN = re.compile(r'\b(discount|waive|free|reduce|lower price)\b', re.IGNORECASE)
    CURRENCY_PATTERN = re.compile(r'(\$|€|£|₹)\s*\d+(?:,\d{3})*(?:\.\d{2})?')

    @staticmethod
    def _evaluate_tone(text: str) -> Dict[str, Any]:
        """Fast keyword-based tone evaluation."""
        flags = []
        is_aggressive = bool(DecisionTreeRouter.AGGRESSIVE_PATTERN.search(text))
        is_urgent = bool(DecisionTreeRouter.URGENT_PATTERN.search(text))
        
        if is_aggressive:
            flags.append("AGGRESSIVE_LANGUAGE_DETECTED")
        if is_urgent:
            flags.append("HIGH_URGENCY_DETECTED")
            
        return {
            "has_warnings": len(flags) > 0,
            "flags": flags,
            "requires_human_review": is_aggressive  # Aggressive emails must always be human-reviewed
        }

    @staticmethod
    def _evaluate_negotiation(text: str) -> Dict[str, Any]:
        """Fast keyword-based financial concession evaluation."""
        flags = []
        has_concession = bool(DecisionTreeRouter.CONCESSION_PATTERN.search(text))
        money_mentioned = DecisionTreeRouter.CURRENCY_PATTERN.findall(text)
        
        if has_concession:
            flags.append("UNAUTHORIZED_CONCESSION_DETECTED")
        if money_mentioned:
            flags.append(f"FINANCIAL_TERMS_DETECTED: {len(money_mentioned)} value(s)")
            
        return {
            "has_warnings": len(flags) > 0,
            "flags": flags,
            "requires_human_review": has_concession or len(money_mentioned) > 0 # Any financial change requires human review
        }

    @classmethod
    def process_draft(cls, draft_text: str, context_type: str = "communication") -> Dict[str, Any]:
        """
        Main entry point for the Decision Tree pre-router.
        Returns a deterministic safety classification.
        """
        logger.debug(f"Routing draft through Decision Tree for type: {context_type}")
        
        if not draft_text:
            return {"safe": True, "flags": [], "requires_human_review": False}
            
        result = {"safe": True, "flags": [], "requires_human_review": False}
        
        # Branch 1: Communication Simulator (Tone)
        if context_type in ["communication", "email", "reply"]:
            tone_eval = cls._evaluate_tone(draft_text)
            if tone_eval["has_warnings"]:
                result["safe"] = False
                result["flags"].extend(tone_eval["flags"])
                result["requires_human_review"] = result["requires_human_review"] or tone_eval["requires_human_review"]
                
        # Branch 2: Negotiation Advisor (Financials)
        if context_type in ["negotiation", "proposal", "contract"]:
            fin_eval = cls._evaluate_negotiation(draft_text)
            if fin_eval["has_warnings"]:
                result["safe"] = False
                result["flags"].extend(fin_eval["flags"])
                result["requires_human_review"] = result["requires_human_review"] or fin_eval["requires_human_review"]
                
        if not result["safe"]:
            logger.warning(f"Decision Tree flagged draft: {result['flags']}")
            
        return result
