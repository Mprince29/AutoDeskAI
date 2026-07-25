import asyncio
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from mcp_servers.core.google_auth import GoogleAuthManager

router = APIRouter()


# ── Question types ────────────────────────────────────────────────────────────

class QuestionType(str, Enum):
    TEXT = "text"
    PARAGRAPH = "paragraph"
    MULTIPLE_CHOICE = "multiple_choice"
    CHECKBOX = "checkbox"
    DROPDOWN = "dropdown"
    SCALE = "scale"


# ── Request models ────────────────────────────────────────────────────────────

class FormQuestion(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    type: QuestionType
    required: bool = False
    options: Optional[List[str]] = None
    # Scale bounds - only relevant when type == SCALE
    scale_low: int = Field(1, ge=1, le=10)
    scale_high: int = Field(5, ge=1, le=10)


class CreateFormRequest(BaseModel):
    user_email: str
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field("", max_length=2000)
    questions: Optional[List[FormQuestion]] = None


class FormResponsesRequest(BaseModel):
    user_email: str
    form_id: str = Field(..., min_length=1)
    max_results: int = Field(100, ge=1, le=1000)


# ── Question payload builder ──────────────────────────────────────────────────
# Module-level dispatch table: built ONCE at import, O(1) lookup per question.
# Using lambdas so options/scale bounds are evaluated per-question at call time.

def _build_question_payload(q: FormQuestion) -> dict:
    """Return the Google Forms API question sub-dict for a FormQuestion."""
    opts = [{"value": o} for o in (q.options or [])]
    dispatch: Dict[QuestionType, dict] = {
        QuestionType.TEXT:            {"textQuestion": {"paragraph": False}},
        QuestionType.PARAGRAPH:       {"textQuestion": {"paragraph": True}},
        QuestionType.MULTIPLE_CHOICE: {"choiceQuestion": {"type": "RADIO",     "options": opts}},
        QuestionType.CHECKBOX:        {"choiceQuestion": {"type": "CHECKBOX",   "options": opts}},
        QuestionType.DROPDOWN:        {"choiceQuestion": {"type": "DROP_DOWN",  "options": opts}},
        QuestionType.SCALE:           {"scaleQuestion":  {"low": q.scale_low,  "high": q.scale_high}},
    }
    type_def = dispatch.get(q.type, {})
    return {"required": q.required, **type_def}


# ── Answer parser ─────────────────────────────────────────────────────────────
# Google Forms returns different answer structures depending on question type.
# ALL choice types (RADIO, CHECKBOX, DROP_DOWN) also use textAnswers - the
# "value" field contains the selected option label, not an ID.

def _parse_answer(answer_obj: dict) -> Any:
    """Parse any Google Forms answer object into a readable Python value.

    Returns a single string for single-select, a list for multi-select,
    a list of file IDs for file-upload questions, or a score float for grades.
    Returns None if the answer type is unrecognised.
    """
    # Text, short-answer, paragraph, AND choice answers (radio/checkbox/dropdown)
    if "textAnswers" in answer_obj:
        vals = [a.get("value", "") for a in answer_obj["textAnswers"].get("answers", [])]
        return vals[0] if len(vals) == 1 else vals

    # File-upload questions
    if "fileUploadAnswers" in answer_obj:
        return [f.get("fileId", "") for f in answer_obj["fileUploadAnswers"].get("answers", [])]

    # Quiz grade/score
    if "gradeAnswer" in answer_obj:
        return answer_obj["gradeAnswer"].get("score")

    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/create_form")
async def create_form(req: CreateFormRequest):
    service, _ = await GoogleAuthManager.get_service_async("forms", "v1", req.user_email)

    # Step 1: Create form - Google Forms API only accepts `info.title` at creation.
    created = await asyncio.to_thread(
        service.forms().create(body={"info": {"title": req.title}}).execute
    )
    form_id: str = created["formId"]
    responder_url: str = created.get("responderUri", "")

    # Step 2: batchUpdate - description + all questions in a single round-trip.
    requests: List[dict] = []

    if req.description:
        requests.append({
            "updateFormInfo": {
                "info": {"description": req.description},
                "updateMask": "description",
            }
        })

    for idx, q in enumerate(req.questions or []):
        requests.append({
            "createItem": {
                "item": {
                    "title": q.title,
                    "questionItem": {"question": _build_question_payload(q)},
                },
                "location": {"index": idx},
            }
        })

    if requests:
        await asyncio.to_thread(
            service.forms().batchUpdate(
                formId=form_id, body={"requests": requests}
            ).execute
        )

    # Step 3: Publish the form so respondents can access it.
    # As of March 31 2026 API-created forms are unpublished by default.
    # setPublishSettings is only available on Google Workspace accounts;
    # personal Gmail accounts skip this silently - the form is still usable
    # internally and can be manually published from the Forms UI.
    try:
        await asyncio.to_thread(
            service.forms().setPublishSettings(
                formId=form_id,
                body={"publishSettings": {"publishState": {"isPublished": True}}},
            ).execute
        )
    except Exception:
        pass  # Non-Workspace accounts raise 403 - safe to ignore

    return {
        "success": True,
        "form_id": form_id,
        "responder_url": responder_url,
        "title": req.title,
        "question_count": len(req.questions or []),
    }


@router.post("/get_form_responses")
async def get_form_responses(req: FormResponsesRequest):
    service, _ = await GoogleAuthManager.get_service_async("forms", "v1", req.user_email)

    # Fetch form structure and responses concurrently - single round-trip latency.
    form_def_coro = asyncio.to_thread(
        service.forms().get(formId=req.form_id).execute
    )
    responses_coro = asyncio.to_thread(
        service.forms().responses().list(formId=req.form_id).execute
    )
    form_def, raw_results = await asyncio.gather(form_def_coro, responses_coro)

    # Build questionId → question title index: O(N) build, O(1) lookup per answer.
    question_map: Dict[str, str] = {}
    for item in form_def.get("items", []):
        q_item = item.get("questionItem", {})
        q = q_item.get("question", {})
        qid = q.get("questionId")
        if qid:
            question_map[qid] = item.get("title", qid)

    parsed: List[Dict[str, Any]] = []
    for resp in raw_results.get("responses", []):
        parsed.append({
            "response_id": resp.get("responseId"),
            "submitted_at": resp.get("lastSubmittedTime"),
            "answers": {
                question_map.get(qid, qid): _parse_answer(ans)
                for qid, ans in resp.get("answers", {}).items()
            },
        })

    return {
        "success": True,
        "form_id": req.form_id,
        "responses": parsed[: req.max_results],
        "total": len(parsed),
    }
