"""
Organizational & Departmental Logic Service

This module houses the high-level business logic for complex multi-step workflows.
Instead of raw tool calls, these tools generate 'WorkflowInstances' and 'WorkflowSteps'
in the database for Human-in-the-Loop review.
"""

from typing import Dict, Any, List
from datetime import datetime, timedelta, timezone
from loguru import logger
from auth.models import User
from models import WorkflowInstance, WorkflowStep

async def create_hiring_workflow(user_email: str, db, candidate_name: str, candidate_email: str, role: str, ctc: str) -> Dict[str, Any]:
    """
    Decomposes a 'Hire' request into a governed multi-step workflow.
    Each step must be approved by the user in the ReviewDashboard.

    Steps:
      1. Research role requirements
      2. Create Offer Letter (Google Doc)
      3. Create NDA (Google Doc)
      4. Send Offer Letter email with PDF attachment
      5. Send NDA email with PDF attachment
      6. Schedule intro meeting
      7. Add candidate to contacts
      8. Invite candidate to Slack workspace + post team welcome
    """
    try:
        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            return {"error": "User not found"}

        safe_name = candidate_name.replace(" ", "_")

        # 1. Create the master Workflow Instance
        wf = WorkflowInstance(
            user_id=user.id,
            goal=f"Hiring Process: {candidate_name} for {role}",
            status="pending"
        )
        db.add(wf)
        db.flush()

        # 2. Define the granular steps
        steps = [
            {
                "num": 1,
                "desc": f"🔍 Research {role} role requirements and market benchmarks",
                "tool": "web_search",
                "input": {
                    "query": f"{role} role responsibilities, market salary CTC {ctc}, required skills 2025"
                }
            },
            {
                "num": 2,
                "desc": f"📄 Create Offer Letter Google Doc for {candidate_name}",
                "tool": "create_document",
                "input": {
                    "title": f"Offer_Letter_{safe_name}",
                    "content": (
                        f"Draft a professional offer letter for {candidate_name} for the position of {role} "
                        f"with a CTC of {ctc}. Include: company letterhead placeholder, date, candidate address, "
                        f"formal salutation, role title, CTC breakdown (base + bonus + benefits), "
                        f"joining date (TBD), reporting manager placeholder, offer validity (7 days), "
                        f"and a signature block. Make it formal and complete."
                    )
                }
            },
            {
                "num": 3,
                "desc": f"🛡️ Create NDA Google Doc for {candidate_name}",
                "tool": "create_document",
                "input": {
                    "title": f"NDA_{safe_name}",
                    "content": (
                        f"Draft a comprehensive Non-Disclosure Agreement for {candidate_name} "
                        f"joining as {role}. Include: parties (Company and {candidate_name}), "
                        f"definition of confidential information, obligations of receiving party, "
                        f"exclusions from confidentiality, term (2 years post-employment), "
                        f"return of materials clause, governing law placeholder, "
                        f"and signature blocks for both parties with date fields."
                    )
                }
            },
            {
                "num": 4,
                "desc": f"📧 Send Offer Letter to {candidate_name} as PDF attachment",
                "tool": "send_email",
                "input": {
                    "to": candidate_email,
                    "subject": f"Offer of Employment – {role}",
                    "body": (
                        f"Dear {candidate_name},\n\n"
                        f"We are delighted to extend this offer of employment for the role of {role}.\n\n"
                        f"Please find the formal offer letter attached as a PDF."
                        f"__OFFER_LETTER_LINK_LINE__"
                        f"Kindly review and revert within 7 days of receipt.\n\n"
                        f"We look forward to welcoming you to the team!\n\n"
                        f"Warm regards,\n{user_email}"
                    ),
                    # __OFFER_LETTER_DOC_ID__ is substituted at execution time with the
                    # Google Doc file_id returned by Step 2 (create_document).
                    "attachment_doc_ids": ["__OFFER_LETTER_DOC_ID__"]
                }
            },
            {
                "num": 5,
                "desc": f"📧 Send NDA to {candidate_name} as PDF attachment",
                "tool": "send_email",
                "input": {
                    "to": candidate_email,
                    "subject": f"Non-Disclosure Agreement – {role} at Our Company",
                    "body": (
                        f"Dear {candidate_name},\n\n"
                        f"Please find attached the Non-Disclosure Agreement required before your joining."
                        f"__NDA_LINK_LINE__"
                        f"Kindly review, sign, and return a copy at your earliest convenience.\n\n"
                        f"Best regards,\n{user_email}"
                    ),
                    # __NDA_DOC_ID__ is substituted at execution time with the
                    # Google Doc file_id returned by Step 3 (create_document).
                    "attachment_doc_ids": ["__NDA_DOC_ID__"]
                }
            },
            {
                "num": 6,
                "desc": f"📅 Schedule Introduction Call with {candidate_name}",
                "tool": "create_calendar_event",
                "input": {
                    "summary": f"Intro Call: {candidate_name} – {role}",
                    "description": f"Welcome call for {candidate_name} joining as {role}. Agenda: team intro, role overview, Q&A.",
                    "attendees": [candidate_email, user_email],
                    "duration_minutes": 30,
                    "start_time": "TBD – update before approving"
                }
            },
            {
                "num": 7,
                "desc": f"👤 Add {candidate_name} to Contacts",
                "tool": "add_contact",
                "input": {
                    "name": candidate_name,
                    "email": candidate_email,
                    "nickname": role
                }
            },
            {
                "num": 8,
                "desc": f"💬 Invite {candidate_name} to Slack workspace + post team welcome",
                "tool": "slack_invite_to_workspace",
                "input": {
                    "invitee_email": candidate_email,
                    "channels": ["general"],
                    "welcome_message": (
                        f"👋 Please welcome *{candidate_name}* who is joining us as *{role}*! "
                        f"We're excited to have them on board. 🎉"
                    )
                }
            },
        ]

        # 3. Save steps to DB
        for s in steps:
            step = WorkflowStep(
                workflow_id=wf.id,
                step_number=s["num"],
                description=s["desc"],
                tool_name=s["tool"],
                tool_input=s["input"],
                status="pending",
                requires_approval=True
            )
            db.add(step)

        db.commit()
        logger.info(f"Hiring workflow created: WF#{wf.id} with {len(steps)} steps for {candidate_name}.")

        return {
            "workflow_id": wf.id,
            "message": (
                f"Hiring workflow for {candidate_name} ({role}) created with {len(steps)} steps. "
                f"Go to the Workflows tab to review and approve each step. "
                f"⚠️ Before approving Steps 4 & 5, update attachment_doc_ids with the "
                f"Google Doc IDs returned by Steps 2 & 3."
            ),
            "steps_count": len(steps),
            "steps_summary": [s["desc"] for s in steps],
        }

    except Exception as e:
        logger.error(f"Failed to create hiring workflow: {e}")
        db.rollback()
        return {"error": str(e)}

