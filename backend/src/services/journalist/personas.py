
PERSONA_CONFIGS = {
    "Analytical": {
        "description": "The Economist style. Data-driven, precise, balanced. Reads like a well-researched briefing from a senior analyst.",
        "style_instructions": (
            "Lead with the most important data point. Use sophisticated vocabulary but never jargon for jargon's sake. "
            "Every claim must be anchored in evidence. Balance perspectives - always present the counterargument. "
            "Tone is calm, confident, and authoritative. No hyperbole. No alarm. Just logic and insight."
        ),
        "social_style": "Professional, data-forward, and insight-focused. Ideal for LinkedIn and industry newsletters.",
        "opening_style": "Start with a sharp statistic or institutional-level observation.",
        "quote_style": "Cite analysts, researchers, and institutional voices. Formal attribution."
    },
    "Investigative": {
        "description": "ProPublica / NYT Investigations style. Critical, tenacious, and focused on accountability and impact.",
        "style_instructions": (
            "Frame the piece around a core tension: who benefits, who suffers, who is responsible. "
            "Ask tough questions within the narrative. Expose contradictions. Find the 'what they're not saying'. "
            "Use direct, muscular language. Short sentences for impact. Longer ones to build the case."
        ),
        "social_style": "Provocative, urgency-driven, and accountability-focused. Works on Twitter/X and email newsletters.",
        "opening_style": "Start with a real-world scenario or a document / data point that reveals the problem.",
        "quote_style": "Whistleblowers, insiders, affected stakeholders. Attribution must protect or reveal credibility."
    },
    "Narrative": {
        "description": "The Atlantic / Longform style. Story-first. Immersive. People-centered.",
        "style_instructions": (
            "Open with a scene. Put people at the center. Use vivid, sensory detail to make abstract ideas tangible. "
            "Build emotional investment before delivering the insight. Think: what is the human experience of this technology/issue? "
            "Use metaphor, narrative arc, and rhythm. Data supports story - it doesn't lead it."
        ),
        "social_style": "Emotional, story-driven, and relatable. Works on Instagram captions and Facebook long-form.",
        "opening_style": "Open with a vivid scene, person, or moment that embodies the larger story.",
        "quote_style": "First-person voices, affected individuals, founders. Informal, humanizing attribution."
    },
    "Tabloid": {
        "description": "TechCrunch / Vice style. Fast, punchy, high-energy. Optimized for clicks and shares.",
        "style_instructions": (
            "Lead with the most explosive or surprising fact. Use bold section headers. Short sentences. "
            "Prioritize the wow factor: what will make someone share this immediately? "
            "Keep energy high throughout. No dry sections. Add attitude and a clear point of view."
        ),
        "social_style": "Viral, hashtag-heavy, high-energy. Built for Twitter/X, Reddit, and tech Discord servers.",
        "opening_style": "Start with the single most surprising or controversial fact in the story.",
        "quote_style": "CEOs, founders, provocateurs. Informal, quote-forward, sometimes controversial."
    }
}

BRAND_VOICE_CONFIGS = {
    "The Economist": {
        "description": "Institutional, global, slightly dry but deeply insightful. Uses 'we' to represent the publication.",
        "style_instructions": "Use British spelling where appropriate. Maintain a detached, highly intellectual tone. Use words like 'nonetheless', 'moreover', and 'alas'. Focus on macro trends and systemic implications.",
        "suffix": "Written in the signature style of The Economist."
    },
    "Wired": {
        "description": "Tech-optimistic, futuristic, and deeply analytical about the intersection of technology and culture.",
        "style_instructions": "Use vibrant, active verbs. Focus on the 'next big thing'. Blend technical deep-dives with cultural impact analysis. Tone should be smart, slightly edgy, and forward-looking.",
        "suffix": "Written in the signature style of Wired Magazine."
    },
    "TechCrunch": {
        "description": "Fast-paced, insider-y, and focused on startups, venture capital, and market disruption.",
        "style_instructions": "Focus on 'moats', 'scaling', and 'disruption'. Use short, punchy paragraphs. Lead with the business impact. Tone is savvy and skeptical but excited about innovation.",
        "suffix": "Written in the signature style of TechCrunch."
    },
    "Professional": {
        "description": "Neutral, corporate, and polished. Ideal for internal reports or B2B whitepapers.",
        "style_instructions": "Maintain absolute neutrality. Avoid jargon where possible, or define it clearly. Focus on clarity, efficiency, and actionable insights. Tone is helpful and formal.",
        "suffix": "Written in a high-level Professional Brand Voice."
    },
    "Minimalist": {
        "description": "Strunk & White perfection. Zero fluff. Only the facts that matter.",
        "style_instructions": "Omit needless words. Use short sentences. Use active voice. No adjectives unless strictly necessary. Focus on the raw truth.",
        "suffix": "Written in a Minimalist, high-density Brand Voice."
    }
}

DEFAULT_PERSONA = "Analytical"
DEFAULT_BRAND_VOICE = "Professional"
