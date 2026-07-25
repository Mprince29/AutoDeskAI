"""
Shared pricing helper - blended (input+output) cost per 1M tokens in USD.
Mirrors the pricing table in frontend/src/components/CostWidget.tsx.
Only non-deprecated models. Last updated: April 2025.
"""

_PRICE_PER_1M: list[tuple[str, float]] = [
    ("gpt-4o",             6.25),
    ("gpt-4o-mini",        0.38),
    ("gpt-4.1",            5.00),
    ("gpt-4.1-mini",       1.00),
    ("o3-mini",            2.75),
    ("o1",                37.50),
    ("claude-opus-4",     45.00),
    ("claude-sonnet-4",    9.00),
    ("claude-haiku-4",     2.40),
    ("claude-3-5-sonnet",  9.00),
    ("claude-3-5-haiku",   2.40),
    ("claude-3-opus",     45.00),
    ("gemini-1.5-pro",     5.63),
    ("gemini-2.0-flash",   0.38),
    ("gemini-2.0-flash",   0.25),
    ("gemini-1.5-pro",     3.13),
    ("gemini-1.5-flash",   0.19),
    ("mistral-large",      4.00),
    ("mistral-small",      0.20),
    ("deepseek-reasoner",  1.37),
    ("deepseek-chat",      0.21),
    ("llama-3.3-70b",      0.69),
    ("llama-3.1-8b",       0.08),
]

_DEFAULT_PRICE = 0.50


def get_price_per_1m(model: str) -> float:
    key = model.lower()
    for name, price in _PRICE_PER_1M:
        if name in key:
            return price
    return _DEFAULT_PRICE


def estimate_cost_usd(tokens: int, model: str) -> float:
    return (tokens / 1_000_000) * get_price_per_1m(model)