async def create_sales_proposal_workflow(user_email: str, db, client_name: str, product_name: str, deal_value: str) -> Dict[str, Any]:
    """Decomposes a Sales Proposal request into a governed multi-step workflow."""
    try:
        user = db.query(User).filter(User.email == user_email).first()
        if not user: return {"error": "User not found"}
        wf = WorkflowInstance(user_id=user.id, goal=f"Sales Proposal: {client_name} for {product_name}", status="pending")
        db.add(wf); db.flush()
        steps = [
            {"num": 1, "desc": f"🔍 Research {client_name}'s recent financial filings and news", "tool": "web_search", "input": {"query": f"{client_name} company news 2024, recent challenges, competitors"}},
            {"num": 2, "desc": f"📄 Draft tailored {product_name} pitch deck slides", "tool": "create_presentation", "input": {"title": f"Pitch_{client_name}", "content": [f"Slide 1: Solving {client_name}'s current pain points", f"Slide 2: Why {product_name} is the best fit"]}},
            {"num": 3, "desc": f"💰 Generate pricing estimate for {deal_value} deal", "tool": "create_spreadsheet", "input": {"title": f"Pricing_{client_name}", "data": [["Item", "Price", "Discount"], ["Software License", deal_value, "10%"]]}},
            {"num": 4, "desc": f"✉️ Draft professional proposal email to {client_name}", "tool": "create_draft", "input": {"to": f"contact@{client_name.lower().replace(' ', '')}.com", "subject": f"Strategic Partnership: {product_name} x {client_name}", "body": "Hi there, based on our research into your recent growth..."}},
            {"num": 5, "desc": f"📅 Schedule follow-up demo with {client_name}", "tool": "create_calendar_event", "input": {"summary": f"Demo: {product_name} x {client_name}", "start_time": "2026-10-15T14:00:00Z", "end_time": "2026-10-15T15:00:00Z"}}
        ]
        for s in steps:
            db.add(WorkflowStep(workflow_id=wf.id, step_number=s["num"], description=s["desc"], tool_name=s["tool"], tool_input=s["input"], status="pending", requires_approval=True))
        db.commit()
        return {"workflow_id": wf.id, "message": f"Sales workflow for {client_name} generated.", "steps_count": len(steps)}
    except Exception as e:
        db.rollback(); return {"error": str(e)}

