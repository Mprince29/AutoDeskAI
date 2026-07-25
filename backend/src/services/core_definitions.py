"""
OpenClaw Dynamic Backbone - Core Definitions.
This acts as the source of truth for the 13 Core Agent archetypes and 5 Departmental contexts.
"""

from typing import Dict, List, Any

# ==========================================
# 13 CORE AGENT TYPES (The Horizontal Layer)
# ==========================================
CORE_AGENTS: Dict[str, Dict[str, Any]] = {
    "ROUTER": {
        "name": "Router (Chief of Staff)",
        "description": "Central brain that decides who does what, routes requests, and breaks down complex tasks.",
        "role_seed": "task dispatcher and orchestrator",
        "suggested_capabilities": ["Task Classification", "Delegation", "Dependency Management"]
    },
    "CREATOR": {
        "name": "Creator (Content Generator)",
        "description": "Produces creative outputs, writing, generation, and formatting according to brand rules.",
        "role_seed": "marketing and content creation engine",
        "suggested_capabilities": ["Content Drafting", "Platform Adaptation", "Tone Matching"]
    },
    "SENSOR": {
        "name": "Sensor (Intelligence Engine)",
        "description": "Real-time awareness system monitoring trends, signals, anomalies, and competitors.",
        "role_seed": "eyes and ears of the system to detect changes or trends",
        "suggested_capabilities": ["Trend Monitoring", "Anomaly Detection", "Competitor Tracking"]
    },
    "DISTRIBUTOR": {
        "name": "Distributor (Publishing & Execution)",
        "description": "Executes and distributes outputs across channels, handling APIs and posting schedules.",
        "role_seed": "publishing and output execution layer",
        "suggested_capabilities": ["Content Scheduling", "API Publishing", "Formatting"]
    },
    "OBSERVER": {
        "name": "Observer (Analytics & Reporting)",
        "description": "Reports only (no action). Tracks KPIs, health, and generates insights from data.",
        "role_seed": "analytics dashboard brain focusing purely on measurement",
        "suggested_capabilities": ["KPI Tracking", "Health Monitoring", "Insight Generation"]
    },
    "OPERATIONS": {
        "name": "Operations (Internal Workflow)",
        "description": "Runs internal system discipline, tracking tasks, sprints, deadlines, and internal syncs.",
        "role_seed": "internal project manager and COO",
        "suggested_capabilities": ["Workflow Tracking", "Deadline Management", "Accountability"]
    },
    "RESEARCHER": {
        "name": "Researcher (Deep Intelligence)",
        "description": "Provides high-quality knowledge, deep web searching, data collection, and fact validation.",
        "role_seed": "dedicated analyst and deep dive researcher",
        "suggested_capabilities": ["Deep Web Research", "Fact Verification", "Data Synthesis"]
    },
    "FUNNEL": {
        "name": "Funnel (Conversion Engine)",
        "description": "Optimizes user journeys, captures leads, maps drip campaigns, and maximizes conversion rates.",
        "role_seed": "growth and sales automation conversion system",
        "suggested_capabilities": ["Lead Capture", "Journey Optimization", "A/B Testing Strategies"]
    },
    "MEMORY": {
        "name": "Memory (Personalization Engine)",
        "description": "Learns preferences, maintains long-term context, and provides historic personalization over time.",
        "role_seed": "persistent brain for personalization and tracking",
        "suggested_capabilities": ["Preference Tracking", "Context Maintenance", "Behavior Analytics"]
    },
    # ── PR & Communications Archetypes ──────────────────────────────────────
    "MEDIA_RESEARCHER": {
        "name": "Media Researcher (PR Intelligence)",
        "description": "Builds journalist/influencer/outlet databases, tracks media coverage, and identifies pitch opportunities. The Muck Rack killer.",
        "role_seed": "media intelligence analyst and PR research engine",
        "suggested_capabilities": ["Media Database Building", "Journalist Profiling", "Coverage Tracking", "Pitch Angle Development"]
    },
    "CONTENT_WRITER": {
        "name": "Content Writer (Publication-Grade)",
        "description": "Produces publication-ready long-form articles, press releases, op-eds with real citations and expert voice. Zero AI slop.",
        "role_seed": "investigative journalist and content strategist with editorial standards",
        "suggested_capabilities": ["Long-Form Articles", "Press Releases", "Thought Leadership", "Source-Backed Writing"]
    },
    "STRATEGIST": {
        "name": "Strategist (Consulting-Grade)",
        "description": "Develops McKinsey/Deloitte-grade frameworks, market analyses, competitive positioning with quantified recommendations.",
        "role_seed": "Partner-level management consultant delivering board-ready strategic analysis",
        "suggested_capabilities": ["Market Analysis", "Competitive Intelligence", "Growth Strategy", "Financial Modeling"]
    },
    "MESSAGING_TESTER": {
        "name": "Messaging Tester (Audience Simulator)",
        "description": "A/B tests messaging with simulated audience panels, scores clarity/persuasion/recall, and recommends winning variants.",
        "role_seed": "consumer insights researcher and messaging strategist",
        "suggested_capabilities": ["Message A/B Testing", "Audience Simulation", "Copy Scoring", "Channel Optimization"]
    },
    "CUSTOM": {
        "name": "Custom Core Agent",
        "description": "A fully unique agent type not bound by the standard OpenClaw archetypes.",
        "role_seed": "novel execution agent with unique focus",
        "suggested_capabilities": ["Unique Execution", "Custom Behavior"]
    }
}


# ==========================================
# 5 DEPARTMENTS (The Vertical Contexts)
# ==========================================
DEPARTMENTS: Dict[str, Dict[str, str]] = {
    "SALES": {
        "name": "Revenue & Outreach",
        "description": "Focused on outbound leads, closing deals, CRMs, and front-line revenue.",
    },
    "CONTENT": {
        "name": "Content & Media Production",
        "description": "Focused on social media, blogs, SEO, and audience building.",
    },
    "ECOMMERCE": {
        "name": "E-Commerce & Storefront",
        "description": "Focused on product catalogs, pricing, inventory dynamics, and consumer support.",
    },
    "BUSINESS_OPS": {
        "name": "Internal Business Operations",
        "description": "Focused on finance, HR, internal workflows, IT monitoring, and compliance.",
    },
    "PR_COMMS": {
        "name": "PR & Communications",
        "description": "Public relations, media outreach, message testing, strategic communications, and earned media.",
    },
    "GLOBAL": {
        "name": "Global Context",
        "description": "Operates across the entire system regardless of department (e.g., Global Memory).",
    },
    "CUSTOM": {
        "name": "Custom Department",
        "description": "A unique business sector outside the standard OpenClaw departments.",
    }
}
