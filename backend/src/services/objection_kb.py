"""
Objection Knowledge Base — static rebuttals + social proof for common sales objections.
Used by the objection handling endpoint to inject product-agnostic rebuttal context
into the LLM prompt for stronger, more credible responses.
"""

OBJECTION_REBUTTALS: dict[str, dict[str, str]] = {
    "budget": {
        "reframe": (
            "Reframe cost as ROI: most clients recover the investment within the first quarter "
            "through time savings, reduced churn, or increased conversion rates. "
            "Ask what the cost of NOT solving this problem is — missed revenue, wasted headcount, "
            "or compounding technical debt typically exceeds the solution cost significantly."
        ),
        "social_proof": (
            "Clients who initially flagged budget concerns typically see a 3-5x return "
            "within 6 months. Offer to walk them through a quick ROI calculation customised "
            "to their team size and use case."
        ),
        "concession": (
            "Consider offering a phased rollout or a pilot scope so the initial commitment "
            "is smaller. Monthly billing options, a proof-of-concept at reduced scope, "
            "or a success-based pricing model can lower the entry barrier meaningfully."
        ),
    },
    "wrong_timing": {
        "reframe": (
            "Timing objections often mask other concerns. Acknowledge their timeline and ask "
            "what specifically needs to change before they'd be ready — budget cycle, headcount, "
            "or a pending initiative. Use this to position a future touchpoint precisely."
        ),
        "social_proof": (
            "Many clients who said 'not right now' came back 60-90 days later facing the same "
            "pain point but with more urgency. Planting a seed now means they think of us first "
            "when priorities shift."
        ),
        "concession": (
            "Offer to do a no-commitment discovery call to map out exactly what a future "
            "engagement would look like — so when they ARE ready, implementation can start "
            "immediately rather than going through another sales cycle."
        ),
    },
    "competitor": {
        "reframe": (
            "Acknowledge that they have options and that healthy competition is good for the market. "
            "Ask what criteria are most important to them — then focus the conversation on the "
            "dimensions where differentiation is strongest: support quality, integration depth, "
            "ease of use, or total cost of ownership over 12-24 months."
        ),
        "social_proof": (
            "Many current customers switched from [competitor category] after experiencing "
            "limitations at scale, poor support response times, or hidden fees. "
            "A side-by-side comparison call with a technical stakeholder often reveals "
            "differentiators that aren't apparent from marketing materials."
        ),
        "concession": (
            "Offer a structured bake-off or parallel pilot. Running both solutions for 30 days "
            "against the same use case lets the product speak for itself without requiring "
            "a leap of faith."
        ),
    },
    "no_authority": {
        "reframe": (
            "Respect that they aren't the decision-maker and make them look good to their leadership. "
            "Provide a concise business case document and an executive summary they can forward. "
            "Ask who else should be included in the next conversation."
        ),
        "social_proof": (
            "Often the internal champion who brings a solution to their leadership gets credit "
            "for the business impact it drives. Position yourself as a partner in helping them "
            "build the internal business case."
        ),
        "concession": (
            "Offer to run a tailored demo or workshop directly for the decision-maker's team, "
            "with zero commitment required. Removing friction from the internal sell is often "
            "the fastest way to accelerate the deal."
        ),
    },
    "not_interested": {
        "reframe": (
            "Respect the response and don't push. Acknowledge it gracefully, briefly mention "
            "one concrete outcome other similar companies have achieved, and offer to close "
            "the conversation with an open door — priorities change, and a soft exit is more "
            "memorable than a hard sell."
        ),
        "social_proof": (
            "Some of the best long-term relationships started as a polite 'not interested.' "
            "Staying in light touch — sharing a relevant insight or case study every few months "
            "— keeps the relationship warm without pressure."
        ),
        "concession": (
            "Ask if there's any format or timing that would work better — a brief 15-minute call "
            "in a month, a short email summary instead of a demo, or connecting on LinkedIn "
            "to stay in touch without commitment."
        ),
    },
    "other": {
        "reframe": (
            "Acknowledge the specific concern with empathy, then restate the core value proposition "
            "in terms of the outcome they care most about. Ask clarifying questions to make sure "
            "the concern is fully understood before proposing a path forward."
        ),
        "social_proof": (
            "We have worked through similar concerns with clients across different industries "
            "and team sizes. Sharing a specific example of how a similar objection was resolved "
            "can often reframe the conversation productively."
        ),
        "concession": (
            "Offer flexibility in engagement structure, timeline, or scope. The goal is to find "
            "an entry point that removes risk while still delivering measurable value quickly."
        ),
    },
}


def get_rebuttal(objection_type: str) -> dict[str, str]:
    """Return the rebuttal dict for a given objection type. Falls back to 'other'."""
    return OBJECTION_REBUTTALS.get(objection_type, OBJECTION_REBUTTALS["other"])