async def create_content_campaign_workflow(user_email: str, db, topic: str, channels: List[str]) -> Dict[str, Any]:
    """Decomposes a Content Campaign request into a governed multi-step workflow."""
    try:
        user = db.query(User).filter(User.email == user_email).first()
        if not user: return {"error": "User not found"}
        wf = WorkflowInstance(user_id=user.id, goal=f"Content Campaign: {topic}", status="pending")
        db.add(wf); db.flush()
        steps = [
            {"num": 1, "desc": f"🔍 Research trending keywords for {topic}", "tool": "web_search", "input": {"query": f"SEO keywords for {topic} 2024, top questions asked"}},
            {"num": 2, "desc": f"📝 Draft 1,500-word authoritative blog post on {topic}", "tool": "create_document", "input": {"title": f"Blog_{topic.replace(' ', '_')}", "content": f"Comprehensive guide to {topic}..."}},
            {"num": 3, "desc": f"🐦 Create social media snippets for {', '.join(channels)}", "tool": "create_draft", "input": {"recipient": "Social-Queue", "subject": f"Post: {topic}", "body": "Check out our latest deep-dive on..."}},
            {"num": 4, "desc": f"🖼️ Generate image prompts for campaign visuals", "tool": "generate_image", "input": {"prompt": f"Professional realistic office setting debating {topic}, high quality"}}
        ]
        for s in steps:
            db.add(WorkflowStep(workflow_id=wf.id, step_number=s["num"], description=s["desc"], tool_name=s["tool"], tool_input=s["input"], status="pending", requires_approval=True))
        db.commit()
        return {"workflow_id": wf.id, "message": f"Content workflow for {topic} generated.", "steps_count": len(steps)}
    except Exception as e:
        db.rollback(); return {"error": str(e)}

async def create_product_listing_workflow(user_email: str, db, product_name: str, store_type: str) -> Dict[str, Any]:
    """Decomposes a Product Listing request into a governed multi-step workflow."""
    try:
        user = db.query(User).filter(User.email == user_email).first()
        if not user: return {"error": "User not found"}
        wf = WorkflowInstance(user_id=user.id, goal=f"Store Listing: {product_name} on {store_type}", status="pending")
        db.add(wf); db.flush()
        steps = [
            {"num": 1, "desc": f"📊 Competitor price search for {product_name} on {store_type}", "tool": "web_search", "input": {"query": f"Price of {product_name} on {store_type}, competitor listings"}},
            {"num": 2, "desc": f"🏷️ Draft SEO-optimized product title and tags", "tool": "create_document", "input": {"title": f"SEO_{product_name}", "content": "Title: Premium ... Tags: ..."}},
            {"num": 3, "desc": f"✨ Write high-converting product description", "tool": "create_document", "input": {"title": f"Desc_{product_name}", "content": "The ultimate solution for ..."}},
            {"num": 4, "desc": f"📂 Export listing data to CSV for bulk upload", "tool": "create_spreadsheet", "input": {"title": f"CSV_{product_name}", "data": [["Handle", "Title", "Body"], [product_name.lower(), product_name, "Description text"]]}}
        ]
        for s in steps:
            db.add(WorkflowStep(workflow_id=wf.id, step_number=s["num"], description=s["desc"], tool_name=s["tool"], tool_input=s["input"], status="pending", requires_approval=True))
        db.commit()
        return {"workflow_id": wf.id, "message": f"E-commerce workflow for {product_name} generated.", "steps_count": len(steps)}
    except Exception as e:
        db.rollback(); return {"error": str(e)}

async def create_qbr_report_workflow(user_email: str, db, quarter: str, department: str) -> Dict[str, Any]:
    """Decomposes a QBR Report request into a governed multi-step workflow."""
    try:
        user = db.query(User).filter(User.email == user_email).first()
        if not user: return {"error": "User not found"}
        wf = WorkflowInstance(user_id=user.id, goal=f"{quarter} Business Review - {department}", status="pending")
        db.add(wf); db.flush()
        steps = [
            {"num": 1, "desc": f"📈 Pull {quarter} KPI data from core systems", "tool": "web_search", "input": {"query": f"{department} performance metrics {quarter}, internal benchmarks"}},
            {"num": 2, "desc": "🤖 Perform statistical analysis and anomaly detection", "tool": "run_statistical_summary", "input": {"data": f"QBR Data for {department}..."}},
            {"num": 3, "desc": "📝 Write 3-page Executive Summary doc", "tool": "create_document", "input": {"title": f"QBR_Summary_{quarter}", "content": f"Executive summary of {department} performance in {quarter}..."}},
            {"num": 4, "desc": "📊 Draft the QBR presentation deck", "tool": "create_presentation", "input": {"title": f"QBR_Deck_{quarter}", "content": ["Slide 1: Objectives", "Slide 2: Results"]}},
            {"num": 5, "desc": f"✉️ Send review invite to {department} leadership", "tool": "create_draft", "input": {"to": f"{department.lower()}-leadership@company.com", "subject": f"Invite: {quarter} QBR", "body": "Hi everyone, I've prepared the QBR and would like your review..."}}
        ]
        for s in steps:
            db.add(WorkflowStep(workflow_id=wf.id, step_number=s["num"], description=s["desc"], tool_name=s["tool"], tool_input=s["input"], status="pending", requires_approval=True))
        db.commit()
        return {"workflow_id": wf.id, "message": f"QBR workflow for {department} generated.", "steps_count": len(steps)}
    except Exception as e:
        db.rollback(); return {"error": str(e)}
